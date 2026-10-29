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
const snapshot = (sessionId, extra = {}) => ({ usageScope: 'codex-session-cumulative-v1', sessionId, ...extra });
const freshSnapshot = (sessionId, extra = {}) => snapshot(sessionId, {
  baselineKnownZero: true, invocationStartedAt: '2026-10-28T14:00:00.000Z', ...extra,
});
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

test('missing exporter keys preserve local measurements without client construction', t => {
  for (const env of [{}, { LANGFUSE_PUBLIC_KEY: 'test' }, { LANGFUSE_SECRET_KEY: 'test' }]) {
    const { db, monitor, clients } = fixture(t, { env });
    assert.equal(monitor.traceTokenUsage('Quill', 'claude', 'test-model', 10, 5, 0.02), true);
    assert.equal(db.queryEvents({}).length, 1);
    assert.equal(clients.length, 0);
    assert.equal(monitor.getTokenSummary().total.generations, 1);
  }
});

test('resumed Codex snapshots exclude the unknown baseline and count only proven UTC intervals', t => {
  let time = Date.parse('2026-10-28T14:31:00Z');
  const { db, monitor, generations } = fixture(t, { now: () => time });
  monitor.traceTokenUsage('A', 'codex', 'm', 81000, 1200, null, snapshot('session-a', { cachedInputTokens: 79000 }));
  let summary = monitor.getTokenSummary();
  assert.equal(summary.total.inputTokens, 0);
  assert.equal(summary.total.unknownUsageGenerations, 1);
  assert.equal(generations.length, 0, 'unknown cumulative usage must not be exported as consumption');
  time += 60000;
  monitor.traceTokenUsage('A', 'codex', 'm', 81500, 1220, null, snapshot('session-a', { cachedInputTokens: 79400 }));
  summary = monitor.getTokenSummary();
  assert.equal(summary.total.inputTokens, 500);
  assert.equal(summary.total.outputTokens, 20);
  assert.equal(summary.total.cachedInputTokens, 400);
  assert.equal(summary.total.uncachedInputTokens, 100);
  assert.deepEqual(generations[0].usageDetails, { input: 500, output: 20 });
  assert.equal(db.queryEvents({})[1].payload.inputTokens, 81500, 'raw snapshot remains intact');
  assert.equal(summary.measurementCoverage.recentIntervals[0].from, '2026-10-28T14:31:00.000Z');
  assert.equal(summary.measurementCoverage.recentIntervals[0].until, '2026-10-28T14:32:00.000Z');
});

test('snapshot baselines survive monitor recreation without treating renamed bots as new sessions', t => {
  let time = Date.parse('2026-10-28T14:31:00Z');
  const { db, monitor } = fixture(t, { env: {}, now: () => time });
  monitor.traceTokenUsage('A', 'codex', 'm', 100, 10, null, snapshot('session-a'));
  time += 1000;
  const restored = createTokenMonitor({ env: {}, write: db.logEvent, read: db.queryEvents, now: () => time });
  restored.traceTokenUsage('renamed', 'codex', 'm', 140, 15, null, snapshot('session-a'));
  assert.equal(restored.getTokenSummary().total.inputTokens, 40);
  assert.equal(restored.getTokenSummary().total.outputTokens, 5);
});

test('missing identity, changed session, regression and unchanged snapshot never become guessed consumption', t => {
  let time = Date.parse('2026-10-28T14:31:00Z');
  const { monitor } = fixture(t, { env: {}, now: () => time });
  for (const [session, input, output] of [[null, 999, 50], ['a', 100, 10], ['b', 200, 20], ['a', 90, 9], ['a', 90, 9], ['b', 200, 20]]) {
    monitor.traceTokenUsage('A', 'codex', 'm', input, output, null, snapshot(session));
    time += 1000;
  }
  const total = monitor.getTokenSummary().total;
  assert.equal(total.inputTokens, 0);
  assert.equal(total.outputTokens, 0);
  assert.equal(total.unknownUsageGenerations, 5);
  assert.equal(total.unchangedUsageSnapshots, 1);
});

