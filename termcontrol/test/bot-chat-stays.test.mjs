// Noam 2026-10-17: "Getting thrown out after writing" - live updates must not pull you out of a bot chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('a bot chat stays open, with its draft, through live updates', { timeout: 90000 }, async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stay-'));
const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
const browser = await chromium.launch();
try {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/');
  await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
  // Make a bot through the API, then open its chat the way a tap does.
  const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stay test' }) }); return (await r.json()).bot.id; });
  await p.goto(base + '/#bot:' + id);
  await p.waitForFunction(() => document.querySelector('.bot-composer textarea'), null, { timeout: 10000, polling: 250 });
  await p.evaluate(() => { const t = document.querySelector('.bot-composer textarea'); t.value = 'half-written message'; t.dispatchEvent(new Event('input')); });
  await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); });
  await wait(3000);
  const after = await p.evaluate(() => ({ inChat: Boolean(document.querySelector('.bot-composer')), draft: document.querySelector('.bot-composer textarea')?.value ?? null, listShown: Boolean(document.querySelector('main .bots-home')) }));
  assert.deepEqual(after, { inChat: true, draft: 'half-written message', listShown: false });
  assert.deepEqual(errors, []);
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
