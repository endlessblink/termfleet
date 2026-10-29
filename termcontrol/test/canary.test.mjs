import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCanary, checkCanary, readCanary } from '../bridge/canary.mjs';

function daemon({ breakAt } = {}) {
  const sessions = new Map(), log = [];
  const send = async (req) => {
    log.push(req.type);
    if (req.type === breakAt) return { ok: false };
    if (req.type === 'ensureSession') { sessions.set(req.id, ''); return { ok: true }; }
    if (req.type === 'writeSession') { sessions.set(req.id, sessions.get(req.id) + req.data); return { ok: true }; }
    if (req.type === 'killSession') { sessions.delete(req.id); return { ok: true }; }
    if (req.type === 'listSessions') return { ok: true, value: { sessions: [...sessions.keys()].map((id) => ({ id })) } };
    return { ok: false };
  };
  return { send, sessions, log, screen: async (id) => sessions.get(id) || '', wait: async () => {} };
}

test('a healthy daemon passes and the test terminal is gone afterwards', async () => {
  const d = daemon();
  const r = await runCanary(d);
  assert.equal(r.ok, true);
  assert.equal(d.sessions.size, 0);
  assert.deepEqual(d.log, ['ensureSession', 'writeSession', 'killSession', 'listSessions']);
});

test('a daemon that cannot type fails with a plain reason, and still cleans up', async () => {
  const d = daemon({ breakAt: 'writeSession' });
  const r = await runCanary(d);
  assert.equal(r.ok, false);
  assert.match(r.error, /Typing/);
  assert.equal(d.sessions.size, 0, 'removed even though the test failed');
});

test('a failure is pushed once, not every run, and saved for the Health tab', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-canary-'));
  const pushed = [];
  const bad = async () => ({ ok: false, at: 1, ms: 5, error: 'x', step: 'type' });
  await checkCanary({ dir, notify: (n) => pushed.push(n), run: bad });
  await checkCanary({ dir, notify: (n) => pushed.push(n), run: bad });
  assert.equal(pushed.length, 1);
  assert.equal(readCanary(dir).ok, false);
  await checkCanary({ dir, notify: (n) => pushed.push(n), run: async () => ({ ok: true, at: 2, ms: 9 }) });
  assert.equal(readCanary(dir).ok, true);
});
