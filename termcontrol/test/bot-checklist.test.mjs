// Noam 2026-10-22 (pc-helper chat): "לא רואה רשימה + זו צריכה להיות רשימה אינטרקטיבית שאני
// יכול לסמן / ללחוץ / להוסיף הערות וכו'". A bot sends a [checklist] block; the chat shows rows he
// can tick, tap and note, and one Send posts his choices back as his own message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChecklist, CHECKLIST_RULE, checklistAnswer, carryCard } from '../bridge/bot-checklist.mjs';
import { Bots, brainBrief, parseBrainLine } from '../bridge/bots.mjs';

const BLOCK = 'I found 3 idle terminals.\n\n[checklist]\nWhich idle terminals should I close?\n- [x] rough-cut-mvp | video editing | idle 3 hours\n- [ ] health-app | health app\n- termfleet x3 — TermFleet work\n[/checklist]\n';

test('a [checklist] block becomes a list with title, rows, details and pre-ticks', () => {
  const r = parseChecklist(BLOCK);
  assert.equal(r.text, 'I found 3 idle terminals.');
  assert.deepEqual(r.checklist, {
    title: 'Which idle terminals should I close?',
    rows: [
      { label: 'rough-cut-mvp', detail: ['video editing', 'idle 3 hours'], checked: true },
      { label: 'health-app', detail: ['health app'], checked: false },
      { label: 'termfleet x3', detail: ['TermFleet work'], checked: false },
    ],
  });
});

test('no block, an empty block, Hebrew tags, direction marks and a code fence', () => {
  assert.equal(parseChecklist('Just text.').checklist, null);
  assert.equal(parseChecklist('[checklist]\nNothing here\n[/checklist]').checklist, null);
  const he = parseChecklist('הנה:\n```\n‏[רשימה]‏\nמה לסגור?\n- [X] botson\n- [ ] paper-bot\n‏[/רשימה]\n```\n');
  assert.equal(he.text, 'הנה:');
  assert.equal(he.checklist.title, 'מה לסגור?');
  assert.deepEqual(he.checklist.rows.map((x) => [x.label, x.checked]), [['botson', true], ['paper-bot', false]]);
  // A title is optional; at most 40 rows.
  const many = parseChecklist('[checklist]\n' + Array.from({ length: 50 }, (_, i) => `- row ${i}`).join('\n') + '\n[/checklist]');
  assert.equal(many.checklist.rows.length, 40);
  assert.equal(many.checklist.title, '');
});

test('his choices go back as one clear message: ticked, not ticked, notes', () => {
  const { checklist } = parseChecklist(BLOCK);
  const text = checklistAnswer(checklist, { checked: [true, false, true], notes: ['', 'keep it, I use it daily', ''], note: 'Close them now please' });
  assert.equal(text, [
    'My choices on your list "Which idle terminals should I close?":',
    'Ticked (2):',
    '- rough-cut-mvp',
    '- termfleet x3',
    'Not ticked (1):',
    '- health-app (my note: keep it, I use it daily)',
    'My note: Close them now please',
  ].join('\n'));
  assert.match(checklistAnswer(checklist, { checked: [false, false, false] }), /Ticked \(0\):\n- none/);
});

test('a list written before the bot\'s last step is kept with its final reply', () => {
  // Claude keeps only the last text of a turn; pc-helper's table was written earlier and lost.
  assert.equal(carryCard('Done. Tick what to close.', ['Looking…', BLOCK]), `Done. Tick what to close.\n\n${BLOCK.slice(BLOCK.indexOf('[checklist]')).trim()}`);
  assert.equal(carryCard(BLOCK, [BLOCK]), BLOCK, 'already in the final reply: unchanged');
  assert.equal(carryCard('Plain.', ['Earlier plain.']), 'Plain.');
  const said = parseBrainLine('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: BLOCK }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }));
  assert.equal(said.said, BLOCK);
  assert.ok(said.activity);
});

test('every bot (Claude and Codex) is told how to send a list', () => {
  for (const provider of ['claude', 'codex']) assert.ok(brainBrief({ name: 'L', job: 'x', provider }).includes(CHECKLIST_RULE));
  assert.match(CHECKLIST_RULE, /\[checklist\]/);
  assert.match(CHECKLIST_RULE, /\[\/checklist\]/);
  assert.ok(CHECKLIST_RULE.split('\n').length <= 8, 'kept short');
});

test('the chat stores the list on the bot message and his send is tied to it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-l-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-l-bots-')), notify: () => {}, run: async () => ({ text: BLOCK }) });
  const { bot } = bots.create({ name: 'Lister', cwd: os.tmpdir() });
  bots.send(bot.id, 'hi');
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  const reply = bots.messages(bot.id).find((m) => m.role === 'bot');
  assert.equal(reply.text, 'I found 3 idle terminals.');
  assert.equal(reply.checklist.rows.length, 3);
  const sent = bots.send(bot.id, 'preview words from the page', { listTo: reply.id, choices: { checked: [false, true, 'yes', true], notes: ['', ' daily '], note: 'thanks' } });
  assert.equal(sent.message.listTo, reply.id);
  // The bridge writes his message from the choices (one wording), and keeps the ticks for the locked card.
  assert.deepEqual(sent.message.listChoices, { checked: [false, true, true], notes: ['', 'daily', ''], note: 'thanks' });
  assert.equal(sent.message.text, 'My choices on your list "Which idle terminals should I close?":\nTicked (2):\n- health-app (my note: daily)\n- termfleet x3\nNot ticked (1):\n- rough-cut-mvp\nMy note: thanks');
  assert.equal(bots.send(bot.id, 'again', { listTo: reply.id }).error, 'You already sent your choices on this list.');
  assert.equal(bots.send(bot.id, 'x', { listTo: 'nope' }).error, 'That list is no longer in this chat. Your choices were not sent.');
});
