import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseQuestion, QUESTION_RULE } from '../bridge/bot-questions.mjs';
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
  assert.match(page, /m\.question\?botQuestionHtml\(m,data\.messages\)/);
  assert.match(page, /\.bot-question:not\(\.answered\) \[data-answer\]/);
  assert.match(page, /Write my own answer/);
});

test('the skills list closes when the message is sent, even if it was still loading', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /if\(field\.value!==m\[0\]\)\{picker\.hidden=/);
  assert.match(page, /following=true;picker\.hidden=true;grow\(\);/);
});
