// Noam 2026-10-21 (politic-figther_dev chat): "ה go ahead היה צריך להיות כפתור". A bot ended
// with "Waiting for Noam: your go-ahead to start the sample from the interview." and he had to
// type "Go ahead". Now a bot message that ends waiting for his go-ahead/approval (and has no
// question card) shows "Go ahead" / "Not yet" under it; a tap sends that text as his own plain
// message to that bot, once only; the buttons settle after a tap or once he has replied.
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

test('a bot waiting for the go-ahead gets Go ahead / Not yet buttons that send once', { timeout: 150000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-goahead-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7900 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [phone, width] of [[true, 390], [false, 1400]]) {
      const p = await (await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Go ahead test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Go ahead test' }) })).json()).bot.id; });
      const sent = [], t0 = Date.now() - 100000;
      const extra = [
        // already answered by typing: buttons shown settled, nothing to tap
        { id: 'old', role: 'bot', text: 'Plan is ready.\nWaiting for Noam: your approval to post the draft.', at: t0 },
        { id: 'typed', role: 'operator', text: 'approved', at: t0 + 100 },
        // a mention in the middle is not a request for a go-ahead
        { id: 'mid', role: 'bot', text: 'Waiting for Noam: your go-ahead was given yesterday.\nSo I started the cut and it is done.', at: t0 + 200 },
        // real lines that are not his go-ahead here: a question shown elsewhere, a terminal prompt, an agent's approval
        { id: 'above', role: 'bot', text: 'Waiting for Noam: approval of the list of jokes and fatalities, in the question above.', at: t0 + 210 },
        { id: 'term', role: 'bot', text: "Waiting for Noam: approve or decline the prompt that's stuck in the rough-cut terminal.", at: t0 + 220 },
        { id: 'agent', role: 'bot', text: 'מחכה ל: אישור מהסוכן שהמשימה הוזזה.', at: t0 + 230 },
        // a question card has its own buttons: no go-ahead buttons added
        { id: 'card', role: 'bot', text: 'Waiting for Noam: your go-ahead on the format.', question: { text: 'Which format?', options: ['Short', 'Long'] }, at: t0 + 300 },
        { id: 'ans', role: 'operator', text: 'Short', answerTo: 'card', at: t0 + 400 },
        // Hebrew wording
        { id: 'he', role: 'bot', text: 'הכנתי את הטיוטה.\nממתין לאישור של נועם להתחיל.', at: t0 + 500 },
        { id: 'heok', role: 'operator', text: 'Not yet', at: t0 + 600 },
        // an unanswered ask that a newer one replaced: no buttons, one open pair at a time
        { id: 'stale', role: 'bot', text: 'Waiting for Noam: your go-ahead to start the sample.', at: t0 + 650 },
        // the reported message, still open
        { id: 'now', role: 'bot', text: 'I read the interview and picked the clip.\n\nWaiting for Noam: your go-ahead to start the sample from the interview.', at: t0 + 700 },
      ];
      await p.route('**/api/bot?*', async (route) => { try { const r = await route.fetch(); const j = await r.json(); j.messages = [...extra, ...sent.map((s, i) => ({ id: 's' + i, role: 'operator', text: s.text, at: t0 + 5000 + i }))]; await route.fulfill({ response: r, json: j }); } catch {} });
      await p.route('**/api/bot/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await wait(400); await route.fulfill({ json: { ok: true } }); });
      await p.goto(base + '/#bot:' + id);
      await p.waitForSelector('.bot-goahead[data-gid="now"] button', { timeout: 15000 });
      const state = () => p.evaluate(() => [...document.querySelectorAll('.bot-goahead')].map((g) => ({ gid: g.dataset.gid, answered: g.classList.contains('answered'), buttons: [...g.querySelectorAll('button')].map((b) => ({ text: b.innerText.trim(), disabled: b.disabled, pressed: b.getAttribute('aria-pressed') === 'true' })) })));

      const before = await state();
      assert.deepEqual(before.map((g) => g.gid), ['old', 'he', 'now'], 'only messages ending in a go-ahead request, never a question card or a mid-text mention');
      assert.deepEqual(before.find((g) => g.gid === 'now'), { gid: 'now', answered: false, buttons: [{ text: 'Go ahead', disabled: false, pressed: false }, { text: 'Not yet', disabled: false, pressed: false }] });
      assert.ok(before.find((g) => g.gid === 'old').answered && before.find((g) => g.gid === 'old').buttons.every((b) => b.disabled && !b.pressed), 'a typed reply settles it');
      assert.ok(before.find((g) => g.gid === 'he').buttons.find((b) => b.text === 'Not yet').pressed, 'a reply matching a button marks that button');
      if (shots) { await p.locator('.bot-goahead[data-gid="now"]').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(shots, `go-ahead-${phone ? 'phone' : 'pc'}-before.png`) }); }

      // one tap sends "Go ahead" as his own plain message; a second tap sends nothing
      const sel = '.bot-goahead[data-gid="now"] button[data-go="yes"]';
      if (phone) await p.tap(sel); else await p.click(sel);
      await p.evaluate((s) => document.querySelector(s)?.click(), sel);
      await p.waitForFunction(() => [...document.querySelectorAll('.bot-goahead[data-gid="now"] button')].every((b) => b.disabled), null, { timeout: 10000, polling: 100 });
      for (let i = 0; i < 30 && !sent.length; i++) await wait(100);
      await wait(1500);
      assert.deepEqual(sent, [{ id, text: 'Go ahead', images: [] }], 'exactly one plain message, like typing it');
      await p.waitForFunction(() => document.querySelector('.bot-goahead[data-gid="now"]')?.classList.contains('answered'), null, { timeout: 10000, polling: 200 });
      const after = (await state()).find((g) => g.gid === 'now');
      assert.deepEqual(after.buttons.map((b) => [b.text, b.disabled, b.pressed]), [['Go ahead', true, true], ['Not yet', true, false]]);
      assert.equal(await p.evaluate(() => document.querySelector('.bot-composer textarea').value), '', 'the message box is left alone');
      if (shots) await p.screenshot({ path: path.join(shots, `go-ahead-${phone ? 'phone' : 'pc'}-after.png`) });
      assert.deepEqual(errors, []);
      await p.unrouteAll({ behavior: 'ignoreErrors' });
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
