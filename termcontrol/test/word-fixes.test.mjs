import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { applyWordFixes, wordFixHint } from '../bridge/word-fixes.mjs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

test('fixes replace whole words and phrases only, keep Hebrew prefixes, longest first', () => {
  const fixes = [
    { heard: 'קלוד', correct: 'Claude' },
    { heard: 'קלוד קוד', correct: 'Claude Code' },
    { heard: 'term fleet', correct: 'TermFleet' },
    { heard: 'רק', correct: 'XX' },
    { heard: 'codecs', correct: 'Codex' },
  ];
  const fix = (t) => applyWordFixes(t, fixes).text;
  assert.equal(fix('תפתח את קלוד קוד עכשיו'), 'תפתח את Claude Code עכשיו', 'the longer phrase wins');
  assert.equal(fix('שאלתי את קלוד וקלוד ענה'), 'שאלתי את Claude וClaude ענה', 'a Hebrew prefix stays in front');
  assert.equal(fix('open Term  Fleet and codecs.'), 'open TermFleet and Codex.', 'case and spacing do not matter');
  assert.equal(fix('ברק ורעם'), 'ברק ורעם', 'a short fix never eats the middle of another word');
  assert.equal(fix('רק עכשיו'), 'XX עכשיו');
  assert.equal(fix('mycodecs codecsy'), 'mycodecs codecsy', 'inside a longer word is left alone');
  assert.equal(applyWordFixes('קלוד קלוד', fixes).changed, 2);
  assert.equal(wordFixHint(fixes), 'Claude, Claude Code, TermFleet, XX, Codex');
});

const STUB = `
import json, sys
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    r = json.loads(line)
    out = {"id": r["id"], "text": "פתחתי את קלוד קוד ב term fleet", "language": "he", "seconds": 0.01, "hint": r.get("hotwords")}
    if r.get("op") == "prepare": out = {"id": r["id"], "prepared": True}
    out["text"] = out.get("text", "") + (" | hint: " + r["hotwords"] if r.get("hotwords") else "")
    print(json.dumps(out, ensure_ascii=False), flush=True)
`;

