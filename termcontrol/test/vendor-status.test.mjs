import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentsByPane } from '../bridge/inventory.mjs';
import { applyVendorStatus, stalledFor, STALL_AFTER_MS } from '../bridge/session-status.mjs';

test('a "working" agent with no sign of life for 20 minutes is called out; waiting never is', () => {
  const now = 10 * STALL_AFTER_MS;
  const quietFor = (ms) => now - ms;
  assert.equal(stalledFor({ turn: 'working' }, { producing: false }, quietFor(STALL_AFTER_MS + 1), now), STALL_AFTER_MS + 1);
  assert.equal(stalledFor({ turn: 'working' }, { producing: false }, quietFor(60_000), now), 0);
  assert.equal(stalledFor({ turn: 'working' }, { producing: true }, quietFor(STALL_AFTER_MS * 3), now), 0);
  assert.equal(stalledFor({ turn: 'waiting' }, { producing: false }, quietFor(STALL_AFTER_MS * 3), now), 0);
});

// 2026-10-12 live check: Claude's own record said a pane was waiting on the operator
// while the phone showed "working". Claude's per-process record now decides.
test('Claude’s own idle / busy / waiting record reaches the pane', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vendor-'));
  const proc = path.join(root, 'proc'), sessions = path.join(root, 'sessions');
  fs.mkdirSync(path.join(proc, '4242'), { recursive: true });
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(proc, '4242', 'cmdline'), 'claude\0--resume\0');
  fs.writeFileSync(path.join(proc, '4242', 'environ'), 'HOME=/x\0TERMFLEET_PANE_ID=terminal-a\0');
  fs.writeFileSync(path.join(sessions, '4242.json'), JSON.stringify({ pid: 4242, sessionId: 's-1', status: 'waiting', statusUpdatedAt: 123 }));
  const agent = agentsByPane({ procRoot: proc, claudeSessions: sessions }).get('terminal-a');
  assert.deepEqual(agent, { provider: 'claude', sessionId: 's-1', vendorStatus: { status: 'waiting', at: 123 } });
});

test('the agent’s own status overrides a stale guess, and nothing changes without it', () => {
  assert.equal(applyVendorStatus({ turn: 'working', vendorStatus: { status: 'waiting' } }).turn, 'waiting');
  assert.equal(applyVendorStatus({ turn: 'idle', vendorStatus: { status: 'busy' } }).turn, 'working');
  assert.equal(applyVendorStatus({ turn: 'working', vendorStatus: { status: 'idle' } }).turn, 'idle');
  assert.equal(applyVendorStatus({ turn: 'completed', vendorStatus: { status: 'idle' } }).turn, 'completed');
  const plain = { turn: 'working' };
  assert.equal(applyVendorStatus(plain), plain);
});
