// Noam 2026-10-21: "אני צריך להיות מסוגל להגיב להודעה הזו מכאן". A bot chat message's menu had
// no Reply on his own messages, and Reply elsewhere only pasted a quote into the box. Now Reply
// on any message sets a quoted preview with × above the box; the reply goes to THIS bot with the
// message's id; the bot gets the quote as context only; a failed reply keeps text and quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function testBots() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reply-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const prompts = [];
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reply-bots-')), notify: () => {}, run: async (runner, text) => { prompts.push(String(text || '')); return { text: 'Ask @Helper to check the build, then tell me.' }; } });
  return { bots, prompts };
}
const settle = async (bots, id) => { for (let i = 0; i < 400 && bots.running.has(id); i++) await wait(5); };

test('a reply is tied to the exact message of this chat, and the bot gets the quote as context only', async () => {
  const { bots, prompts } = testBots();
  const { bot } = bots.create({ name: 'Replyee', cwd: os.tmpdir() });
  const { bot: helper } = bots.create({ name: 'Helper', cwd: os.tmpdir() });
  bots.send(bot.id, 'first message from Noam', { owner: true });
  await settle(bots, bot.id);
  const mine = bots.messages(bot.id).find((m) => m.role === 'operator');
  const theirs = bots.messages(bot.id).find((m) => m.role === 'bot' && m.text);

  // reply to the bot's message: stored with its id, the brain is told it is context only
  const r1 = bots.send(bot.id, 'yes, do that', { owner: true, replyTo: theirs.id });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.message.replyTo, { id: theirs.id, role: 'bot', text: theirs.text });
  await settle(bots, bot.id);
  const asked = prompts.at(-1);
  assert.match(asked, /replying to your earlier message in this chat/);
  assert.match(asked, /context only, not as a new request or approval/);
  assert.ok(asked.includes(theirs.text) && asked.includes('yes, do that'));

  // the quote names @Helper, but only this bot hears the reply (no routing from quoted text)
  assert.ok(!bots.messages(helper.id).some((m) => /yes, do that/.test(m.text || '')), 'a bot named in the quote is not contacted');

  // his own message can be replied to as well
  const r2 = bots.send(bot.id, 'and this too', { owner: true, replyTo: mine.id });
  assert.equal(r2.message.replyTo.role, 'operator');
  await settle(bots, bot.id);
  assert.match(prompts.at(-1), /replying to his own earlier message/);

  // an id that is not in THIS chat (unknown, or another bot's message) sends nothing
  const before = bots.messages(bot.id).length;
  bots.send(helper.id, 'hello helper', { owner: true });
  await settle(bots, helper.id);
  const elsewhere = bots.messages(helper.id).find((m) => m.role === 'operator');
  for (const wrong of ['nope', elsewhere.id]) {
    const r = bots.send(bot.id, 'should not go', { owner: true, replyTo: wrong });
    assert.match(r.error, /no longer in this chat/);
  }
  assert.equal(bots.messages(bot.id).length, before, 'a refused reply adds nothing to the chat');

  // a plain message is unchanged
  assert.equal(bots.send(bot.id, 'plain', { owner: true }).message.replyTo, undefined);
});

