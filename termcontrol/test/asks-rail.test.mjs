// Noam 2026-10-20: a side panel like the Desk app's, listing what he asked this agent and where each stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('the requests side panel shows each request with its status on wide windows only', { timeout: 90000 }, async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rail-'));
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
  const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rail test' }) }); return (await r.json()).bot.id; });
  const asks = [
    { n: 1, text: 'Fix the login page', status: 'done', note: '' },
    { n: 2, text: 'Add a dark theme', status: 'partial', note: 'phone not checked' },
    { n: 3, text: 'Make exports faster', status: 'open', note: '' },
    { n: 4, text: 'Widen the approval to local edits', status: 'open', note: '' },
  ];
  await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.asks = asks; await route.fulfill({ response: r, json: j }); });
  await p.goto(base + '/#bot:' + id);
  await p.waitForFunction(() => document.querySelector('.asks-rail li'), null, { timeout: 15000, polling: 250 });
  const wide = await p.evaluate(() => {
    const rail = document.querySelector('.asks-rail'), box = rail.getBoundingClientRect();
    return { visible: box.width > 200 && getComputedStyle(rail).display !== 'none', rows: [...rail.querySelectorAll('li')].map((li) => li.querySelector('.rail-st').textContent + '|' + li.querySelector('.rail-what').textContent), chipHidden: getComputedStyle(document.querySelector('.asks-chip')).display === 'none' };
  });
  assert.equal(wide.visible, true);
  assert.equal(wide.chipHidden, true);
  assert.deepEqual(wide.rows, ['In work|Widen the approval to local edits', 'Waiting|Make exports faster', 'Partly done|Add a dark theme', '✓ Done|Fix the login page']);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-wide.png' });
  await p.setViewportSize({ width: 390, height: 844 });
  await wait(300);
  const narrow = await p.evaluate(() => ({ railHidden: getComputedStyle(document.querySelector('.asks-rail')).display === 'none', chipShown: getComputedStyle(document.querySelector('.asks-chip')).display !== 'none', noSideScroll: document.documentElement.scrollWidth <= innerWidth }));
  assert.deepEqual(narrow, { railHidden: true, chipShown: true, noSideScroll: true });
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-phone.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
