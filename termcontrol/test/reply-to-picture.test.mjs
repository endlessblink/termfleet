// Noam 2026-10-24: "צריך להיות מסוגל להגיב על תמונה". A picture or video in a bot's message has
// its own Reply (button, long press, right-click); the reply shows the picture as a thumbnail
// above the box and in his sent message, and the bot is told exactly which picture he means.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Bots } from '../bridge/bots.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PIC = 'https://example.test/review/anim-pager-2x.gif';

test('the bridge ties a reply to one picture, even in a message with no text, and tells the bot which', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-picreply-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const prompts = [];
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-picreply-bots-')), notify: () => {}, run: async (_r, text) => { prompts.push(String(text || '')); return { text: 'Noted.' }; }, fill: () => null });
  const { bot } = bots.create({ name: 'Painter', cwd: os.tmpdir() });
  const shown = bots.append(bot.id, { role: 'bot', text: '', media: [{ kind: 'image', href: PIC, name: 'anim-pager-2x.gif' }] });
  const r = bots.send(bot.id, 'make the pager bigger', { owner: true, replyTo: shown.id, replyMedia: PIC });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.message.replyTo, { id: shown.id, role: 'bot', text: '', media: { kind: 'image', href: PIC, name: 'anim-pager-2x.gif' } });
  for (let i = 0; i < 400 && bots.running.has(bot.id); i++) await wait(5);
  assert.match(prompts.at(-1), /replying to your picture "anim-pager-2x\.gif" \(https:\/\/example\.test\/review\/anim-pager-2x\.gif\)[\s\S]*about that picture[\s\S]*make the pager bigger/);
  assert.match(bots.send(bot.id, 'x', { owner: true, replyTo: shown.id, replyMedia: 'https://example.test/other.png' }).error, /That picture is no longer in this chat/);
});

test('in the app: reply to a picture, thumbnail above the box and in the sent message, on phone and PC', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-picreply-ui-'));
  const cfg = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [cfg, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7300 + Math.floor(Math.random() * 300);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: cfg, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
    let first = true;
    for (const phone of [true, false]) {
      const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.route('https://example.test/**', (route) => route.fulfill({ body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'), contentType: 'image/gif' }));
      await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
      await p.goto(`http://localhost:${port}/`);
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; const c = document.querySelector('#confirm'); if (c) c.value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000 });
      let botId;
      if (first) {
        botId = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Painter' }) })).json()).bot.id);
        fs.appendFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), JSON.stringify({ id: 'pic1', at: Date.now(), role: 'bot', text: 'Here is the pager animation.', media: [{ kind: 'image', href: PIC, name: 'anim-pager-2x.gif' }] }) + '\n');
        first = false;
      } else botId = fs.readdirSync(path.join(cfg, 'bots')).find((d) => fs.statSync(path.join(cfg, 'bots', d)).isDirectory());
      await p.evaluate((id) => { location.hash = 'bot:' + id; }, botId);
      await p.waitForSelector('.bot-media-cell img');
      if (phone) await p.locator('.media-reply').first().tap(); else { await p.locator('.bot-media-cell').first().hover(); await p.locator('.media-reply').first().click(); }
      await p.waitForSelector('.reply-preview:not([hidden]) .reply-thumb img');
      assert.match(await p.locator('.reply-preview').innerText(), /Replying to[\s\S]*Picture · anim-pager-2x\.gif/);
      const words = phone ? 'make it loop slower' : 'bigger pager please';
      await p.locator('.composer textarea').fill(words);
      await p.locator('.composer button.send').first().click();
      await p.waitForSelector('.reply-of.with-thumb img');
      for (let i = 0; i < 60; i++) { if (fs.readFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), 'utf8').includes(words)) break; await wait(150); }
      const sent = fs.readFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.role === 'operator' && m.text === words).pop();
      assert.equal(sent?.replyTo?.media?.href, PIC, 'stored as a reply to that picture');
      await p.screenshot({ path: path.join(os.tmpdir(), `reply-to-picture-${phone ? 'phone' : 'pc'}.png`) });
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); bridge.kill('SIGKILL'); }
});
