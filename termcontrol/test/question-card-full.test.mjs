// Noam 2026-10-23: "I need to be able to see and answer this in the agent view not only the
// terminal." / "Righht it directs me to the terminal or gives only one option." / "also make
// sure that multiple selection works better on mobile than it is now".
// A terminal's question is answered in full from Needs you and from a bot's chat, at phone and
// PC size: every choice with its description, pick-several ticked here (no send per tap) and sent
// in one Submit with any own words, an own answer for a single choice, and every question of a
// several-question prompt listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const OPTIONS = [
  { key: '1', label: 'Kettlebells (Recommended)', detail: 'What your logs show you already do: swings, snatch, sumo deadlift, goblet squat.' },
  { key: '2', label: 'Barbell', detail: 'Squat, bench press, rows with a bar and plates.' },
  { key: '3', label: 'Dumbbells', detail: 'Presses, rows, lunges with dumbbells.' },
  { key: '4', label: 'Machines and cables', detail: 'Leg press, lat pulldown, cable rows and similar.' },
];
const QUESTIONS = [
  { title: 'Which tools do you actually want your gym workouts built around? Pick all that apply.', header: 'Tools', multiSelect: true, options: OPTIONS.map(({ label, detail }) => ({ label, detail })) },
  { title: 'How many days a week do you train?', header: 'Days', multiSelect: false, options: [{ label: 'Two', detail: '' }, { label: 'Three', detail: '' }] },
];
const multiAsk = { id: 'claude:s:toolu_1:0:question:Which tools', kind: 'question', title: QUESTIONS[0].title, header: 'Tools', options: OPTIONS, multiSelect: true, stage: null, checked: [], customText: '', questionIndex: 0, questionCount: 2, questions: QUESTIONS, customAnswerSupported: true };
const singleAsk = { id: 'claude:s2:toolu_2:0:question:Ship', kind: 'question', title: 'Ship it to the store now?', header: 'Ship', options: [{ key: '1', label: 'Yes, ship it', detail: 'Uploads the build.' }, { key: '2', label: 'Not yet', detail: '' }], multiSelect: false, stage: null, checked: [], customText: '', questionIndex: 0, questionCount: 1, questions: [], customAnswerSupported: true };