test('the bridge keeps the list, fixes every dictation, and hands the right words to the model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-wordfix-'));
  const stub = path.join(dir, 'stub.py');
  fs.writeFileSync(stub, STUB);
  const port = 7900 + Math.floor(Math.random() * 90);
  process.env.TC_CONFIG_DIR = dir;
  const accounts = await import('../bridge/accounts.mjs');
  if (!accounts.hasAccount()) accounts.createAccount('owner@example.com', 'a-long-enough-password');
  const child = spawn('node', [path.resolve('termcontrol/bridge/server.mjs')], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: dir, TC_STT_WORKER: stub, TC_WHISPER_PY: '/usr/bin/python3', TC_DESK_STT: '0' }, stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 60; i++) {
      if (await new Promise((r) => net.connect(port, '127.0.0.1').on('connect', function () { this.destroy(); r(true); }).on('error', () => r(false)))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const login = await fetch(`http://127.0.0.1:${port}/embed`, { headers: { 'sec-fetch-dest': 'iframe' }, redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const api = (method, body, c = cookie) => fetch(`http://127.0.0.1:${port}/api/word-fixes`, { method, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: body && JSON.stringify(body) });
    assert.equal((await api('GET', undefined, null)).status, 401, 'needs sign-in');
    assert.deepEqual((await (await api('GET')).json()).fixes, []);
    assert.equal((await api('POST', { heard: 'קלוד קוד', correct: '' })).status, 400);
    await api('POST', { heard: 'קלוד קוד', correct: 'Claude Code' });
    const added = await (await api('POST', { heard: 'term fleet', correct: 'TermFleet' })).json();
    assert.equal(added.fixes.length, 2);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'word-fixes.json'), 'utf8'));
    assert.equal(saved.fixes.length, 2, 'kept on the PC, so the phone sees the same list');

    const said = await (await fetch(`http://127.0.0.1:${port}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', cookie }, body: Buffer.alloc(2048, 1) })).json();
    assert.equal(said.text, 'פתחתי את Claude Code ב TermFleet | hint: TermFleet, Claude Code');
    assert.equal(said.fixed, 2);

    const removed = await (await api('DELETE', { heard: 'TERM FLEET' })).json();
    assert.deepEqual(removed.fixes, [{ heard: 'קלוד קוד', correct: 'Claude Code' }]);
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('after dictating, select the wrong word, write the right one, and it is fixed now and from then on', async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const page = await (await browser.newContext({ viewport })).newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
        window.MediaRecorder = class { constructor() { this.mimeType = 'audio/webm'; } start() {} stop() { this.ondataavailable({ data: new Blob([new Uint8Array(64)]) }); this.onstop(); } };
      });
      const pane = { id: 'p1', project: 'demo', provider: 'claude', cwd: '/x', task: 'Demo', turn: 'idle', updatedAt: Date.now() };
      let fixes = [{ heard: 'codecs', correct: 'Codex' }], posted = null;
      await page.route('https://termcontrol.design/**', async (route) => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/api/panes') return route.fulfill({ json: { panes: [pane], groups: [{ project: 'demo', panes: [pane] }], daemon: true, view: 'projects' } });
        if (url.pathname === '/api/feed') return route.fulfill({ json: { pane, events: [{ kind: 'assistant', text: 'hello', at: new Date().toISOString() }], reachedStart: true } });
        if (url.pathname === '/api/transcribe') return route.fulfill({ json: { text: 'תבקש מקלוד לבדוק', language: 'he', fixed: 0 } });
        if (url.pathname === '/api/word-fixes') {
          if (req.method() === 'POST') { posted = JSON.parse(req.postData()); fixes = [posted, ...fixes]; }
          return route.fulfill({ json: { fixes } });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto('https://termcontrol.design/');
      await page.locator('.pane').first().click();
      await page.waitForSelector('.composer .mic', { state: 'attached' });
      await page.evaluate(() => { document.querySelector('.composer-menu').open = true; });
      await page.locator('.composer .mic').click();
      await page.waitForSelector('.composer .mic.rec');
      await page.locator('.composer .mic').click({ force: true });
      await page.waitForSelector('.sendstate [data-fix]');
      // Select the misheard word inside the box, the way he would with a finger or mouse.
      await page.evaluate(() => { const b = document.querySelector('.composer textarea'); const at = b.value.indexOf('מקלוד') + 1; b.setSelectionRange(at, at + 4); });
      await page.locator('.sendstate [data-fix]').click();
      await page.waitForSelector('.word-fix-sheet');
      assert.equal(await page.locator('#wf-heard').inputValue(), 'קלוד', 'the selected word is filled in');
      await page.locator('#wf-correct').fill('Claude');
      await page.waitForSelector('.word-fix-sheet .wf-list li');
      await page.screenshot({ path: path.join(os.tmpdir(), `tc-wordfix-${viewport.width}.png`) });
      await page.locator('.word-fix-sheet [data-save]').click();
      await page.waitForFunction(() => document.querySelector('.word-fix-sheet .wf-list').children.length === 2);
      assert.deepEqual(posted, { heard: 'קלוד', correct: 'Claude' });
      assert.equal(await page.locator('.composer textarea').inputValue(), 'תבקש מClaude לבדוק', 'fixed in the message too');
      const box = await page.locator('.word-fix-sheet .sheet').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'the sheet fits the screen');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.word-fix-sheet').count(), 0);
      // Also reachable any time from the composer menu.
      await page.evaluate(() => { document.querySelector('.composer-menu').open = true; });
      await page.locator('.composer .word-fixes').click();
      await page.waitForSelector('.word-fix-sheet');
      await page.close();
    }
  } finally { await browser.close(); }
});
