// Noam 2026-10-21: "זה לא מאפשר לי לכתוב את התשובה שלי". "Write my own answer" on a bot's
// question card only focused the far-away message box, the typed reply was not tied to the
// question, and any later message closed the card. Now the card opens its own box, the answer
// is tied to that card (older cards too), and the card shows it as answered.
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

test('an answer sent for a card is stored with it, and the bot is told which question it answers', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-own-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const prompts = [];
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-own-bots-')), notify: () => {}, run: async ({ prompt, text } = {}) => { prompts.push(String(prompt || text || '')); return { text: prompts.length === 1 ? '[question]\nShip today?\n- Yes (recommended)\n- No\n[/question]' : 'ok' }; } });
  const { bot } = bots.create({ name: 'Own', cwd: os.tmpdir() });
  bots.send(bot.id, 'hi');
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  const card = bots.messages(bot.id).find((m) => m.question);
  const r = bots.send(bot.id, 'רק אחרי הבדיקות', { answerTo: card.id });
  assert.equal(r.message.answerTo, card.id);
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  assert.ok(bots.queues.get(bot.id)?.length === 0 || !bots.queues.get(bot.id)?.length);
  // an unknown card id is ignored, never stored
  assert.equal(bots.send(bot.id, 'x', { answerTo: 'nope' }).message.answerTo, undefined);
});

test('the bot brain gets the question with a typed answer', () => {
  const src = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(src, /\[Noam's answer to your question "\$\{asked\.question\.text\}"\]/);
  assert.match(fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8'), /answerTo: body\.answerTo/);
});

test('"Write my own answer" opens a box in the card; Hebrew typed there is sent for that card, also an older one', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-own-ui-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [phone, width] of [[true, 390], [false, 1400]]) {
      const p = await (await browser.newContext({ viewport: { width, height: 860 }, hasTouch: phone, isMobile: phone })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Own test'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Own test' }) })).json()).bot.id; });
      const sent = [], t0 = Date.now() - 100000;
      // an older card, then an unrelated message from Noam, then a newer card
      const extra = [{ id: 'q1', role: 'bot', text: '', question: { text: 'How should work spread across several bots be managed?', options: ['One manager bot', 'Group chat of bots'], recommended: 0 }, at: t0 }, { id: 'o0', role: 'operator', text: 'something unrelated', at: t0 + 500 }, { id: 'q2', role: 'bot', text: '', question: { text: 'Ship today?', options: ['Yes', 'No'], recommended: 0 }, at: t0 + 900 }];
      await p.route('**/api/bot?*', async (route) => { try { const r = await route.fetch(); const j = await r.json(); j.messages = [...extra, ...sent.map((s, i) => ({ id: 's' + i, role: 'operator', text: s.text, answerTo: s.answerTo, at: t0 + 5000 + i }))]; await route.fulfill({ response: r, json: j }); } catch {} });
      await p.route('**/api/bot/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await route.fulfill({ json: { ok: true } }); });
      await p.goto(base + '/#bot:' + id);
      await p.waitForSelector('[data-qid="q1"] .bot-q-own', { timeout: 15000 });
      if (phone) await p.tap('[data-qid="q1"] .bot-q-own'); else await p.click('[data-qid="q1"] .bot-q-own');
      assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('[data-qid="q1"] .bot-q-write textarea')), true, 'the box opens inside the card and has the cursor');
      const words = 'למה לא שתי האופציות? manager + group';
      await p.keyboard.type(words);
      await wait(2600);   // a live refresh passes while typing
      const box = await p.evaluate(() => { const t = document.querySelector('[data-qid="q1"] .bot-q-write textarea'); return { value: t.value, dir: getComputedStyle(t).direction, focused: document.activeElement === t }; });
      assert.deepEqual(box, { value: words, dir: 'rtl', focused: true }, 'the words survive a refresh, right-to-left');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.querySelector('[data-qid="q1"]')?.classList.contains('answered'), null, { timeout: 10000, polling: 200 });
      assert.deepEqual(sent.map((s) => ({ text: s.text, answerTo: s.answerTo })), [{ text: words, answerTo: 'q1' }]);
      const card = await p.evaluate(() => ({ mine: document.querySelector('[data-qid="q1"] .bot-q-mine')?.innerText, newerOpen: !document.querySelector('[data-qid="q2"]').classList.contains('answered') }));
      assert.match(card.mine, /למה לא שתי האופציות/);
      assert.equal(card.newerOpen, true, 'answering one card leaves the other open');
      assert.deepEqual(errors, []);
      await p.unrouteAll({ behavior: 'ignoreErrors' });
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
