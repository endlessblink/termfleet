import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

// A stand-in for the real worker: same line protocol, instant answers.
const STUB = `
import json, sys
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    r = json.loads(line)
    size = len(open(r["path"], "rb").read())
    if size < 8:
        out = {"error": "No sound was found in that recording."}
    else:
        out = {"text": "שלום, please add a new agent", "language": r.get("language") or "he", "seconds": 0.01}
    out["id"] = r["id"]
    print(json.dumps(out, ensure_ascii=False), flush=True)
`;

async function startBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-voice-'));
  const stub = path.join(dir, 'stub.py');
  fs.writeFileSync(stub, STUB);
  const port = 7800 + Math.floor(Math.random() * 90);
  // Make an owner account so the iframe sign-in route can issue a session.
  process.env.TC_CONFIG_DIR = dir;
  const accounts = await import('../bridge/accounts.mjs');
  if (!accounts.hasAccount()) accounts.createAccount('owner@example.com', 'a-long-enough-password');
  const child = spawn('node', [path.resolve('termcontrol/bridge/server.mjs')], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: dir, TC_STT_WORKER: stub, TC_WHISPER_PY: '/usr/bin/python3' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    if (await new Promise((r) => net.connect(port, '127.0.0.1').on('connect', function () { this.destroy(); r(true); }).on('error', () => r(false)))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(`http://127.0.0.1:${port}/embed`, { headers: { 'sec-fetch-dest': 'iframe' }, redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return { port, cookie, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('a recorded clip becomes text, Hebrew or English, and bad input is refused', async () => {
  const bridge = await startBridge();
  try {
    const post = (body, query = '', cookie = bridge.cookie) => fetch(`http://127.0.0.1:${bridge.port}/api/transcribe${query}`, {
      method: 'POST', headers: { 'content-type': 'audio/webm', ...(cookie ? { cookie } : {}) }, body,
    });
    const ok = await post(Buffer.alloc(2048, 1));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.match(body.text, /שלום/);
    assert.equal(body.language, 'he');
    assert.equal((await (await post(Buffer.alloc(2048, 1), '?lang=en')).json()).language, 'en', 'a chosen language is honoured');
    assert.equal((await post(Buffer.alloc(2048, 1), '', null)).status, 401, 'needs sign-in');
    const silent = await post(Buffer.alloc(2, 0));
    assert.equal(silent.status, 502);
    assert.match((await silent.json()).error, /No sound/);
    const huge = await post(Buffer.alloc(26 * 1024 * 1024, 1)).catch(() => ({ status: 413 }));
    assert.equal(huge.status, 413, 'recordings are capped');
  } finally { bridge.stop(); }
});

test('the microphone button records, sends the clip, and puts the words in the message box', async () => {
  assert.match(html, /class="mic"/);
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    let sentType = null;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
      window.MediaRecorder = class {
        constructor() { this.mimeType = 'audio/webm'; }
        start() {}
        stop() { this.ondataavailable({ data: new Blob([new Uint8Array(64)]) }); this.onstop(); }
      };
    });
    const pane = { id: 'p1', project: 'demo', provider: 'claude', cwd: '/x', task: 'Demo', turn: 'idle', updatedAt: Date.now() };
    await page.route('https://termcontrol.design/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/api/panes') return route.fulfill({ json: { panes: [pane], groups: [{ project: 'demo', panes: [pane] }], daemon: true, view: 'projects' } });
      if (url.pathname === '/api/feed') return route.fulfill({ json: { pane, events: [{ kind: 'assistant', text: 'hello', at: new Date().toISOString() }], reachedStart: true } });
      if (url.pathname === '/api/transcribe') { sentType = route.request().headers()['content-type']; return route.fulfill({ json: { text: 'שלום, add an agent', language: 'he' } }); }
      return route.fulfill({ json: {} });
    });
    await page.goto('https://termcontrol.design/');
    await page.locator('.pane').first().click();
    await page.waitForSelector('.composer .mic',{state:'attached'});await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;});
    await page.locator('.composer .mic').click();           // start
    await page.waitForSelector('.composer .mic.rec', { timeout: 5000 });  // shows that it is listening
    await page.locator('.composer .mic').click({ force: true });  // stop -> send (it is pulsing, so not "stable")
    await page.waitForFunction(() => document.querySelector('.composer textarea').value.includes('add an agent'));
    assert.equal(sentType, 'audio/webm');
    assert.equal(await page.locator('.composer textarea').inputValue(), 'שלום, add an agent', 'words are in the box, not sent yet');
    assert.equal(await page.locator('.composer .mic.busy').count(), 0);
  } finally { await browser.close(); }
});
