import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSendOnce } from '../bridge/send-once.mjs';

// A phone that gave up waiting must be able to retry without the agent getting the
// message twice.
test('a retried draft is typed once and both callers get the same outcome', async () => {
  const sendOnce = createSendOnce();
  let typed = 0;
  const slow = () => new Promise((resolve) => setTimeout(() => { typed++; resolve({ ok: true, delivered: true }); }, 20));
  const [first, retry] = await Promise.all([sendOnce('d1', 'hello', slow), sendOnce('d1', 'hello', slow)]);
  const later = await sendOnce('d1', 'hello', slow);
  assert.equal(typed, 1);
  assert.equal(first.ok, true);
  assert.equal(retry.repeated, true);
  assert.equal(later.repeated, true);
});

test('a proven prewrite refusal can be retried; a changed text is refused', async () => {
  const sendOnce = createSendOnce();
  let calls = 0;
  assert.equal((await sendOnce('d2', 'x', async () => { calls++; return { error: 'busy', busy: true, notSent: true }; })).busy, true);
  assert.equal((await sendOnce('d2', 'x', async () => { calls++; return { ok: true }; })).ok, true);
  assert.equal(calls, 2);
  assert.match((await sendOnce('d2', 'y', async () => ({ ok: true }))).error, /changed/);
  assert.equal((await sendOnce(undefined, 'z', async () => ({ ok: true }))).ok, true, 'old phones without an id still work');
});

test('the phone sends one id per draft and keeps it across retries', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  assert.match(html, /if \(bar\.sendDraft !== text\)/);
  assert.match(html, /sendId: bar\.sendId/);
});
