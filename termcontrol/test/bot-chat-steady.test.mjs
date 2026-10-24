// Noam 2026-10-24: "screen jitters while the agent is working" (R-7226). While a bot works, its
// chat gets a "Thinking" line, activity lines, a handed-to-a-terminal-agent card and a helpers
// chip, all changing on every poll. The view must stay put: no full redraw of the list, the
// view sticks to the bottom only when he is at the bottom, and never moves when he scrolled up.
// Runs in Chromium at phone size and in WebKit (the PC app's engine, no browser scroll anchoring).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One simulated working turn, one step per poll of the chat.
const history = Array.from({ length: 24 }, (_, i) => ({ id: 'h' + i, role: i % 2 ? 'bot' : 'operator', text: `History message ${i}. ` + 'Some words to make it a real paragraph that wraps over a few lines. '.repeat(1 + (i % 3)), at: 1_700_000_000_000 + i * 1000 }));
const ask = { id: 'q1', role: 'operator', text: 'בכל מה שכתבת כאן לא כיסית את התלונות המשמעותיות שלי - שהמשחק מרגיש מבולגן', at: 1_700_000_100_000 };
const start = { role: 'activity', text: 'Starting a terminal agent' };
const handoff = { role: 'handoff', to: 'a new terminal agent', pane: 'p1', text: 'Noam decided the fight feel is as important as the animation for Monday. Another agent is redrawing the sprites; coordinate with it.' };
const reading = { role: 'activity', text: 'Reading a terminal agent' };
const reply = { id: 'r1', role: 'bot', text: 'A dedicated agent is now working on the fight feel. '.repeat(4), at: 1_700_000_200_000 };
const steps = [
  { working: false, extra: [] },
  { working: true, activity: null, extra: [ask] },
  { working: true, activity: 'Starting a terminal agent', extra: [ask, start] },
  { working: true, activity: 'Starting a terminal agent', helpers: 1, extra: [ask, start, handoff] },
  { working: true, activity: 'Reading a terminal agent and checking what it changed in the fight code so far, which is a long status', helpers: 1, extra: [ask, start, handoff, reading] },
  { working: true, activity: 'Checking something', helpers: 1, extra: [ask, start, handoff, reading] },
  { working: false, helpers: 1, extra: [ask, start, handoff, reading, reply] },
  { working: false, helpers: 1, extra: [ask, start, handoff, reading, reply] },
];

