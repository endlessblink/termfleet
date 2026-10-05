import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { clientKey, crossSiteWrite, safeUrl } from '../bridge/guard.mjs';

const req = (over = {}) => ({ method: 'POST', headers: { host: 'tc.example.com' }, socket: { remoteAddress: '203.0.113.9' }, ...over });

test('login limiter ignores forwarding headers from strangers, trusts them from this machine\'s proxy', () => {
  const spoofed = req({ headers: { host: 'x', 'x-forwarded-for': '10.0.0.1', 'cf-connecting-ip': '10.0.0.2' } });
  assert.equal(clientKey(spoofed), '203.0.113.9', 'a stranger cannot pick their own key');
  const viaProxy = req({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'x', 'cf-connecting-ip': '198.51.100.7' } });
  assert.equal(clientKey(viaProxy), '198.51.100.7');
  assert.equal(clientKey(req({ socket: { remoteAddress: '::1' }, headers: { host: 'x' } })), '::1');
});

test('writes from another site are refused; same-site and tool requests pass', () => {
  assert.equal(crossSiteWrite(req({ headers: { host: 'tc.example.com', origin: 'https://evil.example' } })), true);
  assert.equal(crossSiteWrite(req({ headers: { host: 'tc.example.com', origin: 'null' } })), true);
  assert.equal(crossSiteWrite(req({ headers: { host: 'tc.example.com', origin: 'https://tc.example.com' } })), false);
  assert.equal(crossSiteWrite(req({ headers: { host: '127.0.0.1:7810', 'x-forwarded-host': 'tc.example.com', origin: 'https://tc.example.com' } })), false, 'behind a proxy');
  assert.equal(crossSiteWrite(req({ headers: { host: 'tc.example.com' } })), false, 'no Origin = not a browser page');
  assert.equal(crossSiteWrite(req({ method: 'GET', headers: { host: 'tc.example.com', origin: 'https://evil.example' } })), false, 'reads are not writes');
});

test('a malformed Host header gives no URL instead of a crash', () => {
  assert.equal(safeUrl({ url: '/api/panes', headers: { host: 'bad host' } }), null);
  assert.equal(safeUrl({ url: '/api/panes', headers: { host: '127.0.0.1:7810' } }).pathname, '/api/panes');
});

const raw = (port, text) => new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
  let out = '';
  socket.on('data', (d) => { out += d; });
  socket.on('close', () => resolve(out));
  socket.on('error', () => resolve(out));
  setTimeout(() => socket.destroy(), 3000);
});

test('the running bridge survives a bad Host and refuses a cross-site write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-'));
  const port = 7890 + Math.floor(Math.random() * 90);
  const child = spawn('node', [path.resolve('termcontrol/bridge/server.mjs')], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: dir }, stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) { // wait until it listens
      if (await new Promise((r) => net.connect(port, '127.0.0.1').on('connect', function () { this.destroy(); r(true); }).on('error', () => r(false)))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const bad = await raw(port, 'GET /api/panes HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n');
    assert.match(bad, /^HTTP\/1\.1 400/, 'bad Host answered, not crashed');
    const cross = await raw(port, `POST /api/send HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://evil.example\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
    assert.match(cross, /^HTTP\/1\.1 403/);
    const still = await raw(port, `GET /api/panes HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    assert.match(still, /^HTTP\/1\.1 (401|302)/, 'still alive and answering');
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
