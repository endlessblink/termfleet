// Noam 2026-10-22 (pc-helper chat): "לא רואה רשימה + זו צריכה להיות רשימה אינטרקטיבית שאני
// יכול לסמן / ללחוץ / להוסיף הערות וכו'". On the phone and the PC: a bot's [checklist] shows as
// rows he ticks by tapping, each with a note; ticks and notes survive a reload; one Send posts
// them once, tied to the list, and the card locks. A plain markdown table fits the phone screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.TC_SHOTS_DIR || '';

test('a bot list can be ticked, noted, kept across a reload and sent once', { timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-list-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [phone, width] of [[true, 390], [false, 1400]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'List test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'List test' }) })).json()).bot.id; });
      const t0 = Date.now() - 100000, sent = [];
      const list = { title: 'Tick the terminals to close', rows: [
        { label: 'rough-cut-mvp', detail: ['video editing', 'idle 3 hours'], checked: true },
        { label: 'health-app', detail: ['health app'], checked: false },
        { label: 'politic-fighter x5', detail: ['political bot', 'idle 1 day'], checked: true },
      ] };
      const table = 'Here is what each one did:\n\n| Terminal | Job | Idle for | Memory |\n|---|---|---|---|\n| rough-cut-mvp | video editing pipeline for the interview clips | 3 hours | 1.2 GB |\n| health-app | health app front page | 1 day | 800 MB |';
      const extra = [{ id: 'tbl', role: 'bot', text: table, at: t0 }, { id: 'lst', role: 'bot', text: 'I found 3 idle terminals.', checklist: list, at: t0 + 100 }];
      await p.route('**/api/bot?*', async (route) => { try { const r = await route.fetch(); const j = await r.json(); j.messages = [...extra, ...sent.map((s, i) => ({ id: 's' + i, role: 'operator', text: s.text, listTo: s.listTo, listChoices: s.choices, at: t0 + 5000 + i }))]; await route.fulfill({ response: r, json: j }); } catch {} });
      await p.route('**/api/bot/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await wait(300); await route.fulfill({ json: { ok: true } }); });
      await p.goto(base + '/#bot:' + id);
      await p.waitForSelector('.bot-list[data-lid="lst"] li', { timeout: 15000 });
      const state = () => p.evaluate(() => { const c = document.querySelector('.bot-list[data-lid="lst"]'); return { sent: c.classList.contains('sent'), rows: [...c.querySelectorAll('li')].map((li) => ({ text: li.querySelector('b').innerText, on: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled })), count: c.querySelector('.bot-list-count')?.innerText || '' }; });
      const before = await state();
      assert.deepEqual(before.rows.map((r) => [r.text, r.on]), [['rough-cut-mvp', true], ['health-app', false], ['politic-fighter x5', true]], 'the bot\'s suggested ticks are shown');
      assert.equal(before.count, '2 of 3 ticked');

      // The table fits the phone (no sideways page scroll), the list card too.
      const fits = await p.evaluate(() => { const m = document.querySelector('main'); return [...document.querySelectorAll('.tablewrap, .bot-list')].every((el) => el.getBoundingClientRect().right <= m.getBoundingClientRect().right + 1) && document.documentElement.scrollWidth <= innerWidth; });
      assert.ok(fits, 'table and list stay inside the screen');
      if (shots) { await p.locator('.tablewrap').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(shots, `list-table-${phone ? 'phone' : 'pc'}.png`) }); }

      // Tap a row's name to tick it, untick another, write a note on a row and an overall note.
      const tapOn = async (sel) => { if (phone) await p.tap(sel); else await p.click(sel); };
      await tapOn('.bot-list[data-lid="lst"] li[data-i="1"] b');
      await tapOn('.bot-list[data-lid="lst"] li[data-i="2"] input[type=checkbox]');
      await tapOn('.bot-list[data-lid="lst"] li[data-i="0"] .bot-list-notebtn');
      await p.fill('.bot-list[data-lid="lst"] li[data-i="0"] .bot-list-note', 'keep its log file');
      await p.fill('.bot-list[data-lid="lst"] textarea', 'Close them now');
      await p.evaluate(() => document.activeElement?.blur());
      const ticked = await state();
      assert.deepEqual(ticked.rows.map((r) => r.on), [true, true, false]);
      assert.equal(ticked.count, '2 of 3 ticked');
      if (shots) { await p.locator('.bot-list[data-lid="lst"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(shots, `list-${phone ? 'phone' : 'pc'}-ticking.png`) }); }

      // A reload keeps the draft.
      await p.reload();
      await p.waitForSelector('.bot-list[data-lid="lst"] li', { timeout: 15000 });
      await wait(300);
      assert.deepEqual((await state()).rows.map((r) => r.on), [true, true, false], 'ticks survive a reload');
      assert.equal(await p.inputValue('.bot-list[data-lid="lst"] li[data-i="0"] .bot-list-note'), 'keep its log file');
      assert.equal(await p.inputValue('.bot-list[data-lid="lst"] textarea'), 'Close them now');

      // One Send: his choices go once, tied to the list, and the card locks.
      await tapOn('.bot-list[data-lid="lst"] .bot-list-send');
      await p.evaluate(() => document.querySelector('.bot-list[data-lid="lst"] .bot-list-send')?.click());
      for (let i = 0; i < 30 && !sent.length; i++) await wait(100);
      await wait(1500);
      assert.equal(sent.length, 1, 'sent exactly once');
      assert.equal(sent[0].listTo, 'lst');
      assert.deepEqual(sent[0].choices, { checked: [true, true, false], notes: ['keep its log file', '', ''], note: 'Close them now' });
      assert.equal(sent[0].text, 'My choices on your list "Tick the terminals to close":\nTicked (2):\n- rough-cut-mvp (my note: keep its log file)\n- health-app\nNot ticked (1):\n- politic-fighter x5\nMy note: Close them now');
      await p.waitForFunction(() => document.querySelector('.bot-list[data-lid="lst"]')?.classList.contains('sent'), null, { timeout: 10000, polling: 200 });
      const after = await state();
      assert.ok(after.rows.every((r) => r.disabled), 'locked after sending');
      assert.deepEqual(after.rows.map((r) => r.on), [true, true, false], 'the locked card shows what he sent');
      assert.equal(await p.evaluate(() => localStorage.getItem('tc.botList.lst')), null, 'the draft is cleared once sent');
      if (shots) { await p.locator('.bot-list[data-lid="lst"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(shots, `list-${phone ? 'phone' : 'pc'}-sent.png`) }); }
      assert.deepEqual(errors, []);
      await p.unrouteAll({ behavior: 'ignoreErrors' });
      await ctx.close();
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
