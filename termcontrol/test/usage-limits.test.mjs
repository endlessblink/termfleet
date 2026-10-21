import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeUsageFrom, codexUsageFrom, readUsageLimits } from '../bridge/usage-limits.mjs';

const now = Date.UTC(2026, 9, 21, 14, 0);
const inSec = (minutes) => Math.floor((now + minutes * 60_000) / 1000);

test('Claude status-line limits become "N% left, resets at" for 5 hours and the week', () => {
  const claude = claudeUsageFrom({ observedAt: now, rate_limits: { five_hour: { used_percentage: 38, resets_at: inSec(120) }, seven_day: { used_percentage: 11, resets_at: inSec(3000) } } }, now);
  assert.equal(claude.known, true);
  assert.deepEqual(claude.windows.map((w) => [w.kind, w.remainingPercent, w.resetsAt]), [['fiveHour', 62, inSec(120) * 1000], ['weekly', 89, inSec(3000) * 1000]]);
});

test('a window whose reset time passed shows as renewed, not its old number', () => {
  const claude = claudeUsageFrom({ rate_limits: { five_hour: { used_percentage: 97, resets_at: inSec(-5) } } }, now);
  assert.deepEqual(claude.windows, [{ kind: 'fiveHour', remainingPercent: 100, resetsAt: null, renewed: true }]);
});

test('nothing recorded means unknown, never a guess', () => {
  assert.equal(claudeUsageFrom(null, now).known, false);
  assert.equal(codexUsageFrom(null, null, now).known, false);
  // A Codex window with no declared length is not labelled 5-hour or weekly.
  assert.equal(codexUsageFrom({ primary: { used_percent: 30 } }, now, now).known, false);
});

test('Codex windows are named by their declared length; a weekly-only plan shows only the week', () => {
  const weeklyOnly = codexUsageFrom({ primary: { used_percent: 50, window_minutes: 10080, resets_at: inSec(600) }, secondary: null }, now, now);
  assert.deepEqual(weeklyOnly.windows.map((w) => [w.kind, w.remainingPercent]), [['weekly', 50]]);
  const both = codexUsageFrom({ primary: { used_percent: 10, window_minutes: 300 }, secondary: { used_percent: 40, window_minutes: 10080 } }, now, now);
  assert.deepEqual(both.windows.map((w) => [w.kind, w.remainingPercent]), [['fiveHour', 90], ['weekly', 60]]);
});

test('reads the newest Claude file and the newest Codex rollout record from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-usage-'));
  const claudeFile = path.join(dir, 'claude.json');
  fs.writeFileSync(claudeFile, JSON.stringify({ observedAt: now, rate_limits: { five_hour: { used_percentage: 20, resets_at: inSec(60) } } }));
  const day = path.join(dir, 'sessions', '2026', '10', '21');
  fs.mkdirSync(day, { recursive: true });
  const record = (ts, used) => JSON.stringify({ timestamp: new Date(ts).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 10080, resets_at: inSec(900) } } } });
  fs.writeFileSync(path.join(day, 'rollout-a.jsonl'), [record(now - 60_000, 30), record(now - 30_000, 35)].join('\n') + '\n');
  fs.writeFileSync(path.join(day, 'rollout-b.jsonl'), record(now - 90_000, 20) + '\n');
  process.env.TC_CLAUDE_USAGE_FILE = claudeFile;
  process.env.TC_CODEX_SESSIONS_DIR = path.join(dir, 'sessions');
  try {
    const [claude, codex] = readUsageLimits(now).providers;
    assert.equal(claude.windows[0].remainingPercent, 80);
    assert.equal(codex.windows[0].remainingPercent, 65, 'the newest record across rollouts wins');
  } finally {
    delete process.env.TC_CLAUDE_USAGE_FILE;
    delete process.env.TC_CODEX_SESSIONS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
