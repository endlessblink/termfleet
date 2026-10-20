// Noam 2026-10-20: "how will I know what is ready and waiting for me?" and "I need this from
// every agent: a short summary that keeps itself up to date, with exactly what to do".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectWaiting, createWaitingNotifier } from '../bridge/waiting.mjs';
import { cli, parseMark, ledgerText } from '../../scripts/termfleet-asks.mjs';

const asks = {
  'bot:b1': [{ n: 5, text: 'Show unread messages on the bots', status: 'ready', note: 'open the bots list and look for the orange numbers' }, { n: 6, text: 'Old thing', status: 'done', note: 'x' }],
  'bot:b2': [{ n: 2, text: 'Slim header', status: 'ready', note: 'open a bot chat and tap 25/30' }],
  'terminal:p1': [{ n: 9, text: 'Fix the photo send', status: 'ready', note: 'attach a photo in a bot chat and send it' }, { n: 10, text: 'Still building', status: 'partial', note: 'half' }],
};
const input = {
  bots: [{ id: 'b1', name: 'Agent-Manager' }, { id: 'b2', name: 'paper-bot' }, { id: 'b3', name: 'Quiet', hidden: true, blocked: { ask: 'hidden bots stay out' } }, { id: 'b4', name: 'pc-helper', blocked: { ask: 'Which drive should I clean?' } }],
  panes: [{ id: 'p1', title: 'rough-cut fixes', turn: 'idle' }, { id: 'p2', title: 'Desk deploy', turn: 'waiting', attention: { title: 'Permission request: run npm install' } }, { id: 'p3', title: 'closed one', alive: false, turn: 'waiting' }],
  asksOf: ({ kind, id }) => asks[`${kind}:${id}`] || null,
};

test('one list from every bot and terminal: who, what, and what to do, answers first', () => {
  const items = collectWaiting(input);
  assert.deepEqual(items.map((i) => [i.kind, i.who]), [
    ['approve', 'Desk deploy'], ['answer', 'pc-helper'],
    ['try', 'Agent-Manager'], ['try', 'paper-bot'], ['try', 'rough-cut fixes'],
  ]);
  const ready = items.find((i) => i.who === 'paper-bot');
  assert.equal(ready.todo, 'open a bot chat and tap 25/30');
  assert.equal(ready.go, '#bot:b2');
  assert.equal(items.find((i) => i.who === 'Desk deploy').go, '#p2');
  assert.equal(items.find((i) => i.who === 'Desk deploy').todo, 'Approve or decline it');
  assert.ok(!items.some((i) => /hidden bots|closed one|Still building|Old thing/.test(i.what + i.who)));
});

test('one phone push and one desktop notification per new item; nothing on the first look', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-waiting-')), 'seen.json');
  const pushes = [], desktops = [];
  const notify = createWaitingNotifier({ file, push: async (n) => pushes.push(n), desktop: async (n) => desktops.push(n) });
  const first = collectWaiting(input);
  assert.deepEqual(await notify(first), [], 'what is already waiting at start is not news');
  assert.deepEqual(await notify(first), []);
  const more = collectWaiting({ ...input, asksOf: ({ kind, id }) => kind === 'bot' && id === 'b4' ? [{ n: 1, text: 'Clean the drive', status: 'ready', note: 'check the free space in Files' }] : input.asksOf({ kind, id }) });
  const fresh = await notify(more);
  assert.equal(fresh.length, 1);
  assert.equal(pushes.length, 1); assert.equal(desktops.length, 1);
  assert.match(pushes[0].title, /Ready for you: pc-helper/);
  assert.match(pushes[0].body, /Try: check the free space in Files/);
  assert.equal(pushes[0].url, '/#bot:b4');
  // Survives a restart: no repeat.
  const again = createWaitingNotifier({ file, push: async (n) => pushes.push(n), desktop: async () => {} });
  assert.deepEqual(await again(more), []);
  assert.equal(pushes.length, 1);
});

test('agents mark a request ready with what to try, and are told to', () => {
  assert.equal(cli(['ready', '5', 'open', 'the', 'bots', 'list']).ok, true);
  assert.equal(cli(['ready', '5']).ok, false);
  assert.deepEqual(parseMark('termfleet-asks ready 5,6 "tap 25/30 in a bot chat"'), { status: 'ready', nums: [5, 6], note: 'tap 25/30 in a bot chat' });
  const text = ledgerText([{ n: 1, text: 'Make it smaller', status: 'ready', note: 'open a chat' }, { n: 2, text: 'Another', status: 'open', note: '' }]);
  assert.match(text, /#1 \[ready: open a chat\]/);
  assert.match(text, /Use ready \(not partial\) when it is built and live/);
});
