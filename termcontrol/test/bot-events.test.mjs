import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBotEvents, gitHead, helperState } from '../bridge/bot-events.mjs';
import { Bots } from '../bridge/bots.mjs';
import { Routines } from '../bridge/routines.mjs';

// TF-096 part 7: "Bots wake on schedules and on events. Approvals nobody answers
// expire after 10 minutes".
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-events-'));
function setup() {
  const bots = new Bots({ dir: tmp(), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-h', task: 'run phone tests' }]));
  const woke = [];
  bots.wake = (id, text) => { woke.push(text); return { ok: true }; };
  return { bots, bot, woke };
}

test('a bot wakes when a terminal agent it started finishes', async () => {
  const { bots, woke } = setup();
  const seen = new Map();
  await checkBotEvents({ bots, seen, panes: [{ id: 'terminal-h', turn: 'working' }], readAsk: async () => null, answer: async () => ({}) });
  assert.equal(woke.length, 0);
  await checkBotEvents({ bots, seen, panes: [{ id: 'terminal-h', turn: 'idle' }], readAsk: async () => null, answer: async () => ({}) });
  assert.match(woke[0], /terminal agent you started for "run phone tests" has finished/);
});

// Noam 2026-10-20: a prompt in a terminal a bot runs is shown to him in the bot's chat
// with the terminal's own choices; it is never answered for him, not even after a wait.
test('a prompt in a bot\'s terminal is posted once in its chat with its choices, the bot is told, nothing is answered', async () => {
  const { bots, bot, woke } = setup();
  const seen = new Map();
  const ask = { id: 'ask-1', kind: 'permission', title: 'Do you want to proceed?', detail: 'This starts an export/render. Noam must approve it.', options: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }] };
  const run = (now, a = ask) => checkBotEvents({ bots, seen, now, panes: [{ id: 'terminal-h', turn: 'waiting' }], readAsk: async () => a });
  await run(0);
  await run(60 * 60 * 1000);
  const posted = bots.messages(bot.id).filter((m) => m.role === 'terminal-ask');
  assert.equal(posted.length, 1, 'posted once while the same prompt waits');
  assert.deepEqual({ pane: posted[0].pane, askId: posted[0].askId, text: posted[0].text, detail: posted[0].detail, options: posted[0].options },
    { pane: 'terminal-h', askId: 'ask-1', text: 'Do you want to proceed?', detail: 'This starts an export/render. Noam must approve it.', options: ask.options });
  assert.match(woke.at(-1), /waiting for Noam: "Do you want to proceed\?".*Never answer it yourself/);
  await run(2, { ...ask, id: 'ask-2', title: 'Allow the next step?' });
  assert.equal(bots.messages(bot.id).filter((m) => m.role === 'terminal-ask').length, 2, 'a new prompt is posted again');
});

test('new code in a watched folder wakes the bot once per change', async () => {
  const { bots, bot, woke } = setup();
  let head = 'aaaa1111';
  bots.setWatch(bot.id, { path: '/repo' });
  const go = () => checkBotEvents({ bots, seen: new Map(), panes: [], readAsk: async () => null, answer: async () => ({}), head: () => head });
  await go();
  assert.equal(woke.length, 0, 'the first look only records where it is');
  head = 'bbbb2222';
  await go();
  assert.match(woke[0], /New code landed in \/repo \(commit bbbb2222\)/);
  await go();
  assert.equal(woke.length, 1);
});

test('the real git reader follows a branch and packed refs', () => {
  const repo = tmp();
  fs.mkdirSync(path.join(repo, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(repo, '.git', 'packed-refs'), 'abc123 refs/heads/main\n');
  assert.equal(gitHead(repo), 'abc123');
  fs.writeFileSync(path.join(repo, '.git', 'refs', 'heads', 'main'), 'def456\n');
  assert.equal(gitHead(repo), 'def456');
  assert.equal(gitHead('/no/such'), null);
});

test('a bot\'s own schedule sends to the bot when due', async () => {
  const { bots, bot } = setup();
  let now = new Date('2026-10-19T08:59:00').getTime();
  const sent = [];
  const store = new Routines({ file: path.join(tmp(), 'routines.json'), now: () => now, send: async (pane, text) => { sent.push([pane.id, text]); return { ok: true }; } });
  assert.equal(store.create({ pane: `bot:${bot.id}`, text: 'Give me the morning summary', days: [1], time: '09:00' }).ok, true);
  now = new Date('2026-10-19T09:00:30').getTime();
  await store.tick([{ id: `bot:${bot.id}`, turn: 'idle' }]);
  assert.deepEqual(sent, [[`bot:${bot.id}`, 'Give me the morning summary']]);
  assert.ok(bots);
});

test('a bot that follows an agent it did not start is woken when it finishes, and never refuses that agent\'s approvals', async () => {
  const { bots, bot, woke } = setup();
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-n', task: 'paper bot fix', followed: true }]));
  const seen = new Map();
  const answered = [];
  const tick = (now, turn) => checkBotEvents({ bots, seen, now, panes: [{ id: 'terminal-n', turn }], readAsk: async () => ({ kind: 'approval', title: 'Run it?' }), answer: async () => { answered.push(1); return { ok: true }; } });
  await tick(0, 'waiting');
  await tick(30 * 60 * 1000, 'waiting');
  assert.equal(answered.length, 0, 'Noam\'s own agent is never auto-denied');
  await tick(30 * 60 * 1000 + 1, 'working');
  await tick(30 * 60 * 1000 + 2, 'idle');
  assert.match(woke.at(-1), /you are following \("paper bot fix"\) has finished its turn.*do what you told Noam you would do next/);
});

// Noam 2026-10-20: a bot waiting on terminal agents it handed work to shows that
// on its row, distinct from idle, working and needs-you, and it updates as they finish.
test('a bot row counts its busy terminal agents, once each, and only recent hand-offs', () => {
  const now = 1_800_000_000_000, hour = 3600_000;
  const bot = { helpers: [
    { paneId: 'a', at: now - hour }, { paneId: 'a', at: now - 10 }, // same terminal twice
    { paneId: 'b', at: now - 2 * hour },
    { paneId: 'c', at: now - 5 * hour },
    { paneId: 'old', at: now - 13 * hour }, // handed off yesterday, Noam now uses it
    { paneId: 'gone', at: now - 10 },
  ] };
  const panes = [
    { id: 'a', turn: 'working' }, { id: 'b', turn: 'idle', producing: true },
    { id: 'c', turn: 'waiting' }, { id: 'old', turn: 'working' },
  ];
  assert.deepEqual(helperState(bot, panes, now), { waitingOn: 2, helpersAsking: 1 });
  panes[0].turn = 'idle'; panes[1].producing = false;
  assert.deepEqual(helperState(bot, panes, now), { waitingOn: 0, helpersAsking: 1 }, 'drops as they finish');
  assert.deepEqual(helperState({}, panes, now), { waitingOn: 0, helpersAsking: 0 });
});
