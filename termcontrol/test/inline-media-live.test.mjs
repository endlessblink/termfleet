// Noam 2026-10-24: "כדי שאראה דברים שהוא מג'נרט והוא לא יצטרך לשלוח אותי החוצה כדי לראות דברים".
// A real bridge (own config folder) and a throwaway bot whose chat holds a reply with a picture, a
// GIF and a video, and a question whose answers each carry a picture. Phone size (Chromium) and PC
// size (WebKit, the PC app's engine): everything shows inside the chat, the boxes keep their size
// while loading (no jump), a picture opens full size inside the chat, the video plays in place.
// TC_MEDIA_SHOTS=<folder> saves the screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const fixtures = path.join(repo, 'termcontrol/test/fixtures/media');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(browserType, viewport, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-media-live-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
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
    const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Media check' }) }); return (await r.json()).bot.id; });
    // What the bridge stores for such a reply (the same code as a live reply), with the bridge's own link key.
    const { findMedia, parseQuestion } = await import('../bridge/bot-questions.mjs');
    const was = process.env.TC_CONFIG_DIR; process.env.TC_CONFIG_DIR = configDir;
    const made = findMedia(`Here is what I made, the cover, the loop and the clip:\n${path.join(fixtures, 'cover-a.png')}\n${path.join(fixtures, 'loop.gif')}\n${path.join(fixtures, 'demo.webm')}`);
    const asked = parseQuestion(`[question]\nWhich cover should go on the app?\n- Cover A | ${path.join(fixtures, 'cover-a.png')} (recommended)\n- Cover B | ${path.join(fixtures, 'cover-b.png')}\n[/question]`);
    if (was === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = was;
    assert.equal(made.media.length, 3);
    const t0 = Date.now() - 60_000;
    fs.appendFileSync(path.join(configDir, 'bots', id, 'chat.jsonl'), [
      { id: 'o1', role: 'operator', text: 'make me a cover', at: t0 },
      { id: 'b1', role: 'bot', text: made.text, media: made.media, at: t0 + 1000 },
      { id: 'q1', role: 'bot', text: asked.text, question: asked.question, at: t0 + 2000 },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    // The video can be asked for in pieces (phones need that to play and seek).
    const videoHref = made.media.find((m) => m.kind === 'video').href;
    const part = await fetch(base + videoHref, { headers: { range: 'bytes=0-99' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    await p.goto(base + '/#bot:' + id);
    await p.waitForSelector('.bot-media .bot-media-item', { timeout: 15000 });
    // The boxes have their size before anything loads, so the chat does not jump.
    const before = await p.evaluate(() => [...document.querySelectorAll('.bot-media-item')].map((e) => Math.round(e.getBoundingClientRect().height)));
    await p.waitForFunction(() => [...document.querySelectorAll('.bot-media img')].every((i) => i.complete && i.naturalWidth > 0) && [...document.querySelectorAll('.bot-media video')].every((v) => v.readyState >= 1), null, { timeout: 15000 });
    const after = await p.evaluate(() => [...document.querySelectorAll('.bot-media-item')].map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.deepEqual(after, before, 'no box changed size while loading');
    for (const h of before) assert.ok(h > 60, 'each box is a real picture size');
    const seen = await p.evaluate(() => ({
      images: document.querySelectorAll('.bot-media img').length, videos: document.querySelectorAll('.bot-media video[controls][playsinline]').length,
      lazy: [...document.querySelectorAll('.bot-media img')].every((i) => i.loading === 'lazy'),
      text: document.querySelector('.bot-feed').textContent.includes('cover-a.png'),
      thumbs: [...document.querySelectorAll('.bot-question[data-qid="q1"] .bot-q-thumb img')].map((i) => i.alt),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    assert.equal(seen.images, 2);
    assert.equal(seen.videos, 1);
    assert.equal(seen.lazy, true);
    assert.equal(seen.text, false, 'the file path itself is not shown as text');
    assert.deepEqual(seen.thumbs, ['Cover A', 'Cover B'], 'each answer shows its picture');
    assert.equal(seen.overflow, false);
    if (process.env.TC_MEDIA_SHOTS) {
      fs.mkdirSync(process.env.TC_MEDIA_SHOTS, { recursive: true });
      await p.evaluate(() => document.querySelector('.bot-media').scrollIntoView({ block: 'start' }));
      await wait(200);
      await p.screenshot({ path: path.join(process.env.TC_MEDIA_SHOTS, `${label}-media.png`) });
      await p.evaluate(() => document.querySelector('.bot-question[data-qid="q1"]').scrollIntoView({ block: 'start' }));
      await wait(200);
      await p.screenshot({ path: path.join(process.env.TC_MEDIA_SHOTS, `${label}-question.png`) });
    }
    // The video plays right there.
    const played = await p.evaluate(async () => { const v = document.querySelector('.bot-media video'); v.muted = true; try { await v.play(); } catch (e) { return String(e); } await new Promise((r) => setTimeout(r, 600)); return v.currentTime > 0; });
    assert.equal(played, true);
    // A picture opens full size inside the chat, and closes again.
    const pagesBefore = ctx.pages().length;
    await p.click('.bot-media [data-media-full]');
    await p.waitForSelector('#media-full[open] img', { timeout: 5000 });
    assert.equal(await p.evaluate(() => document.querySelector('#media-full img').naturalWidth > 0), true);
    assert.equal(ctx.pages().length, pagesBefore, 'nothing opened outside the chat');
    if (process.env.TC_MEDIA_SHOTS) await p.screenshot({ path: path.join(process.env.TC_MEDIA_SHOTS, `${label}-full-size.png`) });
    await p.click('#media-full');
    await p.waitForFunction(() => !document.querySelector('#media-full').open, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    const gone = await p.evaluate(async (botId) => (await fetch('/api/bot/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId }) })).status, id);
    assert.equal(gone, 200);
  } finally {
    await browser.close();
    child.kill();
  }
}

test('phone size: pictures, a GIF and a video show and play inside the chat', { timeout: 90_000 }, () => check(chromium, { width: 390, height: 844 }, 'phone'));
test('PC size (the PC app engine): the same', { timeout: 90_000 }, () => check(webkit, { width: 1280, height: 860 }, 'pc'));
