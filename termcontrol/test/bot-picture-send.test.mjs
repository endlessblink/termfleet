// Noam 2026-10-20: "if I attach a picture manually from the phone I can't send the message".
// Root cause: after a slow photo upload, the send went down a connection the bridge had
// already closed (Node's 5 s idle limit vs the tunnel's ~90 s), and was reset. Also: the
// photo is shrunk before it goes up, a gallery file with no type still attaches, and the
// page never reloads itself (losing the picture) while the picture chooser is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startBridge() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-picture-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home'), uploads = path.join(tmp, 'up');
  for (const d of [configDir, botsHome, uploads]) fs.mkdirSync(d, { recursive: true });
  const port = 7600 + Math.floor(Math.random() * 300);
  // The brain is /bin/false: no model is ever called.
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_UPLOAD_DIR: uploads, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const stop = () => { child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { tmp, configDir, uploads, port, stop };
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await wait(150); } } }

test('a connection left idle like the phone tunnel does is still usable', { timeout: 30000 }, async () => {
  const b = startBridge();
  try {
    await ready(b.port);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = () => new Promise((resolve, reject) => { const req = http.get({ host: '127.0.0.1', port: b.port, path: '/login', agent }, (res) => { res.resume(); res.on('end', () => resolve(socket)); }); let socket; req.on('socket', (s) => { socket = s; }); req.on('error', reject); });
    const first = await get();
    let closedByServer = false; first.on('close', () => { closedByServer = true; });
    await wait(7000);
    assert.equal(closedByServer, false, 'the bridge closed an idle connection the tunnel would still reuse');
    await get();
    agent.destroy();
  } finally { b.stop(); }
});

test('a picture attached by hand on a phone is sent to the bot', { timeout: 90000 }, async () => {
  const b = startBridge(), base = `http://localhost:${b.port}`;
  await ready(b.port);
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Picture test' }) }); return (await r.json()).bot.id; });
    await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
    await p.waitForSelector('.bot-files', { state: 'attached', timeout: 15000 });

    // Coming back from the chooser with a new app version waiting must not reload the page.
    await p.evaluate(() => { window.__notReloaded = true; });
    const chooser = p.waitForEvent('filechooser');
    await p.click('.bot-attach');
    await chooser;
    await p.route('**/api/app-version', (route) => route.fulfill({ json: { v: 'newer-' + Date.now() } }));
    await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await wait(1500);
    assert.equal(await p.evaluate(() => window.__notReloaded), true, 'the page reloaded while the picture chooser was open');

    // A big camera photo, handed over with no type (some phone galleries do this).
    const original = await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 2200;
      const g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) >>> 24;
      g.putImageData(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.98));
      const input = document.querySelector('.bot-files'), dt = new DataTransfer();
      dt.items.add(new File([blob], 'IMG_2026.jpg', { type: '' }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      return blob.size;
    });
    assert.ok(original > 1024 * 1024, 'test photo should be large');
    await p.waitForSelector('.bot-pic', { timeout: 5000 });
    const send = p.locator('.composer button.send').first();
    assert.equal(await send.isDisabled(), false);
    await send.tap();
    await p.waitForFunction(() => !document.querySelector('.bot-pic'), null, { timeout: 20000, polling: 200 });
    await wait(500);

    const saved = fs.readdirSync(b.uploads);
    assert.equal(saved.length, 1);
    assert.ok(fs.statSync(path.join(b.uploads, saved[0])).size < original / 2, 'the photo was not shrunk before sending');
    const chat = fs.readFileSync(path.join(b.configDir, 'bots', id, 'chat.jsonl'), 'utf8');
    assert.match(chat, /"role":"operator"[^\n]*"images":1/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); b.stop(); }
});
