// Noam 2026-10-20: "I want the agents to show when there is an unread message. The grey dot
// next to them doesn't help at all." Each bot counts its replies since its chat was last open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-unread-'));
function readyComputer() {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const socket = path.join(home, 'daemon.sock');
  fs.writeFileSync(socket, '');
  return { home, socket };
}
const settle = async (bots, id) => { for (let i = 0; i < 200 && bots.running.has(id); i++) await new Promise((r) => setTimeout(r, 5)); };
const unreadOf = (bots, id) => bots.list().find((b) => b.id === id).unread;

test('replies after the chat was last open count as unread; opening the chat clears them', async () => {
  let clock = 1_000_000;
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), now: () => clock, run: async (bot, text) => ({ text: `Answer to: ${text}` }) });
  const { bot } = bots.create({ name: 'Counter', cwd: os.tmpdir() });
  // A bot nobody has opened yet starts with nothing unread (no flood on first launch).
  assert.equal(unreadOf(bots, bot.id), 0);

  clock += 10_000; bots.send(bot.id, 'first'); await settle(bots, bot.id);
  clock += 10_000; bots.send(bot.id, 'second'); await settle(bots, bot.id);
  // Two bot replies; Noam's own messages never count.
  assert.equal(unreadOf(bots, bot.id), 2);

  clock += 10_000; bots.markRead(bot.id);
  assert.equal(unreadOf(bots, bot.id), 0);

  clock += 10_000; bots.send(bot.id, 'third'); await settle(bots, bot.id);
  assert.equal(unreadOf(bots, bot.id), 1);
});

test('a failed reply also counts as unread, system notes and activity do not', async () => {
  let clock = 2_000_000;
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), now: () => clock, run: async () => ({ error: 'brain down' }) });
  const { bot } = bots.create({ name: 'Failing', cwd: os.tmpdir() });
  assert.equal(unreadOf(bots, bot.id), 0);
  clock += 10_000;
  bots.append(bot.id, { role: 'system', text: 'Renamed.' });
  bots.append(bot.id, { role: 'activity', text: 'Reading files' });
  assert.equal(unreadOf(bots, bot.id), 0);
  bots.send(bot.id, 'hello'); await settle(bots, bot.id);
  assert.ok(unreadOf(bots, bot.id) >= 1);
});

test('the read mark lives in its own file and survives a restart', async () => {
  let clock = 3_000_000;
  const dir = tmp(), checks = readyComputer();
  const first = new Bots({ checks, dir, now: () => clock, run: async () => ({ text: 'ok' }) });
  const { bot } = first.create({ name: 'Durable', cwd: os.tmpdir() });
  first.list();
  clock += 10_000; first.send(bot.id, 'hi'); await settle(first, bot.id);
  assert.equal(unreadOf(first, bot.id), 1);
  assert.ok(fs.existsSync(path.join(dir, bot.id, 'read.json')));
  const again = new Bots({ checks, dir, now: () => clock, run: async () => ({ text: 'ok' }) });
  assert.equal(unreadOf(again, bot.id), 1);
  assert.equal(again.markRead('000000000000'), 0);
});

test('the bot list shows the unread number instead of the grey dot; opening the chat clears it', { timeout: 90000 }, async () => {
  const { chromium, devices } = await import('playwright');
  const { spawn } = await import('node:child_process');
  const root = tmp(), configDir = path.join(root, 'cfg'), botsHome = path.join(root, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Badge test' }) })).json()).bot.id);
    await p.evaluate(async () => fetch('/api/bots'));   // first look: nothing unread yet
    await wait(20);
    const chat = path.join(configDir, 'bots', id, 'chat.jsonl');
    for (const text of ['One', 'Two', 'Three']) fs.appendFileSync(chat, JSON.stringify({ id: Math.random().toString(16).slice(2, 14), at: Date.now(), role: 'bot', text }) + '\n');
    await p.goto(base + '/');
    await p.waitForSelector(`.bot-row.unread[data-bot="${id}"] .bot-unread`, { timeout: 15000 });
    assert.equal(await p.locator(`.bot-row[data-bot="${id}"] .bot-unread`).innerText(), '3');
    assert.equal(await p.locator('.bot-row .bot-health').count(), 0, 'the grey health dot is gone');
    await p.locator(`.bot-row[data-bot="${id}"]`).click();
    await p.waitForSelector('.bot-composer', { timeout: 10000 });
    await wait(1200);
    const left = await p.evaluate(async (bid) => (await (await fetch('/api/bots')).json()).bots.find((b) => b.id === bid).unread, id);
    assert.equal(left, 0);
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); }
});
