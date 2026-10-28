import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { evaluateClaudeQuota, createProviderLaunchPolicy } from '../scripts/lib/provider-launch-policy.mjs';

const NOW = Date.parse('2026-10-28T06:00:00Z');
const record = (used = 20, at = NOW, reset = NOW + 3600000) => ({
  observedAt: at,
  rate_limits: {
    five_hour: { used_percentage: used, resets_at: reset / 1000 },
    seven_day: { used_percentage: 10, resets_at: (reset + 86400000) / 1000 },
  },
});
const temp = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termfleet-provider-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('quota uses the exact 85 percent threshold without display rounding', () => {
  assert.equal(evaluateClaudeQuota(record(84.9), null, NOW).allowed, true);
  for (const used of [85, 85.1, 100]) {
    const result = evaluateClaudeQuota(record(used), null, NOW);
    assert.equal(result.allowed, false);
    assert.equal(result.latch.windows.five_hour.resetAt, NOW + 3600000);
  }
});

test('weekly quota independently blocks at 85 percent', () => {
  const value = record();
  value.rate_limits.seven_day.used_percentage = 85;
  assert.equal(evaluateClaudeQuota(value, null, NOW).allowed, false);
});

test('a smaller number in the same window cannot clear a threshold latch', () => {
  const high = evaluateClaudeQuota(record(85), null, NOW);
  assert.equal(evaluateClaudeQuota(record(10), high.latch, NOW).allowed, false);
});

test('elapsed clock or stale pre-reset observation never proves renewal', () => {
  const high = evaluateClaudeQuota(record(85), null, NOW);
  const afterReset = NOW + 3600001;
  assert.equal(evaluateClaudeQuota(record(10), high.latch, afterReset).allowed, false);
  assert.equal(evaluateClaudeQuota(record(10, afterReset, NOW + 3600000), high.latch, afterReset).allowed, false);
});

test('fresh post-reset observation with a later reset and subthreshold usage clears latch', () => {
  const high = evaluateClaudeQuota(record(85), null, NOW);
  const afterReset = NOW + 3600001;
  const renewed = evaluateClaudeQuota(record(10, afterReset, afterReset + 3600000), high.latch, afterReset);
  assert.equal(renewed.allowed, true);
  assert.deepEqual(renewed.latch.windows, {});
});

test('each latched window needs its own verified renewal', () => {
  const value = record(85);
  value.rate_limits.seven_day.used_percentage = 90;
  const high = evaluateClaudeQuota(value, null, NOW);
  const afterReset = NOW + 3600001;
  const next = record(10, afterReset, afterReset + 3600000);
  next.rate_limits.seven_day.resets_at = value.rate_limits.seven_day.resets_at;
  assert.equal(evaluateClaudeQuota(next, high.latch, afterReset).allowed, false);
});

test('missing, stale, future, malformed, partial and expired observations fail closed', () => {
  const partial = record();
  delete partial.rate_limits.seven_day;
  const malformed = record();
  malformed.rate_limits.five_hour.used_percentage = '20';
  for (const value of [null, {}, record(20, NOW - 300001), record(20, NOW + 1), partial, malformed, record(20, NOW, NOW)]) {
    assert.equal(evaluateClaudeQuota(value, null, NOW).allowed, false);
  }
});

test('invalid saved latch fails closed rather than resetting protection', () => {
  for (const latch of [{}, { version: 1, windows: { five_hour: {} } }, { version: 2, windows: {} }]) {
    assert.equal(evaluateClaudeQuota(record(), latch, NOW).allowed, false);
  }
});

test('non-Claude launch leaves disk untouched and remains usable', (t) => {
  const root = path.join(temp(t), 'absent');
  const policy = createProviderLaunchPolicy({ root, now: () => NOW });
  for (const provider of ['codex', 'opencode', 'shell']) assert.equal(policy.assertProviderLaunch(provider).allowed, true);
  assert.equal(fs.existsSync(root), false);
});

