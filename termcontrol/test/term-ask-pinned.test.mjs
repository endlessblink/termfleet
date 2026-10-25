// Noam 2026-10-25: "שהכפתור תמיד יופיע כאן". The real "Allow Edit?" card was posted at 15:16 and
// ~40 chat lines landed under it within a minute, so it was out of sight. A card still waiting
// is pinned at the bottom of the chat, in view on the phone and the PC, until he answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
test('a waiting terminal card stays in view at the bottom of a busy bot chat, phone and PC', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pinned-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7900 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
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
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Pin test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Pin test' }) })).json()).bot.id; });
      const t = Date.now() - 60 * 60_000;
      const card = { id: 'pin1', role: 'terminal-ask', pane: 'terminal-x', label: 'termfleet', askId: 'claude:s:vendor:1::permission:Allow Edit?', kind: 'permission', text: 'Allow Edit?', detail: 'termcontrol/bridge/requirements.mjs', options: [{ key: 'yes', label: 'Yes, proceed' }, { key: 'no', label: 'No, tell the agent what to do differently' }], at: t };
      const ended = { ...card, id: 'old1', askId: 'old', text: 'An older prompt', settled: true, at: t - 1000 };
      const closed = Array.from({length: 12}, (_, i) => ({ ...card, id: `closed${i}`, kind: i % 2 ? 'question' : 'permission', settled: true, terminalClosed: true }));
      const busy = Array.from({ length: 80 }, (_, i) => (i % 3 ? { id: `a${i}`, role: 'activity', text: 'Checking something', at: t + i * 1000 } : { id: `b${i}`, role: 'bot', text: `Status line ${i}: still working on the release.`, at: t + i * 1000 }));
      const reminder = { id: 'r1', role: 'reminder', pane: 'terminal-x', card: 'pin1', text: 'Still waiting for your answer after 5 minutes: terminal "termfleet" asks "Allow Edit?". The buttons are at the bottom of this chat.', at: t + 300_000 };
      await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.messages = [...j.messages, ended, ...closed, card, ...busy, reminder]; await route.fulfill({ response: r, json: j }); });
      const sent = [];
      await p.route('**/api/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await route.fulfill({ json: { ok: true, sentAt: Date.now() } }); });
      await p.goto(base + '/#bot:' + id);
      await p.waitForSelector('.term-ask-pinned .bot-term-ask [data-term-choice]', { timeout: 15000 });
      await wait(500);
      // Scrolled all the way up, as if reading back: the pinned card is still in view.
      const look = async () => p.evaluate(() => {
        const box = document.querySelector('.term-ask-pinned .bot-term-ask'), r = box.getBoundingClientRect();
        const composer = document.querySelector('.composer')?.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
        return { inView: r.top >= 0 && r.bottom <= innerHeight && (!composer || r.bottom <= composer.top + 1), onTop: box.contains(hit), live: box.querySelectorAll('[data-term-choice]:not([disabled])').length, copies: document.querySelectorAll('[data-term-ask="pin1"]').length, endedShown: Boolean(document.querySelector('[data-term-ask="old1"].ended')), reminder: Boolean(document.querySelector('.bot-reminder')) };
      });
      const atBottom = await look();
      assert.equal(await p.locator('[data-term-ask^="closed"] button').count(), 0);
      assert.equal(await p.locator('.term-ask-pinned [data-term-ask^="closed"]').count(), 0);
      assert.ok(await p.locator('[data-term-ask="closed0"]').evaluate(el => el.getBoundingClientRect().height < 50));
      const before = await p.locator('main').evaluate(el => el.scrollTop);
      await p.locator('main').hover({position:{x:30,y:100}});
      await p.mouse.wheel(0, -600);
      await wait(300);
      assert.ok(await p.locator('main').evaluate(el => el.scrollTop) < before, 'wheel scroll reaches earlier messages');
      await p.evaluate(() => { const main = document.querySelector('.bot-term-ask').closest('main') || document.scrollingElement; main.scrollTop = 0; });
      await wait(400);
      const scrolledUp = await look();
      for (const v of [atBottom, scrolledUp]) assert.deepEqual(v, { inView: true, onTop: true, live: 2, copies: 1, endedShown: true, reminder: true });
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-pinned-${width}.png` });
      await p.locator('.term-ask-pinned [data-term-choice="yes"]').click();
      await p.waitForFunction(() => /Sent "Yes, proceed"/.test(document.querySelector('[data-term-ask="pin1"] .askresult')?.textContent || ''), null, { timeout: 5000 });
      assert.deepEqual(sent, [{ pane: 'terminal-x', askId: card.askId, choice: 'yes' }]);
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
