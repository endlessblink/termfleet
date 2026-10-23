// Noam 2026-10-23 ("several questions in one prompt" answered from the Agents view): after the
// first question of a two-question prompt is answered, the terminal shows the second, but its
// earlier text is still above it and the raw screen copy drops letters ("do train?"). The card
// must follow the terminal's own tab bar ("☒ Tools  ☐ Days") to the second question.
import test from 'node:test';
import assert from 'node:assert/strict';
import { questionFromRecords } from '../bridge/asks.mjs';

const pane = { id: 'terminal-q', provider: 'claude', sessionId: 's1' };
const questions = [
  { header: 'Tools', multiSelect: true, question: 'Which tools do you want your gym workouts built around? Pick all that apply.', options: [{ label: 'Kettlebells' }, { label: 'Barbell' }] },
  { header: 'Days', multiSelect: false, question: 'How many days a week do you train?', options: [{ label: 'Two', description: 'Two longer sessions.' }, { label: 'Three' }] },
];
const record = JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name: 'AskUserQuestion', input: { questions } }] } });

test('the second question is current once the tab bar moves on, even with the first still above', () => {
  const screen = '←  ☐ Tools  ☐ Days  ✔ Submit →\nWhich tools do you want your gym workouts built around? Pick all that apply.\n❯ 1. [✓] Kettlebells\n\n❯Next\n\n←  ☒ Tools  ☐ Days \nHow many days a week do train?\n❯Two\nTwo longer sessions.\nThree\n Type something.\n4.Chat bout this\n\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel';
  const ask = questionFromRecords(pane, [record], screen);
  assert.equal(ask.title, questions[1].question);
  assert.equal(ask.questionIndex, 1);
  assert.equal(ask.multiSelect, false);
  assert.deepEqual(ask.questions.map((q) => q.title), questions.map((q) => q.question));
});

test('the first question stays current while its tab is open', () => {
  const screen = '←  ☐ Tools  ☐ Days  ✔ Submit →\nWhich tools do you want your gym workouts built around? Pick all that apply.\n❯ 1. [ ] Kettlebells\n  2. [ ] Barbell';
  assert.equal(questionFromRecords(pane, [record], screen).questionIndex, 0);
});

test('a fully drawn later question wins over an earlier one still on screen', () => {
  const screen = 'Which tools do you want your gym workouts built around? Pick all that apply.\n...\nHow many days a week do you train?\n❯ 1. Two';
  assert.equal(questionFromRecords(pane, [record], screen).questionIndex, 1);
});
