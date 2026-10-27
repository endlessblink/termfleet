import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, record } from '../bridge/requirements.mjs';

test('bot chat omits Requests everywhere while preserving 107 ledger items', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ledger-panel-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(botsHome);
  const port = 7900 + Math.floor(Math.random() * 100), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    browser = await chromium.launch();
    const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(base);
    await p.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForSelector('.bots-home');
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ledger panel regression' }) })).json()).bot.id);
    const dir = path.join(configDir, 'requirements');
    const items = [80, 27].flatMap((count, batch) => captureMessage({ text: Array.from({ length: count }, (_, i) => `${i + 1}. Keep owner request ${batch * 80 + i + 1} visible`).join('\n'), project: 'termfleet', source: `bot:${id}`, msgId: `panel-fixture-${batch}` }, { dir }));
    assert.equal(items.length, 107);
    record(items.map((it, i) => ({ e: 'status', id: it.id, status: ['new', 'assigned', 'partial', 'ready'][i % 4], open: ['fixture still open'] })), { dir });
    // A "ready" entry counts as ready only when it tells Noam what to try (#16).
    record(items.filter((it, i) => i % 4 === 3).map((it) => ({ e: 'testing-handoff', id: it.id, link: 'https://example.test/try', tryText: 'open the page and tap Send' })), { dir });
    await p.goto(base + '/#bot:' + id);
    await p.waitForSelector('.bot-composer');
    const api = await p.evaluate(async id => (await (await fetch('/api/bot?id=' + id)).json()).asks, id);
    assert.equal(api.length, 107, 'removing UI must preserve request records');
    assert.equal(api.filter(it => it.status === 'ready').length, 26);
    for (const width of [1600, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.reload();
      await p.waitForSelector('.bot-composer');
      await p.waitForFunction(() => document.querySelector('#routines-line')?.dataset.asks !== undefined);
      assert.equal(await p.locator('#side-asks:not([hidden]), .bot-asks-chip, .bot-progress, .ask-verdict, #routines-line .asks-chip').count(), 0, 'no Requests panel, counter or verdict controls');
      await p.click('.bot-menu-button');
      await p.waitForSelector('.bot-menu-sheet[open]');
      assert.equal(await p.locator('.bot-menu-sheet [data-act=asks], .bot-menu-sheet .asks-summary').count(), 0);
      assert.ok(await p.locator('.bot-menu-sheet [data-act=activity]').isVisible(), 'other menu options remain available');
      await p.keyboard.press('Escape');
      assert.ok(await p.locator('.bot-composer').isVisible());
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.TC_SHOT_DIR) await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, `requests-removed-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Desktop and phone: Requests absent after reload; menu and composer work; 107 ledger records preserved.');
  } finally { await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
