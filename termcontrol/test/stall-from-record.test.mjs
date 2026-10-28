import test from 'node:test';
import assert from 'node:assert/strict';
import { stalledFor, STALL_AFTER_MS } from '../bridge/session-status.mjs';

// 2026-10-26: a Codex terminal lost its backend at 12:45. Its error screen's ticking clock kept the
// output growing ("producing"), its hook still said "working", and the app showed "Working (1h 24m)".
// Screen bytes do not prove progress, but silence alone cannot justify destructive recovery.
const now = 10 * 3600_000;

test('fresh output suppresses a silence diagnosis without proving task progress', () => {
  const pane = { turn: 'working', updatedAt: now - 80 * 60_000 };
  const life = { producing: true };
  assert.equal(stalledFor(pane, life, now, now, now - 80 * 60_000), 0);
  assert.equal(stalledFor(pane, { producing: false }, now, now, now - 80 * 60_000), 80 * 60_000);
});

test('an agent still writing its record is not stalled', () => {
  assert.equal(stalledFor({ turn: 'working', updatedAt: 0 }, { producing: true }, now, now, now - 60_000), 0);
});

test('a short quiet spell under the limit is not a stall', () => {
  assert.equal(stalledFor({ turn: 'working' }, { producing: false }, now, now, now - (STALL_AFTER_MS - 1000)), 0);
});

test('waiting on Noam is never a stall', () => {
  assert.equal(stalledFor({ turn: 'waiting' }, { producing: false }, 1, now, 1), 0);
});

test('without a record the old rule stands: output that keeps moving is not a stall', () => {
  assert.equal(stalledFor({ turn: 'working' }, { producing: true }, now - 90 * 60_000, now), 0);
  assert.equal(stalledFor({ turn: 'working' }, { producing: false }, now - 30 * 60_000, now), 30 * 60_000);
});
