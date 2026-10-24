// Noam 2026-10-24: "המספר למעלה מיותר כרגע כי הוא לא משקף כלום", "למעלה מצד ימין", then "כדאי
// אולי שזה יספור משימות שאני נותן ואתה עושה ומסיים באמת ומה נשאר פתוח", "עד עכשיו זה היה סתם 0 כל
// הזמן". The bot chat header counted only what he had confirmed (0/24 while 24 were finished and
// waiting for him to try). It now reads "X done · Y open": done is what the agent finished (done or
// ready to try), open is what is still in progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (n, status) => ({ n, text: `request ${n}`, title: `request ${n}`, status, note: '' });

test('the bot header counts what the agent finished and what is still open, never a stuck 0', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-count-'));
  const cfg = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [cfg, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7300 + Math.floor(Math.random() * 300);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: cfg, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
    let asks = [];
    const read = async (list) => {
      asks = list;
      const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: state })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.route(/\/api\/bot\?/, async (route) => { try { const r = await route.fetch(); const view = await r.json(); await route.fulfill({ response: r, json: { ...view, asks } }); } catch { /* page closing */ } });
      await p.goto(`http://localhost:${port}/#bot:${botId}`);
      await p.waitForSelector('.bot-menu-button');
      await wait(1500);
      const head = await p.evaluate(() => { const c = document.querySelector('.bot-asks-chip'); return { hidden: c.hidden, text: c.innerText, label: c.getAttribute('aria-label') || '' }; });
      // The bot menu shows the same numbers (Noam 2026-10-24: header 18 done · 5 open, menu 0 of 25 done).
      if (!head.hidden) {
        await p.locator('.bot-menu-button').click();
        await p.waitForSelector('.bot-menu-sheet[open]');
        head.menu = await p.locator('.bot-menu-sheet').innerText();
      }
      assert.deepEqual(errors, []);
      await p.context().close();
      return head;
    };
    // Sign in once and make the bot.
    const first = await (await browser.newContext()).newPage();
    await first.goto(`http://localhost:${port}/`);
    await first.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await first.waitForFunction(() => document.querySelector('.fleet-tabs, .bots-home'), null, { timeout: 20000 });
    const botId = await first.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Agent-Manager' }) })).json()).bot.id);
    const state = await first.context().storageState();
    await first.context().close();

    // His screenshot: 24 finished and waiting for him to try. It read 0/24.
    const allReady = await read(Array.from({ length: 24 }, (_, i) => ask(i + 1, 'ready')));
    assert.equal(allReady.hidden, false);
    assert.equal(allReady.text, '24 done · 0 open');
    assert.match(allReady.label, /24 done · 0 open \(24 ready for you to try\)/);
    // A mix: confirmed, ready, in progress, partly done, dropped (not counted).
    const mix = await read([ask(1, 'done'), ask(2, 'ready'), ask(3, 'ready'), ask(4, 'open'), ask(5, 'partial'), ask(6, 'dropped')]);
    assert.equal(mix.text, '3 done · 2 open');
    assert.ok(allReady.menu.includes('24 done · 0 open'), `menu matches the header: ${allReady.menu.slice(0, 200)}`);
    assert.ok(mix.menu.includes('3 done · 2 open'), `menu matches the header: ${mix.menu.slice(0, 200)}`);
    assert.doesNotMatch(mix.menu, /of \d+ done/, 'no second, different count');
    // Nothing counted: no chip.
    assert.equal((await read([])).hidden, true);
  } finally { await browser.close(); bridge.kill('SIGKILL'); }
});
