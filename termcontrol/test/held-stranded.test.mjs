import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { holdMessage, heldPanes, sweepStranded, strandedText, senderOf, STRAND_GRACE_MS, STRAND_STUCK_MS } from '../bridge/held-messages.mjs';

// Noam 2026-10-27 17:08-17:11: five corrections to a working helper were held, the helper was closed before the
// window ended, and the bot told him they were passed on ("you passed nothing! no terminal got these instructions").
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-strand-'));
const from = (id, text) => `[Message from the bot "Agent-Manager" (bot:${id}), sent through TermFleet.] ${text}`;
const T0 = 1_000_000_000_000;

test('five held corrections for a terminal that was closed are filed and the sending bot is told what never arrived', () => {
  const d = dir(); const told = [];
  for (const [i, text] of ['STOP. Noam says the design is a total failure', 'nothing he asked for was done', 'must look like part of termfleet', 'external checker', '/sure at every step'].entries())
    holdMessage('terminal-8c14', from('315a7bfa1cef', text), { dir: d, now: T0 + i * 20_000 });
  assert.deepEqual(heldPanes({ dir: d }), ['terminal-8c14']);
  // The terminal is no longer in the daemon's list.
  const out = sweepStranded({ panes: [], dir: d, now: T0 + 100_000 + STRAND_GRACE_MS, notify: (s) => told.push(s) });
  assert.equal(out.length, 1);
  assert.equal(told.length, 1);
  assert.equal(told[0].sender, '315a7bfa1cef');
  assert.equal(told[0].rows.length, 5);
  assert.deepEqual(heldPanes({ dir: d }), [], 'nothing is left held');
  const filed = fs.readdirSync(d).find((f) => f.endsWith('.undelivered'));
  assert.ok(filed, 'the words are kept in an .undelivered file');
  assert.equal(fs.readFileSync(path.join(d, filed), 'utf8').trim().split('\n').length, 5);
  const text = strandedText(told[0]);
  assert.match(text, /NOT delivered: Your 5 messages/);
  assert.match(text, /terminal was closed/);
  assert.match(text, /STOP\. Noam says the design is a total failure/);
  assert.match(text, /send them again|tell Noam plainly/);
});

test('a terminal that is still alive and working keeps its held messages and nobody is alarmed', () => {
  const d = dir(); const told = [];
  holdMessage('terminal-x', from('abc123def456', 'check the build'), { dir: d, now: T0 });
  assert.deepEqual(sweepStranded({ panes: [{ id: 'terminal-x', alive: true, turn: 'working' }], dir: d, now: T0 + 60_000, notify: (s) => told.push(s) }), []);
  assert.deepEqual(told, []);
  assert.deepEqual(heldPanes({ dir: d }), ['terminal-x']);
});

test('a terminal waiting on a person (a menu or a question) for 5 minutes: the sender is told once, the messages stay held', () => {
  const d = dir(); const told = [];
  holdMessage('terminal-w', from('abc123def456', 'start the mockups'), { dir: d, now: T0 });
  const pane = { id: 'terminal-w', alive: true, turn: 'waiting' };
  assert.deepEqual(sweepStranded({ panes: [pane], dir: d, now: T0 + STRAND_STUCK_MS - 1, notify: (s) => told.push(s) }), []);
  assert.equal(sweepStranded({ panes: [pane], dir: d, now: T0 + STRAND_STUCK_MS + 1, notify: (s) => told.push(s) }).length, 1);
  assert.equal(sweepStranded({ panes: [pane], dir: d, now: T0 + STRAND_STUCK_MS + 60_000, notify: (s) => told.push(s) }).length, 0, 'told once');
  assert.equal(told.length, 1);
  assert.equal(told[0].reason, 'waiting');
  assert.match(strandedText(told[0]), /waiting for a person/);
  assert.deepEqual(heldPanes({ dir: d }), ['terminal-w'], 'still held, not lost');
});

test('old strays are filed quietly and messages from no bot do not wake anyone', () => {
  const d = dir(); const told = [];
  holdMessage('terminal-old', from('315a7bfa1cef', 'ancient'), { dir: d, now: T0 });
  holdMessage('terminal-nobot', 'a plain message with no sender mark', { dir: d, now: T0 + 40 * 60_000 });
  const out = sweepStranded({ panes: [], dir: d, now: T0 + 41 * 60_000, notify: (s) => told.push(s) });
  assert.deepEqual(told, [], 'nobody is woken about a 40-minute-old message or an unmarked one');
  assert.deepEqual(heldPanes({ dir: d }), []);
  assert.equal(out.length, 2);
  assert.equal(senderOf(from('315a7bfa1cef', 'x')), '315a7bfa1cef');
  assert.equal(senderOf('no mark'), null);
});
