import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// 2026-10-16 (Freelance Desk, for the operator): every deploy restart of the
// bridge dropped the phone view. A restart must be invisible: in-flight replies
// finish, the page reconnects by itself and keeps the open chat, no error screen.
const bridge = path.join(import.meta.dirname, '..', 'bridge', 'server.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function start(port, configDir) {
  const child = spawn(process.execPath, [bridge], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  return child;
}
async function ready(base) {
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/login'); return; } catch { await wait(100); } }
  throw new Error('bridge did not start');
}
const exited = (child) => new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));

test('a restart lets an in-flight reply finish before the bridge exits', async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-restart-'));
  const child = start(port, configDir);
  try {
    await ready(base);
    // A request whose body is still arriving when the restart begins.
    const reply = new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 39\r\n\r\nemail=a%40b.test&`);
        setTimeout(() => socket.write('password=aaaaaaaaaaaaa'), 700);
      });
      let data = '';
      socket.on('data', (d) => { data += d; });
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
    });
    await wait(150);
    const gone = exited(child);
    child.kill('SIGTERM');
    const answer = await reply;
    assert.match(answer, /^HTTP\/1\.1 \d{3}/, 'the in-flight request got a real answer');
    const end = await gone;
    assert.equal(end.code, 0, 'a requested restart exits cleanly');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('on a phone, a restart keeps the open chat and reconnects without an error screen', { timeout: 120000 }, async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-restart-'));
  let child = start(port, configDir);
  const browser = await chromium.launch();
  try {
    await ready(base);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    let streams = 0;
    page.on('response', (r) => { if (r.url().includes('/api/session-events') && r.status() === 200) streams++; });
    await page.goto(base + '/');
    if (await page.$('#password')) {
      if (await page.$('#email')) await page.fill('#email', 'owner@example.test');
      await page.fill('#password', 'a-good-password');
      await page.click('button[type=submit]');
    }
    await page.waitForSelector('.pane', { timeout: 20000 });
    await page.click('.pane');
    await page.waitForSelector('.composer', { timeout: 15000 });
    const hash = await page.evaluate(() => location.hash);
    const streamsBefore = streams;

    // Restart: stop, then the gap as the phone sees it through the tunnel — every
    // request answered with "502 Bad Gateway" (which also kills a browser event
    // stream for good) — then start again.
    const gone = exited(child);
    child.kill('SIGTERM');
    await gone;
    const tunnel = http.createServer((req, res) => { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<h1>Bad gateway</h1>'); });
    await new Promise((r) => tunnel.listen(port, '127.0.0.1', r));
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await wait(7000);
    assert.equal(await page.$('.read-failure'), null, 'no error screen while the bridge is down');
    tunnel.closeAllConnections?.();
    await new Promise((r) => tunnel.close(r));
    child = start(port, configDir);
    await ready(base);

    await page.waitForFunction(() => !document.querySelector('.connection-note') && !document.querySelector('.reconnecting'), null, { timeout: 30000 }).catch(async (e) => { throw new Error(e.message + ' / ' + await page.evaluate(() => (document.querySelector('.connection-note')?.outerHTML || '') + ' :: ' + (document.querySelector('.reconnecting')?.outerHTML || '') + ' :: ' + location.hash + ' :: ' + document.getElementById('sub').textContent)); });
    assert.equal(await page.evaluate(() => location.hash), hash, 'the same chat is still open');
    assert.ok(await page.$('.composer'), 'the chat is usable');
    assert.equal(await page.$('.read-failure'), null, 'no error screen after reconnecting');
    for (let i = 0; i < 40 && streams <= streamsBefore; i++) await wait(250);
    assert.ok(streams > streamsBefore, 'the live event stream reconnected by itself');
  } finally {
    await browser.close();
    child.kill('SIGKILL');
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