test('standing owner-only rule denies Claude even at 84.9 with fresh usage', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'usage'));
  fs.writeFileSync(path.join(root, 'usage/claude.json'), JSON.stringify(record(84.9)));
  const policy = createProviderLaunchPolicy({ root, now: () => NOW });
  assert.throws(() => policy.assertProviderLaunch('claude', { surface: 'test-launch' }), { code: 'CLAUDE_LAUNCH_DENIED' });
  const audit = fs.readFileSync(path.join(root, 'provider-policy/audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, 'owner-approval-required');
  assert.equal(audit[0].surface, 'test-launch');
});

test('agent flags, claimed approval and environment variables cannot grant a launch', (t) => {
  const root = temp(t);
  const previous = process.env.TERMFLEET_CLAUDE_APPROVED;
  process.env.TERMFLEET_CLAUDE_APPROVED = '1';
  t.after(() => previous === undefined ? delete process.env.TERMFLEET_CLAUDE_APPROVED : process.env.TERMFLEET_CLAUDE_APPROVED = previous);
  const policy = createProviderLaunchPolicy({ root, now: () => NOW });
  assert.throws(() => policy.assertProviderLaunch('claude', { approved: true, ownerWords: 'latest', provider: 'claude' }), { code: 'CLAUDE_LAUNCH_DENIED' });
});

test('threshold latch survives policy object recreation and missing usage', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'usage'));
  const file = path.join(root, 'usage/claude.json');
  fs.writeFileSync(file, JSON.stringify(record(85)));
  assert.throws(() => createProviderLaunchPolicy({ root, now: () => NOW }).assertProviderLaunch('claude'));
  fs.unlinkSync(file);
  assert.throws(() => createProviderLaunchPolicy({ root, now: () => NOW + 3600001 }).assertProviderLaunch('claude'));
  const latch = JSON.parse(fs.readFileSync(path.join(root, 'provider-policy/claude-latch.json')));
  assert.equal(latch.windows.five_hour.resetAt, NOW + 3600000);
});

test('corrupt durable state and unavailable audit storage cannot permit a launch', (t) => {
  const root = temp(t);
  const dir = path.join(root, 'provider-policy');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'claude-latch.json'), '{broken');
  const policy = createProviderLaunchPolicy({ root, now: () => NOW });
  assert.throws(() => policy.assertProviderLaunch('claude'), { code: 'CLAUDE_LAUNCH_DENIED' });
  assert.equal(fs.readFileSync(path.join(dir, 'claude-latch.json'), 'utf8'), '{broken');
  fs.unlinkSync(path.join(dir, 'audit.jsonl'));
  fs.mkdirSync(path.join(dir, 'audit.jsonl'));
  assert.throws(() => policy.assertProviderLaunch('claude'), { code: 'CLAUDE_LAUNCH_DENIED', reason: 'audit-unavailable' });
});

test('parallel launch attempts all deny and produce durable audit entries', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'usage'));
  fs.writeFileSync(path.join(root, 'usage/claude.json'), JSON.stringify(record(85)));
  const moduleUrl = new URL('../scripts/lib/provider-launch-policy.mjs', import.meta.url).href;
  const source = `import { parentPort, workerData } from 'node:worker_threads';
    const { createProviderLaunchPolicy } = await import(workerData.moduleUrl);
    try { createProviderLaunchPolicy({ root: workerData.root, now: () => workerData.now }).assertProviderLaunch('claude', { surface: 'parallel' }); parentPort.postMessage('allowed'); }
    catch (e) { parentPort.postMessage(e.code); }`;
  const results = await Promise.all(Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { root, moduleUrl, now: NOW } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  assert.deepEqual(new Set(results), new Set(['CLAUDE_LAUNCH_DENIED']));
  const audit = fs.readFileSync(path.join(root, 'provider-policy/audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(audit.length, 12);
  assert.equal(audit.every((entry) => entry.outcome === 'denied'), true);
  const latch = JSON.parse(fs.readFileSync(path.join(root, 'provider-policy/claude-latch.json')));
  assert.equal(latch.windows.five_hour.resetAt, NOW + 3600000);
});
