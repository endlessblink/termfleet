// Noam 2026-10-25, in the politic-fighter chat: an "Allow Edit?" from a terminal the bot started
// sat for an hour; its card was posted at 15:16, buried under ~40 new lines within a minute, later
// shown as ended while the menu was still up, and nothing reminded him. "שהכפתור תמיד יופיע כאן",
// and "כל דבר שכל סוכן נתקע עליו צריך להגיע לכאן". Each test replays one part of that.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBotEvents, screenStillAsks, stuckOnScreen, REMIND_AFTER_MS, REMIND_EVERY_MS } from '../bridge/bot-events.mjs';
import { checkStalls, SILENT_AFTER_MS } from '../bridge/watchdog.mjs';
import { Bots } from '../bridge/bots.mjs';
import { Push } from '../bridge/push.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-stuck-'));
const T0 = 1_792_941_414_879;   // 15:16:54, when the real card was posted
function setup({ name = 'politic-figther_dev', clock } = {}) {
  const now = clock || { t: T0 };
  const bots = new Bots({ dir: tmp(), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() }, now: () => now.t });
  const { bot } = bots.create({ name, cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-h', task: 'termfleet', at: T0 }]));
  const woke = [], pushed = [];
  bots.wake = (id, text) => { woke.push(text); return { ok: true }; };
  return { bots, bot, woke, pushed, notify: (n) => pushed.push(n), now };
}
const EDIT_MENU = [
  '● Update(termcontrol/bridge/requirements.mjs)',
  '',
  ' Do you want to make this edit to requirements.mjs?',
  ' ❯ 1. Yes',
  '   2. Yes, allow all edits during this session (shift+tab)',
  '   3. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n');
const ALLOW_EDIT = { id: 'claude:s:vendor:1::permission:Allow Edit?', kind: 'permission', title: 'Allow Edit?', options: [{ key: 'yes', label: 'Yes, proceed' }, { key: 'no', label: 'No, tell the agent what to do differently' }] };
const cards = (bots, bot) => bots.messages(bot.id).filter((m) => m.role === 'terminal-ask');

test('the card stays live while the menu is still on screen, even when the status stops saying "waiting"', async () => {
  const { bots, bot, notify, now } = setup();
  const seen = new Map();
  const look = (turn, screen) => checkBotEvents({ bots, seen, now: now.t, notify, panes: [{ id: 'terminal-h', provider: 'claude', turn }], readAsk: async () => ALLOW_EDIT, readScreen: async () => screen });
  await look('waiting', EDIT_MENU);
  // Before: two looks reading "working" settled the card, so it showed as ended for the next 45 minutes.
  for (let i = 1; i <= 6; i++) { now.t = T0 + i * 30_000; await look('working', EDIT_MENU); }
  assert.equal(cards(bots, bot).length, 1);
  assert.equal(cards(bots, bot)[0].settled, undefined, 'still answerable: the menu is still drawn');
  // Answered: the menu is gone, so after two looks the card closes.
  now.t += 30_000; await look('working', '● Update(requirements.mjs)\n  ⎿ Updated with 3 additions');
  now.t += 30_000; await look('working', '● Update(requirements.mjs)\n  ⎿ Updated with 3 additions');
  assert.equal(cards(bots, bot)[0].settled, true);
});

test('a menu on screen gets its card even when the status never said "waiting"', async () => {
  const { bots, bot, woke, pushed, notify } = setup();
  await checkBotEvents({ bots, seen: new Map(), now: T0, notify, panes: [{ id: 'terminal-h', provider: 'claude', turn: 'working' }], readAsk: async () => null, readScreen: async () => EDIT_MENU });
  const [card] = cards(bots, bot);
  assert.equal(card.text, 'Do you want to make this edit to requirements.mjs?');
  assert.deepEqual(card.options.map((o) => o.key), ['1', '2', '3']);
  assert.match(woke[0], /pinned at the bottom of his chat/);
  assert.equal(pushed.length, 1, 'his phone is told right away');
  assert.match(pushed[0].body, /termfleet/);
});

test('unanswered: a reminder in the chat and a phone buzz after 5 minutes, then every 15, never in between', async () => {
  const { bots, bot, pushed, notify, now } = setup();
  const seen = new Map();
  const look = () => checkBotEvents({ bots, seen, now: now.t, notify, panes: [{ id: 'terminal-h', provider: 'claude', turn: 'waiting' }], readAsk: async () => ALLOW_EDIT, readScreen: async () => EDIT_MENU });
  await look();
  const reminders = () => bots.messages(bot.id).filter((m) => m.role === 'reminder');
  now.t = T0 + REMIND_AFTER_MS - 30_000; await look();
  assert.equal(reminders().length, 0);
  now.t = T0 + REMIND_AFTER_MS; await look();
  assert.equal(reminders().length, 1);
  assert.match(reminders()[0].text, /Still waiting for your answer after 5 minutes: terminal "termfleet" asks "Allow Edit\?"/);
  const buzz = pushed.at(-1);
  assert.equal(buzz.force, true, 'sent even with a page open somewhere');
  now.t += 60_000; await look();
  assert.equal(reminders().length, 1, 'not again a minute later');
  now.t = T0 + REMIND_AFTER_MS + REMIND_EVERY_MS; await look();
  assert.equal(reminders().length, 2);
  assert.equal(cards(bots, bot).length, 1, 'still one card, no repeats');
});

test('an agent that stops on an error, a limit or a blocked command reaches the chat at once, once', async () => {
  const { bots, bot, woke, pushed, notify } = setup();
  const seen = new Map();
  const errorScreen = '● Bash(npm test)\n  ⎿  API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}\n\n> ';
  const look = (turn, screen) => checkBotEvents({ bots, seen, now: T0, notify, panes: [{ id: 'terminal-h', provider: 'claude', turn }], readAsk: async () => null, readScreen: async () => screen, closeCheck: () => [] });
  await look('working', '● Bash(npm test)');
  await look('idle', errorScreen);
  await look('idle', errorScreen);
  const stuck = bots.messages(bot.id).filter((m) => m.role === 'stuck');
  assert.equal(stuck.length, 1);
  assert.match(stuck[0].text, /Terminal "termfleet" stopped on an error: API Error: 529/);
  assert.ok(woke.some((w) => /stopped on an error/.test(w)));
  assert.ok(pushed.some((p) => /stuck/.test(p.title)));
  assert.equal(stuckOnScreen('You\'ve hit your usage limit · resets 7pm').kind, 'limit');
  assert.equal(stuckOnScreen('PreToolUse:Bash hook error: Blocked by security policy').kind, 'blocked');
  assert.equal(stuckOnScreen('All 54 tests pass.\n> '), null);
});

test('screen menus are recognised in the shapes Claude and Codex draw', () => {
  assert.equal(screenStillAsks(EDIT_MENU), true);
  assert.equal(screenStillAsks(' Do you want to proceed?\n ❯ 1. Yes\n   2. No'), true, 'no footer drawn yet');
  assert.equal(screenStillAsks(' Allow command?\n › 1. Yes, proceed\n   2. No, and tell Codex what to do'), true);
  assert.equal(screenStillAsks('All done.\n> '), false);
});

test('a card still waiting is returned to the page however many lines came after it', () => {
  const { bots, bot } = setup();
  bots.append(bot.id, { role: 'terminal-ask', pane: 'terminal-h', label: 'termfleet', askId: 'a1', kind: 'permission', text: 'Allow Edit?', options: [{ key: 'yes', label: 'Yes, proceed' }] });
  bots.append(bot.id, { role: 'terminal-ask', pane: 'terminal-h', label: 'termfleet', askId: 'a0', kind: 'permission', text: 'Old one', options: [], settled: true });
  for (let i = 0; i < 400; i++) bots.append(bot.id, { role: 'activity', text: 'Checking something' });
  const shown = bots.view(bot.id).messages;
  assert.ok(shown.some((m) => m.role === 'terminal-ask' && m.askId === 'a1'), 'the open card is there');
  assert.ok(!shown.some((m) => m.askId === 'a0'), 'an ended one is not dragged back');
});

test('a forced phone notification is sent even while a page is open', async () => {
  const sent = [];
  const push = new Push({ dir: tmp(), fetchImpl: async (url) => { sent.push(url); return { ok: true, status: 201 }; } });
  const data = push.read(); data.subscriptions = [{ endpoint: 'https://push.example.test/sub' }]; push.write(data);
  push.seen();
  assert.equal((await push.notify({ title: 't', body: 'b' })).reason, 'app open');
  assert.equal((await push.notify({ title: 't', body: 'b', force: true })).sent, 1);
});

// The stalled-terminal watchdog (Agent-Manager 2026-10-25; Noam: "אמרת בעצמך שצריך watchdog").
// Chat notes were removed on 2026-10-25 (bd4ffe1: they flooded his chat); idle or closed
// terminals were dropped in 15b217f. A finding goes to stderr and the lasting event log (#10).
test('watchdog: a "working" terminal silent for 30 minutes is told once, on stderr and in the event log, never as a chat note', () => {
  const { bots, bot } = setup();
  const flagged = new Map(), logs = [], saved = [];
  const panes = [{ id: 'terminal-h', turn: 'working', title: 'termfleet' }, { id: 'terminal-busy', turn: 'working', title: 'busy one' }];
  const lastAt = (p) => (p.id === 'terminal-h' ? T0 : T0 + SILENT_AFTER_MS);
  const look = (now) => checkStalls({ bots, panes, items: [], now, flagged, lastAt, log: (l) => logs.push(l), record: (f, owners) => saved.push([f.kind, f.pane, owners]) });
  assert.deepEqual(look(T0 + SILENT_AFTER_MS - 60_000), []);
  const [found] = look(T0 + 41 * 60_000);
  assert.equal(found.kind, 'stalled');
  assert.match(logs[0], /^\[watchdog\] Terminal "termfleet" has been silent for 41 minutes/);
  assert.deepEqual(saved, [['stalled', 'terminal-h', [bot.name]]], 'kept in the event log with the bot that owns it');
  assert.equal(bots.messages(bot.id).filter((m) => m.role === 'stuck').length, 0, 'no chat flood');
  assert.deepEqual(look(T0 + 56 * 60_000), [], 'the same stall is told once');
  // It spoke again, then went quiet again: a new stall, told again.
  panes[0].turn = 'idle'; look(T0 + 57 * 60_000);
  panes[0].turn = 'working'; assert.equal(look(T0 + 58 * 60_000).length, 1);
  assert.equal(saved.length, 2);
});
