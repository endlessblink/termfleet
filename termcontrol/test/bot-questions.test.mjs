import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseQuestion, QUESTION_RULE, markRepeatedQuestions, sameQuestion } from '../bridge/bot-questions.mjs';
import { Bots, brainBrief } from '../bridge/bots.mjs';

// Noam 2026-10-20: "use the question tool always + in english for grill me and any other questions".
test('a [question] block becomes a card with answers and the recommended one', () => {
  const r = parseQuestion('I recommend the VPS because it never sleeps.\n\n[question]\nQuestion 1: Where should the bots run?\n- Contabo VPS (recommended)\n- This PC\n- A new cloud server\n[/question]\n');
  assert.equal(r.text, 'I recommend the VPS because it never sleeps.');
  assert.deepEqual(r.question, { text: 'Question 1: Where should the bots run?', options: ['Contabo VPS', 'This PC', 'A new cloud server'], recommended: 0 });
});

test('no block, or a block with one answer, stays plain text; at most four answers', () => {
  assert.equal(parseQuestion('Just text.').question, null);
  assert.equal(parseQuestion('[question]\nOk?\n- Yes\n[/question]').question, null);
  const many = parseQuestion('[question]\nPick\n1. a\n2. b\n3. c\n4. d\n5. e\n[/question]');
  assert.deepEqual(many.question.options, ['a', 'b', 'c', 'd']);
  assert.equal(many.text, '');
});

test('every bot is told to ask Noam in English with the card', () => {
  const brief = brainBrief({ name: 'Q', job: 'x' });
  assert.ok(brief.includes(QUESTION_RULE));
  assert.match(QUESTION_RULE, /in English as a question card/);
});

test('the chat stores the question on the bot message so the page can draw buttons', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-q-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-q-bots-')), notify: () => {}, run: async () => ({ text: '[question]\nShip today?\n- Yes (recommended)\n- No\n[/question]' }) });
  const { bot } = bots.create({ name: 'Asker', cwd: os.tmpdir() });
  bots.send(bot.id, 'hi');
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  const reply = bots.messages(bot.id).find((m) => m.role === 'bot');
  assert.equal(reply.text, '');
  assert.deepEqual(reply.question, { text: 'Ship today?', options: ['Yes', 'No'], recommended: 0 });
});

test('the page draws the card and sends a tap as Noam\'s answer', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /function botQuestionHtml/);
  assert.match(page, /m\.question\?botQuestionHtml\(m,\[\.\.\.data\.messages,/);
  assert.match(page, /\.bot-question:not\(\.answered\) \[data-answer\]/);
  assert.match(page, /Write my own answer/);
});

test('the skills list closes when the message is sent, even if it was still loading', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /if\(field\.value!==m\[0\]\)\{picker\.hidden=/);
  assert.match(page, /following=true;picker\.hidden=true;grow\(\);/);
});

// Noam 2026-10-20: "the questions show twice for nothing" (Rough-Cut bot re-asked an open question).
test('a question asked again before Noam replies shows once, the newest; his reply in between keeps both', () => {
  const opts = ['A recording or voice-over', 'An animation in Graphics', 'The whole window closed', "The agent's work"];
  const q = (text, options = opts) => ({ role: 'bot', text: '', question: { text, options } });
  const shown = (msgs) => markRepeatedQuestions(msgs).filter((m) => m.question && !m.repeated).length;
  assert.equal(shown([q('What stopped before it finished?'), { role: 'bot', text: 'Still waiting.' }, q('What stopped before it finished?')]), 1);
  // nearly the same words, or a "Question 2:" prefix, count as the same question
  assert.equal(shown([q('Question 1: What stopped before it finished?'), q('What stopped, before it was finished?')]), 1);
  // the same answers and half the words: the same question reworded
  assert.equal(shown([q('What stopped before it finished?'), q('What stopped right before the finish?')]), 1);
  // ...but not with different answers
  assert.equal(shown([q('What stopped before it finished?'), q('What stopped right before the finish?', ['Yes', 'No'])]), 2);
  // the newest card is the one kept
  assert.equal(markRepeatedQuestions([q('What stopped before it finished?'), q('What stopped before it finished?')])[1].repeated, undefined);
  // he replied in between: both stay (the first one is answered)
  assert.equal(shown([q('What stopped before it finished?'), { role: 'operator', text: 'the recording' }, q('What stopped before it finished?')]), 2);
  // a different question stays
  assert.equal(shown([q('What stopped before it finished?'), q('Where should the bots run?', ['VPS', 'This PC'])]), 2);
  assert.equal(sameQuestion({ text: 'Where should the bots run?', options: ['VPS', 'PC'] }, { text: 'Should the bots get a new name?', options: ['Yes', 'No'] }), false);
  // bots are told not to re-ask an open question
  assert.match(QUESTION_RULE, /never ask it again/);
});

// Noam 2026-10-21 to Freelance-desk_dev: "תשתמש תמיד בכלי השאלות" — the bot answered that
// bots have no question tool, because the rule only ever called it a "card".
test('the rule names the card as the bots\' question tool, so "use the question tool" finds it', () => {
  assert.match(QUESTION_RULE, /question tool/i);
  assert.match(QUESTION_RULE, /no other question tool/i);
  assert.match(QUESTION_RULE, /Hebrew/);
});

test('a card written in a Hebrew conversation still becomes buttons', () => {
  const rlm = '‏';
  const r = parseQuestion(`הנה ההמלצה שלי.\n\n${rlm}[question]${rlm}\n${rlm}לאן לתייק את הקורס?\n${rlm}- להוראה שלך (מומלץ)\n${rlm}– לבינה מעצבת\n${rlm}[/question]`);
  assert.equal(r.text, 'הנה ההמלצה שלי.');
  assert.deepEqual(r.question, { text: 'לאן לתייק את הקורס?', options: ['להוראה שלך', 'לבינה מעצבת'], recommended: 0 });
  const tags = parseQuestion('[שאלה]\nלשלוח היום?\n- כן (recommended)\n- לא\n[/שאלה]');
  assert.deepEqual(tags.question, { text: 'לשלוח היום?', options: ['כן', 'לא'], recommended: 0 });
  const fenced = parseQuestion('טקסט\n```\n[question]\nShip today?\n- Yes (recommended)\n- No\n[/question]\n```');
  assert.equal(fenced.text, 'טקסט');
  assert.deepEqual(fenced.question.options, ['Yes', 'No']);
});

// Noam 2026-10-22: cards already posted twice for the same terminal prompt show once, the newest.
test('identical terminal prompt cards collapse to the newest; a different one and one after his reply stay', async () => {
  const { markRepeatedTerminalAsks } = await import('../bridge/bot-questions.mjs');
  const card = (id, text = 'Push it?') => ({ id, role: 'terminal-ask', pane: 'terminal-h', text, options: [{ key: '1', label: 'Yes' }] });
  const note = (id) => ({ id, role: 'event', text: 'Your terminal agent for "x" is waiting for Noam: "Push it?".' });
  const out = markRepeatedTerminalAsks([card('1'), note('n1'), { id: 'b1', role: 'bot', text: 'still waiting' }, card('2'), note('n2'), card('3', 'Other?')]);
  assert.deepEqual(out.filter((m) => !m.repeated).map((m) => m.id), ['b1', '2', 'n2', '3']);
  const after = markRepeatedTerminalAsks([card('1'), { id: 'o', role: 'operator', text: 'ok' }, card('2')]);
  assert.equal(after.filter((m) => m.repeated).length, 0);
});
