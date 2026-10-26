import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTerminalId, sessionStartOutput } from '../../scripts/termfleet-sql-history-hook.mjs';

test('terminal identity uses the exact pane or a unique matching conversation, never cwd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-history-'));
  const status = path.join(dir, 'terminal-workspace', 'agent-status'); fs.mkdirSync(status, { recursive: true });
  const env = { XDG_DATA_HOME: dir };
  try {
    fs.writeFileSync(path.join(status, 'pane-one.json'), JSON.stringify({ paneId: 'terminal-one', sessionId: 'one', cwd: '/same' }));
    fs.writeFileSync(path.join(status, 'pane-two.json'), JSON.stringify({ paneId: 'terminal-two', sessionId: 'two', cwd: '/same' }));
    assert.equal(resolveTerminalId({ session_id: 'one', cwd: '/same' }, env), 'terminal-one');
    assert.equal(resolveTerminalId({ session_id: 'missing', cwd: '/same' }, env), null);
    assert.equal(resolveTerminalId({ cwd: '/same' }, env), null);
    assert.equal(resolveTerminalId({ session_id: 'one' }, { ...env, TERMFLEET_PANE_ID: 'terminal-exact' }), 'terminal-exact');
    fs.writeFileSync(path.join(status, 'pane-duplicate.json'), JSON.stringify({ paneId: 'terminal-other', sessionId: 'one' }));
    assert.equal(resolveTerminalId({ session_id: 'one' }, env), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SessionStart queries newest twenty for one terminal and renders chronological metadata with recovery lineage', async () => {
  let calls = 0;
  const events = Array.from({ length: 20 }, (_, i) => ({ id: 100 - i, terminal_id: 'terminal-exact', created_at: new Date(100000 - i * 1000).toISOString(), event_type: 'message', payload: { role: 'assistant', characters: i, content: 'PRIVATE TRANSCRIPT' } }));
  events[3] = { ...events[3], event_type: 'stall', payload: { healthRecovery: { predecessor_terminal_id: 'terminal-exact', commits: ['PRIVATE COMMIT'] } } };
  const result = await sessionStartOutput({}, { env: { TERMFLEET_PANE_ID: 'terminal-exact' }, fetchImpl: async url => {
    calls++; const query = new URL(url);
    assert.equal(query.pathname, '/api/events/query');
    assert.deepEqual(Object.fromEntries(query.searchParams), { terminal_id: 'terminal-exact', limit: '20', order: 'desc' });
    return { ok: true, json: async () => ({ events }) };
  } });
  assert.equal(calls, 1);
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  const text = result.hookSpecificOutput.additionalContext;
  assert.match(text, /newest 20 events/);
  assert.ok(text.indexOf('00:01:21') < text.indexOf('00:01:40'));
  assert.match(text, /Recovery predecessor: terminal-exact/);
  assert.doesNotMatch(text, /PRIVATE TRANSCRIPT|PRIVATE COMMIT/);
});

test('missing identity, unavailable service, and wrong-terminal responses fail open without context', async () => {
  assert.deepEqual(await sessionStartOutput({}, { env: {}, fetchImpl: () => { throw new Error('must not query globally'); } }), {});
  assert.deepEqual(await sessionStartOutput({}, { env: { TERMFLEET_PANE_ID: 'one' }, fetchImpl: async () => { throw new Error('offline'); } }), {});
  assert.deepEqual(await sessionStartOutput({}, { env: { TERMFLEET_PANE_ID: 'one' }, fetchImpl: async () => ({ ok: false }) }), {});
  assert.deepEqual(await sessionStartOutput({}, { env: { TERMFLEET_PANE_ID: 'one' }, fetchImpl: async () => ({ ok: true, json: async () => ({ events: [{ terminal_id: 'other', event_type: 'message' }] }) }) }), {});
});

test('executable hook emits valid empty JSON for malformed input outside TermFleet', () => {
  const env = { ...process.env, XDG_DATA_HOME: '/tmp/nonexistent-tf-sql-hook-fixture' }; delete env.TERMFLEET_PANE_ID;
  const out = spawnSync(process.execPath, ['scripts/termfleet-sql-history-hook.mjs'], { input: 'invalid', encoding: 'utf8', env });
  assert.equal(out.status, 0); assert.deepEqual(JSON.parse(out.stdout), {});
});
