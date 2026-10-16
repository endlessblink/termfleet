import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBotEvents, APPROVAL_EXPIRES_MS, gitHead } from '../bridge/bot-events.mjs';
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

test('an approval nobody answers for 10 minutes is denied and the bot is told; questions are never auto-answered', async () => {
  const { bots, woke } = setup();
  const seen = new Map();
  const answered = [];
  const run = (now, kind) => checkBotEvents({ bots, seen, now, panes: [{ id: 'terminal-h', turn: 'waiting' }], readAsk: async () => ({ kind, title: 'Run npm publish?' }), answer: async (pane, ask) => { answered.push(ask.kind); return { ok: true }; } });
  await run(0, 'approval');
  await run(APPROVAL_EXPIRES_MS - 1, 'approval');
  assert.equal(answered.length, 0, 'not before 10 minutes');
  await run(APPROVAL_EXPIRES_MS + 1, 'approval');
  assert.deepEqual(answered, ['approval']);
  assert.match(woke.at(-1), /waited 10 minutes for an approval nobody gave \("Run npm publish\?"\), so it was denied/);
  await run(APPROVAL_EXPIRES_MS * 2, 'approval');
  assert.equal(answered.length, 1, 'denied once');
  const other = setup();
  const seen2 = new Map();
  const asked = [];
  for (const now of [0, APPROVAL_EXPIRES_MS + 5]) await checkBotEvents({ bots: other.bots, seen: seen2, now, panes: [{ id: 'terminal-h', turn: 'waiting' }], readAsk: async () => ({ kind: 'question' }), answer: async () => { asked.push(1); return { ok: true }; } });
  assert.equal(asked.length, 0);
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
