// Noam 2026-10-20: "וגם אם יש סוכן שאחראי על הנושא אז גם הוא צריך להציף את זה ולבקש את היאשור
// ואז זה יעבור ישירות לטרמינל כאילו אני לחצתי על זה במחשב". A terminal's prompt shows in
// the bot's chat with the terminal's own choices; a tap sends exactly that choice for that prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('a terminal prompt in a bot chat: its choices as buttons, a tap goes to that terminal, nothing spills out', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-termask-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1600]) {
      const p = await (await browser.newContext({ viewport: { width, height: 860 } })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Ask test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ask test' }) })).json()).bot.id; });
      const msg = { id: 'ta1', role: 'terminal-ask', pane: 'terminal-x', label: 'Render the intro', askId: 'claude:s:prompt:Do you want to proceed?', kind: 'permission', text: 'Do you want to proceed?', detail: 'This starts an export/render. Noam must approve it.', options: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }], at: Date.now() };
      await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.messages = [...j.messages, msg]; await route.fulfill({ response: r, json: j }); });
      const sent = [];
      await p.route('**/api/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await route.fulfill({ json: { ok: true, sentAt: Date.now() } }); });
      await p.goto(base + '/#bot:' + id);
      await p.waitForSelector('.bot-term-ask [data-term-choice]', { timeout: 15000 });
      const look = await p.evaluate(() => {
        const box = document.querySelector('.bot-term-ask'), r = box.getBoundingClientRect(), bad = [];
        for (const el of box.querySelectorAll('*')) { const e = el.getBoundingClientRect(); if (e.width && (e.left < r.left - 1 || e.right > r.right + 1)) bad.push(el.tagName); }
        return { buttons: [...box.querySelectorAll('[data-term-choice]')].map((b) => b.textContent), text: box.innerText, bad, pageScroll: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.deepEqual(look.buttons, ['Yes', 'No']);
      assert.match(look.text, /Render the intro/);
      assert.match(look.text, /This starts an export\/render/);
      assert.deepEqual([look.bad, look.pageScroll], [[], false]);
      await p.locator('.bot-term-ask [data-term-choice="2"]').click();
      await p.waitForFunction(() => /Sent "No"/.test(document.querySelector('.bot-term-ask .askresult')?.textContent || ''), null, { timeout: 5000 });
      assert.deepEqual(sent, [{ pane: 'terminal-x', askId: msg.askId, choice: '2' }]);
      assert.equal(await p.locator('.bot-term-ask [data-term-choice]:not([disabled])').count(), 0, 'one tap, then the buttons rest');
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-termask-${width}.png` });
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Noam 2026-10-24: a card read "This agent is asking permission to continue", its buttons looked
// live, and a tap only said "no longer active". A card the terminal moved on from is shown as
// ended; a tap on an out-of-date card follows the same prompt asked again, else ends the card.
test('a terminal card the terminal moved on from never looks answerable', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-termask-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 860 } })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stale test' }) })).json()).bot.id);
    const opts = [{ key: 'yes', label: 'Yes, proceed' }, { key: 'no', label: 'No' }];
    const dead = { id: 'old', role: 'terminal-ask', pane: 'terminal-x', label: 'Ship steps', askId: 'a0', kind: 'permission', text: 'Allow this command?', detail: 'Push the steps update', options: opts, settled: true, at: Date.now() - 5000 };
    const live = { id: 'new', role: 'terminal-ask', pane: 'terminal-y', label: 'Build APK', askId: 'a1', kind: 'permission', text: 'Allow this command?', detail: 'Build the Android app', options: opts, at: Date.now() };
    await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.messages = [...j.messages, dead, live]; await route.fulfill({ response: r, json: j }); });
    const replies = [{ stale: true, error: 'gone', current: { id: 'a2', kind: 'permission', title: 'Allow this command?', options: ['yes', 'no'] } }, { ok: true }];
    const sent = [];
    await p.route('**/api/send', async (route) => { sent.push(JSON.parse(route.request().postData())); const body = replies.shift(); await route.fulfill({ status: body.ok ? 200 : 409, json: body }); });
    await p.goto(base + '/#bot:' + id);
    await p.waitForSelector('[data-term-ask="new"] [data-term-choice]', { timeout: 15000 });
    const old = await p.evaluate(() => { const b = document.querySelector('[data-term-ask="old"]'); return { ended: b.classList.contains('ended'), live: b.querySelectorAll('[data-term-choice]:not([disabled])').length, text: b.innerText }; });
    assert.equal(old.ended, true);
    assert.equal(old.live, 0, 'an ended card has no live buttons');
    assert.match(old.text, /Push the steps update/);
    assert.match(old.text, /No longer open in the terminal/);
    // Out of date, but the terminal asks the same again: the card follows it, and the next tap goes through.
    await p.locator('[data-term-ask="new"] [data-term-choice="yes"]').click();
    await p.waitForFunction(() => /asked this again/.test(document.querySelector('[data-term-ask="new"] .askresult')?.textContent || ''), null, { timeout: 5000 });
    await p.locator('[data-term-ask="new"] [data-term-choice="yes"]').click();
    await p.waitForFunction(() => /Sent/.test(document.querySelector('[data-term-ask="new"] .askresult')?.textContent || ''), null, { timeout: 5000 });
    assert.deepEqual(sent.map((s) => s.askId), ['a1', 'a2']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
