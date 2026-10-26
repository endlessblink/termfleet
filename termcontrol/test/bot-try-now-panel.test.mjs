import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { captureMessage, record } from '../bridge/requirements.mjs';

test('testing panel implementation is removed from the UI', () => {
  const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /tryNowHtml|class="try-now|\.try-now[{: ]/);
});
test('authenticated desktop and phone chat omit the removed testing panel despite 107 ready items', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-try-now-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(botsHome);
  const port = 8000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForSelector('.bots-home');
    const id = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ready testing regression' }) })).json()).bot.id);
    const dir = path.join(configDir, 'requirements');
    const items = [0, 50, 100].flatMap(offset => captureMessage({ text: Array.from({ length: Math.min(50, 107 - offset) }, (_, i) => `${i + 1}. Keep ready request ${offset + i + 1} testable`).join('\n'), project: 'termfleet', source: `bot:${id}`, msgId: `removed-panel-fixture-${offset}` }, { dir }));
    record(items.map((it, i) => ({ e: 'status', id: it.id, status: 'ready', evidence: i === 0 ? '' : `Try: Choose two fighters and start match ${i + 1} ${base}/login` })), { dir });
    await page.goto(base + '/#bot:' + id);
    await page.waitForSelector('.bot-feed');
    const api = await page.evaluate(async id => (await (await fetch('/api/bot?id=' + id)).json()).tryNow, id);
    assert.equal(api.length, 107, 'ready records stay intact');
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator('.try-now, .try-now-item').count(), 0, 'panel must be absent, not hidden');
      assert.doesNotMatch(await page.locator('body').innerText(), /Testing instructions missing|Testing link missing|חסרות הוראות לבדיקה|חסר קישור לבדיקה/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `chat must fit ${width}`);
      if (process.env.TC_TRY_SHOT_DIR) {
        fs.mkdirSync(process.env.TC_TRY_SHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.TC_TRY_SHOT_DIR, `panel-removed-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    console.log('Authenticated desktop/phone: removed panel and warnings absent; 107 ready ledger records retained.');
  } finally { await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
