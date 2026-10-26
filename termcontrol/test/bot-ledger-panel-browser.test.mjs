import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, record } from '../bridge/requirements.mjs';

test('authenticated bot panel renders every ledger item, with ready entries and no transcript dependency', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ledger-panel-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(botsHome);
  const port = 7900 + Math.floor(Math.random() * 100), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
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
    const items = captureMessage({ text: Array.from({ length: 80 }, (_, i) => `${i + 1}. Keep owner request ${i + 1} visible`).join('\n'), project: 'termfleet', source: `bot:${id}`, msgId: 'panel-fixture' }, { dir });
    assert.equal(items.length, 80);
    record(items.map((it, i) => ({ e: 'status', id: it.id, status: ['new', 'assigned', 'partial', 'ready'][i % 4], open: ['fixture still open'] })), { dir });
    await p.goto(base + '/#bot:' + id);
    await p.waitForFunction(() => document.querySelectorAll('#side-asks li:not(.rail-more)').length === 80);
    const api = await p.evaluate(async id => (await (await fetch('/api/bot?id=' + id)).json()).asks, id);
    assert.equal(api.length, 80);
    assert.equal(api.filter(it => it.status === 'ready').length, 20);
    const shown = await p.locator('#side-asks').innerText();
    assert.match(shown, /R-1 Keep owner request 1 visible/);
    assert.match(shown, /R-80 Keep owner request 80 visible/);
    assert.doesNotMatch(shown, /Your open requests|Answered/);
    assert.equal(await p.locator('#side-asks .rail-x').count(), 0, 'item ids must never call transcript-number dismiss');
    const desktop = await p.evaluate(() => {
      const rail = document.querySelector('#side-asks').getBoundingClientRect(), header = document.querySelector('body > header').getBoundingClientRect(), composer = document.querySelector('.bot-composer').getBoundingClientRect();
      return { top: rail.top, right: rail.right, left: rail.left, bottom: rail.bottom, headerBottom: header.bottom, composerRight: composer.right, width: innerWidth };
    });
    assert.ok(Math.abs(desktop.top - desktop.headerBottom - 16) <= 2, 'requests must start at the top below the header: ' + JSON.stringify(desktop));
    assert.ok(desktop.left >= desktop.composerRight + 8 && desktop.right <= desktop.width, 'requests must stay in the free space right of the chat');
    const list = p.locator('#side-asks ul');
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await list.evaluate(el => el.scrollTop > 0), 'all entries remain accessible by scrolling');
    if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT, fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(300);
    const phone = await p.evaluate(() => {
      const rail = document.querySelector('#side-asks'), chip = document.querySelector('.bot-asks-chip'), composer = document.querySelector('.bot-composer').getBoundingClientRect(), r = chip.getBoundingClientRect();
      return { railHidden: getComputedStyle(rail).display === 'none', chipVisible: !chip.hidden && r.width > 0, clear: r.bottom <= composer.top && r.left >= 0 && r.right <= innerWidth, noOverflow: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(phone, { railHidden: true, chipVisible: true, clear: true, noOverflow: true });
    if (process.env.TC_SHOT_PHONE) await p.screenshot({ path: process.env.TC_SHOT_PHONE, fullPage: true });
    assert.deepEqual(errors, []);
    console.log('API and rendered panel: 80 unique owner items; 20 ready; oldest and newest present; scroll reaches end; desktop top-right; phone controls remain clear.');
  } finally { await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
