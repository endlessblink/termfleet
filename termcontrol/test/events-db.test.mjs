import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createEventLog } from '../bridge/events-db.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-events-'));
  let now = Date.parse('2026-10-25T10:00:00Z');
  const file = path.join(dir, 'agent_events.db');
  const open = () => createEventLog({ file, now: () => now });
  const db = open();
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, file, open, advance: (ms) => { now += ms; } };
}

test('persists JSON and filters safely across reopen', (t) => {
  const { db, open } = fixture(t);
  db.logEvent('one', 'helper', 'codex', 'message', { text: 'שלום' });
  db.logEvent('two', null, 'claude', 'tool_use', { name: 'Read' });
  assert.equal(db.queryEvents({ terminal_id: 'one', event_type: 'message' })[0].payload.text, 'שלום');
  assert.equal(db.queryEvents({ terminal_id: "' OR 1=1 --" }).length, 0);
  assert.throws(() => db.logEvent('one', null, 'codex', 'invalid', {}));
  db.close();
  const reopened = open();
  try { assert.equal(reopened.queryEvents().length, 2); } finally { reopened.close(); }
});

test('startup deletes only events older than seven days', (t) => {
  const { db, file, open } = fixture(t);
  db.logEvent('one', null, 'codex', 'start', {});
  const raw = new Database(file);
  raw.prepare('UPDATE agent_events SET created_at = ?').run('2026-10-17T10:00:00.000Z');
  raw.close();
  db.logEvent('two', null, 'claude', 'start', {});
  const reopened = open();
  try { assert.deepEqual(reopened.queryEvents().map((e) => e.terminal_id), ['two']); } finally { reopened.close(); }
});

test('groups bots/providers and bounds inferred activity instead of counting long silence as work', (t) => {
  const { db, advance } = fixture(t);
  db.logEvent('one', 'helper', 'codex', 'start', {});
  advance(120_000);
  db.logEvent('one', 'helper', 'codex', 'tool_use', {});
  advance(10_000);
  db.logEvent('one', 'helper', 'codex', 'stall', {});
  advance(20_000);
  db.logEvent('one', 'helper', 'codex', 'close', {});
  advance(3600_000);
  const stats = db.getStats();
  assert.deepEqual(stats.eventsPerBot, [{ bot_name: 'helper', events: 4 }]);
  assert.deepEqual(stats.eventsPerProvider, [{ provider: 'codex', events: 4 }]);
  assert.equal(stats.terminals[0].active_ms, 70_000);
  assert.equal(stats.terminals[0].idle_ms, 80_000);
  assert.equal(stats.terminals[0].state, 'closed');
});

test('observes starts, new messages/tools, stalls and closes once, surviving bridge restart', (t) => {
  const { db, open, advance } = fixture(t);
  const pane = { id: 'one', bot_name: 'helper', provider: 'codex', sessionId: 'chat' };
  const events = [{ kind: 'assistant', at: '2026-10-25T09:00:00Z', text: 'old' }];
  const read = () => events;
  db.observe([pane], read);
  advance(1000);
  events.push({ kind: 'assistant', at: '2026-10-25T10:00:01Z', text: 'new' },
    { kind: 'tool', at: '2026-10-25T10:00:01Z', name: 'Read', summary: 'private input' });
  db.observe([pane], read);
  db.observe([pane], read);
  const reopened = open();
  try {
    reopened.observe([pane], read);
    assert.equal(reopened.queryEvents().length, 3);
    assert.equal(reopened.queryEvents({ event_type: 'tool_use' })[0].payload.name, 'Read');
    assert.equal(JSON.stringify(reopened.queryEvents()).includes('private input'), false);
    advance(61_000);
    reopened.observe([pane], read);
    reopened.observe([], read);
    reopened.observe([], read);
    assert.deepEqual(reopened.queryEvents().map((e) => e.event_type), ['start', 'message', 'tool_use', 'stall', 'close']);
  } finally { reopened.close(); }
});

test('token usage never restores, keeps alive or creates synthetic terminal activity', (t) => {
  const { db, open, advance } = fixture(t);
  db.logEvent('bot-token:helper', 'helper', 'codex', 'token_usage', { inputTokens: 123 });
  db.observe([{ id: 'real', provider: 'codex' }], () => []);
  advance(61_000);
  db.logEvent('real', 'helper', 'codex', 'token_usage', {});
  const reopened = open();
  try {
    reopened.observe([{ id: 'real', provider: 'codex' }], () => []);
    assert.equal(reopened.queryEvents({ terminal_id: 'bot-token:helper' }).length, 1);
    assert.equal(reopened.queryEvents({ terminal_id: 'real', event_type: 'stall' }).length, 1);
    assert.deepEqual(reopened.getStats().terminals.map((row) => row.terminal_id), ['real']);
  } finally { reopened.close(); }
});

