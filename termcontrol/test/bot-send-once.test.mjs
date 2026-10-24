// Noam 2026-10-24: his message with one picture ("הפופאפים איך שהם עכשיו, עמוסים ממש") reached
// the Agent-Manager bot three times. The picture was uploaded once, so the copies were the same
// pending message sent again: the first send answered too slowly, the chat showed "Not sent"
// although the bridge had saved it, and Resend (tappable twice while the screen caught up) sent
// it again, twice. Now every send carries an id the bridge keeps with the message: a repeat of
// that id is never stored or handed to the bot again, and the chat recognises its own saved
// message instead of calling it unsent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-send-once-'));
function readyComputer() {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  return { home, socket: path.join(home, 'daemon.sock') };
}

test('the same send id is stored and handed to the bot once, even after a restart', async () => {
  const dir = tmp(), heard = [];
  const make = () => new Bots({ checks: readyComputer(), dir, run: async (bot, text) => { heard.push(text); return { text: 'ok' }; } });
  const bots = make();
  const { bot } = bots.create({ name: 'Once', cwd: os.tmpdir() });
  const first = bots.send(bot.id, 'the popups are crowded', { owner: true, sendId: 'send-abc-1' });
  assert.equal(first.ok, true);
  const again = bots.send(bot.id, 'the popups are crowded', { owner: true, sendId: 'send-abc-1' });
  assert.equal(again.ok, true);
  assert.equal(again.repeated, true);
  assert.equal(again.message.id, first.message.id);
  const later = make().send(bot.id, 'the popups are crowded', { owner: true, sendId: 'send-abc-1' });
  assert.equal(later.repeated, true);
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  const mine = bots.messages(bot.id).filter((m) => m.role === 'operator');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].sendId, 'send-abc-1');
  assert.equal(heard.length, 1);
  // A different id is a new message, as before.
  assert.equal(bots.send(bot.id, 'the popups are crowded', { owner: true, sendId: 'send-abc-2' }).repeated, undefined);
});

function startBridge() {
  const base = tmp();
  const configDir = path.join(base, 'cfg'), botsHome = path.join(base, 'home'), uploads = path.join(base, 'up');
  for (const d of [configDir, botsHome, uploads]) fs.mkdirSync(d, { recursive: true });
  const port = 7900 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_UPLOAD_DIR: uploads, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  return { configDir, port, stop: () => { child.kill('SIGKILL'); fs.rmSync(base, { recursive: true, force: true }); } };
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await wait(150); } } }

async function openChat(browser, base, context) {
  const p = await (await browser.newContext(context)).newPage();
  await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/');
  await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
  const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Send once' }) }); return (await r.json()).bot.id; });
  await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
  await p.waitForSelector('.bot-composer textarea', { timeout: 15000 });
  await p.waitForFunction(() => !document.querySelector('#main .spin'), null, { timeout: 15000, polling: 200 });
  return { p, id, errors };
}
const operatorCopies = (b, id, text) => fs.readFileSync(path.join(b.configDir, 'bots', id, 'chat.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.role === 'operator' && m.text === text).length;
const shown = (p, text) => p.evaluate((t) => document.getElementById('main').innerText.includes(t), text);

for (const [label, context] of [['phone', devices['Pixel 7']], ['PC', { viewport: { width: 1400, height: 900 } }]]) {
  test(`${label}: a saved message whose answer was lost shows as sent, and Resend tapped twice adds no copy`, { timeout: 90000 }, async () => {
    const b = startBridge(), base = `http://localhost:${b.port}`;
    await ready(b.port);
    const browser = await chromium.launch();
    try {
      const { p, id, errors } = await openChat(browser, base, context);
      const send = async (text) => { await p.fill('.bot-composer textarea', text); await p.locator('.bot-composer button.send').click(); };

      // 1. Slow bridge / dropped answer: the bridge saves the message but its answer never arrives.
      await p.route('**/api/bot/send', async (route) => { try { await route.fetch(); } catch (e) { console.log('DEBUG fetch', e.message); } await route.abort('timedout').catch(() => {}); });
      await send('first message');
      for (let i = 0; i < 100 && !operatorCopies(b, id, 'first message'); i++) await wait(100);
      await p.waitForFunction(() => !document.querySelector('.bot-pending, .bot-failed-send') && document.getElementById('main').innerText.includes('first message'), null, { timeout: 20000, polling: 200 }).catch(() => {});
      assert.equal(await shown(p, 'first message'), true);
      assert.equal(await p.locator('[data-resend]').count(), 0, 'a message the bridge saved was offered for Resend');
      assert.equal(operatorCopies(b, id, 'first message'), 1);

      // 2. Really not delivered (connection dropped), then Resend tapped twice on a slow bridge.
      await p.unroute('**/api/bot/send');
      await p.route('**/api/bot/send', (route) => route.abort('connectionreset'));
      await send('second message');
      await p.waitForSelector('[data-resend]', { timeout: 20000 });
      await p.unroute('**/api/bot/send');
      let calls = 0;
      await p.route('**/api/bot/send', async (route) => { calls += 1; await wait(800); await route.continue().catch(() => {}); });
      await p.evaluate(() => { const r = document.querySelector('[data-resend]'); r.click(); r.click(); });
      await p.waitForFunction(() => !document.querySelector('.bot-pending, .bot-failed-send') && document.getElementById('main').innerText.includes('second message'), null, { timeout: 20000, polling: 200 });
      await wait(1500);
      assert.equal(operatorCopies(b, id, 'second message'), 1, 'Resend tapped twice stored the message twice');
      assert.equal(calls, 1, `Resend tapped twice sent ${calls} requests`);

      // 3. While a send is slow the message says it is still sending, then joins the chat once.
      await p.unroute('**/api/bot/send');
      await p.route('**/api/bot/send', async (route) => { await wait(3000); await route.continue().catch(() => {}); });
      await send('third message');
      await p.waitForSelector('.bot-pending .pending-delivery', { timeout: 5000 });
      assert.match(await p.locator('.bot-pending .pending-delivery').innerText(), /Sending|שולח/);
      await p.waitForFunction(() => !document.querySelector('.bot-pending'), null, { timeout: 20000, polling: 200 });
      assert.equal(operatorCopies(b, id, 'third message'), 1);
      await p.screenshot({ path: path.join(os.tmpdir(), `bot-send-once-${label}.png`) });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); b.stop(); }
  });
}
