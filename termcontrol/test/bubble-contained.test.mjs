// Noam 2026-10-20: "לא רוצה שאלמנטים יצאו מחוץ לבועה" — list numbers, code and long lines stayed outside the message bubble.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
// The exact reply from his picture: list item 1 reads as English (command words), item 2 as Hebrew.
const REAL = "טוב, הנה המצב המלא:\n\n**הדיסק sdb הוא WD Blue SA510 SSD בנפח 4TB** — זה הדיסק הראשי שלך (/, /home, /media/endlessblink/data). בבוט הנוכחי אין שגיאות I/O עליו, מה שאומר שהשגיאות מהקפיאה היו כנראה תוצאה של ה-swap thrashing ולא סימן לדיסק גוסס. עדיין, כדאי להריץ בדיקת SMART מלאה — זה דורש sudo, אז תצטרך להריץ `sudo smartctl -a /dev/sdb` בטרמינל.\n\n**מה עשיתי למניעה:**\n\nearlyoom מוגדר עם `-r 3600 -n` — בלי הרשאות SIGKILL יעילות ובלי שליחת הודעות D-Bus. הבעיה שראינו היא ש-earlyoom ניסה להרוג את ffmpeg שלוש פעמים ונכשל כי התהליך היה תקוע על I/O. שני שיפורים שאפשר לעשות:\n\n1. **להגביל ffmpeg עם systemd-run או ulimit** כשאתה מריץ עיבוד כבד — למשל `systemd-run --scope -p MemoryMax=30G ffmpeg ...`\n2. **לשפר את earlyoom** — להוסיף `-g` כדי שישתמש ב-SIGKILL מהר יותר במקום לחכות\n\nרוצה שאיישם את שני השינויים?";
const REPLY = [
  REAL,
  'טוב, הנה המצב המלא:',
  'מה עשיתי למניעה:',
  '1. **להגביל ffmpeg עם systemd-run או ulimit** — למשל `systemd-run --scope -p MemoryMax=30G ffmpeg ...`',
  '2. **לשפר את earlyoom** — להוסיף `-g` כדי שישתמש ב-SIGKILL מהר יותר',
  '- a bullet with `aVeryLongInlineCodeTokenWithoutAnySpacesThatKeepsGoingAndGoingAndGoingAndGoingAndGoing1234567890`',
  'https://example.test/' + 'a'.repeat(240),
  '```',
  'sudo smartctl -a /dev/sdb && ' + 'x'.repeat(300),
  '```',
].join('\n');
test('nothing in a message leaves its bubble: list numbers, inline code, code blocks, long lines', { timeout: 90000 }, async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bubble-'));
const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
const browser = await chromium.launch();
try {
  for (const width of [1600, 390]) {
    const p = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/');
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => { const r = await fetch('/api/bots'); const have = (await r.json()).bots.find((b) => b.name === 'Bubble test'); if (have) return have.id; const c = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bubble test' }) }); return (await c.json()).bot.id; });
    await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.messages = [...j.messages, { id: 'm1', role: 'bot', text: REPLY, at: Date.now() }]; await route.fulfill({ response: r, json: j }); });
    await p.goto(base + '/#bot:' + id);
    await p.waitForFunction(() => document.querySelector('main .msg.assistant .bubble li'), null, { timeout: 15000, polling: 250 });
    const out = await p.evaluate(() => {
      const bad = [];
      for (const bubble of document.querySelectorAll('main .msg .bubble')) {
        const b = bubble.getBoundingClientRect();
        for (const el of bubble.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (!r.width) continue;
          if (r.left < b.left - 1 || r.right > b.right + 1) bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)} in ${Math.round(b.left)}-${Math.round(b.right)}`);
          // a list number sits in the item's start margin: it needs room inside the bubble on that side
          if (el.tagName === 'LI') { const rtl = getComputedStyle(el).direction === 'rtl'; const room = rtl ? b.right - r.right : r.left - b.left; if (room < 20) bad.push(`LI number has ${Math.round(room)}px (${rtl ? 'rtl' : 'ltr'})`); }
        }
      }
      return { bad, pageScroll: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.deepEqual(out, { bad: [], pageScroll: false }, `width ${width}: ${JSON.stringify(out)}`);
    if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-bubble-${width}.png` });
    assert.deepEqual(errors, []);
  }
} finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