test('the send route passes the reply target through', () => {
  assert.match(fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8'), /replyTo: body\.replyTo/);
});

test('Reply from a message menu: preview with ×, sent with the message id, kept with Edit when sending fails', { timeout: 150000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reply-ui-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
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
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Reply test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reply test' }) })).json()).bot.id; });
      const sent = [], t0 = Date.now() - 100000;
      let fail = false;
      const extra = [{ id: 'o1', role: 'operator', text: 'אני מרגיש שהמכות המיוחדות לא עובדות', at: t0 }, { id: 'b1', role: 'bot', text: 'Checking the special moves now.', at: t0 + 500 }];
      await p.route('**/api/bot?*', async (route) => { try { const r = await route.fetch(); const j = await r.json(); j.messages = [...extra, ...sent.map((s, i) => ({ id: 's' + i, role: 'operator', text: s.text, ...(s.replyTo ? { replyTo: { id: s.replyTo, role: s.replyTo === 'b1' ? 'bot' : 'operator', text: extra.find((m) => m.id === s.replyTo).text } } : {}), at: t0 + 5000 + i }))]; await route.fulfill({ response: r, json: j }); } catch {} });
      await p.route('**/api/bot/send', async (route) => { const body = JSON.parse(route.request().postData()); if (fail) return route.fulfill({ status: 503, json: { error: 'The bridge is restarting.' } }); sent.push(body); await route.fulfill({ json: { ok: true } }); });
      await p.goto(base + '/#bot:' + id);
      const tap = (sel) => (phone ? p.tap(sel) : p.click(sel));
      const reply = async (mid) => { await p.waitForSelector(`.msg[data-mid="${mid}"] .message-menu summary`, { timeout: 15000 }); await tap(`.msg[data-mid="${mid}"] .message-menu summary`); await tap(`.msg[data-mid="${mid}"] .reply-message`); };
      const preview = () => p.evaluate(() => { const b = document.querySelector('.bot-composer .reply-preview'); return b && !b.hidden ? b.innerText : ''; });

      // his own message has Reply; the preview shows it and × cancels without sending
      await reply('o1');
      assert.match(await preview(), /You: אני מרגיש שהמכות המיוחדות/);
      assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('.bot-composer textarea')), true, 'the box gets the cursor');
      assert.equal(await p.evaluate(() => document.querySelector('.bot-composer textarea').value), '', 'nothing is pasted into the box');
      await tap('.bot-composer .reply-cancel');
      assert.equal(await preview(), '', '× removes the preview');
      assert.equal(sent.length, 0);

      // reply to the bot's message: sent to this bot with that message id, preview cleared
      await reply('b1');
      assert.match(await preview(), /Reply test: Checking the special moves/);
      await p.fill('.bot-composer textarea', 'כן, תבדוק את זה');
      await tap('.bot-composer .send');
      await p.waitForFunction(() => document.querySelector('.reply-of'), null, { timeout: 10000, polling: 200 });
      assert.deepEqual(sent.map((s) => ({ id: s.id, text: s.text, replyTo: s.replyTo })), [{ id, text: 'כן, תבדוק את זה', replyTo: 'b1' }]);
      assert.equal(await preview(), '');
      assert.match(await p.evaluate(() => document.querySelector('.msg[data-mid="s0"] .reply-of').innerText), /Reply test: Checking the special moves/, 'the sent reply shows what it answers');

      // a failed reply keeps its text and quote; Edit puts both back; the retry carries the id
      fail = true;
      await reply('o1');
      await p.fill('.bot-composer textarea', 'גם הפיניש לא עובד');
      await tap('.bot-composer .send');
      await p.waitForSelector('.bot-failed-send [data-edit]', { timeout: 10000 });
      assert.match(await p.evaluate(() => document.querySelector('.bot-failed-send').innerText), /You: אני מרגיש[\s\S]*גם הפיניש לא עובד[\s\S]*The bridge is restarting/);
      await tap('.bot-failed-send [data-edit]');
      assert.equal(await p.evaluate(() => document.querySelector('.bot-composer textarea').value), 'גם הפיניש לא עובד');
      assert.match(await preview(), /You: אני מרגיש/);
      fail = false;
      await tap('.bot-composer .send');
      await p.waitForFunction(() => !document.querySelector('.bot-failed-send, .bot-pending'), null, { timeout: 10000, polling: 200 });
      { const { sendId, ...last } = sent.at(-1); assert.ok(sendId, 'the send carries its own id'); assert.deepEqual(last, { id, text: 'גם הפיניש לא עובד', images: [], replyTo: 'o1' }); }

      // a plain message after that carries no reply
      await p.fill('.bot-composer textarea', 'plain one');
      await tap('.bot-composer .send');
      await p.waitForFunction((n) => true, sent.length);
      for (let i = 0; i < 50 && sent.at(-1).text !== 'plain one'; i++) await wait(100);
      assert.equal(sent.at(-1).replyTo, undefined);
      assert.deepEqual(errors, []);
      await p.unrouteAll({ behavior: 'ignoreErrors' });
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
