// Noam 2026-10-22: "אני רוצה להיות מסוגל להזיז ימינה ושמאלה בפלאפון כדי לעבור לסוכן הבא"
// and "אם אני חוזר אחורה מסוכן בפלאפון זה צריך לחזור לאזור שבו היה הסוכן במסך".
// A bot chat swipes to the next/previous bot in the list order (as terminal chats already do),
// keeps each bot's unsent words, and Back lands the list on the card he ended on, where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bridgePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../bridge/server.mjs');

async function startBridge(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7900 + Math.floor(Math.random() * 600);
  const child = spawn(process.execPath, [bridgePath], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  return { base: `http://localhost:${port}`, stop: () => { child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
async function signIn(p, base) {
  await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  await p.goto(base + '/');
  if (await p.$('#password')) await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
}
async function swipe(p, { dx = -150, dy = 0, x = 200, y = 330, selector = '#main' } = {}) {
  await p.evaluate(async ({ dx, dy, x, y, selector }) => {
    const el = document.querySelector(selector);
    const fire = (type, ox, oy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, clientX: x + ox, clientY: y + oy }));
    fire('pointerdown', 0, 0);
    for (const f of [0.15, 0.35, 0.6, 0.85, 1]) { fire('pointermove', dx * f, dy * f); await new Promise(requestAnimationFrame); }
    fire('pointerup', dx, dy);
  }, { dx, dy, x, y, selector });
}
const rowTop = (p, id) => p.evaluate((id) => { const r = document.querySelector(`#main .bots-list .bot-row[data-bot="${id}"]`); return r ? Math.round(r.getBoundingClientRect().top - document.querySelector('#main').getBoundingClientRect().top) : null; }, id);
const botName = (p) => p.evaluate(() => document.querySelector('#title .bot-names bdi')?.textContent || '');
const inBot = (p, id) => p.waitForFunction((id) => location.hash === '#bot:' + id && document.querySelector('.bot-composer textarea') && !document.querySelector('.chat-navigation-preview') && document.querySelector('#title .bot-names bdi'), id, { timeout: 15000 });
const backToList = async (p) => { await p.waitForFunction(() => document.querySelector('#main .bots-list'), null, { timeout: 10000 }); await wait(400); };

test('bot chats swipe between bots and Back returns the list to the card', { timeout: 180000 }, async () => {
  const bridge = await startBridge('tc-botswipe-');
  const browser = await chromium.launch();
  const shots = process.env.TC_SWIPE_SHOTS;
  try {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await signIn(p, bridge.base);
    for (let i = 1; i <= 14; i++) await p.evaluate(async (i) => { await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Bot ${String(i).padStart(2, '0')}`, job: 'Keeps things tidy' }) }); }, i);
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll('#main .bots-list .bot-row[data-bot]').length === 14, null, { timeout: 20000, polling: 250 });
    const order = await p.$$eval('#main .bots-list .bot-row[data-bot]', (els) => els.map((e) => ({ id: e.dataset.bot, name: e.querySelector('.room-name')?.textContent })));

    // Put the 9th bot in the middle of the screen, remember where it sits, open it.
    const pick = order[8];
    await p.evaluate((id) => { const m = document.querySelector('#main'), r = m.querySelector(`.bot-row[data-bot="${id}"]`); m.scrollTop += r.getBoundingClientRect().top - m.getBoundingClientRect().top - 260; }, pick.id);
    await wait(200);
    const startTop = await rowTop(p, pick.id);
    assert.ok(startTop > 150 && startTop < 400, `the picked card sits mid-screen (${startTop})`);
    if (shots) await p.screenshot({ path: path.join(shots, '1-list.png') });
    await p.click(`#main .bot-row[data-bot="${pick.id}"]`);
    await inBot(p, pick.id);
    assert.equal(await botName(p), pick.name);
    await p.fill('.bot-composer textarea', `draft for ${pick.name}`);

    // Back with no swipe: the same card returns to the same place.
    await p.click('header #nav .back');
    await backToList(p);
    assert.ok(Math.abs((await rowTop(p, pick.id)) - startTop) <= 4, `back lands on the card (${await rowTop(p, pick.id)} vs ${startTop})`);

    // Open it again; the draft is still there.
    await p.click(`#main .bot-row[data-bot="${pick.id}"]`);
    await inBot(p, pick.id);
    assert.equal(await p.inputValue('.bot-composer textarea'), `draft for ${pick.name}`);

    // Things that must NOT switch bots: short drags, vertical drags, the message box, the screen edges.
    for (const opt of [{ dx: -40 }, { dx: -150, dy: 120 }, { selector: '.bot-composer textarea' }, { x: 10, dx: 150 }, { x: 405, dx: -150 }]) {
      await swipe(p, opt); await wait(450);
      assert.equal(new URL(p.url()).hash, '#bot:' + pick.id, `no switch for ${JSON.stringify(opt)}`);
    }

    // Mid-drag: the chat follows the finger and the next bot peeks in.
    await p.evaluate(async () => {
      const el = document.querySelector('#main');
      const fire = (type, dx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, clientX: 300 + dx, clientY: 330 }));
      fire('pointerdown', 0); for (const dx of [-20, -60, -110, -160]) { fire('pointermove', dx); await new Promise(requestAnimationFrame); }
      await new Promise(requestAnimationFrame);
    });
    assert.match(await p.evaluate(() => document.querySelector('.chat-navigation-preview strong')?.textContent || ''), new RegExp(order[9].name));
    if (shots) await p.screenshot({ path: path.join(shots, '2-mid-swipe.png') });
    await p.evaluate(() => document.querySelector('#main').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, clientX: 140, clientY: 330 })));

    // Swipe left = next bot in the list (left-to-right layout).
    await inBot(p, order[9].id);
    assert.equal(await botName(p), order[9].name);
    if (shots) await p.screenshot({ path: path.join(shots, '3-next-bot.png') });
    assert.equal(await p.inputValue('.bot-composer textarea'), '', 'the next bot has its own empty message box');
    await p.fill('.bot-composer textarea', 'words for the next bot');

    // Swipe right = previous: back on the first bot, its draft intact.
    await swipe(p, { dx: 160 });
    await inBot(p, pick.id);
    assert.equal(await p.inputValue('.bot-composer textarea'), `draft for ${pick.name}`);
    await swipe(p, { dx: -160 }); await inBot(p, order[9].id);
    assert.equal(await p.inputValue('.bot-composer textarea'), 'words for the next bot');
    await swipe(p, { dx: -160 }); await inBot(p, order[10].id);
    assert.equal(await botName(p), order[10].name);

    // Back after swiping: the list shows the bot he ended on, where the first card was.
    await p.click('header #nav .back');
    await backToList(p);
    const endTop = await rowTop(p, order[10].id);
    assert.ok(Math.abs(endTop - startTop) <= 4, `back after swiping lands on the last bot (${endTop} vs ${startTop})`);
    if (shots) await p.screenshot({ path: path.join(shots, '4-back-to-list.png') });

    // The phone's own back (browser history) behaves the same.
    await p.click(`#main .bot-row[data-bot="${order[10].id}"]`); await inBot(p, order[10].id);
    await swipe(p, { dx: 160 }); await inBot(p, order[9].id);
    await p.goBack();
    await backToList(p);
    assert.ok(Math.abs((await rowTop(p, order[9].id)) - startTop) <= 4, `system back lands on the bot he ended on (${await rowTop(p, order[9].id)} vs ${startTop})`);

    // Last bot: swiping past the end stays put.
    const last = order.at(-1);
    await p.evaluate((id) => document.querySelector(`#main .bot-row[data-bot="${id}"]`).scrollIntoView({ block: 'center' }), last.id);
    await p.click(`#main .bot-row[data-bot="${last.id}"]`); await inBot(p, last.id);
    await swipe(p, { dx: -160 }); await wait(600);
    assert.equal(new URL(p.url()).hash, '#bot:' + last.id);
    assert.deepEqual(errors, []);
    await ctx.close();

    // Hebrew (right-to-left): swiping right goes to the next bot.
    const he = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' });
    const q = await he.newPage();
    await signIn(q, bridge.base);
    await q.waitForFunction(() => document.querySelectorAll('#main .bots-list .bot-row[data-bot]').length === 14, null, { timeout: 20000, polling: 250 });
    const heOrder = await q.$$eval('#main .bots-list .bot-row[data-bot]', (els) => els.map((e) => e.dataset.bot));
    assert.equal(await q.evaluate(() => document.documentElement.dir), 'rtl');
    await q.click(`#main .bot-row[data-bot="${heOrder[2]}"]`); await inBot(q, heOrder[2]);
    await swipe(q, { dx: 160 }); await inBot(q, heOrder[3]);
    await swipe(q, { dx: -160 }); await inBot(q, heOrder[2]);
    await he.close();
  } finally { await browser.close(); bridge.stop(); }
});

test('on a computer, a bot chat ignores mouse drags', { timeout: 90000 }, async () => {
  const bridge = await startBridge('tc-botswipe-pc-');
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await signIn(p, bridge.base);
    const ids = [];
    for (let i = 1; i <= 3; i++) ids.push(await p.evaluate(async (i) => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Desk ${i}`, job: 'x' }) })).json()).bot.id, i));
    await p.evaluate((id) => { location.hash = 'bot:' + id; }, ids[0]);
    await p.waitForSelector('.bot-composer textarea', { timeout: 15000 });
    const box = await p.locator('#main').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 200); await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 - 300, box.y + 205, { steps: 8 }); await p.mouse.up();
    await wait(600);
    assert.equal(new URL(p.url()).hash, '#bot:' + ids[0]);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#main')).transform), 'none');
  } finally { await browser.close(); bridge.stop(); }
});
