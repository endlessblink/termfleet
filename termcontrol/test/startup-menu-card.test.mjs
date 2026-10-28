import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenPromptAsk, screenPermissionAsk } from '../bridge/asks.mjs';
import { screenStillAsks } from '../bridge/bot-events.mjs';

// Noam 2026-10-27 (Image 19): a terminal sat frozen on Codex's "Hooks need review" menu and nothing
// reached him: "terminals get stuck on these instead of passing it to me through the control agents".
const PANE = { id: 'terminal-x', provider: 'codex', project: 'freelance-desk' };
const CODEX_HOOKS = [
  '',
  '  Hooks need review',
  '  4 hooks are new or changed.',
  '  Hooks can run outside the sandbox after you trust them.',
  '',
  '',
  '› 1. Review hooks',
  '  2. Trust all and continue',
  "  3. Continue without trusting (hooks won't run)",
  '',
  '  enter confirm · esc skip',
].join('\n');

test('the exact Codex hooks screen from his screenshot becomes a question with its three real options', () => {
  const ask = screenPromptAsk(PANE, CODEX_HOOKS);
  assert.ok(ask, 'a card is offered');
  assert.equal(ask.title, 'Hooks need review');
  assert.deepEqual(ask.options.map((o) => [o.key, o.label]), [
    ['1', 'Review hooks'], ['2', 'Trust all and continue'], ['3', "Continue without trusting (hooks won't run)"],
  ]);
  assert.match(ask.detail, /4 hooks are new or changed/);
  assert.match(ask.detail, /outside the sandbox/);
  assert.equal(ask.screenChoice, true, 'the answer is typed as that digit then Enter, like at the PC');
  assert.equal(screenPermissionAsk(PANE, CODEX_HOOKS)?.title, 'Hooks need review');
  assert.equal(screenStillAsks(CODEX_HOOKS), true, 'the card stays live while the menu is on screen');
});

test('once the menu is answered and the program moved on, no card is offered', () => {
  assert.equal(screenPromptAsk(PANE, `${CODEX_HOOKS}\n\n• Working (3s • esc to interrupt)`), null);
  assert.equal(screenStillAsks('› Ask Codex to do anything\n  weekly 18% left'), false);
});

test('ordinary screens and the older Claude menu behave as before', () => {
  assert.equal(screenPromptAsk(PANE, 'user@host:~$ ls\nfile.txt\nuser@host:~$ '), null);
  const claude = [
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. No',
    '',
    'Esc to cancel',
  ].join('\n');
  const ask = screenPromptAsk({ ...PANE, provider: 'claude' }, claude);
  assert.equal(ask?.title, 'Do you want to proceed?');
  assert.deepEqual(ask.options.map((o) => o.label), ['Yes', 'No']);
  // A numbered list in normal output with no menu footer is never a question.
  assert.equal(screenPromptAsk(PANE, '1. Review hooks\n2. Trust all and continue\nHooks need review'), null);
});
