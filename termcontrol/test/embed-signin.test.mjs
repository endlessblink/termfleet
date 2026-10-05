import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The Agents tab inside TermFleet signs itself in, but only for this machine's
// own iframe — never for a phone, a tunnel, or a web page opening it directly.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-embed-'));
process.env.TC_CONFIG_DIR = dir;
const accounts = await import('../bridge/accounts.mjs');
const { handleAuthRoutes, currentUser } = await import('../bridge/auth.mjs');
accounts.createAccount('owner@example.com', 'a-long-enough-password');

const call = async ({ remote = '127.0.0.1', host = '127.0.0.1', headers = {} } = {}) => {
  const req = { method: 'GET', headers: { host, ...headers }, socket: { remoteAddress: remote } };
  const out = { status: null, headers: {} };
  const res = { writeHead(code, h = {}) { out.status = code; out.headers = h; }, end() {} };
  await handleAuthRoutes(req, res, new URL(`http://${host}:7810/embed`));
  return out;
};

test('this machine\'s own iframe is signed in as the owner', async () => {
  const out = await call({ headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(out.status, 302);
  const cookie = out.headers['set-cookie'].split(';')[0].split('=').slice(1).join('=');
  assert.equal(currentUser({ headers: { cookie: `tc_session=${cookie}` } }).email, 'owner@example.com');
});

test('a web page, a tunnel, or another device cannot use it', async () => {
  assert.equal((await call({ headers: { 'sec-fetch-dest': 'document' } })).status, 404, 'opened as a page');
  assert.equal((await call({ headers: { 'sec-fetch-dest': 'iframe', 'x-forwarded-for': '1.2.3.4' } })).status, 404, 'through a proxy');
  assert.equal((await call({ remote: '192.168.1.20', headers: { 'sec-fetch-dest': 'iframe' } })).status, 404, 'other device');
  assert.equal((await call({ host: 'tc.example.com', headers: { 'sec-fetch-dest': 'iframe' } })).status, 404, 'public hostname');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
