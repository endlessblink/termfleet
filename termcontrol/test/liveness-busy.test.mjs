// R-7214: idle Codex terminals repaint a few bytes when the window is focused or resized. That
// blip is not use: it kept 16 finished terminals looking "used in the last few minutes" forever.
// Real work (a Codex turn, a spinner, Noam typing) moves output on consecutive looks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observe } from '../bridge/liveness.mjs';

test('one repaint blip moves "last output" but not "last busy"; output on two looks in a row is busy', () => {
  let s = observe(undefined, 1000, 0);
  assert.deepEqual([s.lastGrewAt, s.lastBusyAt], [null, null], 'first look says nothing');
  s = observe(s, 1080, 60_000);
  assert.deepEqual([s.lastGrewAt, s.lastBusyAt], [60_000, null], 'a lone 80-byte repaint');
  s = observe(s, 1080, 120_000);
  assert.deepEqual([s.lastGrewAt, s.lastBusyAt], [60_000, null]);
  s = observe(s, 5000, 130_000);
  s = observe(s, 9000, 140_000);
  assert.deepEqual([s.lastGrewAt, s.lastBusyAt], [140_000, 140_000], 'output on consecutive looks is real activity');
});
