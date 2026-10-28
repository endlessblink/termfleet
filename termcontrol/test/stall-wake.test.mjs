import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
import { checkStalledBots, STALL_AFTER_MS, STALL_EVERY_MS } from '../bridge/stall-wake.mjs';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stall-'));
  const bots = new Bots({ dir: path.join(dir, 'bots'), run: async () => ({}) });
  const { bot } = bots.create({ name: 'Desk', cwd: os.tmpdir() });
  const woke = [];
  bots.wake = (id, text) => { woke.push(text); return { ok: true }; };
  const items = [{ id: 'R-1', status: 'assigned', words: 'fix the serif font', at: 1000, where: null }];
  bots.openWork = () => items;
  return { bots, bot, woke, items };
}

test('a bot with open requests and nothing running is woken after 15 quiet minutes, then at most once an hour', () => {
  const { bots, bot, woke } = setup();
  bots.append(bot.id, { role: 'operator', text: 'fix it' });
  const t0 = Date.now();
  assert.deepEqual(checkStalledBots({ bots, now: t0 + 5 * 60_000 }), [], 'too soon');
  assert.deepEqual(checkStalledBots({ bots, now: t0 + STALL_AFTER_MS + 1000 }), [bot.id]);
  assert.match(woke[0], /R-1/);
  assert.deepEqual(checkStalledBots({ bots, now: t0 + STALL_AFTER_MS + 10 * 60_000 }), [], 'not again within the hour');
  assert.deepEqual(checkStalledBots({ bots, now: t0 + STALL_AFTER_MS + STALL_EVERY_MS + 5000 }), [bot.id], 'again after the hour');
});

test('quiet when a terminal is working on it, when nothing is open, or when switched off', () => {
  const { bots, bot, woke, items } = setup();
  const later = Date.now() + 2 * STALL_AFTER_MS;
  items[0].where = 'terminal-a';
  assert.deepEqual(checkStalledBots({ bots, panes: [{ id: 'terminal-a', turn: 'working' }], now: later }), []);
  assert.deepEqual(checkStalledBots({ bots, now: later, env: { TERMFLEET_STALL_WAKE: '0' } }), []);
  items.length = 0;
  assert.deepEqual(checkStalledBots({ bots, now: later }), []);
  assert.equal(woke.length, 0);
});
