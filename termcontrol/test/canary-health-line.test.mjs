import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Plan step 7: the Health tab shows one plain line from the self-test the server saved.
test('the Health tab shows the self-test result from the real server', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-canary-ui-'));
  fs.writeFileSync(path.join(dir, 'canary.json'), JSON.stringify({ ok: true, at: Date.now(), checkedAt: Date.now(), ms: 554 }));
  const port = 8600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: dir, TC_NO_AGENT_HEALTH: '1', TC_NO_TERMINAL_HEALTH: '1', TC_NO_WATCHDOG: '1', TC_BOTS_HOME: path.join(dir, 'home') }, stdio: 'ignore',
  });
  let browser;
  try {
    for (let n = 0; n < 100; n++) { try { await fetch(base + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await page.addInitScript(() => { localStorage.setItem('termcontrol-fleet-tab', 'health'); localStorage.setItem('termcontrol-language', 'en'); });
    await page.goto(base);
    await page.waitForSelector('#password');
    await page.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForSelector('[data-key="canary"]', { timeout: 15000 });
    assert.match(await page.locator('[data-key="canary"]').innerText(), /Self-test passed/);
    if (process.env.TC_SHOT_DIR) await page.screenshot({ path: path.join(process.env.TC_SHOT_DIR, 'canary-health-line.png') });
    fs.writeFileSync(path.join(dir, 'canary.json'), JSON.stringify({ ok: false, at: Date.now(), checkedAt: Date.now(), error: 'Typing into a test terminal failed.' }));
    await page.reload();
    await page.waitForSelector('[data-key="canary"]', { timeout: 15000 });
    assert.match(await page.locator('[data-key="canary"]').innerText(), /Self-test failed: Typing into a test terminal failed\./);
  } finally { await browser?.close(); child.kill(); }
});
