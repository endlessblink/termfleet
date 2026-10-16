import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Push } from '../bridge/push.mjs';
import { Bots } from '../bridge/bots.mjs';

// TF-096 part 7: "you get phone notifications per bot".
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-push-'));
const settle = async (bots, id) => { for (let i = 0; i < 200 && bots.running.has(id); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a push is signed with the bridge\'s own key and carries no text', async () => {
  const calls = [];
  const push = new Push({ dir: tmp(), fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 }; } });
  assert.equal(push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }).ok, true);
  assert.match(push.subscribe({ endpoint: 'http://evil' }).error, /not a notification address/);
  const r = await push.notify({ title: 'Quill', body: 'The phone tests pass.', url: '/#bot:x' });
  assert.equal(r.sent, 1);
  const { init } = calls[0];
  assert.equal(init.headers['Content-Length'], '0', 'no message text goes through the push service');
  const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(init.headers.Authorization);
  const [h, c, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://fcm.googleapis.com');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(key, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(key, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
  assert.equal(push.latest().body, 'The phone tests pass.', 'the phone fetches the text from the bridge');
});

test('no notification while Noam has the app open; a phone that unsubscribed is forgotten', async () => {
  let now = 1_000_000;
  const push = new Push({ dir: tmp(), now: () => now, fetchImpl: async () => ({ ok: false, status: 410 }) });
  push.subscribe({ endpoint: 'https://push.example/1' });
  push.seen();
  assert.equal((await push.notify({ title: 'x', body: 'y' })).reason, 'app open');
  now += 120_000;
  await push.notify({ title: 'x', body: 'y' });
  assert.equal(push.read().subscriptions.length, 0);
});

test('a bot notifies on its reply and on a needs-you, unless its notifications are off', async () => {
  const notes = [];
  const bots = new Bots({ dir: tmp(), run: async () => ({ text: 'All 12 tests pass.' }), fill: () => null, checks: { home: os.homedir() }, notify: (n) => notes.push(n) });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  bots.send(bot.id, 'run the tests');
  await settle(bots, bot.id);
  assert.deepEqual(notes.map((n) => [n.title, n.body, n.url]), [['Quill', 'All 12 tests pass.', `/#bot:${bot.id}`]]);
  bots.update(bot.id, { notify: false });
  bots.send(bot.id, 'again');
  await settle(bots, bot.id);
  assert.equal(notes.length, 1);
  assert.equal(bots.summary(bot.id).notify, false);
});
