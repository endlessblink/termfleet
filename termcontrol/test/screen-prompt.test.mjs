// Noam 2026-10-20: "דברים כאלו צריכם להיות נגישים דרך הטרמינלים בסלולרי כדי שאוכל לאשר".
// A prompt drawn in the terminal (here: a hook asking to approve a render) must reach the
// phone with its own reason and choices, and a tap must press exactly that choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenPromptAsk, screenPermissionAsk, pendingAsk } from '../bridge/asks.mjs';
import { answerScreenChoice } from '../bridge/send.mjs';

// The bottom of the rough-cut terminal in his picture.
const HOOK = [
  "node /tmp/p23.mjs && sed -i 's/bottom: 6/bottom: 10/' apps/desktop/src/renderer/src/dev-media-tools.tsx && git status --short",
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' Hook PreToolUse:Bash requires confirmation for this command:',
  ' This starts an export/render. Noam must approve it. [settings]',
  ' settings.json to update hooks',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n');

test('a hook prompt on screen becomes the same question, reason and choices', () => {
  const ask = screenPromptAsk({ id: 'p', provider: 'claude', sessionId: 's' }, HOOK);
  assert.equal(ask.title, 'Do you want to proceed?');
  assert.equal(ask.detail, 'This starts an export/render. Noam must approve it.');
  assert.deepEqual(ask.options, [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }]);
  assert.equal(ask.screenChoice, true);
  assert.equal(screenPromptAsk({ id: 'p', provider: 'claude', sessionId: 's' }, HOOK).id, ask.id, 'the same prompt keeps its id, so a tap can be matched to it');
  assert.ok(screenPermissionAsk({ id: 'p', provider: 'shell' }, HOOK), 'reached from the generic screen detector too');
});

test('a Claude pane on a permission prompt offers the on-screen choices, not generic ones', () => {
  const pane = { id: 'p', provider: 'claude', cwd: '/nowhere', sessionId: 'none', turn: 'waiting', vendorStatus: { status: 'waiting', at: 1, waitingFor: 'permission prompt' } };
  assert.deepEqual(pendingAsk(pane, { screen: HOOK }).options.map((o) => o.label), ['Yes', 'No']);
});

test('nothing is read from a screen without an open menu', () => {
  assert.equal(screenPromptAsk({}, 'Do you want to proceed?\n1. Yes\n2. No\n'), null, 'no Esc footer: old text, not a live menu');
  assert.equal(screenPromptAsk({}, ' Do you want to proceed?\n 1. Yes\n\n Esc to cancel'), null, 'one choice is not a menu');
  assert.equal(screenPromptAsk({}, ' Pick one\n 1. Yes\n 2. No\n Esc to cancel'), null, 'needs a question');
});

test('the same screen prompt asked again can be answered again; an unconfirmed answer still blocks', async () => {
  const { ChoiceReceipts } = await import('../bridge/choice-receipts.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const receipts = new ChoiceReceipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rcpt-')), 'r.json'));
  const id = screenPromptAsk({ id: 'p' }, HOOK).id;
  let sends = 0;
  assert.equal((await receipts.send('p', id, '1', async () => { sends++; return { ok: true }; })).ok, true);
  assert.equal(receipts.get('p', id), null, 'answered and seen closed');
  assert.equal((await receipts.send('p', id, '2', async () => { sends++; return { ok: true }; })).ok, true);
  assert.equal(sends, 2);
  await receipts.send('p', id, '1', async () => ({ error: 'still open', uncertain: true }));
  assert.equal(receipts.get('p', id).state, 'uncertain');
  assert.equal((await receipts.send('p', id, '1', async () => { sends++; return { ok: true }; })).uncertain, true);
  assert.equal(sends, 2, 'never re-sent while unconfirmed');
});

const fake = (screens) => {
  const sent = [];
  let i = 0;
  return { sent, opts: { write: async (d) => { sent.push(d); }, screen: async () => screens[Math.min(i++, screens.length - 1)], pause: async () => {}, live: async () => new Set(['p']), record: () => {} } };
};
const prompt = screenPromptAsk({ id: 'p' }, HOOK);

test('a tap presses only the digit when the menu acts on it', async () => {
  const { sent, opts } = fake(['done, prompt gone']);
  assert.equal((await answerScreenChoice({ id: 'p' }, prompt, '1', opts)).ok, true);
  assert.deepEqual(sent, ['1']);
});

test('Enter follows only when the same prompt is still open with the cursor on that choice', async () => {
  const moved = HOOK.replace(' ❯ 1. Yes', '   1. Yes').replace('   2. No', ' ❯ 2. No');
  const { sent, opts } = fake([moved, moved, moved, 'answered']);
  assert.equal((await answerScreenChoice({ id: 'p' }, prompt, '2', opts)).ok, true);
  assert.deepEqual(sent, ['2', '\r']);
  // The answered prompt can still sit in the text above what the program prints next.
  const after = fake([HOOK + '\nanswered: 2\n$ ']);
  assert.equal((await answerScreenChoice({ id: 'p' }, prompt, '2', after.opts)).ok, true);
  assert.deepEqual(after.sent, ['2'], 'old text above is not an open prompt, so no Enter');
  const stuck = fake([HOOK]);
  const r = await answerScreenChoice({ id: 'p' }, prompt, '2', stuck.opts);
  assert.equal(r.uncertain, true);
  assert.deepEqual(stuck.sent, ['2'], 'no Enter while the cursor is on another choice');
});
