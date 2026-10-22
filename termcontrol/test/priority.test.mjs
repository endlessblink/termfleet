// Noam 2026-10-22: 'אין דרך להגביל את מידת השימוש במעבד לכל הסוכנים האלו אלא אם זה משהו דחוף?'
// The phone's Urgent toggle and agent-share setting go through these bridge routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { handlePriority, priorityState } from '../bridge/priority.mjs';
import { priorityPaths } from '../../scripts/lib/cpu-priority.mjs';

const setup = () => {
  const paths = priorityPaths({ XDG_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-prio-bridge-')) });
  const calls = [];
  const sys = { daemonUnits: () => ['termfleet-daemon-1.service'], setProperty: (u, p) => { calls.push([u, p]); return true; } };
  const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-prio-proc-'));
  return { opts: { paths, sys, procRoot, cgroupRoot: procRoot }, calls };
};
const call = async (method, pathname, body, opts) => {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method;
  let out = null;
  const handled = await handlePriority(req, {}, new URL(`http://x${pathname}`), (_res, status, data) => { out = { status, data }; }, opts);
  return { handled, ...out };
};

test('other routes are left to the bridge', async () => {
  const { opts } = setup();
  assert.equal((await call('GET', '/api/sleep', null, opts)).handled, false);
});

test('the phone reads and changes the share every agent terminal gets, applied live', async () => {
  const { opts, calls } = setup();
  assert.deepEqual((await call('GET', '/api/priority', null, opts)).data, { agentWeight: 20, urgent: [] });
  const set = await call('POST', '/api/priority/settings', { agentWeight: 50 }, opts);
  assert.equal(set.status, 200);
  assert.equal(set.data.agentWeight, 50);
  assert.deepEqual(calls, [['termfleet-daemon-1.service', { CPUWeight: 50, IOWeight: 50 }]]);
  assert.equal((await call('POST', '/api/priority/settings', { agentWeight: 0 }, opts)).status, 400);
  assert.equal(priorityState(opts).agentWeight, 50);
});

test('Urgent from the phone says plainly why it could not, and rejects non-terminals', async () => {
  const { opts } = setup();
  assert.equal((await call('POST', '/api/priority/urgent', { pane: '../etc', on: true }, opts)).status, 400);
  const r = await call('POST', '/api/priority/urgent', { pane: 'terminal-a-b', on: true }, opts);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /no running programs/);
});
