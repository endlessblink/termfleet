#!/usr/bin/env node
/**
 * Readability and reach: measured contrast, text sizes, tap targets, focus,
 * and the markup a screen reader depends on. Numbers, on the real screens.
 *
 *   node termcontrol/test/access.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, '..', 'bridge', 'server.mjs');
let pass = 0, fail = 0; const failures = [];
async function check(name, fn) {
  try { const r = await fn(); pass++; console.log(`  ok   ${name}${typeof r === 'string' ? ' — ' + r : ''}`); }
  catch (e) { fail++; failures.push([name, e.message]); console.log(`  FAIL ${name} — ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const group = (t) => console.log(`\n${t}`);

/** Runs in the page: contrast of every text node against its real backdrop. */
const CONTRAST = `(() => {
  const lum = (c) => {
    const [r,g,b] = c.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  const parse = (s) => (s.match(/[\\d.]+/g) || []).slice(0,3).map(Number);
  const backdrop = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      const alpha = (bg.match(/[\\d.]+/g) || [])[3];
      if (p.length === 3 && bg !== 'rgba(0, 0, 0, 0)' && (alpha === undefined || Number(alpha) > 0.5)) return p;
      n = n.parentElement;
    }
    return [20,20,19];
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fg = parse(cs.color), bg = backdrop(el);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1,L2) + 0.05) / (Math.min(L1,L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    out.push({ role: el.className || el.tagName, size, ratio: Math.round(ratio*100)/100, need: large ? 3 : 4.5 });
  }
  return out;
})()`;

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-a11y-'));
  const port = 7940 + Math.floor(Math.random() * 9);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/login'); break; } catch { await wait(150); } }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();

  group('Sign-in screen');
  await p.goto(base + '/');

  await check('every word meets contrast', async () => {
    const bad = (await p.evaluate(CONTRAST)).filter((r) => r.ratio < r.need);
    ok(bad.length === 0, bad.map((b) => `${b.role} ${b.ratio}:1 (needs ${b.need})`).join(', '));
    return 'all pass';
  });

  await check('nothing smaller than 12px', async () => {
    const small = await p.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => ({ role: e.className || e.tagName, size: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((r) => r.size < 12));
    ok(small.length === 0, small.map((s) => `${s.role} ${s.size}px`).join(', '));
  });

  await check('fields and button are easy to hit', async () => {
    const small = await p.$$eval('input, button', (els) => els
      .map((e) => ({ t: e.tagName, ...e.getBoundingClientRect().toJSON() }))
      .filter((r) => r.height < 44));
    ok(small.length === 0, JSON.stringify(small));
  });

  await check('focus is clearly visible', async () => {
    await p.focus('#email');
    const ring = await p.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#email'));
      return { outline: cs.outlineStyle, shadow: cs.boxShadow };
    });
    ok(ring.outline !== 'none' || (ring.shadow && ring.shadow !== 'none'), 'no visible focus indicator');
    return 'ring present';
  });

  await check('the form is labelled properly', async () => {
    const unlabelled = await p.$$eval('input', (els) => els.filter((e) => !document.querySelector(`label[for="${e.id}"]`)).length);
    ok(unlabelled === 0, `${unlabelled} inputs without a label`);
  });

  group('Fleet list and chat');
  await p.fill('#email', 'owner@example.com');
  await p.fill('#password', 'a-good-password');
  await p.click('button[type=submit]');
  await p.waitForSelector('.pane', { timeout: 15000 });
  await wait(600);

  await check('fleet: every word meets contrast', async () => {
    const bad = (await p.evaluate(CONTRAST)).filter((r) => r.ratio < r.need);
    const worst = bad.sort((a, b) => a.ratio - b.ratio)[0];
    ok(bad.length === 0, `${bad.length} failing, worst ${worst?.role} at ${worst?.ratio}:1`);
    return 'all pass';
  });

  await check('fleet: nothing smaller than 12px', async () => {
    const small = await p.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => ({ role: e.className || e.tagName, size: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((r) => r.size < 12));
    ok(small.length === 0, small.map((s) => `${s.role} ${s.size}px`).join(', '));
  });

  await check('fleet: groups are real headings', async () => {
    const h = await p.$$eval('h2', (els) => els.map((e) => e.textContent.trim()));
    ok(h.length > 0, 'section labels are not headings');
    return h.join(', ');
  });

  await check('fleet: each card announces itself', async () => {
    const labels = await p.$$eval('.pane', (els) => els.map((e) => e.getAttribute('aria-label')));
    ok(labels.every((l) => l && l.length > 5), 'cards have no spoken description');
    return labels[0].slice(0, 50) + '…';
  });

  await check('the page declares itself dark', async () => {
    const cs = await p.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    ok(/dark/.test(cs), `color-scheme is "${cs}"`);
  });

  await p.click('.pane');
  await p.waitForSelector('.composer');
  await wait(1500);

  await check('chat: every word meets contrast', async () => {
    const bad = (await p.evaluate(CONTRAST)).filter((r) => r.ratio < r.need);
    const worst = bad.sort((a, b) => a.ratio - b.ratio)[0];
    ok(bad.length === 0, `${bad.length} failing, worst ${worst?.role} at ${worst?.ratio}:1`);
    return 'all pass';
  });

  await check('chat: nothing smaller than 12px', async () => {
    const small = await p.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => ({ role: e.className || e.tagName, size: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((r) => r.size < 12));
    ok(small.length === 0, small.map((s) => `${s.role} ${s.size}px`).join(', '));
  });

  await check('chat: every control is big enough to tap', async () => {
    const small = await p.$$eval('button, textarea, a', (els) => els
      .map((e) => { const r = e.getBoundingClientRect(); return { role: e.className || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => (r.w && r.h) && (r.w < 44 || r.h < 44)));
    ok(small.length === 0, small.map((s) => `${s.role} ${s.w}x${s.h}`).join(', '));
  });

  await check('new messages are announced, not silent', async () => {
    const live = await p.evaluate(() => document.querySelector('#main')?.getAttribute('aria-live'));
    ok(live === 'polite', `aria-live is "${live}"`);
  });

  await check('there is a landmark to jump to', async () => {
    const roles = await p.evaluate(() => ({
      main: !!document.querySelector('main, [role=main]'),
      banner: !!document.querySelector('header, [role=banner]'),
    }));
    ok(roles.main && roles.banner, JSON.stringify(roles));
  });

  await check('a visitor without JavaScript is told why it is blank', async () => {
    const html = fs.readFileSync(path.join(here, '..', 'app', 'index.html'), 'utf8');
    ok(/<noscript/.test(html), 'no message for a browser with scripting off');
  });

  await check('motion respects the system setting', async () => {
    const html = fs.readFileSync(path.join(here, '..', 'app', 'index.html'), 'utf8');
    ok(/prefers-reduced-motion/.test(html), 'animations ignore the reduced-motion preference');
  });

  await browser.close();
  child.kill('SIGKILL');
  for (const f of fs.readdirSync(configDir)) fs.unlinkSync(path.join(configDir, f));
  fs.rmdirSync(configDir);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); for (const [n, e] of failures) console.log(`  - ${n}: ${e}`); process.exit(1); }
}
main().catch((e) => { console.error('test run itself failed:', e); process.exit(2); });
