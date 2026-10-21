// Noam 2026-10-21 (ideas from Xiryn): each bot browses in its own window; he can take a
// bot's window over from the phone and hand it back with a note the bot continues from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotBrowser } from '../bridge/bot-browser.mjs';
import { startWindowProxy, setTakeover, readTakeover } from '../bridge/bot-windows.mjs';

const repo = path.resolve('.');
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((b) => fs.existsSync(b));

/** Opens a page for a bot through its own window go-between, the way its tools do. */
async function botOpens(proxyPort, url) {
  const v = await (await fetch(`http://127.0.0.1:${proxyPort}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); wait.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const made = await send('Target.createTarget', { url });
  return { targetId: made.result.targetId, close: () => ws.close() };
}

test('the phone shows each bot\'s window; take over, then hand back with a note the bot receives', { skip: !chrome && 'no Chrome on this machine', timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bwphone-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home'), state = path.join(tmp, 'state');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const cdpPort = 19900 + Math.floor(Math.random() * 90);
  const chromeBrowser = new BotBrowser({ port: cdpPort, profile: path.join(tmp, 'profile'), headless: true, binary: chrome, windowsDir: state });
  assert.ok((await chromeBrowser.start()).ok);
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_BOT_BROWSER_PORT: String(cdpPort), TC_BOT_WINDOWS_DIR: state }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  const opened = [], proxies = [];
  try {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const make = (name) => p.evaluate(async (n) => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) }); return (await r.json()).bot.id; }, name);
    const scout = await make('Scout'), clerk = await make('Clerk');
    // Both bots browse at once, each in its own window.
    for (const [id, name, url] of [[scout, 'Scout', 'data:text/html,<title>Scout page</title><h1>Sign in to continue</h1>'], [clerk, 'Clerk', 'data:text/html,<title>Clerk page</title><h1>Invoices</h1>']]) {
      const proxy = await startWindowProxy({ botId: id, botName: name, upstreamPort: cdpPort, dir: state });
      proxies.push(proxy);
      opened.push(await botOpens(proxy.port, url));
    }
    // Scout needs Noam for a step.
    setTakeover(scout, { ask: 'Sign in to the site, then hand it back', by: 'bot' }, state);
    await p.goto(base + '/#bot:' + clerk);
    await p.waitForFunction(() => document.querySelector('.bot-browser'), null, { timeout: 15000, polling: 250 });
    await p.evaluate(() => { document.querySelector('.bot-more').open = true; document.querySelector('.bot-browser').click(); });
    await p.waitForFunction(() => document.querySelector('.bw-state')?.textContent.includes('Sign in to the site'), null, { timeout: 15000, polling: 250 });
    assert.deepEqual(await p.$$eval('.bw-tab', (b) => b.map((x) => x.textContent).sort()), ['Clerk', 'Scout']);
    await p.waitForFunction(() => document.querySelector('.browser-shot')?.naturalWidth > 0, null, { timeout: 10000, polling: 250 });
    if (process.env.TC_SHOT_DIR) await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, 'phone-bot-asks.png') });
    // Hand back with a note: the bot receives it as a message.
    await p.fill('.bw-note', 'I logged in');
    await p.click('.bw-handback');
    await p.waitForFunction(() => document.querySelector('.bw-takeover'), null, { timeout: 10000, polling: 250 });
    assert.equal(readTakeover(scout, state), null, 'Scout has its window back');
    const view = await p.evaluate(async (id) => (await (await fetch('/api/bot?id=' + id)).json()), scout);
    assert.ok(JSON.stringify(view).includes('His note: \\"I logged in\\"'), 'the note reached Scout');
    // Take over Clerk's window from the phone.
    await p.click('.bw-tab:has-text("Clerk")');
    await p.waitForFunction(() => document.querySelector('.bw-state')?.textContent.includes('Clerk is using'), null, { timeout: 10000, polling: 250 });
    await p.click('.bw-takeover');
    await p.waitForFunction(() => document.querySelector('.bw-state')?.textContent.includes('You have'), null, { timeout: 10000, polling: 250 });
    assert.equal(readTakeover(clerk, state)?.by, 'noam');
    await p.waitForFunction(() => document.querySelector('.browser-shot')?.naturalWidth > 0, null, { timeout: 10000, polling: 250 });
    if (process.env.TC_SHOT_DIR) await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, 'phone-noam-has-it.png') });
    assert.deepEqual(errors, []);
  } finally {
    for (const o of opened) o.close();
    for (const x of proxies) await x.close().catch(() => {});
    await browser.close(); child.kill('SIGKILL');
    try { const v = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; }); ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch { /* closed */ }
    await wait(500);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
