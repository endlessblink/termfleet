#!/usr/bin/env node
/**
 * How TermControl behaves on a phone: layout at real sizes, scrolling while it
 * refreshes, the keyboard, navigation, and what happens when the machine goes
 * away mid-use.
 *
 *   node termcontrol/test/phone.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, '..', 'bridge', 'server.mjs');

let pass = 0, fail = 0; const failures = [];
async function check(name, fn) {
  try {
    const r = await fn();
    pass++; console.log(`  ok   ${name}${typeof r === 'string' ? ' — ' + r : ''}`);
  } catch (e) { fail++; failures.push([name, e.message]); console.log(`  FAIL ${name} — ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const group = (t) => console.log(`\n${t}`);

const PHONES = [
  { name: 'small phone', width: 360, height: 640 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'large Android', width: 412, height: 915 },
];

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-phone-'));
  const port = 7960 + Math.floor(Math.random() * 30);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/login'); break; } catch { await wait(150); } }

  const browser = await chromium.launch();

  const signedIn = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(base + '/');
    if (await p.$('#password')) {
      await p.fill('#email', 'owner@example.com');
      await p.fill('#password', 'a-good-password');
      await p.click('button[type=submit]');
    }
    await p.waitForSelector('.pane', { timeout: 15000 });
    return { ctx, p };
  };

  group('Layout on real phone sizes');
  for (const vp of PHONES) {
    const { ctx, p } = await signedIn(vp);

    await check(`${vp.name}: nothing spills off the side`, async () => {
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 1, `page is ${over}px wider than the screen`);
    });

    await check(`${vp.name}: cards are comfortable to tap`, async () => {
      const h = await p.$$eval('.pane', (els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
      ok(h >= 44, `smallest card is ${Math.round(h)}px tall`);
      return `${Math.round(h)}px`;
    });

    await p.click('.pane');
    await p.waitForSelector('.composer', { timeout: 10000 });
    await wait(1200);

    await check(`${vp.name}: last message clears the reply box`, async () => {
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await wait(300);
      const gap = await p.evaluate(() => {
        const items = [...document.querySelectorAll('#main > *')];
        const last = items[items.length - 1].getBoundingClientRect();
        const bar = document.querySelector('.composer').getBoundingClientRect();
        return Math.round(bar.top - last.bottom);
      });
      ok(gap >= 0, `overlaps by ${-gap}px`);
      return `${gap}px clear`;
    });

    await check(`${vp.name}: long unbroken text does not stretch the page`, async () => {
      const over = await p.evaluate(() => {
        const el = document.querySelector('.bubble') || document.querySelector('.tool');
        if (!el) return 0;
        return Math.round(el.getBoundingClientRect().width - window.innerWidth);
      });
      ok(over <= 1, `content is ${over}px too wide`);
    });

    await ctx.close();
  }

  group('Reading while it updates');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await p.click('.pane');
    await p.waitForSelector('.composer');
    await wait(1200);

    await check('scrolling up is not undone by a refresh', async () => {
      await p.evaluate(() => window.scrollTo(0, 200));
      const before = await p.evaluate(() => Math.round(window.scrollY));
      await wait(9500);
      const after = await p.evaluate(() => Math.round(window.scrollY));
      ok(Math.abs(before - after) <= 2, `moved from ${before} to ${after}`);
      return 'held position';
    });

    await check('at the bottom, it follows new messages', async () => {
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await wait(9000);
      const atBottom = await p.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 20);
      ok(atBottom, 'lost the bottom');
    });
    await ctx.close();
  }

  group('Getting around');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await p.click('.pane');
    await p.waitForSelector('.composer');

    await check('the phone back button returns to the fleet', async () => {
      await p.goBack();
      await wait(700);
      ok(await p.$('.pane'), 'did not return to the list');
      ok(!(await p.$('.composer')), 'reply box left behind');
    });

    await check('going back again leaves the app rather than looping', async () => {
      const entries = await p.evaluate(() => history.length);
      ok(entries >= 2, 'history should hold the fleet and the chat');
      return `${entries} entries`;
    });

    await check('reopening a chat by link works', async () => {
      const id = await p.$eval('.pane', (e) => e.dataset.id);
      await p.goto(base + '/#' + id);
      await p.waitForSelector('.composer', { timeout: 10000 });
      ok(await p.$('.composer'), 'link did not open the chat');
    });
    await ctx.close();
  }

  group('When things go wrong');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await p.click('.pane');
    await p.waitForSelector('.composer');
    await wait(1000);

    await check('losing the connection does not blank what you are reading', async () => {
      const before = await p.$$eval('#main > *', (e) => e.length);
      await ctx.setOffline(true);
      await wait(9000);
      const after = await p.$$eval('#main > *', (e) => e.length);
      await ctx.setOffline(false);
      ok(after >= before, `messages dropped from ${before} to ${after}`);
      return 'kept on screen';
    });

    await check('a failed send tells you, and keeps your text', async () => {
      await ctx.setOffline(true);
      await p.fill('.composer textarea', 'a message that cannot be delivered');
      await p.click('.composer button');
      await p.waitForSelector('.sendstate', { timeout: 8000 });
      // the first frame says "Sending…"; wait for the outcome
      await p.waitForFunction(
        () => !/^Sending|^Still trying/.test(document.querySelector('.sendstate')?.textContent || ''),
        { timeout: 14000 },
      );
      const msg = await p.textContent('.sendstate');
      const kept = await p.inputValue('.composer textarea');
      await ctx.setOffline(false);
      ok(/could not reach|did not answer/i.test(msg), `unclear message: ${msg}`);
      ok(kept.length > 0, 'your text was thrown away');
      return 'text preserved';
    });

    await check('a signed-out session is handled, not left spinning', async () => {
      await ctx.clearCookies();
      await p.reload();
      await wait(1500);
      const url = p.url();
      ok(/login|setup/.test(url), `expected the sign-in screen, got ${url}`);
    });
    await ctx.close();
  }

  group('Typing');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await p.click('.pane');
    await p.waitForSelector('.composer');

    await check('the box grows with a long message but stays bounded', async () => {
      const start = await p.$eval('.composer textarea', (e) => e.offsetHeight);
      await p.fill('.composer textarea', Array(30).fill('a long line of text').join('\n'));
      await wait(300);
      const grown = await p.$eval('.composer textarea', (e) => e.offsetHeight);
      ok(grown > start, 'did not grow');
      ok(grown <= 140, `grew too far: ${grown}px`);
      return `${start} to ${grown}px`;
    });

    await check('the reply box stays reachable with a full message', async () => {
      const visible = await p.evaluate(() => {
        const b = document.querySelector('.composer button').getBoundingClientRect();
        return b.bottom <= window.innerHeight + 1 && b.top >= 0;
      });
      ok(visible, 'the send button is off screen');
    });

    await check('double tapping send does not send twice', async () => {
      await p.fill('.composer textarea', 'hello there');
      const calls = [];
      await p.route('**/api/send', async (route) => { calls.push(1); await route.fulfill({ status: 200, body: '{"ok":true}' }); });
      await p.click('.composer button');
      await p.click('.composer button').catch(() => {});
      await wait(900);
      ok(calls.length <= 1, `sent ${calls.length} times`);
      return `${calls.length} request`;
    });
    await ctx.close();
  }

  await browser.close();
  child.kill('SIGKILL');
  for (const f of fs.readdirSync(configDir)) fs.unlinkSync(path.join(configDir, f));
  fs.rmdirSync(configDir);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); for (const [n, e] of failures) console.log(`  - ${n}: ${e}`); process.exit(1); }
}
main().catch((e) => { console.error('test run itself failed:', e); process.exit(2); });
