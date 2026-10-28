import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { deadPort } from './helpers/link-server.mjs';
import { brainTokenUsage, createTokenMonitor } from '../bridge/token-monitor.mjs';
import { createEventLog } from '../bridge/events-db.mjs';
import { runBrain } from '../bridge/bots.mjs';

const configured = { LANGFUSE_PUBLIC_KEY: 'test-public', LANGFUSE_SECRET_KEY: 'test-secret' };
function fixture(t, options = {}) {
  const db = createEventLog({ file: ':memory:' });
  t.after(() => db.close());
  const generations = [], clients = [];
  class MockLangfuse {
    constructor(config) { clients.push(config); }
    on() {}
    generation(body) { generations.push(body); }
  }
  const monitor = createTokenMonitor({ env: configured, Client: MockLangfuse, write: db.logEvent, read: db.queryEvents, ...options });
  return { db, monitor, generations, clients };
}

test('missing public or secret key silently does nothing, including no client construction', t => {
  for (const env of [{}, { LANGFUSE_PUBLIC_KEY: 'test' }, { LANGFUSE_SECRET_KEY: 'test' }]) {
    const { db, monitor, clients } = fixture(t, { env });
    assert.equal(monitor.traceTokenUsage('Quill', 'claude', 'test-model', 10, 5, 0.02), false);
    assert.equal(db.queryEvents({}).length, 0);
    assert.equal(clients.length, 0);
    assert.equal(monitor.getTokenSummary().total.generations, 0);
  }
});

test('mocked Langfuse gets metadata and usage only; SQLite supplies cached per-bot/provider totals', t => {
  let time = Date.now();
  const { db, monitor, generations, clients } = fixture(t, { now: () => time });
  monitor.traceTokenUsage('Quill', 'claude', 'claude-test', 12, 3, 0.02);
  monitor.traceTokenUsage('Quill', 'codex', 'codex-test', 10, 5);
  monitor.traceTokenUsage('Desk', 'claude', 'claude-test', 8, 2, 0);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].baseUrl, 'https://cloud.langfuse.com');
  assert.deepEqual(generations[0].usageDetails, { input: 12, output: 3 });
  assert.deepEqual(generations[0].costDetails, { total: 0.02 });
  assert.equal('costDetails' in generations[1], false);
  assert.equal('input' in generations[0], false);
  assert.equal('output' in generations[0], false);
  const summary = monitor.getTokenSummary();
  assert.deepEqual(summary.total, { generations: 3, inputTokens: 30, outputTokens: 10, cost: 0.02, unknownCostGenerations: 1 });
  assert.equal(summary.byBot.find(b => b.botName === 'Quill').generations, 2);
  assert.equal(summary.byProvider.find(p => p.provider === 'claude').inputTokens, 20);
  summary.total.inputTokens = -1;
  db.logEvent('other', 'Desk', 'codex', 'token_usage', { model: 'test', inputTokens: 7, outputTokens: 1, cost: null });
  assert.equal(monitor.getTokenSummary().total.inputTokens, 30);
  time += 5001;
  assert.equal(monitor.getTokenSummary().total.inputTokens, 37);
  monitor.traceTokenUsage('Desk', 'codex', 'test', 1, 1);
  assert.equal(monitor.getTokenSummary().total.inputTokens, 38);
});

test('custom host, invalid counts and exporter/storage failures are safe', t => {
  const { monitor, clients } = fixture(t, { env: { ...configured, LANGFUSE_HOST: 'https://example.invalid' } });
  for (const input of [-1, NaN, Infinity, '10', 0.5]) assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', input, 1), false);
  assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', 1, 1, -1), false);
  monitor.traceTokenUsage('A', 'codex', 'm', 0, 0, 0);
  assert.equal(clients[0].baseUrl, 'https://example.invalid');
  const broken = createTokenMonitor({ env: configured, Client: class { constructor() { throw Error('offline'); } }, write() { throw Error('disk'); } });
  assert.doesNotThrow(() => broken.traceTokenUsage('A', 'claude', 'm', 1, 2, 0));
});

test('summary pages beyond 1000 events and never queries the remote client', t => {
  const { db, monitor, clients } = fixture(t);
  for (let i = 0; i < 1005; i++) db.logEvent('bot-token:A', 'A', 'codex', 'token_usage', { inputTokens: 1, outputTokens: 2 });
  assert.equal(monitor.getTokenSummary().total.generations, 1005);
  assert.equal(monitor.getTokenSummary().total.outputTokens, 2010);
  assert.equal(clients.length, 0);
});

