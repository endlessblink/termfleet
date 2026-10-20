// Noam 2026-10-20: the mark around the open chat in the bots list kept disappearing while he was inside that chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('the open bot keeps its outline in the list while live updates redraw it', { timeout: 90000 }, async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-outline-'));
const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
const browser = await chromium.launch();
try {
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/');
  await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
  const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Outline test' }) }); return (await r.json()).bot.id; });
  await p.goto(base + '/');
  await p.waitForFunction((bid) => document.querySelector(`.bot-row[data-bot="${bid}"]`), id, { timeout: 15000, polling: 250 });
  await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
  await p.waitForFunction((bid) => document.querySelector(`.bot-row.open-chat[data-bot="${bid}"]`), id, { timeout: 15000, polling: 250 });
  // Live updates redraw the list; the outline must come back every time, and only on the open chat.
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); const list = document.querySelector('.bots-list'); if (list) list.innerHTML = list.innerHTML; });
    await wait(700);
    const state = await p.evaluate((bid) => ({ marked: document.querySelectorAll('.bot-row.open-chat').length, right: Boolean(document.querySelector(`.bot-row.open-chat[data-bot="${bid}"]`)) }), id);
    assert.deepEqual(state, { marked: 1, right: true });
  }
  // Opening a second chat moves the outline: never two at once.
  const other = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Second' }) }); return (await r.json()).bot.id; });
  await p.goto(base + '/');
  await p.waitForFunction((bid) => document.querySelector(`.bot-row[data-bot="${bid}"]`), other, { timeout: 15000, polling: 250 });
  await p.click(`.bot-row[data-bot="${id}"]`);
  await p.waitForFunction((bid) => document.querySelector(`.bot-row.open-chat[data-bot="${bid}"]`), id, { timeout: 8000, polling: 200 });
  await p.click(`.bot-row[data-bot="${other}"]`);
  await p.waitForFunction((bid) => document.querySelector(`.bot-row.open-chat[data-bot="${bid}"]`), other, { timeout: 8000, polling: 200 });
  assert.equal(await p.evaluate(() => document.querySelectorAll('.bot-row.open-chat').length), 1);
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
