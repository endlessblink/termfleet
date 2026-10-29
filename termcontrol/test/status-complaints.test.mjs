import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Bots } from '../bridge/bots.mjs';
import { helperState } from '../bridge/bot-events.mjs';
import { markItem, record } from '../bridge/requirements.mjs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const avatarState = vm.runInNewContext(html.match(/const avatarState=p=>[^;]+;/)[0] + '\navatarState');

test('a waiting tool alone never paints Needs you; an actual card does', () => {
  assert.equal(avatarState({ turn: 'waiting' }), 'idle');
  for (const kind of ['question', 'permission']) {
    assert.equal(avatarState({ turn: 'waiting', attention: { kind, title: 'Answer this' } }), 'needs-you');
  }
  assert.equal(avatarState({ turn: 'working' }), 'working');
  assert.equal(avatarState({ alive: false }), 'exited');
});

test('a helper needs an unsettled card, even without a bot store', () => {
  const now = Date.now(), bot = { id: 'bot', helpers: [{ paneId: 'pane', at: now }] };
  const panes = [{ id: 'pane', turn: 'waiting' }];
  assert.equal(helperState(bot, panes, now).helpersAsking, 0);
  let messages = [];
  const bots = { messages: () => messages };
  assert.equal(helperState(bot, panes, now, { bots }).helpersAsking, 0);
  messages = [{ role: 'terminal-ask', pane: 'pane', kind: 'permission' }];
  assert.equal(helperState(bot, panes, now, { bots }).helpersAsking, 1);
  assert.equal(helperState(bot, [], now, { bots }).helpersAsking, 0, 'closed terminals cannot ask');
  messages[0].settled = true;
  assert.equal(helperState(bot, panes, now, { bots }).helpersAsking, 0);
});

test('unfinished bot requests show pending work without pretending a brain is running', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-status-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bots = new Bots({ dir, checks: { home: os.homedir() }, fill: () => null });
  const { bot } = bots.create({ name: 'Status test', cwd: os.tmpdir() });
  assert.equal(bots.summary(bot.id).state, 'idle');
  const items = bots.captureRequirements(bot.id, bot, { id: 'owner-message', at: Date.now() }, 'Fix the misleading status badge.');
  assert.equal(items.length, 1);
  assert.equal(bots.summary(bot.id).state, 'pending');
  assert.equal(bots.summary(bot.id).openTasks, 1);
  bots.running.set(bot.id, { activity: 'Checking the fix' });
  assert.equal(bots.summary(bot.id).state, 'working');
  bots.running.delete(bot.id);
  // A bot's "ready" must tell Noam what to try (a working link is checked over the network), so the
  // fixture writes the ready mark and its Try line straight to the ledger.
  record([{ e: 'status', id: items[0].id, status: 'ready' }, { e: 'testing-handoff', id: items[0].id, link: 'https://example.test/try', tryText: 'open the bot list and read its row' }], { dir: bots.reqDir() });
  assert.equal(bots.summary(bot.id).openTasks, 0);
  assert.equal(bots.summary(bot.id).state, 'idle');
});
