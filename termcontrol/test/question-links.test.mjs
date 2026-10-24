import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseQuestion, QUESTION_RULE, needsLink, markWithdrawnQuestions, nearDuplicate, NOTHING_NEW, alreadyAnsweredNote } from '../bridge/bot-questions.mjs';
import { viewHref, resolveView } from '../bridge/question-view.mjs';
import { Bots, brainBrief } from '../bridge/bots.mjs';

// Noam 2026-10-24: "אני חייב חייב חייב חייב שתמיד יהיה לינק עם אופציות!!!!!!!" / "בכל שיחה שהיא"
// (a card asked "Which of the three looks?" with Look A/B/C and nothing to look at).
test('a card carries an "open to compare" link and a link per answer', () => {
  const r = parseQuestion('Here are the looks.\n\n[question]\nWhich of the three looks do you want for the app?\nlink: https://example.com/compare\n- Look A | https://example.com/a (recommended)\n- Look B | https://example.com/b\n- Look C\n[/question]');
  assert.equal(r.text, 'Here are the looks.');
  assert.equal(r.question.text, 'Which of the three looks do you want for the app?');
  assert.equal(r.question.link, 'https://example.com/compare');
  assert.deepEqual(r.question.options, ['Look A', 'Look B', 'Look C']);
  assert.deepEqual(r.question.optionLinks, ['https://example.com/a', 'https://example.com/b', null]);
  assert.equal(r.question.recommended, 0);
});

test('a link in the question line, or in the reply above the card, becomes the card link', () => {
  const inLine = parseQuestion('[question]\nWhich look? See https://example.com/looks\n- A\n- B\n[/question]');
  assert.equal(inLine.question.link, 'https://example.com/looks');
  const above = parseQuestion('The comparison page is ready: https://example.com/page\n\n[question]\nWhich look?\n- A\n- B\n[/question]');
  assert.equal(above.question.link, 'https://example.com/page');
  // a plain choice with nothing to view stays as it was
  const plain = parseQuestion('[question]\nShip today?\n- Yes\n- No\n[/question]');
  assert.equal(plain.question.link, undefined);
  assert.equal(plain.question.optionLinks, undefined);
});

test('a page on the PC opens through the app, on the phone too', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-view-'));
  const dir = path.join(home, 'looks');
  fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'compare.html'), '<img src="img/a.png">');
  fs.writeFileSync(path.join(dir, 'img', 'a.png'), 'png');
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'id.html'), 'secret');
  const href = viewHref(path.join(dir, 'compare.html'), { roots: [home] });
  assert.match(href, /^\/view\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]+\/compare\.html$/);
  // a made-up key, or another folder under the same key, opens nothing
  assert.equal(resolveView(href.replace(/^\/view\/[^/]{22}/, '/view/' + 'A'.repeat(22)), { roots: [home] }), null);
  const other = href.split('/'); other[3] = Buffer.from(home).toString('base64url');
  assert.equal(resolveView(other.join('/'), { roots: [home] }), null);
  const page = resolveView(href, { roots: [home] });
  assert.equal(page.file, fs.realpathSync(path.join(dir, 'compare.html')));
  assert.equal(page.type, 'text/html; charset=utf-8');
  // the page's own pictures load from the same folder
  const pic = resolveView(href.replace('compare.html', 'img/a.png'), { roots: [home] });
  assert.equal(pic.type, 'image/png');
  // nothing outside that folder, no hidden folders, nothing outside home
  assert.equal(resolveView(href.replace('compare.html', '../../etc/passwd'), { roots: [home] }), null);
  assert.equal(viewHref(path.join(home, '.ssh', 'id.html'), { roots: [home] }), null);
  assert.equal(viewHref('/etc/hostname', { roots: [home] }), null);
  // in a card, a file path becomes that link
  const r = parseQuestion(`[question]\nWhich look?\nlink: ${path.join(dir, 'compare.html')}\n- A\n- B\n[/question]`, { roots: [home] });
  assert.equal(r.question.link, href);
});

test('a question about looks or designs with no link is caught; a plain question is not', () => {
  assert.equal(needsLink({ text: 'Which of the three looks do you want for the app?', options: ['Look A', 'Look B', 'Look C'] }), true);
  assert.equal(needsLink({ text: 'Which design should I keep?', options: ['The first', 'The second'] }), true);
  assert.equal(needsLink({ text: 'Which one?', options: ['Version 1', 'Version 2'] }), true);
  assert.equal(needsLink({ text: 'איזה עיצוב לבחור?', options: ['א', 'ב'] }), true);
  assert.equal(needsLink({ text: 'Where should the bots run?', options: ['Contabo VPS', 'This PC'] }), false);
  assert.equal(needsLink({ text: 'Ship today?', options: ['Yes', 'No'] }), false);
  assert.equal(needsLink({ text: 'Which look?', options: ['A', 'B'], link: 'https://x.y/z' }), false);
});

