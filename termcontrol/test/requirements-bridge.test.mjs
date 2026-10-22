// TF-102 end to end through a real (private) bridge: Noam types one multi-part message into a
// bot chat in the app; it lands as separate items in his words, the bot can list them, its
// hand-off is refused without naming them and carries his exact words when it does.
// The brain is /bin/false, so no model is ever called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLedger } from '../bridge/requirements.mjs';
import { findOwnerWords } from '../bridge/owner-words.mjs';

const script = (name) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url));
const run = (base, file, args, env = {}) => spawnSync(process.execPath, [script(file), ...args], { encoding: 'utf8', env: {
  ...process.env, TC_CONFIG_DIR: base, TERMFLEET_REQ_DIR: '', TERMFLEET_BOT_ID: '', TERMFLEET_BOT_NAME: '', TERMFLEET_PANE_ID: '',
  XDG_DATA_HOME: path.join(base, 'no-data'), TERMFLEET_DAEMON_SOCKET: path.join(base, 'no-daemon.sock'), ...env,
} });

const MESSAGE = 'Three things on the politic page:\n1. the title strip faces fill the whole strip\n2. the faces loop endlessly\n3. portraits keep their colours';

test('a real multi-part bot message lands as separate items, listable, and travels in his words', { timeout: 90000 }, async () => {
  const { chromium } = await import('playwright');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-req-bridge-'));
  const configDir = path.join(tmpDir, 'cfg'), botsHome = path.join(tmpDir, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7560 + Math.floor(Math.random() * 200);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TERMFLEET_REQ_DIR: '', TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
    const p = await browser.newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const botId = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'politic-figther_dev' }) })).json()).bot.id);
    await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, botId);
    const box = p.locator('.composer textarea').first();
    await box.waitFor({ timeout: 15000 });
    await box.fill(MESSAGE);
    await p.locator('.composer button.send').first().click();

    // His message, split into its parts, under the bot, keyed by his real message id.
    let items = [];
    for (let i = 0; i < 40 && items.length < 4; i++) { items = [...loadLedger({ dir: path.join(configDir, 'requirements') }).items.values()]; if (items.length < 4) await new Promise((r) => setTimeout(r, 250)); }
    const owner = findOwnerWords('latest', { botId, base: configDir });
    assert.deepEqual(items.map((it) => it.words), ['Three things on the politic page:', 'the title strip faces fill the whole strip', 'the faces loop endlessly', 'portraits keep their colours']);
    assert.ok(items.every((it) => it.source === `bot:${botId}` && it.msgId === owner.id && it.status === 'new'));

    // The bridge serves them to the phone and the desktop.
    const served = await p.evaluate(async () => (await (await fetch('/api/requirements?closed=1')).json()).items.map((it) => it.id));
    assert.deepEqual(served.sort(), ['R-1', 'R-2', 'R-3', 'R-4']);
    const view = await p.evaluate(async (bid) => (await (await fetch(`/api/bot?id=${bid}`)).json()), botId);
    assert.deepEqual((view.requirements || []).map((it) => it.id).sort(), ['R-1', 'R-2', 'R-3', 'R-4']);

    // Inside the bot: list them, look one up, and hand over.
    const env = { TERMFLEET_BOT_ID: botId, TERMFLEET_BOT_NAME: 'politic-figther_dev' };
    const listed = run(configDir, 'termfleet-asks.mjs', ['items'], env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /R-4 \[new\] "portraits keep their colours"[\s\S]*R-1 \[new\]/);
    assert.match(run(configDir, 'termfleet-asks.mjs', ['show', 'R-3'], env).stdout, /Noam's words: "the faces loop endlessly"/);
    const refused = run(configDir, 'termfleet-team.mjs', ['send', 'politic-fighter', '--dry-run', 'fix the strip'], env);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Name the items of Noam's this hand-off is for[\s\S]*R-2 "the title strip faces fill the whole strip"/);
    const brief = run(configDir, 'termfleet-team.mjs', ['send', 'politic-fighter', '--req', 'R-2,R-3', '--dry-run', 'fix the strip'], env);
    assert.equal(brief.status, 0, brief.stderr);
    assert.match(brief.stdout, /- R-2: "the title strip faces fill the whole strip"\n- R-3: "the faces loop endlessly"/);
    assert.match(brief.stdout, /\[delivery D-[0-9a-f]{8}\]/);
  } finally { await browser.close(); bridge.kill('SIGKILL'); }
});
