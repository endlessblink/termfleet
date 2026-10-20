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
  let asks = [
    { n: 1, text: '[Noam attached 1 picture. Look at it (open the file to see it): /home/endlessblink/Pictures/x.png] Fix the login page. Then more words that are long.', status: 'done', note: '' },
    { n: 2, text: 'Add a dark theme', status: 'partial', note: 'phone not checked | tail -1' },
    { n: 3, text: 'Make exports faster', status: 'open', note: '' },
    { n: 4, text: 'Widen the approval to local edits', status: 'open', note: '' },
  ];
  let live = null;
  await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.asks = asks; if (live) { j.bot.state = 'working'; j.bot.helpers = [{ paneId: 'x', state: 'working', title: 'termfleet', live }]; } await route.fulfill({ response: r, json: j }); });
  await p.goto(base + '/#bot:' + id);
  await p.waitForFunction(() => document.querySelector('.asks-rail li'), null, { timeout: 15000, polling: 250 });
  const wide = await p.evaluate(() => {
    const rail = document.querySelector('.asks-rail'), box = rail.getBoundingClientRect();
    return { visible: box.width > 200 && getComputedStyle(rail).display !== 'none', rows: [...rail.querySelectorAll('li')].map((li) => li.querySelector('.rail-sub').textContent.split(' \u00b7 ')[0] + '|' + li.querySelector('.rail-what').textContent), chipHidden: getComputedStyle(document.querySelector('.asks-chip')).display === 'none' };
  });
  assert.equal(wide.visible, true);
  assert.equal(await p.evaluate(() => document.querySelector('.rail-toggle span').textContent), '3 open \u00b7 1 done');
  assert.equal(await p.evaluate(() => document.querySelector('.asks-rail').textContent.includes('/home/') || document.querySelector('.asks-rail').textContent.includes('tail -1') || document.querySelector('.asks-rail').textContent.includes('[Noam')), false);
  assert.equal(wide.chipHidden, true);
  assert.deepEqual(wide.rows, ['✓ Done|Fix the login page', 'phone not checked|Add a dark theme', 'Waiting|Make exports faster', 'Waiting|Widen the approval to local edits']);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-wide.png' });
  assert.ok((await p.evaluate(() => document.querySelector('.asks-rail').getBoundingClientRect().width)) <= 240);
  // The panel sits at the bottom of the right side, just above the message box, and grows upward.
  const place = await p.evaluate(() => { const r = document.querySelector('.asks-rail').getBoundingClientRect(), c = document.querySelector('.bot-composer').getBoundingClientRect(); return { railBottom: Math.round(r.bottom), composerTop: Math.round(c.top), railTop: Math.round(r.top), viewport: innerHeight }; });
  assert.ok(place.railBottom >= place.composerTop && place.railBottom <= place.viewport, JSON.stringify(place)); // beside the message box, bottom-aligned with it
  assert.ok(place.railTop > 100, JSON.stringify(place));
  const beside = await p.evaluate(() => { const r = document.querySelector('.asks-rail').getBoundingClientRect(), c = document.querySelector('.bot-composer').getBoundingClientRect(); return { gap: Math.round(r.left - c.right), inside: r.right <= innerWidth }; });
  assert.ok(beside.gap >= 0 && beside.gap <= 40 && beside.inside, JSON.stringify(beside));
  // Live: a request moving to done shows up by itself, without a reload (the page redraws every few seconds).
  await p.evaluate(() => { window.__same = 1; });
  asks = asks.map((a) => (a.n === 3 ? { ...a, status: 'done' } : a));
  await p.waitForFunction(() => [...document.querySelectorAll('.asks-rail li')].some((li) => li.textContent.includes('✓ Done') && li.textContent.includes('Make exports faster')), null, { timeout: 12000, polling: 500 });
  assert.equal(await p.evaluate(() => window.__same), 1);
  // The core of the panel: the row being worked on shows, as its main line, what the terminal agent it was handed to is doing now, and that line follows the agent on its own.
  live = 'bringing the panel back';
  await p.waitForFunction(() => document.querySelector('.asks-rail li:last-child .rail-what')?.textContent.includes('termfleet: bringing the panel back'), null, { timeout: 12000, polling: 500 });
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-live1.png' });
  live = 'checking the screenshots';
  await p.waitForFunction(() => document.querySelector('.asks-rail li:last-child .rail-what')?.textContent.includes('termfleet: checking the screenshots'), null, { timeout: 12000, polling: 500 });
  assert.match(await p.evaluate(() => document.querySelector('.asks-rail li:last-child .rail-sub').textContent), /^In work/);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-live2.png' });
  live = null;
  // Many requests: about four rows show, the newest at the bottom is in view, older ones are above.
  asks = [...asks, { n: 5, text: 'Request five', status: 'done', note: '' }, { n: 6, text: 'Request six', status: 'done', note: '' }, { n: 7, text: 'Request seven', status: 'open', note: '' }];
  await p.waitForFunction(() => document.querySelectorAll('.asks-rail li').length === 7, null, { timeout: 12000, polling: 500 });
  await wait(600);
  const many = await p.evaluate(() => { const ul = document.querySelector('.asks-rail ul'), last = [...ul.querySelectorAll('li')].pop().getBoundingClientRect(), box = ul.getBoundingClientRect(); return { height: Math.round(box.height), atBottom: ul.scrollHeight - ul.scrollTop - ul.clientHeight < 8, newestVisible: last.bottom <= box.bottom + 1 && last.top >= box.top - 1, firstText: ul.querySelector('li').textContent }; });
  assert.ok(many.height <= 310 && many.height >= 150, JSON.stringify(many));
  assert.equal(many.atBottom, true);
  assert.equal(many.newestVisible, true);
  assert.match(many.firstText, /Fix the login page/);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-many.png' });
  // Folding: one click hides the list, the choice survives a reload.
  await p.click('.rail-toggle');
  assert.equal(await p.evaluate(() => document.querySelector('.asks-rail ul').offsetParent === null), true);
  await p.reload();
  await p.waitForFunction(() => document.querySelector('.asks-rail'), null, { timeout: 15000, polling: 250 });
  assert.equal(await p.evaluate(() => document.querySelector('.asks-rail').classList.contains('folded') && document.querySelector('.asks-rail ul').offsetParent === null), true);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-folded.png' });
  await p.click('.rail-toggle');
  assert.equal(await p.evaluate(() => document.querySelector('.asks-rail ul').offsetParent !== null), true);
  await p.setViewportSize({ width: 390, height: 844 });
  await wait(300);
  const narrow = await p.evaluate(() => ({ railHidden: getComputedStyle(document.querySelector('.asks-rail')).display === 'none', chipShown: getComputedStyle(document.querySelector('.asks-chip')).display !== 'none', noSideScroll: document.documentElement.scrollWidth <= innerWidth }));
  assert.deepEqual(narrow, { railHidden: true, chipShown: true, noSideScroll: true });
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-phone.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
