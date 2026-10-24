// Noam 2026-10-24: "אני חייב חייב חייב חייב שתמיד יהיה לינק עם אופציות!!!!!!!" / "בכל שיחה שהיא",
// and "אין שום סיבה לחזרה הזו!!!!". A real bridge (own config folder) and a throwaway bot whose
// chat holds a choice with links, a card it took back and a repeated reply; checked at phone
// size (Chromium) and PC size (WebKit, the PC app's engine): the links are there and open the
// page, the old card says no longer needed with its buttons off, the repeat shows once.
// TC_LINKS_SHOTS=<folder> saves the screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(browserType, viewport, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-links-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home'), looks = path.join(tmp, 'looks');
  for (const d of [configDir, botsHome, looks]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(looks, 'compare.html'), '<!doctype html><title>Three looks</title><h1>Three looks side by side</h1><img src="a.svg" alt="Look A">');
  fs.writeFileSync(path.join(looks, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e8a33d"/></svg>');
  const port = 7900 + Math.floor(Math.random() * 600), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await browserType.launch();
  try {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    if (browserType === webkit) {
      const r = await fetch(base + '/setup', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams({ email: 'owner@example.test', password: 'a-good-password', confirm: 'a-good-password' }) });
      const m = /^([^=;\s]+)=([^;]*)/.exec(r.headers.get('set-cookie') || '');
      assert.ok(m, `setup gave a session (status ${r.status})`);
      await ctx.addCookies([{ name: m[1], value: m[2], url: base }]);
    }
    await p.goto(base + '/');
    if (browserType !== webkit) await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Links check' }) }); return (await r.json()).bot.id; });
    // What the bridge stores after a bot asks with links (the same parse as a live reply).
    const { parseQuestion } = await import('../bridge/bot-questions.mjs');
    const was = process.env.TC_CONFIG_DIR; process.env.TC_CONFIG_DIR = configDir;   // the bridge's own link key
    const asked = parseQuestion(`The three looks are ready.\n\n[question]\nWhich of the three looks do you want for the app?\nlink: ${path.join(looks, 'compare.html')}\n- Look A | https://example.com/look-a (recommended)\n- Look B | https://example.com/look-b\n- Look C | https://example.com/look-c\n[/question]`);
    assert.match(asked.question.link, /^\/view\//);
    if (was === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = was;
    const t0 = Date.now() - 60_000, same = 'Got it. The current colors stay in light mode, and the changes are only to the structure, spacing, button separation and amount of text.';
    const lines = [
      { id: 'o1', role: 'operator', text: 'show me the looks', at: t0 },
      { id: 'q0', role: 'bot', text: '', question: { text: 'Which of the two old looks?', options: ['Old A', 'Old B'] }, at: t0 + 1000 },
      { id: 'b0', role: 'bot', text: 'New looks are coming. Until then, ignore the question above.', at: t0 + 2000 },
      { id: 'b1', role: 'bot', text: same, at: t0 + 3000 },
      { id: 'b2', role: 'bot', text: same.replace('Got it.', 'Got it:'), duplicate: true, at: t0 + 4000 },
      { id: 'q1', role: 'bot', text: asked.text, question: asked.question, at: t0 + 5000 },
    ];
    fs.appendFileSync(path.join(configDir, 'bots', id, 'chat.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await p.goto(base + '/#bot:' + id);
    await p.waitForSelector('.bot-question[data-qid="q1"] a.bot-q-link', { timeout: 15000 });
    await wait(300);
    const seen = await p.evaluate(() => {
      const card = document.querySelector('.bot-question[data-qid="q1"]'), old = document.querySelector('.bot-question[data-qid="q0"]');
      const r = (el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height }; };
      return {
        top: card.querySelector('a.bot-q-link').textContent.trim(), topHref: card.querySelector('a.bot-q-link').getAttribute('href'),
        per: [...card.querySelectorAll('a.bot-q-optlink')].map((a) => a.getAttribute('href')), perSize: [...card.querySelectorAll('a.bot-q-optlink')].map(r),
        live: [...card.querySelectorAll('[data-answer]')].every((b) => !b.disabled),
        oldGone: old?.classList.contains('withdrawn'), oldNote: old?.querySelector('.bot-q-gone')?.textContent || '', oldOff: [...(old?.querySelectorAll('[data-answer]') || [])].every((b) => b.disabled),
        repeats: [...document.querySelectorAll('.bot-feed .msg')].filter((m) => /current colors stay in light mode/.test(m.textContent)).length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    if (process.env.TC_LINKS_SHOTS) {
      fs.mkdirSync(process.env.TC_LINKS_SHOTS, { recursive: true });
      await p.evaluate(() => document.querySelector('.bot-question[data-qid="q0"]').scrollIntoView({ block: 'start' }));
      await p.screenshot({ path: path.join(process.env.TC_LINKS_SHOTS, `${label}-chat.png`) });
    }
    assert.match(seen.top, /Open to compare/);
    assert.deepEqual(seen.per, ['https://example.com/look-a', 'https://example.com/look-b', 'https://example.com/look-c']);
    for (const s of seen.perSize) assert.ok(s.h >= 44, 'each answer\'s Open link is big enough to tap');
    assert.equal(seen.live, true);
    assert.equal(seen.oldGone, true);
    assert.match(seen.oldNote, /No longer needed/);
    assert.equal(seen.oldOff, true);
    assert.equal(seen.repeats, 1, 'the repeated reply shows once');
    assert.equal(seen.overflow, false, 'nothing sticks out sideways');
    // Tapping "Open to compare" opens the page from the PC, pictures included.
    const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('.bot-question[data-qid="q1"] a.bot-q-link')]);
    await tab.waitForLoadState('load');
    assert.equal(await tab.locator('h1').textContent(), 'Three looks side by side');
    assert.equal(await tab.evaluate(() => document.querySelector('img').naturalWidth), 40);
    if (process.env.TC_LINKS_SHOTS) await tab.screenshot({ path: path.join(process.env.TC_LINKS_SHOTS, `${label}-opened-page.png`) });
    // The page runs sandboxed: it cannot act as Noam on the app.
    const status = await tab.evaluate(async () => { try { return (await fetch('/api/bots')).status; } catch { return 'blocked'; } });
    assert.notEqual(status, 200);
    assert.deepEqual(errors, []);
    // The throwaway bot is deleted again.
    const gone = await p.evaluate(async (botId) => (await fetch('/api/bot/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId }) })).status, id);
    assert.equal(gone, 200);
  } finally {
    await browser.close();
    child.kill();
  }
}

test('phone size: the choice has working links, the old card is no longer needed, the repeat shows once', { timeout: 90_000 }, () => check(chromium, { width: 390, height: 844 }, 'phone'));
test('PC size (the PC app engine): the same', { timeout: 90_000 }, () => check(webkit, { width: 1280, height: 860 }, 'pc'));
