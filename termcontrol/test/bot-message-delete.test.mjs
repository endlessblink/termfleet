// Noam 2026-10-25: "צריך שתהיה אפשרות לעצור הודעה מוסימת אם בטעות מקלידים טעות או משהו שרוצים
// למחוק". His own message in a bot chat can be deleted from its menu (right-click or long press
// opens it). Still waiting in line: it is pulled out and the bot never sees it. Already with the
// bot: the turn finishes; the chat shows only that it was deleted, never the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-delete-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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

test('a message still waiting in line is pulled out: the bot never sees it', async () => {
  const seen = [];
  let finish;
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), run: async (bot, text) => { seen.push(text); if (seen.length === 1) await new Promise((r) => { finish = r; }); return { text: 'ok' }; } });
  const { bot } = bots.create({ name: 'Eraser', cwd: os.tmpdir() });
  bots.send(bot.id, 'first message');
  for (let i = 0; i < 100 && !finish; i++) await wait(5);
  const typo = bots.send(bot.id, 'oops, sent by mistake');
  assert.equal(typo.queued, true);
  const res = bots.retract(bot.id, typo.message.id);
  assert.equal(res.ok, true);
  assert.equal(res.cancelled, true);
  finish();
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  await wait(20);
  assert.equal(seen.length, 1, 'no second turn was started for the deleted message');
  assert.ok(!seen.join('\n').includes('sent by mistake'));
  const gone = bots.messages(bot.id).find((m) => m.id === typo.message.id);
  assert.equal(gone.deleted.cancelled, true);
  assert.equal(gone.text, undefined, 'the words are not kept');
  assert.ok(!fs.readFileSync(path.join(bots.folder(bot.id), 'chat.jsonl'), 'utf8').includes('sent by mistake'));
});

test('a message the bot already took stays with the running turn; the chat only marks it deleted', async () => {
  let finish;
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), run: async () => { await new Promise((r) => { finish = r; }); return { text: 'done' }; } });
  const { bot } = bots.create({ name: 'Eraser', cwd: os.tmpdir() });
  const sent = bots.send(bot.id, 'please do the thing');
  for (let i = 0; i < 100 && !finish; i++) await wait(5);
  const res = bots.retract(bot.id, sent.message.id);
  assert.equal(res.ok, true);
  assert.equal(res.cancelled, false);
  assert.equal(bots.running.has(bot.id), true, 'the turn keeps running');
  finish();
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  const chat = bots.messages(bot.id);
  assert.equal(chat.find((m) => m.id === sent.message.id).deleted.cancelled, false);
  assert.ok(chat.some((m) => m.role === 'bot' && m.text === 'done'));
  // A second delete is harmless; only his own messages can be deleted.
  assert.equal(bots.retract(bot.id, sent.message.id).repeated, true);
  const reply = chat.find((m) => m.role === 'bot');
  assert.match(bots.retract(bot.id, reply.id).error, /not one of yours/);
  assert.match(bots.retract(bot.id, 'nope').error, /not one of yours/);
});

test('a message waiting for the quick side answer is dropped, and never handed on afterwards', async () => {
  let finish;
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), run: async () => { await new Promise((r) => { finish = r; }); return { text: 'done' }; } });
  bots.side = () => new Promise(() => {});   // the side answer never comes back
  const { bot } = bots.create({ name: 'Eraser', cwd: os.tmpdir() });
  bots.send(bot.id, 'start');
  for (let i = 0; i < 100 && !finish; i++) await wait(5);
  const mid = bots.send(bot.id, 'wrong words mid-turn', { owner: false });
  const res = bots.retract(bot.id, mid.message.id);
  assert.equal(res.ok, true);
  // Whatever the side path does next, a deleted message is not handed on.
  bots.handOn(bot.id, { msgId: mid.message.id, text: 'wrong words mid-turn' }, null);
  assert.equal((bots.queues.get(bot.id) || []).some((t) => t.includes('wrong words')), false);
  finish();
});

test('phone: a long press on his own message opens Delete; two taps delete it and the chat says so', { timeout: 180000 }, async () => {
  const dir = tmp();
  const configDir = path.join(dir, 'cfg'), botsHome = path.join(dir, 'home'), log = path.join(dir, 'brain.log');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const fake = path.join(dir, 'fake-claude.cjs');
  // Every turn the "brain" gets is logged; each turn takes 6 s, so a second message waits in line.
  fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('fs');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(log)},process.argv.join(' ')+'\\n'+input+'\\n---\\n');setTimeout(()=>{console.log(JSON.stringify({type:"system",subtype:"init",session_id:"11111111-1111-4111-8111-111111111111"}));console.log(JSON.stringify({type:"result",subtype:"success",result:"Working on it"}));},6000);});\n`, { mode: 0o755 });
  const port = 7600 + Math.floor(Math.random() * 90);
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_CLAUDE_BIN: fake, TC_DESK_STT: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Delete test' }) })).json()).bot.id);
    await p.goto(`http://localhost:${port}/#bot:${id}`);
    await p.waitForFunction(() => document.querySelector('.bot-composer textarea'), null, { timeout: 10000, polling: 250 });
    const send = (text) => p.evaluate(async ([botId, t]) => (await (await fetch('/api/bot/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId, text: t }) })).json()).message.id, [id, text]);
    await send('first real request');
    const typoId = await send('טעות הקלדה שלא רציתי לשלוח');
    await p.waitForFunction((mid) => document.querySelector(`.msg.user[data-mid="${mid}"]`), typoId, { timeout: 10000, polling: 250 });
    // A long press on the bubble opens its menu with Delete.
    const box = await p.locator(`.msg.user[data-mid="${typoId}"] .bubble`).boundingBox();
    const cdp = await ctx.newCDPSession(p);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await wait(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction((mid) => document.querySelector(`.msg.user[data-mid="${mid}"] .message-menu[open] .delete-message`), typoId, { timeout: 5000, polling: 100 });
    await p.screenshot({ path: path.join(os.tmpdir(), 'tc-delete-menu.png') });
    const del = p.locator(`.msg.user[data-mid="${typoId}"] .delete-message`);
    await del.click();
    assert.match(await del.innerText(), /לחיצה נוספת למחיקה/, 'the first tap only asks to confirm');
    await del.click();
    await p.waitForFunction((mid) => document.querySelector(`.msg-deleted[data-mid="${mid}"]`), typoId, { timeout: 10000, polling: 250 });
    assert.match(await p.locator(`.msg-deleted[data-mid="${typoId}"]`).innerText(), /הבוט לא ראה אותה/);
    assert.equal(await p.evaluate(() => document.querySelector('main').textContent.includes('טעות הקלדה')), false);
    await p.screenshot({ path: path.join(os.tmpdir(), 'tc-delete-done.png') });
    // The first turn ends; the deleted message never starts a turn of its own.
    await wait(14000);
    const brain = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.match(brain, /first real request/);
    // Only the quick side responder (which answers while the bot works) read it; the working bot never did.
    const turns = brain.split('\n---\n').filter((t) => t.includes('טעות הקלדה'));
    assert.ok(turns.every((t) => t.includes('quick side responder')), 'the working bot never saw the deleted message');
    assert.equal(await p.evaluate(() => document.querySelectorAll('.side-reply-tag').length), 0, 'no quick answer to a deleted message');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
