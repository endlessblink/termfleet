import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Routines, nextRunAt, describeDays, LATE_LIMIT_MS } from '../bridge/routines.mjs';

// Goal 2026-10-12 (Rakazo/guilds routines): "every weekday at 8, ask the agent for
// today's plan" from the phone. A busy agent is waited for, never typed into.
const local = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();

test('the next run lands on a chosen day at the chosen local time', () => {
  // 2026-10-12 is a Monday.
  assert.equal(nextRunAt([1], '08:00', local(2026, 10, 12, 7, 0)), local(2026, 10, 12, 8, 0));
  assert.equal(nextRunAt([1], '08:00', local(2026, 10, 12, 9, 0)), local(2026, 10, 19, 8, 0));
  assert.equal(nextRunAt([0, 1, 2, 3, 4], '08:00', local(2026, 10, 16, 9, 0)), local(2026, 10, 18, 8, 0), 'Friday → Sunday');
  assert.equal(nextRunAt([], '08:00'), null);
  assert.equal(describeDays([4, 3, 2, 1, 0]), 'Sun–Thu');
});

function harness() {
  let clock = local(2026, 10, 12, 7, 59);
  const sent = [];
  const routines = new Routines({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-routines-')), 'r.json'), now: () => clock,
    send: async (pane, text) => { sent.push({ pane: pane.id, text }); return { ok: true }; } });
  return { routines, sent, at: (ms) => { clock = ms; }, now: () => clock };
}

test('a due routine is sent once and moves to its next day', async () => {
  const h = harness();
  const { routine } = h.routines.create({ pane: 'p1', text: 'Plan my day', days: [1, 2], time: '08:00' });
  h.at(local(2026, 10, 12, 8, 0));
  await h.routines.tick([{ id: 'p1', turn: 'idle' }]);
  await h.routines.tick([{ id: 'p1', turn: 'idle' }]);
  assert.deepEqual(h.sent, [{ pane: 'p1', text: 'Plan my day' }]);
  assert.equal(h.routines.data.routines[0].nextRunAt, local(2026, 10, 13, 8, 0));
  assert.equal(routine.lastResult.ok, true);
});

test('a busy agent is waited for, then skipped with a reason after two hours', async () => {
  const h = harness();
  h.routines.create({ pane: 'p1', text: 'Plan my day', days: [1], time: '08:00' });
  h.at(local(2026, 10, 12, 8, 30));
  await h.routines.tick([{ id: 'p1', turn: 'working' }]);
  assert.equal(h.sent.length, 0);
  h.at(local(2026, 10, 12, 9, 0));
  await h.routines.tick([{ id: 'p1', turn: 'idle' }]);
  assert.equal(h.sent.length, 1, 'sent once it was free');
  const second = h.routines.create({ pane: 'p2', text: 'x', days: [1], time: '10:00' }).routine;
  h.at(local(2026, 10, 12, 10, 0) + LATE_LIMIT_MS + 1);
  await h.routines.tick([{ id: 'p2', turn: 'working' }]);
  assert.match(second.lastResult.reason, /busy for two hours/);
});

test('a closed agent is skipped with a reason; bad input is refused', async () => {
  const h = harness();
  const { routine } = h.routines.create({ pane: 'gone', text: 'x', days: [1], time: '08:00' });
  h.at(local(2026, 10, 12, 8, 1));
  await h.routines.tick([]);
  assert.match(routine.lastResult.reason, /closed/);
  assert.ok(h.routines.create({ pane: 'p', text: '', days: [1], time: '08:00' }).error);
  assert.ok(h.routines.create({ pane: 'p', text: 'x', days: [], time: '08:00' }).error);
  assert.ok(h.routines.create({ pane: 'p', text: 'x', days: [1], time: '8am' }).error);
});