test('every bot is told never to ask him to choose between things he cannot see', () => {
  assert.match(QUESTION_RULE, /link:/);
  assert.match(QUESTION_RULE, /\| <link>/);
  assert.match(QUESTION_RULE, /never ask him to choose between things he cannot see/i);
  assert.ok(brainBrief({ name: 'Q', job: 'x' }).includes(QUESTION_RULE));
});

// Noam 2026-10-24 (same screen): "אין שום סיבה לחזרה הזו!!!!" — an old card stayed live after
// the bot said to ignore it, and the same reply came twice.
test('a question the bot takes back shows as no longer needed', () => {
  const card = (id, text, options = ['Look A', 'Look B', 'Look C']) => ({ id, role: 'bot', text: '', question: { text, options } });
  const out = markWithdrawnQuestions([
    card('q1', 'Which of the three looks do you want for the app?'),
    { id: 'b1', role: 'bot', text: "I'll send you the updated page when it's ready. Until then, ignore the question above.", question: { text: 'Which of the three looks do you want for the app?', options: ['Look A', 'Look B', 'Look C'] } },
    card('q2', 'Should dark mode get brighter colors?', ['Yes', 'No']),
  ]);
  assert.equal(out[0].withdrawn, true);
  assert.equal(out[1].withdrawn, true, 'the same card attached to the message that takes it back is withdrawn too');
  assert.equal(out[2].withdrawn, undefined, 'a new question after it stays live');
  // he answered first: nothing to withdraw
  const answered = markWithdrawnQuestions([card('q1', 'Which look?'), { id: 'o', role: 'operator', text: 'Look A' }, { id: 'b', role: 'bot', text: 'Ignore the question above.' }]);
  assert.equal(answered[0].withdrawn, undefined);
  // Hebrew and plain "no longer needed"
  assert.equal(markWithdrawnQuestions([card('q', 'Which look?'), { id: 'b', role: 'bot', text: 'תתעלם מהשאלה למעלה' }])[0].withdrawn, true);
  assert.equal(markWithdrawnQuestions([card('q', 'Which look?'), { id: 'b', role: 'bot', text: 'That question is no longer needed.' }])[0].withdrawn, true);
  assert.match(QUESTION_RULE, /no longer needed/);
});

test('the page shows a withdrawn card as no longer needed with its buttons off, and draws the links', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /m\.withdrawn/);
  assert.match(page, /No longer needed/);
  assert.match(page, /bot-q-link/);
  assert.match(page, /Open to compare/);
  assert.match(page, /bot-q-optlink/);
});

test('a reply that repeats the one just before it is caught; a different one is not', () => {
  const a = 'Got it. The current colors stay in light mode, and the changes are only to the structure, spacing, button separation and amount of text. For dark mode, the agent will offer two or three more fun color options instead of the muddy brown, and add them to the same comparison page.';
  const b = 'Got it: the current colors stay in light mode, and the changes are only to the structure, spacing, button separation and amount of text. For dark mode the agent will offer two or three more fun color options instead of the muddy brown and add them to the same comparison page.';
  assert.equal(nearDuplicate(a, b), true);
  assert.equal(nearDuplicate(a, 'The food screen is now part of the comparison too.'), false);
  assert.equal(nearDuplicate('', ''), false);
});

test('a waiting message the bot already answered is handed on with the answer, not as new', () => {
  const note = alreadyAnsweredNote('Got it. The current colors stay.');
  assert.match(note, /already replied/);
  assert.match(note, /Do not repeat/);
  assert.match(note, new RegExp(NOTHING_NEW));
});

async function makeBots(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ql-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  return new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ql-bots-')), notify: () => {}, run });
}
const settle = async (bots, id) => { for (let i = 0; i < 4000 && (bots.running.has(id) || (bots.queues.get(id) || []).length); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a card about looks with no link is held back and the bot is told to add the link first', async () => {
  const prompts = [];
  const replies = [
    'Three looks are ready.\n[question]\nWhich of the three looks do you want?\n- Look A\n- Look B\n- Look C\n[/question]',
    '[question]\nWhich of the three looks do you want?\nlink: https://example.com/looks\n- Look A\n- Look B\n- Look C\n[/question]',
  ];
  const bots = await makeBots(async (bot, text) => { prompts.push(text); return { text: replies[prompts.length - 1] || 'ok' }; });
  const { bot } = bots.create({ name: 'Looks', cwd: os.tmpdir() });
  bots.send(bot.id, 'show me the looks');
  await settle(bots, bot.id);
  const shown = bots.messages(bot.id).filter((m) => m.role === 'bot');
  assert.equal(shown[0].text, 'Three looks are ready.');
  assert.equal(shown[0].question, undefined, 'the card without a link is not shown');
  assert.match(prompts[1], /cannot see/);
  assert.equal(shown[1].question.link, 'https://example.com/looks');
});

