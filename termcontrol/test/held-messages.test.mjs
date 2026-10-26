import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldHold, holdMessage, takeHeld, deliverHeld, bundle, heldPanes } from '../bridge/held-messages.mjs';
import { delegate } from '../bridge/orchestrate.mjs';

// 2026-10-26: holding messages for a Codex agent until its turn ended was tried and left 65
// messages undelivered for up to 1.5 hours (those agents never finished a turn). Holding is now
// opt-in (TERMFLEET_HOLD_BUSY=1), and anything still held goes in within one pass.
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-held-'));

test('holding is off unless switched on, and then only for a busy Codex agent', () => {
  assert.equal(shouldHold({ provider: 'codex', turn: 'working' }, {}), false, 'off by default since the 1.5-hour turns');
  assert.equal(shouldHold({ provider: 'codex', turn: 'working' }, { TERMFLEET_HOLD_BUSY: '1' }), true);
  assert.equal(shouldHold({ provider: 'codex', turn: 'idle' }, { TERMFLEET_HOLD_BUSY: '1' }), false);
  assert.equal(shouldHold({ provider: 'claude', turn: 'working' }, { TERMFLEET_HOLD_BUSY: '1' }), false);
});

test('by default a message to a busy Codex agent goes straight in', async () => {
  const d = dir(); const typed = [];
  const prev = process.env.TERMFLEET_HOLD_BUSY; delete process.env.TERMFLEET_HOLD_BUSY;
  try {
    const r = await delegate({ id: 'terminal-c', alive: true, provider: 'codex', turn: 'working' }, 'check the build', { send: async (p, t) => { typed.push(t); return { ok: true }; }, heldOpts: { dir: d } });
    assert.equal(r.held, undefined);
    assert.equal(typed.length, 1);
    assert.deepEqual(heldPanes({ dir: d }), []);
  } finally { if (prev !== undefined) process.env.TERMFLEET_HOLD_BUSY = prev; }
});

test('held messages go in together on the next pass, even while the agent works, never into a question', async () => {
  const d = dir(); const typed = [];
  holdMessage('terminal-c', 'first', { dir: d, now: 1 });
  holdMessage('terminal-c', 'second', { dir: d, now: 2 });
  const send = async (p, t) => { typed.push(t); return { ok: true }; };
  await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'waiting' }], send, dir: d });
  assert.equal(typed.length, 0, 'never into a question or approval');
  const out = await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'working' }], send, dir: d });
  assert.deepEqual(out, [{ pane: 'terminal-c', count: 2 }]);
  assert.match(typed[0], /^\[2 messages arrived while you were working[\s\S]*message 1 of 2 ---\nfirst[\s\S]*message 2 of 2 ---\nsecond$/);
  assert.deepEqual(takeHeld('terminal-c', { dir: d }), [], 'nothing left');
});

test('a failed delivery keeps the messages for the next try', async () => {
  const d = dir();
  holdMessage('terminal-c', 'keep me', { dir: d });
  await deliverHeld({ panes: [{ id: 'terminal-c', alive: true, turn: 'idle' }], send: async () => ({ error: 'busy' }), dir: d });
  assert.deepEqual(takeHeld('terminal-c', { dir: d }).map((r) => r.text), ['keep me']);
});

test('a new message takes any held ones with it', async () => {
  const d = dir(); const typed = [];
  holdMessage('terminal-c', 'older', { dir: d });
  await delegate({ id: 'terminal-c', alive: true, provider: 'codex', turn: 'idle' }, 'newer', { send: async (p, t) => { typed.push(t); return { ok: true }; }, heldOpts: { dir: d } });
  assert.equal(typed.length, 1);
  assert.match(typed[0], /2 messages arrived[\s\S]*older[\s\S]*newer/);
  assert.equal(bundle(['only']), 'only');
});