test('completed totals include Claude cache tokens once and preserve Codex input totals', () => {
  assert.deepEqual(brainTokenUsage('codex', { type: 'turn.completed', usage: { input_tokens: 30, cached_input_tokens: 20, output_tokens: 4 } }, 'gpt-test'),
    [{ model: 'gpt-test', inputTokens: 30, outputTokens: 4, cost: null }]);
  const result = { type: 'result', modelUsage: { 'claude-test': { inputTokens: 2, cacheReadInputTokens: 20, cacheCreationInputTokens: 3, outputTokens: 4, costUSD: 0.01 } }, usage: { input_tokens: 999, output_tokens: 999 } };
  assert.deepEqual(brainTokenUsage('claude', result), [{ model: 'claude-test', inputTokens: 25, outputTokens: 4, cost: 0.01 }]);
  assert.deepEqual(brainTokenUsage('claude', { type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 3 } } }), []);
  assert.deepEqual(brainTokenUsage('claude', { type: 'result', usage: { input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.1 }, 'claude-test'),
    [{ model: 'claude-test', inputTokens: 5, outputTokens: 4, cost: 0.1 }]);
});

test('Claude totals parse without a launch, and the Codex response stream reaches the mocked monitor', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-token-brain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { monitor, generations } = fixture(t);
  const claudeResult = { type: 'result', result: 'Ready', usage: { input_tokens: 12, output_tokens: 3 }, total_cost_usd: 0.01 };
  for (const usage of brainTokenUsage('claude', claudeResult, 'claude-test')) {
    monitor.traceTokenUsage('Quill', 'claude', usage.model, usage.inputTokens, usage.outputTokens, usage.cost);
  }
  for (const provider of ['claude', 'codex']) {
    const events = provider === 'codex' ? [
      { type: 'item.completed', item: { type: 'agent_message', text: 'Ready' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
    ] : [
      { type: 'system', subtype: 'init', model: 'claude-test' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Ready' }], usage: { input_tokens: 3, output_tokens: 1 } } },
      { type: 'result', result: 'Ready', usage: { input_tokens: 12, output_tokens: 3 }, total_cost_usd: 0.01 },
    ];
    const bin = path.join(root, provider);
    fs.writeFileSync(bin, `#!/bin/sh\ncat <<'TOKEN_FIXTURE'\n${events.map(e => JSON.stringify(e)).join('\n')}\nTOKEN_FIXTURE\n`, { mode: 0o700 });
    const result = await runBrain({ id: 'token-test', name: 'Quill', cwd: root, provider, sessions: {} }, 'test', {
      bins: { [provider]: bin }, env: { PATH: '/usr/bin:/bin', TERMFLEET_GENTLE_BRAINS: '0' }, onUsage: monitor.traceTokenUsage,
    });
    if (provider === 'claude') {
      assert.match(result.error, /Claude launch denied/);
      assert.equal(generations.length, 1, 'a denied launch records no usage generation');
      continue;
    }
    assert.equal(result.text, 'Ready');
    assert.equal(result.error, null);
  }
  assert.equal(generations.length, 2);
  assert.equal(generations[0].model, 'claude-test');
  assert.equal(generations[1].model, 'unknown');
  assert.equal(monitor.getTokenSummary().total.inputTokens, 22);
});

test('summary route requires authentication and reads persisted usage without Langfuse keys', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-token-http-'));
  const seed = createEventLog({ file: path.join(dir, 'data', 'agent_events.db') });
  seed.logEvent('bot-token:Quill', 'Quill', 'codex', 'token_usage', { inputTokens: 14, outputTokens: 3 });
  seed.close();
  const port = await deadPort();
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    env: { ...process.env, TC_CONFIG_DIR: dir, TC_BOTS_HOME: path.join(dir, 'bots'),
      XDG_DATA_HOME: path.join(dir, 'xdg'), TC_NO_AGENT_HEALTH: '1', TC_HOST: '127.0.0.1', TC_PORT: String(port),
      LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/login'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(ready, 'isolated bridge started');
  assert.equal((await fetch(base + '/api/tokens/summary')).status, 401);
  const setup = await fetch(base + '/setup', { method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ email: 'tokens@example.test', password: 'isolated-fixture-password' }) });
  assert.equal(setup.status, 302);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/tokens/summary', { headers: { cookie } });
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.total.inputTokens, 14);
  assert.equal(summary.total.outputTokens, 3);
  assert.equal(summary.byBot[0].botName, 'Quill');
  assert.equal(summary.byProvider[0].provider, 'codex');
});
