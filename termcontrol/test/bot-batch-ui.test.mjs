import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

for (const width of [390, 1280]) test(`${width}px batch selection respects group/search, freezes arrivals, cancels and reports partial results`, { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-batch-ui-'));
  const config = path.join(tmp, 'config'), home = path.join(tmp, 'home');
  fs.mkdirSync(config); fs.mkdirSync(home);
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: config, TC_BOTS_HOME: home, TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForSelector('.bots-home');
    const post = (url, body) => page.evaluate(async ({ url, body }) => (await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()), { url, body });
    const a = (await post('/api/bots', { name: 'Alpha one' })).bot;
    const b = (await post('/api/bots', { name: 'Alpha two' })).bot;
    const c = (await post('/api/bots', { name: 'Outside' })).bot;
    await post('/api/bot-groups', { name: 'Pair', members: [a.id, b.id] });
    await page.reload(); await page.locator('[data-bot-select]').click({ timeout: 5000 });
    await page.locator('[data-bot-scope]').selectOption({ label: 'Pair' });
    await page.locator('[data-bot-select-all]').click();
    assert.match(await page.locator('[data-bot-selected-count]').innerText(), /2/);
    assert.equal(await page.locator(`[data-bot="${c.id}"]`).isVisible(), false);
    await page.locator('[data-bot-batch="remove"]').click();
    await page.waitForSelector('.bot-batch-sheet [data-confirm]');
    assert.match(await page.locator('.bot-batch-sheet').innerText(), /Alpha one/);
    assert.match(await page.locator('.bot-batch-sheet').innerText(), /Alpha two/);
    assert.match(await page.locator('.bot-batch-sheet').innerText(), /archiv/i);
    await page.screenshot({path:`/tmp/termfleet-batch-fixture-confirm-${width}.png`,fullPage:true});
    await page.locator('.bot-batch-sheet [data-cancel]').click();
    assert.equal((await page.evaluate(async () => (await (await fetch('/api/bots')).json()).bots)).length, 3);
    const newcomer = (await post('/api/bots', { name: 'New arrival' })).bot;
    await page.locator('button[data-tab="bots"]').click();
    assert.match(await page.locator('[data-bot-selected-count]').innerText(), /2/);
    await page.locator('[data-bot-batch="remove"]').click();
    await page.waitForSelector('.bot-batch-sheet [data-confirm]');
    // Change one selected identity after confirmation; the other still succeeds.
    await post('/api/bot/update', { id: b.id, name: 'Changed after preview' });
    await page.locator('.bot-batch-sheet [data-confirm]').click();
    await page.waitForFunction(() => document.querySelector('.bot-batch-sheet')?.dataset.finished === '1');
    const result = await page.locator('.bot-batch-sheet').innerText();
    assert.match(result, /Alpha one.*Removed/s);
    assert.match(result, /Alpha two.*changed/s);
    const list = await page.evaluate(async () => (await (await fetch('/api/bots')).json()).bots);
    assert.deepEqual(new Set(list.map(x => x.id)), new Set([b.id, c.id, newcomer.id]));
    await page.locator('.bot-batch-sheet [data-cancel]').click();
    await page.locator('[data-bot-scope]').selectOption('all');
    await page.locator('[data-bot-selection-clear]').click();
    await page.locator('.fleet-search-open').click();
    await page.locator('.fleet-search').fill('Outside');
    await page.locator('[data-bot-select-all]').click();
    assert.match(await page.locator('[data-bot-selected-count]').innerText(), /1/);
    await page.locator('[data-bot-batch="close"]').click();
    await page.locator('.bot-batch-sheet [data-confirm]').click();
    await page.waitForFunction(() => document.querySelector('.bot-batch-sheet')?.dataset.finished === '1');
    assert.match(await page.locator('.bot-batch-sheet').innerText(), /Closed/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    // Shared static HTML must not offer unsupported mutations on an older bridge.
    await page.route('**/api/bots',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch(),body=await response.json();delete body.botBatch;await route.fulfill({response,json:body});});
    await page.reload();await page.waitForSelector('.bots-home');
    assert.equal(await page.locator('[data-bot-select]').count(),0);
    assert.ok(await page.locator('.bots-list .bot-row[data-bot]').count());
  } finally { await browser?.close(); if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;} fs.rmSync(tmp, { recursive: true, force: true }); }
});
