import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, mentionedBots, TAGS_EVERYONE } from '../bridge/bots.mjs';
import { findOwnerWords } from '../bridge/owner-words.mjs';

// Noam 2026-10-21: "אפשר גם שאני אוכל לתייג סוכן אחר בהודעה ואז הוא יגיב גם" / "אבל סתם ככה
// זה יוצר כאוס" / "למה שבעצם לא יהיו 2 האופציות? סוכן מנהל + קבוצה". A tagged bot answers in
// the same chat; in a group only tagged bots answer; bots never bring each other in.
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-tags-'));
function readyComputer() {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  return { home, socket: path.join(home, 'daemon.sock') };
}
const idle = async (bots) => { for (let i = 0; i < 400 && bots.running.size; i++) await new Promise((r) => setTimeout(r, 5)); };

function setup(reply = (bot) => `${bot.name} here`) {
  const seen = [];
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), fill: () => null, notify: () => {}, run: async (bot, text) => { seen.push({ name: bot.name, text }); return { text: reply(bot, text) }; } });
  bots.ownerWordsBase = tmp();
  const make = (name) => bots.create({ name, cwd: os.tmpdir() }).bot;
  return { bots, seen, make };
}

test('tags match whole bot names, spaces or dashes, Hebrew too, longest name first', () => {
  const list = [{ id: 'a', name: 'Agent' }, { id: 'b', name: 'Agent-Manager' }, { id: 'c', name: 'Grok Bot' }, { id: 'd', name: 'קוויל' }];
  assert.deepEqual(mentionedBots('@Agent-Manager what do you think?', list).map((b) => b.id), ['b']);
  assert.deepEqual(mentionedBots('ask @grok-bot and @Agent', list).map((b) => b.id).sort(), ['a', 'c']);
  assert.deepEqual(mentionedBots('מה דעתך @קוויל?', list).map((b) => b.id), ['d']);
  assert.deepEqual(mentionedBots('mail me at noam@Agent.com or @Agents', list), []);
  assert.equal(TAGS_EVERYONE('@all ready?'), true);
  assert.equal(TAGS_EVERYONE('מה אתם אומרים @כולם'), true);
  assert.equal(TAGS_EVERYONE('install @allure'), false);
});

test('tagging a bot in another bot\'s chat: it gets Noam\'s signed words and answers in the same chat', async () => {
  const { bots, seen, make } = setup();
  const host = make('Quill'), guest = make('Hogan');
  bots.send(host.id, 'Ship it? @Hogan check the servers first', { owner: true });
  await idle(bots);
  const hostChat = bots.messages(host.id);
  const posted = hostChat.find((m) => m.guest);
  assert.equal(posted.guest.name, 'Hogan');
  assert.equal(posted.text, 'Hogan here');
  assert.equal(hostChat.filter((m) => m.role === 'bot' && !m.guest).length, 1, 'the host answers too');
  const guestChat = bots.messages(guest.id);
  const inbound = guestChat.find((m) => m.role === 'operator');
  assert.deepEqual(inbound.from, { kind: 'bot', id: host.id, name: 'Quill' });
  assert.ok(guestChat.some((m) => m.role === 'bot' && m.text === 'Hogan here'), 'its own chat keeps the answer too');
  assert.equal(findOwnerWords(inbound.id, { base: bots.ownerWordsBase }).botId, guest.id, 'approvals count');
  assert.match(seen.find((s) => s.name === 'Hogan').text, /Noam tagged you \(@Hogan\) in his chat with the bot "Quill"/);
  assert.match(seen.find((s) => s.name === 'Quill').text, /Noam also tagged Hogan/);
  // The host hears what the guest said the next time Noam writes to it.
  bots.send(host.id, 'thanks', { owner: true });
  await idle(bots);
  assert.match(seen.at(-1).text, /bots Noam tagged answered in this chat:\n- Hogan: Hogan here/);
});

test('bots never bring each other in: a bot answer, a routine or an event that names a bot tags nobody', async () => {
  const { bots, seen, make } = setup(() => 'ask @Hogan about it');
  const host = make('Quill');
  make('Hogan');
  bots.send(host.id, 'routine check @Hogan', { owner: false });
  bots.wake(host.id, 'event mentions @Hogan');
  await idle(bots);
  assert.deepEqual([...new Set(seen.map((s) => s.name))], ['Quill']);
});

test('in a group only tagged bots answer; @all asks everyone; untagged gets no answer', async () => {
  const { bots, seen, make } = setup();
  const a = make('Quill'), b = make('Hogan');
  const { group } = bots.groups.create({ name: 'Release', members: [a.id, b.id] });
  assert.deepEqual(bots.sendGroup(group.id, 'morning all').tagged, []);
  await idle(bots);
  assert.equal(seen.length, 0, 'nobody answers an untagged message');
  bots.sendGroup(group.id, '@Hogan status?');
  await idle(bots);
  assert.deepEqual(seen.map((s) => s.name), ['Hogan']);
  assert.match(seen[0].text, /the group chat "Release"[\s\S]*Noam: morning all/);
  bots.sendGroup(group.id, '@all done?');
  await idle(bots);
  const replies = bots.groups.messages(group.id).filter((m) => m.guest).map((m) => m.guest.name).sort();
  assert.deepEqual(replies, ['Hogan', 'Hogan', 'Quill']);
  // Members can change later; a removed bot no longer answers @all.
  bots.groups.update(group.id, { members: [a.id] });
  bots.sendGroup(group.id, '@all again');
  await idle(bots);
  assert.equal(seen.at(-1).name, 'Quill');
  assert.equal(bots.groups.update(group.id, { members: [] }).error, 'A group needs at least one bot.');
});
