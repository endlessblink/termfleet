// Noam 2026-10-20: the requests list lives in the sidebar under the conversations, like the Desk app; the chat stays where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('the requests list sits in the sidebar under the bots (like the Desk), never touches the chat, and follows the work live', { timeout: 90000 }, async () => {
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
  await p.waitForFunction(() => document.querySelector('#side-asks li'), null, { timeout: 15000, polling: 250 });
  const geo = () => p.evaluate(() => { const rect = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } : null; }; return { asks: rect('#side-asks'), side: rect('#fleet-side'), list: rect('#fleet-side .side-content'), main: rect('main'), composer: rect('.bot-composer'), vw: innerWidth, vh: innerHeight }; });
  const g0 = await geo();
  // In the sidebar, below the bots list, filling to the bottom, in its own scroll; the right-hand panel is gone; the chat uses the whole width.
  assert.ok(g0.asks.r <= g0.side.r && g0.asks.l >= g0.side.l && g0.asks.b <= g0.vh, JSON.stringify(g0));
  assert.ok(g0.asks.t >= g0.list.t, JSON.stringify(g0));
  assert.equal(await p.evaluate(() => document.querySelectorAll('.asks-rail').length), 0);
  assert.ok(Math.abs((g0.main.l + g0.main.r) / 2 - (g0.side.r + g0.vw) / 2) <= 2, 'the chat stays centred in the area right of the sidebar: nothing is reserved on the right ' + JSON.stringify(g0));
  const text = await p.evaluate(() => document.querySelector('#side-asks').innerText);
  assert.match(text, /Your requests · 1 not finished · 2 answered · 1 done/);
  assert.doesNotMatch(text, /\/home\/|tail -1|\[Noam/);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#side-asks li')].map((li) => li.querySelector('.st').textContent + '|' + li.querySelector('.rail-what').textContent));
  assert.deepEqual(await rows(), ['Not finished|Add a dark theme', 'Answered|Widen the approval to local edits', 'Answered|Make exports faster', '✓ Done|Fix the login page']);
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-wide.png' });
  // Noam 2026-10-20: never 'Waiting' on a request the bot already moved past.
  assert.doesNotMatch(text, /Waiting/);
  // Noam 2026-10-20: unfinished on top, finished ones below; only his words (no agent notes, wake-ups or scheduled messages).
  assert.doesNotMatch(text, /phone not checked|wake-up|Morning check/);
  // Live: a request moving to done shows up by itself, without a reload.
  await p.evaluate(() => { window.__same = 1; });
  asks = asks.map((a) => (a.n === 3 ? { ...a, status: 'done' } : a));
  await p.waitForFunction(() => [...document.querySelectorAll('#side-asks li')].some((li) => li.textContent.includes('✓ Done') && li.textContent.includes('Make exports faster')), null, { timeout: 12000, polling: 500 });
  assert.equal(await p.evaluate(() => window.__same), 1);
  // The core: the working request leads, with what the terminal agent it was handed to is doing now, following the agent on its own.
  live = 'bringing the panel back';
  await p.waitForFunction(() => document.querySelector('#side-asks li:first-child .rail-what')?.textContent === 'termfleet: bringing the panel back', null, { timeout: 12000, polling: 500 });
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-live1.png' });
  live = 'checking the screenshots';
  await p.waitForFunction(() => document.querySelector('#side-asks li:first-child .rail-what')?.textContent === 'termfleet: checking the screenshots', null, { timeout: 12000, polling: 500 });
  assert.equal(await p.evaluate(() => document.querySelector('#side-asks li:first-child .st').textContent), 'In work');
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-live2.png' });
  live = null;
  // Many requests: its own scroll, newest/working on top, the list never grows past its share of the sidebar.
  asks = [...asks, ...Array.from({ length: 20 }, (_, k) => k + 5).map((n) => ({ n, text: `Request number ${n}`, status: n === 24 ? 'open' : 'done', note: '' }))];
  await p.waitForFunction(() => document.querySelectorAll('#side-asks li').length === 24, null, { timeout: 12000, polling: 500 });
  await wait(600);
  const order = await rows();
  assert.ok(order.findIndex((r) => r.endsWith('Request number 24')) < order.findIndex((r) => r.startsWith('✓ Done')), 'an unfinished request stays above the done ones ' + JSON.stringify(order));
  const many = await p.evaluate(() => { const ul = document.querySelector('#side-asks ul'), s = document.querySelector('#side-asks').getBoundingClientRect(); return { scrolls: ul.scrollHeight > ul.clientHeight, top: ul.scrollTop, first: ul.querySelector('li').textContent, share: s.height / innerHeight, dbg: [ul.scrollHeight, ul.clientHeight, Math.round(s.height), Math.round(s.top), innerHeight, document.querySelector('#fleet-side').getBoundingClientRect().height] }; });
  assert.deepEqual({ scrolls: many.scrolls, top: many.top }, { scrolls: true, top: 0 }, JSON.stringify(many));
  assert.match(many.first, /Add a dark theme/);
  assert.ok(many.share <= 0.55, JSON.stringify(many));
  // Nothing in the chat moved through all of that.
  const g1 = await geo();
  assert.deepEqual(g1.composer, g0.composer);
  assert.deepEqual(g1.main, g0.main);
  // Folding is remembered (and the chat still does not move).
  await p.click('#side-asks summary');
  assert.equal(await p.evaluate(() => document.querySelector('#side-asks details').open), false);
  await wait(3000);
  const stored = await p.evaluate(() => ({ ls: localStorage.getItem('termcontrol-asks-rail'), open: document.querySelector('#side-asks details').open }));
  assert.deepEqual(stored, { ls: 'folded', open: false }, JSON.stringify(stored));
  await p.reload();
  await p.waitForFunction(() => document.querySelector('#side-asks details'), null, { timeout: 15000, polling: 250 });
  assert.equal(await p.evaluate(() => document.querySelector('#side-asks details').open), false);
  assert.deepEqual((await geo()).composer, g0.composer);
  await p.click('#side-asks summary');
  assert.equal(await p.evaluate(() => document.querySelector('#side-asks details').open), true);
  // A phone keeps the small chip and no sidebar list.
  await p.setViewportSize({ width: 390, height: 844 });
  await wait(300);
  const narrow = await p.evaluate(() => ({ listHidden: getComputedStyle(document.querySelector('#side-asks')).display === 'none', chipShown: getComputedStyle(document.querySelector('.asks-chip')).display !== 'none', noSideScroll: document.documentElement.scrollWidth <= innerWidth }));
  assert.deepEqual(narrow, { listHidden: true, chipShown: true, noSideScroll: true });
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-phone.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
