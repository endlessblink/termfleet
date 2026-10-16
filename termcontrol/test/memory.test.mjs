import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotMemory, searchChat, CARD_CHAR_LIMIT } from '../bridge/memory.mjs';
import { Bots, brainBrief, handoverText } from '../bridge/bots.mjs';
import { run as memoryCommand } from '../../scripts/termfleet-memory.mjs';

// TF-096 part 3: "A bot remembers past conversations and can search them. It keeps a
// short memory card that you approve, and starts fresh by itself when its memory
// fills, without losing track. Its chat stays one continuous conversation."
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-mem-'));
const settle = async (bots, id) => { for (let i = 0; i < 200 && bots.running.has(id); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a proposed memory is not used until Noam approves it; forgotten ones never come back', () => {
  const m = new BotMemory(tmp());
  const p = m.propose({ text: 'Noam wants every phone screen checked before saying done', kind: 'preference', source: 'bot' }).entry;
  assert.equal(m.card(), '', 'proposals are not on the card');
  assert.equal(m.pendingCount(), 1);
  m.approve(p.id, 'Check every phone screen before saying done');
  assert.match(m.card(), /Noam's preferences:\n- Check every phone screen before saying done/);
  m.forget(p.id);
  assert.equal(m.card(), '');
  assert.equal(m.propose({ text: 'a valid memory' }).ok, true);
  assert.match(m.propose({ text: 'x' }).error, /Say what should be remembered/);
  assert.equal(m.propose({ text: 'Check every phone screen before saying done' }).duplicate, undefined, 'a forgotten text can be suggested again');
});

test('Noam can add a memory directly; the card stays within its size limit, newest kept', () => {
  const m = new BotMemory(tmp());
  assert.equal(m.add({ text: 'Never push code without asking me', kind: 'decision' }).entry.status, 'approved');
  for (let i = 0; i < 40; i++) m.add({ text: `Lesson number ${i} ${'detail '.repeat(30)}`, kind: 'lesson' });
  const card = m.card();
  assert.ok(card.length <= CARD_CHAR_LIMIT + 200);
  assert.match(card, /Lesson number 39/);
});

test('searching past conversations finds his words in Hebrew and English, best match first', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const chat = [
    { role: 'operator', text: 'Use Seedream 5 for the cover, never Flux', at: now - 30 * 86400e3 },
    { role: 'bot', text: 'Noted: covers come from Seedream 5 only.', at: now - 30 * 86400e3 },
    { role: 'operator', text: 'הכריכה צריכה להיות כחולה', at: now - 2 * 86400e3 },
    { role: 'activity', text: 'Reading files cover', at: now },
  ];
  const en = searchChat(chat, 'cover Seedream', { now });
  assert.equal(en[0].who, 'Noam');
  assert.match(en[0].snippet, /Seedream 5 for the cover/);
  assert.ok(en.every((h) => !/Reading files/.test(h.snippet)), 'activity lines are not conversation');
  const he = searchChat(chat, 'כריכה', { now });
  assert.match(he[0].snippet, /הכריכה צריכה להיות כחולה/);
  assert.deepEqual(searchChat(chat, '', { now }), []);
});

test('the bot command searches and proposes for its own bot only', () => {
  const root = tmp();
  const id = 'abcdefabcdef';
  const folder = path.join(root, 'bots', id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'chat.jsonl'), JSON.stringify({ role: 'operator', text: 'The deadline is Thursday', at: Date.now() }) + '\n');
  const env = { TERMFLEET_BOT_ID: id, TC_CONFIG_DIR: root };
  assert.match(memoryCommand(['search', 'deadline'], env).message, /The deadline is Thursday/);
  assert.match(memoryCommand(['propose', 'Deadline', 'is', 'Thursday', '--kind', 'fact'], env).message, /only after Noam approves/);
  assert.equal(new BotMemory(folder).pendingCount(), 1);
  assert.match(memoryCommand(['card'], env).message, /Nothing approved yet/);
  assert.equal(memoryCommand(['search', 'x'], {}).ok, false, 'outside a bot it refuses');
});

test('the brain always gets the approved card, and a handover after a fresh start', () => {
  const brief = brainBrief({ name: 'Quill', job: 'x', rules: '' }, { card: 'Your memory card (approved by Noam…):\n- Never push', handover: "Noam's unfinished requests, in his words:\n- [open] \"fix the list\"" });
  assert.match(brief, /termfleet-memory search/);
  assert.match(brief, /- Never push/);
  assert.match(brief, /continuing after a fresh start[\s\S]*"fix the list"/);
});

test('when its memory is full the bot starts fresh, keeps one chat, and carries his open requests and latest words', async () => {
  const dir = tmp();
  const briefs = [];
  let fill = 85;
  const bots = new Bots({ dir, fill: () => fill, run: async (bot, text, { extras }) => { briefs.push({ session: bot.sessions.claude.id, extras }); return { text: `ok: ${text}` }; } });
  const { bot } = bots.create({ name: 'Quill', cwd: dir });
  const b = bots.read(bot.id); b.sessions.claude.started = true; bots.write(b);
  const oldSession = b.sessions.claude.id;
  bots.memory(bot.id).add({ text: 'Never push without asking', kind: 'decision' });
  bots.append(bot.id, { role: 'operator', text: 'Make the bot list calmer' });
  bots.append(bot.id, { role: 'bot', text: 'Working on the calmer list' });
  bots.send(bot.id, 'how is it going?');
  await settle(bots, bot.id);
  const chat = bots.view(bot.id).messages;
  assert.ok(chat.some((m) => m.role === 'system' && /Fresh start: Quill's working memory was 85% full/.test(m.text)));
  assert.equal(chat.at(-1).text, 'ok: how is it going?', 'the same chat continues');
  assert.notEqual(briefs[0].session, oldSession, 'a new brain conversation');
  assert.match(briefs[0].extras.handover, /Noam: Make the bot list calmer/);
  assert.match(briefs[0].extras.card, /Never push without asking/);
  assert.equal(bots.read(bot.id).handover, undefined, 'the handover is used once');
  fill = 10;
  bots.send(bot.id, 'and now?');
  await settle(bots, bot.id);
  assert.equal(briefs[1].extras.handover, '', 'no fresh start below the limit');
});

test('the handover lists unfinished requests only, in his exact words', () => {
  const text = handoverText({}, [{ role: 'operator', text: 'hi' }], { asks: [{ n: 1, text: 'Research memory deeply', status: 'partial', note: 'light pass only' }, { n: 2, text: 'Done thing', status: 'done', note: 'x' }] });
  assert.match(text, /\[partial\] "Research memory deeply" \(light pass only\)/);
  assert.doesNotMatch(text, /Done thing/);
});
