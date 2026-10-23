import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Bots } from '../bridge/bots.mjs';
import { checkBotEvents, helperState } from '../bridge/bot-events.mjs';
import { endFollows } from '../bridge/follows.mjs';

// Noam 2026-10-21: "למה אתה ממשיך לעדכן על פעולות של בוטים אחרים בלי שנתבקשת?"
const here = path.dirname(fileURLToPath(import.meta.url));

function setup(helpers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-follow-'));
  const bots = new Bots({ dir: path.join(dir, 'bots'), run: async () => ({}) });
  const { bot } = bots.create({ name: 'Manager', cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify(helpers));
  const woke = [];
  bots.wake = (id, text) => { woke.push(text); return { ok: true }; };
  return { dir, bots, bot, woke };
}
const turn = (bots, seen, id, t) => checkBotEvents({ bots, seen, panes: [{ id, turn: t }], readAsk: async () => null });

test('a follow wakes the bot once, then ends by itself', async () => {
  const { bots, bot, woke } = setup([{ paneId: 'terminal-p', task: 'paper-bot post', followed: true, at: Date.now() }]);
  const seen = new Map();
  await turn(bots, seen, 'terminal-p', 'working');
  await turn(bots, seen, 'terminal-p', 'idle');
  assert.equal(woke.length, 1);
  assert.match(woke[0], /follow has now ended/);
  assert.ok(bots.helpers(bot.id)[0].ended, 'the follow is marked ended');
  // The followed agent works again later: nobody is woken, nothing reported.
  await turn(bots, seen, 'terminal-p', 'working');
  await turn(bots, seen, 'terminal-p', 'idle');
  assert.equal(woke.length, 1);
  assert.equal(helperState({ helpers: bots.helpers(bot.id) }, [{ id: 'terminal-p', turn: 'working' }]).waitingOn, 0);
});

test('following the same agent twice wakes once', async () => {
  const at = Date.now();
  const { bots, woke } = setup([{ paneId: 'terminal-p', followed: true, at }, { paneId: 'terminal-p', followed: true, at }]);
  const seen = new Map();
  await turn(bots, seen, 'terminal-p', 'working');
  await turn(bots, seen, 'terminal-p', 'idle');
  assert.equal(woke.length, 1);
});

test('an agent the bot started still wakes it each time it finishes', async () => {
  const { bots, woke } = setup([{ paneId: 'terminal-h', task: 'run tests', at: Date.now() }]);
  const seen = new Map();
  // Each real job: a one-look busy flicker is not a job (bot-events.test: "once per job").
  for (const t of ['working', 'idle', 'working', 'working', 'idle']) await turn(bots, seen, 'terminal-h', t);
  assert.equal(woke.length, 2);
});

test('unfollow --all ends only follows; a named agent ends whatever it was', () => {
  const list = [{ paneId: 'a', followed: true }, { paneId: 'b' }, { paneId: 'c', followed: true, ended: 1 }];
  const all = endFollows(list, { all: true, at: 5 });
  assert.equal(all.count, 1);
  assert.deepEqual(all.list.map((h) => h.ended), [5, undefined, 1]);
  assert.equal(endFollows(list, { paneId: 'b', at: 7 }).list[1].ended, 7);
});

test('termfleet-team unfollow stops the wake-ups from inside a bot', () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-unfollow-'));
  const id = 'abcdefabcdef';
  const folder = path.join(config, 'bots', id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'helpers.json'), JSON.stringify([
    { paneId: 'terminal-paper', task: 'paper-bot', followed: true, at: 1 },
    { paneId: 'terminal-rough', task: 'rough-cut', followed: true, at: 1 },
    { paneId: 'terminal-mine', task: 'my helper', at: 1 },
  ]));
  const cli = (...args) => spawnSync(process.execPath, [path.join(here, '../../scripts/termfleet-team.mjs'), 'unfollow', ...args], { env: { ...process.env, TC_CONFIG_DIR: config, TERMFLEET_BOT_ID: id }, encoding: 'utf8' });
  const one = cli('terminal-paper');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /Stopped following paper-bot/);
  const all = cli('--all');
  assert.match(all.stdout, /Stopped following every agent you follow/);
  const list = JSON.parse(fs.readFileSync(path.join(folder, 'helpers.json'), 'utf8'));
  assert.ok(list[0].ended && list[1].ended);
  assert.equal(list[2].ended, undefined, 'an agent it started is left alone by --all');
  assert.match(cli('--all').stdout, /not following anyone/);
  const outside = spawnSync(process.execPath, [path.join(here, '../../scripts/termfleet-team.mjs'), 'unfollow', '--all'], { env: { ...process.env, TERMFLEET_BOT_ID: '' }, encoding: 'utf8' });
  assert.notEqual(outside.status, 0);
});
