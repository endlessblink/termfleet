// Noam 2026-10-24: "צריך להיות מסוגל להגיב גם על אלמנט כזה" (after "צריך להיות מסוגל להגיב על תמונה").
// A bot's checklist card and question card have their own Reply, like a picture: an arrow in the
// card's corner, or a long press / right-click on the card. The quote names the card, and the
// bridge accepts a card as a reply target even when its message has no text of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('reply to a checklist card and to a question card, on phone and PC', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cardreply-'));
  const cfg = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [cfg, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7300 + Math.floor(Math.random() * 300);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: cfg, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
    let botId = null;
    for (const phone of [true, false]) {
      const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
      await p.goto(`http://localhost:${port}/`);
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000 });
      if (!botId) {
        botId = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Agent-Manager' }) })).json()).bot.id);
        const cards = [
          { id: 'list1', at: Date.now(), role: 'bot', text: '', checklist: { title: 'Which screens to fix first', rows: [{ label: 'Login', detail: [], checked: false }, { label: 'Menu', detail: [], checked: false }] } },
          { id: 'q1', at: Date.now() + 1, role: 'bot', text: '', question: { text: 'Which format?', options: ['Short', 'Long'] } },
        ];
        fs.appendFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
      }
      await p.evaluate((id) => { location.hash = 'bot:' + id; }, botId);
      await p.waitForSelector('[data-card-reply="list1"] .card-reply');
      await p.waitForSelector('[data-card-reply="q1"] .card-reply');
      for (const [card, title, words] of [['list1', /List: Which screens to fix first/, phone ? 'do Login first' : 'skip Menu'], ['q1', /Question: Which format\?/, phone ? 'neither, a table' : 'Short but with links']]) {
        if (phone) await p.locator(`[data-card-reply="${card}"] .card-reply`).tap(); else await p.locator(`[data-card-reply="${card}"]`).click({ button: 'right', position: { x: 20, y: 12 } });
        await p.waitForSelector('.reply-preview:not([hidden])');
        assert.match(await p.locator('.reply-preview').innerText(), title);
        await p.locator('.composer textarea').fill(words);
        await p.locator('.composer button.send').first().click();
        let sent = null;
        for (let i = 0; i < 60 && !sent; i++) { sent = fs.readFileSync(path.join(cfg, 'bots', botId, 'chat.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.role === 'operator' && m.text === words); if (!sent) await wait(150); }
        assert.ok(sent, `the reply "${words}" was sent`);
        assert.equal(sent.replyTo?.id, card, 'tied to that card');
        assert.match(sent.replyTo?.text || '', title);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); bridge.kill('SIGKILL'); }
});
