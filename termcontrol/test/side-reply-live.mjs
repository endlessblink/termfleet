#!/usr/bin/env node
/**
 * Live check of instant answers while a bot works (R-7173), against the RUNNING bridge.
 * Makes a throwaway bot, gives it a long task, asks a question mid-turn, measures how long
 * the answer takes, screenshots the chat at phone and PC sizes, then deletes only that bot.
 * Uses the bot's normal plan (one short task). Run: node termcontrol/test/side-reply-live.mjs [outDir]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const port = Number(process.env.TC_PORT || 7810);
const base = `http://127.0.0.1:${port}`;
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'side-live-'));
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The PC app's own loopback sign-in (the Agents tab iframe).
const signIn = await fetch(`${base}/embed`, { redirect: 'manual', headers: { 'sec-fetch-dest': 'iframe' } });
const cookie = String(signIn.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) throw new Error(`sign-in failed (${signIn.status})`);
const api = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'side-live-work-'));
const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
for (const d of names) { fs.mkdirSync(path.join(work, d)); fs.writeFileSync(path.join(work, d, 'a.txt'), 'x'); }
const made = await api('/api/bots', { name: `side check ${Date.now() % 100000}`, provider: 'claude', cwd: work, fallback: 'none' });
const id = made.bot.id;
let browser;
try {
  await api('/api/bot/send', { id, text: `For each folder here (${names.join(', ')}), run a separate ls -la on it, one call after the other (never together), and write one short line after each. Then summarise all twelve.` });
  const view = () => api(`/api/bot?id=${id}`);
  let v;
  // Ask once it has been on tool steps for a little while (the chat logs an activity only when it changes).
  for (let i = 0; i < 240; i++) { v = await view(); if (v.bot.state === 'working' && v.bot.activitySince && Date.now() - v.bot.activitySince > 8000) break; await wait(500); }
  if (v.bot.state !== 'working') throw new Error('the task ended before the question could be asked mid-turn');
  const asked = Date.now();
  await api('/api/bot/send', { id, text: 'how far along are you? can you finish in the next minute?' });
  let side = null;
  for (let i = 0; i < 240 && !side; i++) { v = await view(); side = v.messages.find((m) => m.side); if (!side) await wait(250); }
  const seconds = ((Date.now() - asked) / 1000).toFixed(1);
  const stillWorking = v.bot.state === 'working';
  if (!side) throw new Error('no quick answer arrived');
  console.log(`side answer after ${seconds}s (model ${side?.side?.ms} ms), main turn still working: ${stillWorking}`);
  console.log(`answer: ${side?.text}`);
  browser = await chromium.launch();
  for (const device of [{ name: 'pc', viewport: { width: 1280, height: 800 }, touch: false }, { name: 'phone', viewport: { width: 390, height: 844 }, touch: true }]) {
    const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, hasTouch: device.touch, isMobile: device.touch });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage();
    await p.goto(`${base}/#bot:${id}`);
    await p.waitForSelector('.side-reply-tag', { timeout: 15000 });
    await wait(800);
    const shot = path.join(out, `side-reply-${device.name}.png`);
    await p.screenshot({ path: shot });
    console.log(`screenshot ${device.name}: ${shot}`);
    await ctx.close();
  }
  // Let the main turn finish, so the final answer can be checked against the quick one.
  for (let i = 0; i < 600; i++) { v = await view(); if (v.bot.state !== 'working' && !v.bot.queued) break; await wait(500); }
  const replies = v.messages.filter((m) => m.role === 'bot');
  console.log(`bot messages: ${replies.length} (quick: ${replies.filter((m) => m.side).length})`);
  console.log(`final: ${replies.filter((m) => !m.side).pop()?.text}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), domain: '127.0.0.1', path: '/' }]);
  const p = await ctx.newPage();
  await p.goto(`${base}/#bot:${id}`);
  await wait(2500);
  await p.screenshot({ path: path.join(out, 'side-reply-phone-after.png') });
  console.log(`screenshot after: ${path.join(out, 'side-reply-phone-after.png')}`);
} finally {
  await browser?.close();
  await api('/api/bot/delete', { id }).catch((e) => console.error('delete failed', e.message));
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`deleted throwaway bot ${id}`);
}
