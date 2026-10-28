import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStartHandover } from '../bridge/bots.mjs';

// #25: a bot whose brain conversation starts fresh answered "I don't know which problems you mean".
const chat = [
  { role: 'operator', text: 'The reminders flood my phone, fix it' },
  { role: 'bot', text: 'I handed it to a terminal agent.' },
  { role: 'operator', text: 'Which problems are we talking about?' },
];

test('a fresh brain conversation gets the chat so far, without the message it is about to answer', () => {
  const text = freshStartHandover({ provider: 'claude', sessions: { claude: { started: false } } }, chat, 'Which problems are we talking about?');
  assert.match(text, /Noam: The reminders flood my phone, fix it/);
  assert.match(text, /You: I handed it to a terminal agent\./);
  assert.doesNotMatch(text, /Which problems are we talking about/);
});

test('a running conversation, or a brand-new chat, needs nothing added', () => {
  assert.equal(freshStartHandover({ provider: 'claude', sessions: { claude: { started: true } } }, chat, 'hi'), '');
  assert.equal(freshStartHandover({ provider: 'codex', sessions: { codex: 'abc' } }, chat, 'hi'), '');
  assert.equal(freshStartHandover({ provider: 'claude', sessions: { claude: { started: false } } }, [{ role: 'operator', text: 'first message' }], 'first message'), '');
});

test('Codex with no session yet counts as fresh', () => {
  assert.match(freshStartHandover({ provider: 'codex', sessions: { codex: null } }, chat, 'x'), /The reminders flood/);
});
