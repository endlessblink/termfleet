import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsReady, extractConditions, unmetConditions } from '../bridge/conditions.mjs';

// His real ask in the Agent-Manager chat, 27 Oct 2026.
const ASK = 'at least 3 mockups from the interface using impeccable';
test('his stated conditions are pulled out of his words', () => {
  assert.deepEqual(extractConditions(ASK), { min: 3, choose: true, skill: 'impeccable' });
  assert.equal(extractConditions('לפחות שלושה מוקאפים לבחור מהם').min, 3);
  assert.deepEqual(extractConditions('תתקן את הכפתור'), {});
});

test('a ready reply with one picture, or a live build with no options, is refused with a plain reason', () => {
  const c = extractConditions(ASK);
  const one = unmetConditions(c, { reply: 'The dashboard mockup is ready.', shown: 1 });
  assert.ok(one.some((r) => /at least 3/.test(r)));
  const live = unmetConditions(c, { reply: 'I integrated the panels into the interface and it is live. impeccable used.', shown: 0 });
  assert.ok(live.some((r) => /Nothing goes live/.test(r)));
});

test('three options shown with the named skill passes, and an honest "not ready" is left alone', () => {
  const c = extractConditions(ASK);
  assert.deepEqual(unmetConditions(c, { reply: 'Three mockups ready, designed with impeccable. Pick one.', shown: 3 }), []);
  assert.deepEqual(unmetConditions(c, { reply: 'Not ready yet: only one mockup so far.', shown: 1 }), []);
});

test('his real Hebrew words, typos included (16:38 27 Oct)', () => {
  assert.deepEqual(extractConditions(['תעצב את זה ותן לי מוקאפטים לבחור', 'תשתמש בimpacable']), { choose: true, skill: 'impeccable' });
  assert.equal(claimsReady('כשהמוקאפים יהיו מוכנים תקבל אותם כאן'), false, 'future is not a claim');
  assert.equal(claimsReady('שלושה מוקאפים מוכנים — כל אחד עם גרסת דסקטופ'), true);
  assert.deepEqual(unmetConditions({ choose: true }, { reply: 'אתה צודק, טעיתי. הכל מוכן.', shown: 0 }), []);
});
