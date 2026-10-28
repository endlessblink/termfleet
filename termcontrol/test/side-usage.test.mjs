import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSide, recordSideUsage } from '../bridge/side-reply.mjs';
import { createTokenMonitor } from '../bridge/token-monitor.mjs';

const bot = { id: 'aaaaaaaaaaaa', name: 'Usage fixture', provider: 'codex', model: 'fixture-model' };
const thread = { type: 'thread.started', thread_id: 'fresh-side-thread' };
const usage = { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 30, output_tokens: 7 } };
const answer = { type: 'item.completed', item: { type: 'agent_message', text: 'REPLY: A grounded status.\nPASS_ON: no' } };

async function fixture(t, events, options = {}, exitCode = 0, hang = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-side-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'fake-codex.mjs');
  const out = events.map(event => typeof event === 'string' ? event : JSON.stringify(event)).join('\n');
  fs.writeFileSync(bin, `#!/usr/bin/env node\nif(${hang})setInterval(()=>{},1000);const out=${JSON.stringify(out)};process.stdout.write(out.slice(0,17));process.stdout.write(out.slice(17),()=>{process.exitCode=${exitCode};});`, { mode: 0o755 });
  return runSide(bot, 'Read-only fixture.', { bins: { codex: bin }, cwd: dir,
    env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' }, ...options });
}

test('actual side subprocess records fresh Codex usage once without changing its answer', async t => {
  const rows = [];
  const monitor = createTokenMonitor({ env: {}, read: () => [], write: (...args) => {
    rows.push({ terminal_id: args[0], bot_name: args[1], provider: args[2], payload: args[4] }); return rows.length;
  } });
  const result = await fixture(t, [thread, answer, usage, usage], { onUsage: monitor.traceTokenUsage });
  assert.equal(result.text, answer.item.text);
  assert.equal(rows.length, 2, 'usage survives chunking and a missing trailing newline');
  assert.equal(rows[0].payload.sessionId, thread.thread_id);
  assert.equal(rows[0].payload.surface, 'bot-side-reply');
  assert.equal(rows[0].payload.interval.status, 'interval');
  assert.equal(rows[0].payload.interval.baseline, 'new-thread-zero');
  assert.equal(rows[0].payload.interval.inputTokens, 120);
  assert.equal(rows[0].payload.interval.cachedInputTokens, 30);
  assert.equal(rows[1].payload.interval.status, 'unchanged', 'duplicate snapshot is not a second generation');
});

test('a failed side process still records emitted usage', async t => {
  const recorded = [];
  const result = await fixture(t, [thread, usage], { onUsage: (...args) => recorded.push(args) }, 1);
  assert.ok(result.error);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][3], 120);
});

test('monitor failures never alter the generated side answer', async t => {
  const result = await fixture(t, [thread, answer, usage], { onUsage: () => { throw new Error('monitor unavailable'); } });
  assert.equal(result.text, answer.item.text);
});

test('missing usage is not invented and missing thread cannot claim a fresh baseline', async t => {
  const recorded = [];
  await fixture(t, ['not-json', answer], { onUsage: (...args) => recorded.push(args) });
  assert.equal(recorded.length, 0);
  await fixture(t, [answer, usage], { onUsage: (...args) => recorded.push(args) });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][6].sessionId, null);
  assert.equal(recorded[0][6].baselineKnownZero, false);
});

test('reported usage survives timeout termination of a side process', async t => {
  const recorded = [];
  const result = await fixture(t, [thread, usage], { timeoutMs: 200, onUsage: (...args) => recorded.push(args) }, 0, true);
  assert.ok(result.error);
  assert.equal(recorded.length, 1);
});

test('Claude side results reuse per-model cache and cost accounting without launching a provider', () => {
  const recorded = [];
  recordSideUsage({ ...bot, provider: 'claude' }, JSON.stringify({ type: 'result', modelUsage: {
    'fixture-claude': { inputTokens: 10, cacheReadInputTokens: 20, cacheCreationInputTokens: 5, outputTokens: 4, costUSD: 0.25 },
  } }), (...args) => recorded.push(args), new Date().toISOString());
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].slice(1, 6), ['claude', 'fixture-claude', 35, 4, 0.25]);
  assert.equal(recorded[0][6].surface, 'bot-side-reply');
});
