import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStalls } from '../bridge/watchdog.mjs';

const now = Date.now();
const minute = 60_000;
const day = 24 * 60 * minute;
function check({ panes = [], items = [], flagged = new Map() } = {}) {
  const messages = [];
  const bots = { list: () => [{ id: 'manager', name: 'Agent Manager' }], append: (id, message) => messages.push(message) };
  const findings = checkStalls({ bots, panes, items, now, flagged, lastAt: p => p.lastWorkedAt, log: () => {} });
  return { findings, messages };
}
const item = (overrides = {}) => ({ id: 'R-test', words: 'Finish the current work', at: now - 90 * minute, status: 'assigned', assigned: [{ pane: 'current', at: now - 60 * minute }], ...overrides });
const pane = (turn = 'working') => ({ id: 'current', turn, lastWorkedAt: now - 60 * minute });

test('closed, idle and waiting terminals never produce request warnings', () => {
  for (const panes of [[], [pane('idle')], [pane('waiting')]]) {
    assert.deepEqual(check({ panes, items: [item()] }).messages, []);
  }
});

test('requests older than 24 hours are excluded even after recent reassignment', () => {
  const { findings } = check({ panes: [pane()], items: [item({ at: now - day - 1 })] });
  assert.equal(findings.filter(f => f.kind === 'item').length, 0);
});

test('old or unknown assignment and request timestamps are excluded', () => {
  for (const request of [item({ at: undefined }), item({ assigned: [{ pane: 'current', at: now - day - 1 }] }), item({ assigned: [{ pane: 'current' }] })]) {
    assert.equal(check({ panes: [pane()], items: [request] }).findings.filter(f => f.kind === 'item').length, 0);
  }
});

test('recent requests on stalled working terminals warn once per episode', () => {
  const flagged = new Map();
  const args = { panes: [pane()], items: [item({ at: now - day })], flagged };
  assert.equal(check(args).findings.filter(f => f.kind === 'item').length, 1);
  assert.equal(check(args).messages.length, 0);
});

test('current working terminals with recent progress do not warn', () => {
  assert.deepEqual(check({ panes: [{ ...pane(), lastWorkedAt: now - minute }], items: [item()] }).messages, []);
});