test('new Codex session may use an explicit zero baseline; legacy raw Codex totals stay unknown', t => {
  const { db, monitor } = fixture(t);
  db.logEvent('legacy', 'A', 'codex', 'token_usage', { inputTokens: 81000000, outputTokens: 120000 });
  monitor.traceTokenUsage('A', 'codex', 'm', 15, 3, null, snapshot('new', {
    baselineKnownZero: true, invocationStartedAt: '2026-10-28T14:00:00.000Z', cachedInputTokens: 10,
  }));
  const summary = monitor.getTokenSummary();
  assert.equal(summary.total.inputTokens, 15);
  assert.equal(summary.total.outputTokens, 3);
  assert.equal(summary.total.unknownUsageGenerations, 1);
  assert.equal(summary.measurementCoverage.recentIntervals[0].from, '2026-10-28T14:00:00.000Z');
  assert.equal(db.queryEvents({})[0].payload.inputTokens, 81000000);
});

test('failed snapshot write does not advance a baseline or export overlapping consumption', t => {
  let time = Date.parse('2026-10-28T14:31:00Z'), fail = false;
  const { db, generations } = fixture(t);
  const monitor = createTokenMonitor({ env: configured, now: () => time, read: db.queryEvents,
    write: (...args) => fail ? false : db.logEvent(...args),
    Client: class { on() {} generation(body) { generations.push(body); } },
  });
  monitor.traceTokenUsage('A', 'codex', 'm', 100, 10, null, snapshot('write-failure'));
  time += 1000; fail = true;
  assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', 120, 12, null, snapshot('write-failure')), false);
  assert.equal(generations.length, 0);
  time += 1000; fail = false;
  monitor.traceTokenUsage('A', 'codex', 'm', 140, 15, null, snapshot('write-failure'));
  const summary = monitor.getTokenSummary();
  assert.equal(summary.total.inputTokens, 40);
  assert.equal(summary.measurementHealth.writeFailures, 1);
  assert.equal(summary.measurementCoverage.recentIntervals[0].from, '2026-10-28T14:31:00.000Z');
  assert.deepEqual(generations[0].usageDetails, { input: 40, output: 5 });
});

test('future zero baseline and impossible cache increments stay unknown', t => {
  let time = Date.parse('2026-10-28T14:31:00Z');
  const { monitor } = fixture(t, { env: {}, now: () => time });
  monitor.traceTokenUsage('A', 'codex', 'm', 10, 2, null, snapshot('future', {
    baselineKnownZero: true, invocationStartedAt: '2026-10-28T14:32:00Z',
  }));
  monitor.traceTokenUsage('A', 'codex', 'm', 100, 10, null, snapshot('cache-invalid', { cachedInputTokens: 50 }));
  time += 1000;
  monitor.traceTokenUsage('A', 'codex', 'm', 110, 11, null, snapshot('cache-invalid', { cachedInputTokens: 80 }));
  assert.equal(monitor.getTokenSummary().total.inputTokens, 0);
  assert.equal(monitor.getTokenSummary().total.unknownUsageGenerations, 3);
});

test('regressed counter chains remain quarantined across restart instead of counting a replayed prefix twice', t => {
  let time = Date.parse('2026-10-28T14:31:00Z');
  const { db, monitor } = fixture(t, { env: {}, now: () => time });
  for (const input of [100, 150, 100]) {
    monitor.traceTokenUsage('A', 'codex', 'm', input, 10, null, snapshot('same-session'));
    time += 1000;
  }
  const restored = createTokenMonitor({ env: {}, read: db.queryEvents, write: db.logEvent, now: () => time });
  for (const input of [150, 180]) {
    restored.traceTokenUsage('A', 'codex', 'm', input, 10, null, snapshot('same-session'));
    time += 1000;
  }
  let summary = restored.getTokenSummary();
  assert.equal(summary.total.inputTokens, 50, 'later recovery of the old counters is not a proven new epoch');
  assert.equal(summary.total.unknownUsageGenerations, 4);
  assert.equal(db.queryEvents({}).at(-1).payload.interval.reason, 'baseline-chain-invalidated');
  restored.traceTokenUsage('A', 'codex', 'm', 20, 3, null, freshSnapshot('genuinely-new-session'));
  summary = restored.getTokenSummary();
  assert.equal(summary.total.inputTokens, 70, 'a distinct known-new session remains measurable');
});