test('a held card sent again still without a link is shown, so nothing is lost', async () => {
  const card = '[question]\nWhich design do you want?\n- First design\n- Second design\n[/question]';
  let n = 0;
  const bots = await makeBots(async () => { n++; return { text: card }; });
  const { bot } = bots.create({ name: 'Looks2', cwd: os.tmpdir() });
  bots.send(bot.id, 'go');
  await settle(bots, bot.id);
  assert.equal(n, 2);
  const cards = bots.messages(bot.id).filter((m) => m.question);
  assert.equal(cards.length, 1);
});

test('messages answered by the turn they waited behind are not answered again', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const prompts = [];
  const bots = await makeBots(async (bot, text) => {
    prompts.push(text);
    if (prompts.length === 1) { await gate; return { text: 'Got it. The colors stay and dark mode gets brighter options.' }; }
    return { text: NOTHING_NEW };
  });
  const { bot } = bots.create({ name: 'Twice', cwd: os.tmpdir() });
  bots.send(bot.id, 'event-ish first message');
  for (let i = 0; i < 4000 && !prompts.length; i++) await new Promise((r) => setTimeout(r, 5));
  const { message } = bots.send(bot.id, 'maybe brighter colors in dark mode', { owner: true });
  // the busy turn learns about his message (as the requirements reminder does), takes its item and answers it
  const { loadLedger, markItem, record } = await import('../bridge/requirements.mjs');
  const dir = bots.reqDir();
  for (const it of loadLedger({ dir }).items.values()) if (it.msgId === message.id) record(markItem({ status: 'answered', id: it.id, note: 'answered in the busy turn' }, { dir }).events, { dir });
  release();
  await settle(bots, bot.id);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /already replied/);
  const replies = bots.messages(bot.id).filter((m) => m.role === 'bot');
  assert.equal(replies.length, 1, 'nothing new: no second reply');
});

test('a waiting message the busy turn did not take is answered normally, with no note', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const prompts = [];
  const bots = await makeBots(async (bot, text) => { prompts.push(text); if (prompts.length === 1) await gate; return { text: 'ok ' + prompts.length }; });
  const { bot } = bots.create({ name: 'Untaken', cwd: os.tmpdir() });
  bots.send(bot.id, 'first');
  for (let i = 0; i < 4000 && !prompts.length; i++) await new Promise((r) => setTimeout(r, 5));
  bots.send(bot.id, 'second, never shown to the busy turn', { owner: true });
  release();
  await settle(bots, bot.id);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[1], /already replied/);
});

test('a near-identical second reply in a row is hidden', async () => {
  const same = 'Got it. The current colors stay in light mode, and the changes are only to the structure, spacing and amount of text.';
  let n = 0;
  const bots = await makeBots(async () => { n++; return { text: n === 1 ? same : `${same.replace('Got it.', 'Got it:')}` }; });
  const { bot } = bots.create({ name: 'Dup', cwd: os.tmpdir() });
  bots.send(bot.id, 'one');
  await settle(bots, bot.id);
  bots.queues.set(bot.id, ['[Event, not from Noam] the helper finished']);
  bots.drain(bot.id);
  await settle(bots, bot.id);
  const shown = bots.messages(bot.id).filter((m) => m.role === 'bot' && !m.duplicate);
  assert.equal(shown.length, 1);
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /m\.duplicate/);
});

test('a terminal agent\'s question with links in its answers shows them on the card, chat and Agents view alike', async () => {
  const { questionFromRecords } = await import('../bridge/asks.mjs');
  const { terminalAskMessage } = await import('../bridge/bot-events.mjs');
  const lines = [JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: 'Which look? Compare: https://example.com/all', header: 'Look', options: [{ label: 'Look A', description: 'Warm, see https://example.com/a' }, { label: 'Look B', description: 'Cool' }] }] } }] } })];
  const ask = questionFromRecords({ provider: 'claude', sessionId: 's' }, lines, 'Which look?');
  assert.deepEqual(ask.links, [{ label: '', href: 'https://example.com/all' }, { label: 'Look A', href: 'https://example.com/a' }]);
  assert.deepEqual(terminalAskMessage('p', 'x', ask).links, ask.links);
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /\$\{qAllHtml\(ask\)\}\$\{qLinksHtml\(ask\)\}/);
  assert.match(page, /links:m\.links/);
});