async function bridge() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-qcard-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7300 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  return { base: `http://localhost:${port}`, stop: () => { child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
async function signIn(p, base) {
  await p.goto(base + '/');
  await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
}
const shot = (p, name) => process.env.TC_SHOT ? p.screenshot({ path: `${process.env.TC_SHOT}-${name}.png`, fullPage: false }) : null;

test('Needs you answers pick-several, own answers and several-question prompts in full', { timeout: 120000 }, async () => {
  const { base, stop } = await bridge();
  const browser = await chromium.launch();
  try {
    for (const [width, height, touch] of [[390, 844, true], [1600, 900, false]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await signIn(p, base);
      const sent = [];
      await p.route('**/api/inbox', (route) => route.fulfill({ json: { items: [
        { pane: { id: 'terminal-health', title: 'health-app', provider: 'claude', lastActiveAt: 1 }, ask: multiAsk },
        { pane: { id: 'terminal-ship', title: 'store', provider: 'claude', lastActiveAt: 2 }, ask: singleAsk },
      ] } }));
      await p.route('**/api/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await route.fulfill({ json: { ok: true, sentAt: Date.now() } }); });
      await p.goto(base + '/#inbox');
      const card = p.locator('.inbox-card[data-pane="terminal-health"]');
      await card.locator('.q-opt').first().waitFor({ timeout: 15000 });

      // Every choice and description shown, never "answer in the chat".
      const text = await card.innerText();
      for (const o of OPTIONS) { assert.ok(text.includes(o.label), o.label); assert.ok(text.includes(o.detail), o.detail); }
      assert.doesNotMatch(text, /Pick several in the chat|Answer this in the chat/);
      assert.match(text, /Question 1 of 2/);
      await card.locator('.q-all summary').click();
      assert.match(await card.locator('.q-all').innerText(), /How many days a week do you train\?/);

      // Big rows; the whole row ticks; nothing is sent per tap.
      const rows = await card.locator('.q-opt').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(rows.every((h) => h >= 56), `rows ${rows}`);
      await card.locator('.q-opt[data-q-choice="1"] .q-detail').click();
      await card.locator('.q-opt[data-q-choice="4"] .q-label').click();
      await card.locator('.q-opt[data-q-choice="2"]').click();
      await card.locator('.q-opt[data-q-choice="2"]').click();
      assert.deepEqual(await card.locator('.q-opt').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked'))), ['true', 'false', 'false', 'true']);
      assert.equal(sent.length, 0, 'a tick never sends');
      await card.locator('[data-q-own]').fill('resistance bands');
      assert.equal(await card.locator('[data-q-submit]').textContent(), 'Submit 3 choices');

      // Submit stays on screen while picking: with the first choice at the top, it is inside the window.
      await card.locator('.q-opt[data-q-choice="1"]').evaluate((e) => e.scrollIntoView({ block: 'start' }));
      const submitBox = await card.locator('[data-q-submit]').boundingBox();
      assert.ok(submitBox && submitBox.y >= 0 && submitBox.y + submitBox.height <= height + 1, `submit at ${JSON.stringify(submitBox)}`);
      await shot(p, `inbox-multi-${width}`);
      await card.locator('[data-q-submit]').click();
      await p.waitForFunction(() => /Answered: Kettlebells \(Recommended\), Machines and cables, resistance bands/.test(document.querySelector('.inbox-card[data-pane="terminal-health"] .q-result')?.textContent || ''), null, { timeout: 5000 });
      assert.deepEqual(sent, [{ pane: 'terminal-health', askId: multiAsk.id, choice: 'submit-multi', multi: true, choices: ['1', '4'], customText: 'resistance bands' }]);
      assert.equal(await card.locator('.q-opt:not([disabled])').count(), 0, 'answered once, then the card rests');

      // A single choice can be answered in own words.
      const ship = p.locator('.inbox-card[data-pane="terminal-ship"]');
      assert.match(await ship.innerText(), /Uploads the build\./);
      await ship.locator('[data-q-own-open]').click();
      await ship.locator('[data-q-own]').fill('Ship it on Sunday');
      await ship.locator('.q-send').click();
      await p.waitForFunction(() => /Answered: Ship it on Sunday/.test(document.querySelector('.inbox-card[data-pane="terminal-ship"] .q-result')?.textContent || ''), null, { timeout: 5000 });
      assert.deepEqual(sent[1], { pane: 'terminal-ship', askId: singleAsk.id, answer: 'Ship it on Sunday' });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no sideways scroll');
      await shot(p, `inbox-done-${width}`);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); stop(); }
});

test('a bot chat shows a terminal\'s pick-several question in full and answers it in one Submit', { timeout: 120000 }, async () => {
  const { base, stop } = await bridge();
  const browser = await chromium.launch();
  try {
    for (const [width, height, touch] of [[390, 844, true], [1600, 900, false]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await signIn(p, base);
      const id = await p.evaluate(async () => { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Coach'); if (have) return have.id; return (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Coach' }) })).json()).bot.id; });
      const msg = { id: 'ta-multi', role: 'terminal-ask', pane: 'terminal-health', label: 'health-app', askId: multiAsk.id, kind: 'question', text: multiAsk.title, options: OPTIONS, multiSelect: true, questionIndex: 0, questionCount: 2, questions: QUESTIONS, at: Date.now() };
      await p.route('**/api/bot?*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.messages = [...j.messages, msg]; await route.fulfill({ response: r, json: j }); });
      const sent = [];
      await p.route('**/api/send', async (route) => { sent.push(JSON.parse(route.request().postData())); await route.fulfill({ json: { ok: true, sentAt: Date.now() } }); });
      await p.goto(base + '/#bot:' + id);
      const box = p.locator('.bot-term-ask');
      await box.locator('.q-opt').first().waitFor({ timeout: 15000 });
      const text = await box.innerText();
      for (const o of OPTIONS) { assert.ok(text.includes(o.label)); assert.ok(text.includes(o.detail)); }
      assert.doesNotMatch(text, /Open the terminal to answer/);
      await box.locator('.q-opt[data-q-choice="3"]').click();
      await box.locator('.q-opt[data-q-choice="1"]').click();
      assert.equal(sent.length, 0);
      await p.waitForTimeout(4500); // a chat redraw keeps the ticks
      assert.deepEqual(await box.locator('.q-opt').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked'))), ['true', 'false', 'true', 'false']);
      await shot(p, `bot-multi-${width}`);
      await box.locator('[data-q-submit]').click();
      await p.waitForFunction(() => /Answered: Kettlebells \(Recommended\), Dumbbells/.test(document.querySelector('.bot-term-ask .q-result')?.textContent || ''), null, { timeout: 5000 });
      assert.deepEqual(sent, [{ pane: 'terminal-health', askId: multiAsk.id, choice: 'submit-multi', multi: true, choices: ['3', '1'], customText: '' }]);
      const spill = await box.evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('*')].filter((c) => { const e = c.getBoundingClientRect(); return e.width && (e.left < r.left - 1 || e.right > r.right + 1); }).map((c) => c.className); });
      assert.deepEqual(spill, []);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); stop(); }
});
