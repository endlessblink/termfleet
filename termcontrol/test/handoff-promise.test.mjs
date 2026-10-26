import test from 'node:test';
import assert from 'node:assert/strict';
import { brokenHandoff } from '../bridge/bots.mjs';

// Complaint #12 (2026-10-26): 10 of 20 hand-off promises in a week were never kept. Rough-Cut on
// 24 Oct 11:53 said "I'll have an agent start on the P2 and P3 fixes now" and nothing happened for 31 h.
const start = 1000;

test('a promise to hand work to an agent with no hand-off in the turn is caught (real wordings)', () => {
  assert.match(brokenHandoff("Got it. I'll have an agent start on the P2 and P3 fixes now.", [], start), /I'll have an agent/);
  assert.match(brokenHandoff("I'll send all of them to the Mac bugs agent.", [{ role: 'bot', at: 1500 }], start), /I'll send all of them to the Mac bugs agent/);
  assert.match(brokenHandoff('הבנתי. אעביר את זה לטרמינל שעובד על זה.', [], start), /אעביר את זה לטרמינל/);
});

test('a hand-off made in the same turn clears it; a failed one does not', () => {
  assert.equal(brokenHandoff("I'll have an agent fix it.", [{ role: 'handoff', at: 1200, text: 'Fix the menu' }], start), null);
  assert.match(brokenHandoff("I'll have an agent fix it.", [{ role: 'handoff', at: 1200, text: 'NOT started: ...' }], start), /have an agent/);
  assert.match(brokenHandoff("I'll have an agent fix it.", [{ role: 'handoff', at: 500, text: 'older turn' }], start), /have an agent/, 'a hand-off from an earlier turn does not count');
});

test('replies without a hand-off promise are left alone', () => {
  assert.equal(brokenHandoff('The agent finished; the menu works on the tester site.', [], start), null);
  assert.equal(brokenHandoff("I'll check the logs myself.", [], start), null);
});
