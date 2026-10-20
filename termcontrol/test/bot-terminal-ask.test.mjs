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