test('mocked Langfuse gets metadata and usage only; SQLite supplies cached per-bot/provider totals', t => {
  let time = Date.now();
  const { db, monitor, generations, clients } = fixture(t, { now: () => time });
  monitor.traceTokenUsage('Quill', 'claude', 'claude-test', 12, 3, 0.02);
  monitor.traceTokenUsage('Quill', 'codex', 'codex-test', 10, 5, null, freshSnapshot('quill'));
  monitor.traceTokenUsage('Desk', 'claude', 'claude-test', 8, 2, 0);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].baseUrl, 'https://cloud.langfuse.com');
  assert.deepEqual(generations[0].usageDetails, { input: 12, output: 3 });
  assert.deepEqual(generations[0].costDetails, { total: 0.02 });
  assert.equal('costDetails' in generations[1], false);
  assert.equal('input' in generations[0], false);
  assert.equal('output' in generations[0], false);
  const summary = monitor.getTokenSummary();
  assert.deepEqual(summary.total, { generations: 3, inputTokens: 30, outputTokens: 10, cost: 0.02, unknownCostGenerations: 1, cachedInputTokens: 0, uncachedInputTokens: 0, unknownCacheGenerations: 3,
    usageObservations: 3, unknownUsageGenerations: 0, unchangedUsageSnapshots: 0 });
  assert.equal(summary.byBot.find(b => b.botName === 'Quill').generations, 2);
  assert.equal(summary.byProvider.find(p => p.provider === 'claude').inputTokens, 20);
  summary.total.inputTokens = -1;
  db.logEvent('other', 'Desk', 'claude', 'token_usage', { model: 'test', inputTokens: 7, outputTokens: 1, cost: null });
  assert.equal(monitor.getTokenSummary().total.inputTokens, 30);
  time += 5001;
  assert.equal(monitor.getTokenSummary().total.inputTokens, 37);
  monitor.traceTokenUsage('Desk', 'claude', 'test', 1, 1);
  assert.equal(monitor.getTokenSummary().total.inputTokens, 38);
});

test('custom host, invalid counts and exporter/storage failures are safe', t => {
  const { monitor, clients } = fixture(t, { env: { ...configured, LANGFUSE_HOST: 'https://example.invalid' } });
  for (const input of [-1, NaN, Infinity, '10', 0.5]) assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', input, 1), false);
  assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', 1, 1, -1), false);
  monitor.traceTokenUsage('A', 'claude', 'm', 0, 0, 0);
  assert.equal(clients[0].baseUrl, 'https://example.invalid');
  const broken = createTokenMonitor({ env: configured, Client: class { constructor() { throw Error('offline'); } }, write() { throw Error('disk'); } });
  assert.doesNotThrow(() => broken.traceTokenUsage('A', 'claude', 'm', 1, 2, 0));
});

test('summary pages beyond 1000 events and never queries the remote client', t => {
  const { db, monitor, clients } = fixture(t);
  for (let i = 0; i < 1005; i++) db.logEvent('bot-token:A', 'A', 'claude', 'token_usage', { inputTokens: 1, outputTokens: 2 });
  assert.equal(monitor.getTokenSummary().total.generations, 1005);
  assert.equal(monitor.getTokenSummary().total.outputTokens, 2010);
  assert.equal(clients.length, 0);
});

test('completed totals include Claude cache tokens once and preserve Codex input totals', () => {
  assert.deepEqual(brainTokenUsage('codex', { type: 'turn.completed', usage: { input_tokens: 30, cached_input_tokens: 20, output_tokens: 4 } }, 'gpt-test'),
    [{ model: 'gpt-test', inputTokens: 30, outputTokens: 4, cost: null, cachedInputTokens: 20, usageScope: 'codex-session-cumulative-v1' }]);
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
      { type: 'thread.started', thread_id: 'fixture-fresh-thread' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Ready' } },
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 6, output_tokens: 2 } },
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
  assert.equal(monitor.getTokenSummary().total.cachedInputTokens, 6);
  assert.equal(monitor.getTokenSummary().total.uncachedInputTokens, 4);
  assert.equal(monitor.getTokenSummary().total.unknownCacheGenerations, 1);
});

