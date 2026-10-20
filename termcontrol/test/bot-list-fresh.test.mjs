// Noam 2026-10-20: the icon and name at the top of the chat were cut off, and a new bot (health-coach_dev) was missing from the list while its chat was open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('a bot chat header is not cut off, and a bot made meanwhile appears in the list', { timeout: 90000 }, async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-list-'));
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
  const make = (name) => p.evaluate(async (n) => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) }); return (await r.json()).bot.id; }, name);
  const first = await make('First bot');
  await p.goto(base + '/');
  await p.waitForFunction((bid) => document.querySelector(`.bot-row[data-bot="${bid}"]`), first, { timeout: 15000, polling: 250 });
  await p.click(`.bot-row[data-bot="${first}"]`);
  await p.waitForFunction(() => document.querySelector('.bot-composer textarea'), null, { timeout: 15000, polling: 250 });
  // (a) the header shows its avatar and name fully: nothing above the window's top edge, and the chat starts below it.
  const head = await p.evaluate(() => { const h = document.querySelector('body > header').getBoundingClientRect(), a = document.querySelector('body > header .head-avatar, body > header .bot-avatar')?.getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(); return { headerTop: Math.round(h.top), avatarTop: a ? Math.round(a.top) : null, headerBottom: Math.round(h.bottom), mainTop: Math.round(m.top) }; });
  assert.ok(head.headerTop >= 0 && head.avatarTop !== null && head.avatarTop >= 0 && head.headerBottom <= head.mainTop + 1, JSON.stringify(head));
  if (process.env.TC_SHOT) await p.screenshot({ path: process.env.TC_SHOT + '-header.png' });
  // (b) a bot made while this chat is open shows up in the list by itself; the open one stays outlined.
  const second = await make('Second bot');
  await p.waitForFunction((bid) => document.querySelector(`.bot-row[data-bot="${bid}"]`), second, { timeout: 25000, polling: 500 });
  const state = await p.evaluate((bid) => ({ rows: document.querySelectorAll('.bot-row').length, outlined: [...document.querySelectorAll('.bot-row.open-chat')].map((x) => x.dataset.bot), count: document.querySelector('.fleet-tabs [data-tab=bots] .tab-count')?.textContent }), first);
  assert.deepEqual({ rows: state.rows, outlined: state.outlined, count: state.count }, { rows: 2, outlined: [first], count: '2' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