test('migrates existing CHECK constraint while preserving rows, IDs and dedup indexes', (t) => {
  const { db, file, open } = fixture(t);
  db.logEvent('real', null, 'codex', 'start', { source_id: 'source' });
  db.close();
  const raw = new Database(file);
  const schema = raw.prepare("SELECT sql FROM sqlite_master WHERE name='agent_events'").get().sql.replace(",'token_usage'", '');
  raw.exec('ALTER TABLE agent_events RENAME TO previous');
  raw.exec(schema);
  raw.exec('INSERT INTO agent_events SELECT * FROM previous; DROP TABLE previous');
  raw.close();
  const migrated = open();
  try {
    assert.equal(migrated.queryEvents()[0].id, 1);
    assert.equal(migrated.logEvent('real', null, 'codex', 'start', { source_id: 'source' }), null);
    assert.ok(migrated.logEvent('token', 'helper', 'codex', 'token_usage', {}));
  } finally { migrated.close(); }
});

test('accepts epoch timestamps, deduplicates streamed message IDs and closes sleeping panes', (t) => {
  const { db, advance } = fixture(t);
  const pane = { id: 'one', provider: 'opencode', profile: { name: 'a label' } };
  db.observe([pane], () => []);
  advance(1000);
  const event = { kind: 'assistant', at: Date.parse('2026-10-25T10:00:01Z'), source_id: 'message:a', text: 'partial' };
  db.observe([pane], () => [event]);
  db.observe([pane], () => [{ ...event, text: 'complete' }]);
  db.observe([{ ...pane, sleeping: true }], () => []);
  assert.deepEqual(db.queryEvents().map((e) => e.event_type), ['start', 'message', 'close']);
  assert.equal(db.queryEvents()[0].bot_name, null);
});

test('real bridge protects statistics and returns stored counts after authentication', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-events-http-'));
  const port = 18000 + Math.floor(Math.random() * 10000);
  const seed = createEventLog({ file: path.join(dir, 'data', 'agent_events.db') });
  seed.logEvent('seed', 'helper', 'codex', 'message', {});
  seed.close();
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    env: { ...process.env, TC_CONFIG_DIR: dir, TC_BOTS_HOME: path.join(dir, 'bots'),
      XDG_DATA_HOME: path.join(dir, 'xdg'), TC_NO_AGENT_HEALTH: '1', TC_HOST: '127.0.0.1', TC_PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/login'); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(ready, 'isolated bridge started');
  // Loopback SQL reads are intentionally available to installed local hooks.
  assert.equal((await fetch(base + '/api/events/stats')).status, 200);
  assert.equal((await fetch(base + '/api/terminals/health')).status, 401);
  const setup = await fetch(base + '/setup', { method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ email: 'events@example.com', password: 'isolated-test-password' }) });
  assert.equal(setup.status, 302);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/events/stats', { headers: { cookie } });
  assert.equal(response.status, 200);
  const stats = await response.json();
  const health = await fetch(base + '/api/terminals/health', { headers: { cookie } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).intervalMs, 120_000);
  assert.ok(stats.eventsPerProvider.some((row) => row.provider === 'codex' && row.events >= 1));
  assert.ok(stats.terminals.some((row) => row.terminal_id === 'seed'));
});

test('health activity ignores synthetic observations and reads latest SQL activity beyond query limits', (t) => {
  const { db, advance } = fixture(t);
  assert.equal(db.lastActivity('one'), null);
  db.logEvent('one', null, 'codex', 'message', {});
  const first = db.lastActivity('one');
  for (let i = 0; i < 1001; i++) { advance(1); db.logEvent('one', null, 'codex', 'token_usage', {}); }
  db.logEvent('one', null, 'codex', 'stall', {});
  db.logEvent('one', null, 'codex', 'close', {});
  assert.equal(db.lastActivity('one'), first);
  advance(1000); db.logEvent('one', null, 'codex', 'tool_use', {});
  assert.ok(db.lastActivity('one') > first);
});
