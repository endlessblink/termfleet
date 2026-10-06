import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('an idle session signs out only when an idle limit is set', async () => {
  process.env.TC_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-idle-'));
  const accounts = await import('../bridge/accounts.mjs');
  accounts.createAccount('owner@example.com', 'a-long-enough-password');
  const owner = accounts.ownerUser();
  const t0 = Date.now();

  delete process.env.TC_SESSION_IDLE_MS;
  const plain = accounts.mintSession(owner).value;
  assert.ok(accounts.readSession(plain, t0), 'signed in');
  assert.ok(accounts.readSession(plain, t0 + 90 * 86400_000), 'no limit set: stays signed in');

  process.env.TC_SESSION_IDLE_MS = '60000';
  const timed = accounts.mintSession(owner).value;
  assert.ok(accounts.readSession(timed, t0), 'first use');
  assert.ok(accounts.readSession(timed, t0 + 50_000), 'used again within the limit');
  assert.ok(accounts.readSession(timed, t0 + 100_000), 'activity keeps it alive');
  assert.equal(accounts.readSession(timed, t0 + 200_000), null, 'idle past the limit signs out');
  delete process.env.TC_SESSION_IDLE_MS;
});
