// Noam 2026-10-19: "the three points menu keeps closing by itself + still no way to reply".
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a message menu stays open while the chat refreshes; Reply quotes the message; Model and plan is its own row', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-menu-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const fake = path.join(tmp, 'fake-claude.cjs');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"system",subtype:"init",session_id:"11111111-1111-4111-8111-111111111111"}));\nconsole.log(JSON.stringify({type:"result",subtype:"success",result:"First answer from the bot"}));\n', { mode: 0o755 });
  const port = 7500 + Math.floor(Math.random() * 90);
  const repo = path.resolve('.');
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_CLAUDE_BIN: fake, TC_DESK_STT: '0' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Menu test' }) })).json()).bot.id);
    await p.goto(`http://localhost:${port}/#bot:${id}`);
    await p.waitForFunction(() => document.querySelector('.bot-composer textarea'), null, { timeout: 10000, polling: 250 });
    await p.evaluate(async (botId) => { await fetch('/api/bot/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId, text: 'hello' }) }); }, id);
    await p.waitForFunction(() => /First answer from the bot/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 20000, polling: 250 });
    // Open the menu on the bot's message, then let the chat change underneath it.
    await p.evaluate(() => document.querySelector('.msg.assistant .message-menu > summary').click());
    await p.evaluate(async (botId) => { await fetch('/api/bot/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId, text: 'second message' }) }); }, id);
    await wait(5000);   // several refreshes
    const during = await p.evaluate(() => ({ open: document.querySelector('.msg.assistant .message-menu')?.open, newShown: /second message/.test(document.querySelector('main').textContent) }));
    assert.deepEqual(during, { open: true, newShown: false }, 'the menu is not closed by a refresh, and nothing is redrawn under it');
    // Reply puts a quote in the box and closes the menu; the chat then catches up.
    await p.evaluate(() => { document.querySelector('.bot-composer textarea').value = 'yes'; });
    await p.evaluate(() => document.querySelector('.msg.assistant .reply-message').click());
    const box = await p.inputValue('.bot-composer textarea');
    assert.equal(box, '> First answer from the bot\n\nyes');
    await p.waitForFunction(() => /second message/.test(document.querySelector('main').textContent), null, { timeout: 8000, polling: 250 });
    // "Model and plan" is its own row and shows only the plan, model and backup.
    await p.evaluate(() => { document.querySelector('.bot-more > summary').click(); document.querySelector('.bot-more .bot-model').click(); });
    await p.waitForFunction(() => document.querySelector('.room-dialog select[name=model]'), null, { timeout: 8000, polling: 250 });
    const visible = await p.evaluate(() => [...document.querySelectorAll('.room-dialog .room-field')].filter((e) => !e.hidden).map((e) => e.className));
    assert.deepEqual(visible, ['room-field model-field']);
    assert.match(await p.evaluate(() => document.querySelector('.room-dialog h2').textContent), /Model and plan/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
