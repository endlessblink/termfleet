// Noam 2026-10-20 picked option B + the menu: the top of a bot chat is one slim line (back,
// icon + name with its brain, a requests button, one menu); options live in a bottom sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test('a bot chat opens with a one-line header and a menu that keeps every option', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-slim-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Slim test', job: 'Keeps the phone app working' }) })).json()).bot.id);
    await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
    await p.waitForSelector('.bot-menu-button', { timeout: 15000 });
    await wait(800);
    const head = await p.evaluate(() => ({ h: Math.round(document.querySelector('header[role=banner]').getBoundingClientRect().height), name: document.querySelector('#title .bot-names bdi')?.textContent, brain: document.querySelector('#title .bot-brain')?.textContent, options: getComputedStyle(document.querySelector('#chat-status')).display, theme: getComputedStyle(document.querySelector('header>.theme-toggle')).display, chipHidden: document.querySelector('.bot-asks-chip').hidden, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.ok(head.h <= 60, `header is ${head.h}px tall`);
    assert.equal(head.name, 'Slim test');
    assert.match(head.brain, /Claude/);
    assert.equal(head.options, 'none'); assert.equal(head.theme, 'none');
    assert.equal(head.chipHidden, true, 'no requests yet, so no 25/30 button');
    assert.equal(head.overflow, false);

    await p.click('.bot-menu-button');
    await p.waitForSelector('.bot-menu-sheet[open]');
    const items = await p.$$eval('.bot-menu-sheet .menu-item .menu-label', (els) => els.map((e) => e.textContent));
    assert.deepEqual(items, ['Model and backup', 'Memory', 'Schedule', 'Edit bot', 'Light or dark', 'Browser', 'Notifications on', 'Pin', 'Hide', 'Delete bot']);
    // Light or dark still works from the menu.
    const before = await p.evaluate(() => document.documentElement.dataset.theme || '');
    await p.click('.bot-menu-sheet [data-act=theme]');
    await wait(300);
    assert.notEqual(await p.evaluate(() => document.documentElement.dataset.theme || ''), before);
    // Edit bot opens the same editor the old button opened.
    await p.click('.bot-menu-button'); await p.click('.bot-menu-sheet [data-act=edit]');
    await p.waitForSelector('dialog[open]:not(.bot-menu-sheet)', { timeout: 5000 });
    await p.keyboard.press('Escape');
    // Delete asks for a second tap.
    await p.click('.bot-menu-button'); await p.click('.bot-menu-sheet [data-act=del]');
    assert.match(await p.textContent('.bot-menu-sheet [data-act=del]'), /Tap again/);
    await p.keyboard.press('Escape');
    // Back to the list: the normal header returns.
    await p.click('header #nav .back');
    await p.waitForSelector('.bots-home', { timeout: 10000 });
    assert.equal(await p.evaluate(() => document.body.classList.contains('bot-view') || Boolean(document.querySelector('.bot-head-actions'))), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
