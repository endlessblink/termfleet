import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldHold, holdMessage, takeHeld, deliverHeld, bundle, heldPanes } from '../bridge/held-messages.mjs';
import { delegate } from '../bridge/orchestrate.mjs';

// 2026-10-26: Codex folds a message typed mid-turn into the running turn; 1,972 of 2,098 agent
// messages arrived that way. Noam approved holding them until the turn ends, delivered together.
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-held-'));

test('only a Codex agent that is mid-turn is held for', () => {
  assert.equal(shouldHold({ provider: 'codex', turn: 'working' }, {}), true);
  assert.equal(shouldHold({ provider: 'codex', turn: 'idle' }, {}), false);
  assert.equal(shouldHold({ provider: 'claude', turn: 'working' }, {}), false);
  assert.equal(shouldHold({ provider: 'codex', turn: 'working' }, { TERMFLEET_HOLD_BUSY: '0' }), false, 'can be switched off');
});

test('a message to a busy Codex agent is held, not typed', async () => {
  const d = dir(); const typed = [];
  const r = await delegate({ id: 'terminal-c', alive: true, provider: 'codex', turn: 'working' }, 'check the build', { send: async (p, t) => { typed.push(t); return { ok: true }; }, heldOpts: { dir: d } });
  assert.deepEqual(r, { ok: true, held: true });
  assert.equal(typed.length, 0);
  assert.deepEqual(heldPanes({ dir: d }), ['terminal-c']);
});

test('once the turn ends, every held message goes in as one, oldest first', async () => {
  const d = dir(); const typed = [];
  holdMessage('terminal-c', 'first', { dir: d, now: 1 });
  holdMessage('terminal-c', 'second', { dir: d, now: 2 });
  const send = async (p, t) => { typed.push(t); return { ok: true }; };
  await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'working' }], send, dir: d });
  assert.equal(typed.length, 0, 'still working: nothing typed');
  await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'waiting' }], send, dir: d });
  assert.equal(typed.length, 0, 'never into a question or approval');
  const out = await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'idle' }], send, dir: d });
  assert.deepEqual(out, [{ pane: 'terminal-c', count: 2 }]);
  assert.equal(typed.length, 1);
  assert.match(typed[0], /^\[2 messages arrived while you were working[\s\S]*message 1 of 2 ---\nfirst[\s\S]*message 2 of 2 ---\nsecond$/);
  assert.deepEqual(takeHeld('terminal-c', { dir: d }), [], 'nothing left');
});

test('a failed delivery keeps the messages for the next try', async () => {
  const d = dir();
  holdMessage('terminal-c', 'keep me', { dir: d });
  await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'idle' }], send: async () => ({ error: 'busy' }), dir: d });
  assert.deepEqual(takeHeld('terminal-c', { dir: d }).map((r) => r.text), ['keep me']);
});

test('a new message to an idle agent takes the held ones with it', async () => {
  const d = dir(); const typed = [];
  holdMessage('terminal-c', 'older', { dir: d });
  await delegate({ id: 'terminal-c', alive: true, provider: 'codex', turn: 'idle' }, 'newer', { send: async (p, t) => { typed.push(t); return { ok: true }; }, heldOpts: { dir: d } });
  assert.equal(typed.length, 1);
  assert.match(typed[0], /2 messages arrived[\s\S]*older[\s\S]*newer/);
  assert.equal(bundle(['only']), 'only');
});
