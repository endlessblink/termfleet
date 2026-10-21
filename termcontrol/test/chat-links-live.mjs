#!/usr/bin/env node
/**
 * Links in a real bot chat, on a PC and a phone: they open in a new tab, a copy
 * button copies them with a "copied" note, a right click / long press offers
 * "Copy link", and a screenshot path opens the picture.
 *
 *   node termcontrol/test/chat-links-live.mjs [screenshot-folder]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.argv[2] || null;
let pass = 0, fail = 0;
const check = async (name, fn) => { try { const r = await fn(); pass++; console.log(`  ok   ${name}${r ? ' — ' + r : ''}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

const config = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-links-'));
// A real picture under the home folder, so the preview has something to open.
const picDir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'tc-links-shot-'));
const pic = path.join(picDir, 'after-fix.png');
fs.writeFileSync(pic, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const id = 'b0b0b0b01ee7';
fs.mkdirSync(path.join(config, 'bots', id), { recursive: true });
fs.writeFileSync(path.join(config, 'bots', id, 'bot.json'), JSON.stringify({ id, name: 'בוט קישורים', job: '', rules: '', provider: 'claude', active: 'claude', cwd: config, createdAt: Date.now(), sessions: { claude: null, codex: null } }));
const now = Date.now();
const chat = [
  { role: 'operator', text: 'תן לי את הקישורים לריפו ולתיעוד' },
  { role: 'bot', text: 'בטח! הריפו נמצא ב-https://github.com/endlessblink/termfleet, והתיעוד כאן: [המדריך המלא](https://tauri.app/start/).\nאפשר גם לפתוח github.com/endlessblink (בלי https), ואת התצוגה המקומית בכתובת `http://127.0.0.1:5177`.' },
  { role: 'bot', text: 'English line with a link mid-sentence: see https://en.wikipedia.org/wiki/Tauri_(software), then reply.\nצילום המסך אחרי התיקון: ' + pic + '\nקישור לא בטוח נשאר טקסט: [לחצו](javascript:alert(1))' },
].map((m, i) => JSON.stringify({ id: 'm' + i, at: now - (3 - i) * 60000, ...m })).join('\n') + '\n';
fs.writeFileSync(path.join(config, 'bots', id, 'chat.jsonl'), chat);

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(here, '..', 'bridge', 'server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: config, TC_BOTS_HOME: config, TC_HOST: '127.0.0.1' }, stdio: 'ignore' });
const cleanup = () => { child.kill('SIGKILL'); fs.rmSync(config, { recursive: true, force: true }); fs.rmSync(picDir, { recursive: true, force: true }); };
process.once('exit', cleanup);
for (let i = 0; i < 60; i++) { try { await fetch(base + '/login'); break; } catch { await wait(150); } }

const browser = await chromium.launch();
for (const device of [{ name: 'pc', viewport: { width: 1280, height: 800 }, touch: false }, { name: 'phone', viewport: { width: 390, height: 844 }, touch: true }]) {
  console.log(`\n${device.name}`);
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, hasTouch: device.touch, isMobile: device.touch, locale: 'he-IL', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  await p.goto(base + '/');
  if (await p.$('#password')) { if (await p.$('#email')) await p.fill('#email', 'owner@example.test'); await p.fill('#password', 'a-good-password'); await p.click('button[type=submit]'); }
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.goto(`${base}/#bot:${id}`);
  await p.waitForSelector('.bot-feed a.msg-link', { timeout: 15000 });
  await wait(600);
  const hrefs = await p.$$eval('.bot-feed a.msg-link', (as) => as.map((a) => a.getAttribute('href')));

  await check('every link in the chat is clickable', async () => {
    ok(hrefs.includes('https://github.com/endlessblink/termfleet'), 'repo link missing: ' + hrefs);
    ok(hrefs.includes('https://tauri.app/start/'), 'markdown link missing');
    ok(hrefs.includes('https://github.com/endlessblink'), 'bare domain missing');
    ok(hrefs.includes('http://127.0.0.1:5177'), 'local preview missing');
    ok(hrefs.includes('https://en.wikipedia.org/wiki/Tauri_(software)'), 'link with brackets missing');
    ok(hrefs.some((h) => h.startsWith('/api/local-image')), 'screenshot link missing');
    ok(!hrefs.some((h) => /^javascript/i.test(h)), 'unsafe link became clickable');
    return `${hrefs.length} links`;
  });
  await check('links open in a new tab, safely', async () => {
    const bad = await p.$$eval('.bot-feed a.msg-link', (as) => as.filter((a) => a.target !== '_blank' || !/noopener/.test(a.rel)).length);
    ok(bad === 0, `${bad} links would open in place`);
    const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('.bot-feed a.msg-link[href="https://github.com/endlessblink/termfleet"]')]);
    ok(tab.url().startsWith('https://github.com/endlessblink/termfleet') || tab.url() === 'about:blank', 'new tab went to ' + tab.url());
    await tab.close();
  });
  if (shots) await p.screenshot({ path: path.join(shots, `${device.name}-chat-links.png`) });

  await check('the copy button copies the link and says so', async () => {
    await p.click('.bot-feed .link-copy[data-link="https://tauri.app/start/"]');
    await p.waitForSelector('.link-toast.show', { timeout: 2000 });
    const text = await p.$eval('.link-toast', (el) => el.textContent);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(clip === 'https://tauri.app/start/', 'clipboard has ' + clip);
    if (shots) await p.screenshot({ path: path.join(shots, `${device.name}-copied.png`) });
    return text;
  });
  await wait(1800);

  await check(device.touch ? 'a long press offers Copy link' : 'a right click offers Copy link', async () => {
    const link = await p.$('.bot-feed a.msg-link[href="https://github.com/endlessblink"]');
    const box = await link.boundingBox();
    if (device.touch) {
      const cdp = await ctx.newCDPSession(p);
      const pt = [{ x: box.x + 10, y: box.y + box.height / 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      await wait(800);
      await p.waitForSelector('.link-menu', { timeout: 2000 });
      if (shots) await p.screenshot({ path: path.join(shots, `${device.name}-long-press-menu.png`) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(200);
      ok(p.context().pages().length === 1, 'the long press also opened the link');
    } else {
      await p.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
      await p.waitForSelector('.link-menu', { timeout: 2000 });
      if (shots) await p.screenshot({ path: path.join(shots, `${device.name}-right-click-menu.png`) });
    }
    await p.click('.link-menu [data-copy]');
    await p.waitForSelector('.link-toast.show', { timeout: 2000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(clip === 'https://github.com/endlessblink', 'clipboard has ' + clip); // written bare, copied as a full address
    ok(!(await p.$('.link-menu')), 'menu stayed open');
  });

  await check('links stay left-to-right inside the Hebrew line', async () => {
    const dirs = await p.$$eval('.bot-feed a.msg-link', (as) => as.map((a) => getComputedStyle(a).direction));
    ok(dirs.every((d) => d === 'ltr'), dirs.join());
    const para = await p.$eval('.bot-feed a.msg-link', (a) => a.parentElement.closest('[dir]').getAttribute('dir'));
    ok(para === 'rtl', 'Hebrew line is ' + para);
  });
  await check('the screenshot path opens the picture', async () => {
    const href = hrefs.find((h) => h.startsWith('/api/local-image'));
    const r = await p.evaluate(async (u) => { const res = await fetch(u); return [res.status, res.headers.get('content-type')]; }, href);
    ok(r[0] === 200 && r[1] === 'image/png', r.join());
    const denied = await p.evaluate(async () => (await fetch('/api/local-image?path=%2Fetc%2Fpasswd')).status);
    ok(denied === 404, 'a non-picture was served: ' + denied);
  });
  await check('nothing spills off the side', async () => {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `${over}px too wide`);
  });
  await ctx.close();
}
const anon = await (await fetch(`${base}/api/local-image?path=${encodeURIComponent(pic)}`)).status;
await check('a signed-out visitor cannot open pictures', () => ok(anon === 401, 'status ' + anon));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