test('resumed caller never invents a zero baseline when thread.started changes identity or is missing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-token-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'codex');
  for (const threadId of ['existing-session', 'unexpected-replacement', null]) {
    const { monitor } = fixture(t, { env: {} });
    const events = [
      ...(threadId ? [{ type: 'thread.started', thread_id: threadId }] : []),
      { type: 'item.completed', item: { type: 'agent_message', text: 'Ready' } },
      { type: 'turn.completed', usage: { input_tokens: 81000, cached_input_tokens: 79000, output_tokens: 1200 } },
    ];
    fs.writeFileSync(bin, `#!/bin/sh\ncat <<'TOKEN_FIXTURE'\n${events.map(e => JSON.stringify(e)).join('\n')}\nTOKEN_FIXTURE\n`, { mode: 0o700 });
    const observed = [];
    const result = await runBrain({ id: 'token-test', name: 'Quill', cwd: root, provider: 'codex', sessions: { codex: 'existing-session' } }, 'test', {
      bins: { codex: bin }, env: { PATH: '/usr/bin:/bin', TERMFLEET_GENTLE_BRAINS: '0' },
      onUsage: (...args) => { observed.push(args.at(-1)); return monitor.traceTokenUsage(...args); },
    });
    assert.equal(result.text, 'Ready');
    assert.equal(observed[0].baselineKnownZero, false);
    assert.equal(observed[0].sessionId, threadId || 'existing-session');
    assert.equal(monitor.getTokenSummary().total.inputTokens, 0);
    assert.equal(monitor.getTokenSummary().total.unknownUsageGenerations, 1);
  }
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
  assert.equal(summary.total.inputTokens, 0, 'unscoped historical Codex usage cannot prove consumption');
  assert.equal(summary.total.outputTokens, 0);
  assert.equal(summary.total.unknownUsageGenerations, 1);
  assert.equal(summary.byBot[0].botName, 'Quill');
  assert.equal(summary.byProvider[0].provider, 'codex');
});

// Missing and invalid cache counters must not become fabricated zero-cache usage.
test('cache breakdown covers only valid reported subsets and retains historical unknowns', t => {
  const { monitor, db, generations } = fixture(t);
  monitor.traceTokenUsage('A', 'codex', 'm', 30, 4, null, freshSnapshot('cache-a', { cachedInputTokens: 20 }));
  monitor.traceTokenUsage('A', 'codex', 'm', 10, 2, null, freshSnapshot('cache-b', { cachedInputTokens: 0 }));
  let id = 0;
  for (const value of [undefined, null, -1, 11, NaN, '5']) {
    monitor.traceTokenUsage('A', 'codex', 'm', 10, 1, null, freshSnapshot(`invalid-${id++}`, { cachedInputTokens: value }));
  }
  db.logEvent('legacy', 'A', 'claude', 'token_usage', { inputTokens: 7, outputTokens: 1 });
  const total = monitor.getTokenSummary().total;
  assert.equal(total.inputTokens, 107);
  assert.equal(total.cachedInputTokens, 20);
  assert.equal(total.uncachedInputTokens, 20);
  assert.equal(total.unknownCacheGenerations, 7);
  assert.deepEqual(generations[0].usageDetails, { input: 30, output: 4 });
  assert.equal(generations[0].metadata.cachedInputTokens, 20);
  assert.equal(generations[0].metadata.uncachedInputTokens, 10);
});

test('local persistence failure is reported without throwing or constructing an exporter', () => {
  const monitor = createTokenMonitor({ env: {}, write() { throw Error('disk'); } });
  assert.equal(monitor.traceTokenUsage('A', 'codex', 'm', 10, 2), false);
});


test('fake Codex stream keeps replying while exposing failed measurement writes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-token-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'codex');
  fs.writeFileSync(bin, `#!/bin/sh
cat <<'TOKEN_FIXTURE'
${JSON.stringify({ type: 'thread.started', thread_id: 'fixture-fresh-thread' })}
${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Ready' } })}
${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 6, output_tokens: 2 } })}
TOKEN_FIXTURE
`, { mode: 0o700 });
  for (const write of [() => { throw Error('disk private detail'); }, () => null, () => false]) {
    const { monitor, clients } = fixture(t, { env: {}, write });
    // Cache a clean summary first; a failure must invalidate it immediately.
    assert.equal(monitor.getTokenSummary().measurementHealth.writeFailures, 0);
    const result = await runBrain({ id: 'token-test', name: 'Quill', cwd: root, provider: 'codex', sessions: {} }, 'test', {
      bins: { codex: bin }, env: { PATH: '/usr/bin:/bin', TERMFLEET_GENTLE_BRAINS: '0' }, onUsage: monitor.traceTokenUsage,
    });
    assert.equal(result.text, 'Ready');
    const summary = monitor.getTokenSummary();
    assert.equal(summary.total.generations, 0);
    assert.equal(summary.measurementHealth.writeFailures, 1);
    assert.ok(summary.measurementHealth.lastWriteFailureAt);
    assert.equal(JSON.stringify(summary).includes('private detail'), false);
    assert.equal(clients.length, 0);
  }
});
