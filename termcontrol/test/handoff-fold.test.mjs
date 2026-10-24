// Noam 2026-10-24: "הודעות סתם חוזרות על עצמן וממלאות את המסך". A bot sent one message to six
// politic-fighter terminals 4 s apart; each hand-off is recorded once, and the chat showed the same
// line six times. Back-to-back hand-offs with the same words now show once, with a count.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the same hand-off to several terminals in a row shows once, with how many terminals', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-handoff-'));
  const cfg = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [cfg, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7300 + Math.floor(Math.random() * 300);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: cfg, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000 });
    const botId = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'politic-figther_dev' }) })).json()).bot.id);
    const words = 'Noam (his words attached): why do we stop every time instead of continuing?';
    const lines = [1, 2, 3].map((n) => ({ id: `h${n}`, at: Date.now() + n, role: 'handoff', pane: `terminal-${n}`, to: 'politic-fighter', text: words }));
    lines.push({ id: 'h4', at: Date.now() + 9, role: 'handoff', pane: 'terminal-9', to: 'politic-fighter', text: 'A different task.' });
    fs.appendFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await p.evaluate((id) => { location.hash = 'bot:' + id; }, botId);
    await p.waitForSelector('.bot-handoff');
    const shown = await p.locator('.bot-handoff').allInnerTexts();
    assert.equal(shown.length, 2, JSON.stringify(shown));
    assert.match(shown[0], /Handed to politic-fighter \(3 terminals\): Noam \(his words attached\): why do we stop every time/);
    assert.match(shown[1], /Handed to politic-fighter: A different task\./);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); bridge.kill('SIGKILL'); }
});