async function runTurn(browserType, viewport, scrolledUp) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-steady-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7900 + Math.floor(Math.random() * 600), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await browserType.launch();
  let context = null;
  try {
    // TC_STEADY_VIDEO=<folder> records each run, for before/after proof.
    const video = process.env.TC_STEADY_VIDEO ? { recordVideo: { dir: path.join(process.env.TC_STEADY_VIDEO, `${browserType.name()}-${scrolledUp ? 'scrolled-up' : 'at-bottom'}`), size: viewport } } : {};
    context = await browser.newContext({ viewport, serviceWorkers: 'block', ...video });
    const p = await context.newPage();
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    // WebKit drops a Secure cookie on plain-http localhost (the test server has no TLS):
    // set the password from here and hand the session to the browser without Secure.
    if (browserType === webkit) {
      const r = await fetch(base + '/setup', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams({ email: 'owner@example.test', password: 'a-good-password', confirm: 'a-good-password' }) });
      const m = /^([^=;\s]+)=([^;]*)/.exec(r.headers.get('set-cookie') || '');
      assert.ok(m, `setup gave a session (status ${r.status})`);
      await p.context().addCookies([{ name: m[1], value: m[2], url: base }]);
    }
    await p.goto(base + '/');
    if (browserType !== webkit) await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Steady test' }) }); return (await r.json()).bot.id; });
    let step = 0;
    await p.route(/\/api\/bot\?id=/, async (route) => {
      const response = await route.fetch().catch(() => null); if (!response) return route.abort().catch(() => {}); const data = await response.json();
      const s = steps[Math.min(step, steps.length - 1)];
      // The bridge returns only the newest messages, so every new line drops the oldest one at the top.
      data.messages = [...history.slice(Math.min(step, steps.length - 1)), ...s.extra.map((m, i) => ({ at: 1_700_000_150_000 + i, ...m }))];
      Object.assign(data.bot, { state: s.working ? 'working' : 'idle', activity: s.activity || null, activitySince: s.working ? Date.now() - 90_000 : null, helpers: s.helpers ? [{ paneId: 'p1', title: 'Fight feel', task: 'Make the fight feel fast', state: s.working ? 'working' : 'idle' }] : [] });
      await route.fulfill({ response, json: data }).catch(() => {});
    });
    await p.goto(base + '/#bot:' + id);
    await p.waitForFunction(() => document.querySelectorAll('.bot-feed .msg').length >= 24, null, { timeout: 15000, polling: 100 }).catch(async (e) => { throw new Error(e.message + ' :: ' + p.url() + ' :: ' + (await p.evaluate(() => document.querySelector('main').innerHTML.slice(0, 400)))); });
    await wait(500);
    // WebKit has no scroll anchoring; switch it off in Chromium too so both test the app's own logic.
    await p.evaluate(() => { document.querySelector('main').style.overflowAnchor = 'none'; });
    const first = await p.evaluate((up) => {
      const main = document.querySelector('main');
      if (up) main.scrollTop = Math.max(0, main.scrollHeight / 2 - main.clientHeight / 2); else main.scrollTop = main.scrollHeight;
      const box = main.getBoundingClientRect(), msgs = [...document.querySelectorAll('.bot-feed .msg')];
      const anchor = msgs.find((m) => m.getBoundingClientRect().top >= box.top + 10) || msgs[0];
      anchor.__kept = true; window.__samples = []; window.__anchor = anchor;
      const sample = () => { window.__samples.push({ top: anchor.getBoundingClientRect().top, gap: main.scrollHeight - main.scrollTop - main.clientHeight }); window.__raf = requestAnimationFrame(sample); };
      sample();
      return anchor.getBoundingClientRect().top;
    }, scrolledUp);
    await wait(300);
    for (step = 1; step < steps.length; step++) await wait(2300);   // the chat polls every 2 s
    await wait(800);
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    const result = await p.evaluate(() => { cancelAnimationFrame(window.__raf); const s = window.__samples; return { samples: s.length, kept: Boolean(window.__anchor.isConnected && window.__anchor.__kept), tops: s.map((x) => x.top), gaps: s.map((x) => x.gap) }; });
    assert.deepEqual(errors, []);
    return { ...result, first };
  } finally { await context?.close().catch(() => {}); await browser.close().catch(() => {}); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
}

for (const [name, type, viewport] of [['phone (Chromium)', chromium, { width: 390, height: 844 }], ['PC app (WebKit)', webkit, { width: 860, height: 820 }]]) {
  test(`${name}: scrolled up, the view never moves while the bot works`, { timeout: 120000 }, async () => {
    const r = await runTurn(type, viewport, true);
    assert.ok(r.samples > 20, 'frames were sampled');
    const moved = Math.max(...r.tops.map((t) => Math.abs(t - r.first)));
    assert.ok(moved <= 1, `the message he was reading moved by ${moved}px`);
    assert.equal(r.kept, true, 'old messages are kept, not redrawn');
  });
  test(`${name}: at the bottom, it follows the new lines without jumping`, { timeout: 120000 }, async () => {
    const r = await runTurn(type, viewport, false);
    const worst = Math.max(...r.gaps);
    assert.ok(worst <= 2, `the view fell ${worst}px behind the bottom at some frame`);
    // The read position only ever moves one way (up, as new lines arrive): no up-and-down.
    let back = 0; for (let i = 1; i < r.tops.length; i++) if (r.tops[i] > r.tops[i - 1] + 0.5) back = Math.max(back, r.tops[i] - r.tops[i - 1]);
    assert.ok(back <= 1, `content jumped back down by ${back}px`);
    assert.equal(r.kept, true, 'old messages are kept, not redrawn');
  });
}
