// Noam 2026-10-26: the requests list is a small strip top-right; the chat stays where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('legacy requests and live helper updates cannot restore the removed bot panel', { timeout: 90000 }, async () => {
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
  let asks = [
    { n: 1, text: '[Noam attached 1 picture. Look at it (open the file to see it): /home/endlessblink/Pictures/x.png] Fix the login page. Then more words that are long.', status: 'done', note: '' },
    { n: 2, text: 'Add a dark theme', status: 'partial', note: 'phone not checked | tail -1' },
    { n: 3, text: 'Make exports faster', status: 'open', note: '' },
    { n: 4, text: 'Widen the approval to local edits', status: 'open', note: '' },
    { n: 5, text: '(1) [Event, not from Noam] wake-up: the agent finished', status: 'open', note: '' },
    { n: 6, text: 'Morning check: read the terminal and report', status: 'done', note: 'Sent to agent: report' },
  ];
  let live = null;
  await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.asks = asks; if (live) { j.bot.state = 'working'; j.bot.helpers = [{ paneId: 'x', state: 'working', title: 'termfleet', live }]; } await route.fulfill({ response: r, json: j }); });
  // the bot's own schedule: its message is not one of his requests
  await p.route('**/api/routines?*', (route) => route.fulfill({ json: { routines: [{ id: 'r1', text: 'Morning check: read the terminal and report', time: '09:00', label: 'Weekdays', days: [1, 2, 3, 4, 5] }] } }));
  await p.goto(base + '/#bot:' + id);
  await p.waitForSelector('.bot-composer');
  for (const width of [1600, 390]) {
    await p.setViewportSize({ width, height: 900 });
    live = 'checking the latest change';
    await p.reload();
    await p.waitForSelector('.bot-composer');
    await p.waitForFunction(() => document.querySelector('#routines-line')?.dataset.asks !== undefined);
    assert.equal(await p.locator('#side-asks:not([hidden]), .asks-chip, .bot-asks-chip').count(), 0);
    assert.ok(await p.locator('.bot-composer').isVisible());
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await p.unrouteAll({ behavior: 'wait' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
