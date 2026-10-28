import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
import { checkBotEvents } from '../bridge/bot-events.mjs';
import { ChoiceReceipts } from '../bridge/choice-receipts.mjs';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-question-admission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bots = new Bots({ dir, run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-h', task: 'review' }]));
  const receipts = new ChoiceReceipts(path.join(dir, 'receipts.json'));
  const wakes = [], notices = [];
  bots.wake = (_id, text) => wakes.push(text);
  const ask = { id: 'vendor-question-1', kind: 'question', title: 'Which result?', options: [{ key: '1', label: 'First' }, { key: '2', label: 'Second' }] };
  const poll = (question = ask, seen = new Map(), now = Date.now()) => checkBotEvents({ bots, seen, now,
    panes: [{ id: 'terminal-h', provider: 'codex', sessionId: 'session-1', turn: 'waiting' }],
    readAsk: async () => question, readCompletion: () => ({ unresolved: 'not needed for question admission' }), notify: notice => notices.push(notice),
    readAnswerReceipt: (pane, id) => receipts.get(pane, id) });
  return { bots, bot, receipts, wakes, notices, ask, poll };
}

test('an asked unanswered question stays findable without another automatic wake, including a fresh polling cursor', async t => {
  const { bots, bot, wakes, poll } = setup(t);
  await poll(); await poll();
  assert.equal(wakes.length, 1);
  const cards = bots.view(bot.id).messages.filter(m => m.role === 'terminal-ask');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].settled, undefined);
});

test('a successful exact answer receipt blocks scheduling and recreating the answered question after restart', async t => {
  const { bots, bot, receipts, wakes, ask, poll } = setup(t);
  await receipts.send('terminal-h', ask.id, '1', async () => ({ ok: true }));
  await poll(); await poll();
  assert.equal(wakes.length, 0, 'no automatic model turn for an answered identity');
  assert.equal(bots.messages(bot.id).filter(m => m.role === 'terminal-ask').length, 0);
});

test('an existing question is retired after its successful answer instead of being reminded', async t => {
  const { bots, bot, receipts, wakes, ask, poll } = setup(t);
  await poll();
  await receipts.send('terminal-h', ask.id, '1', async () => ({ ok: true }));
  await poll();
  assert.equal(wakes.length, 1);
  assert.equal(bots.messages(bot.id).find(m => m.role === 'terminal-ask').settled, true);
});

test('a genuinely new question identity remains eligible even with identical words', async t => {
  const { receipts, wakes, ask, poll } = setup(t);
  await receipts.send('terminal-h', ask.id, '1', async () => ({ ok: true }));
  await poll({ ...ask, id: 'vendor-question-2' });
  assert.equal(wakes.length, 1);
});

test('an explicitly repeated screen prompt retains the existing new-prompt receipt semantics', async t => {
  const { receipts, wakes, ask, poll } = setup(t);
  const again = { ...ask, id: 'codex:session-1:prompt:explicit-reask' };
  await receipts.send('terminal-h', again.id, '1', async () => ({ ok: true }));
  await poll(again);
  assert.equal(wakes.length, 1, 'screen reappearance after verified closure is a new prompt');
});

test('a definitely not-sent answer never suppresses the unanswered question', async t => {
  const { receipts, wakes, ask, poll } = setup(t);
  await receipts.send('terminal-h', ask.id, '1', async () => ({ error: 'not sent', notSent: true }));
  await poll();
  assert.equal(wakes.length, 1);
});
test('an unanswered question remains available after five minutes without an automatic reask notification', async t => {
  const { bots, bot, wakes, notices, ask, poll } = setup(t);
  await poll();
  await poll(ask, new Map(), Date.now() + 6 * 60_000);
  assert.equal(wakes.length, 1);
  assert.equal(notices.length, 1, 'only the first genuinely new question notifies');
  assert.equal(bots.messages(bot.id).filter(m => m.role === 'reminder').length, 0);
  assert.equal(bots.view(bot.id).messages.filter(m => m.role === 'terminal-ask' && !m.settled).length, 1);
});
