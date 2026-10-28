import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real isolated question panel reconciles answers and resolves one old card without waking a model', { timeout: 60_000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-question-resolution-'));
  const config = path.join(tmp, 'config'), bin = path.join(tmp, 'bin');
  fs.mkdirSync(config); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(config, 'automatic-actions.paused'), 'isolated fixture: automatic work held');
  const called = path.join(tmp, 'provider-called');
  for (const provider of ['codex', 'claude']) {
    fs.writeFileSync(path.join(bin, provider), '#!/bin/sh\nprintf called >> "' + called + '"\nexit 1\n', { mode: 0o700 });
  }
  const portProbe = net.createServer();
  portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], {
    env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: config,
      TC_BOTS_HOME: path.join(tmp, 'home'), TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1',
      PATH: bin + path.delimiter + process.env.PATH }, stdio: 'ignore',
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await wait(100);
  }
  assert.ok(ready, 'owned isolated bridge started');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '/');
  await page.evaluate(() => {
    document.querySelector('#email').value = 'owner@example.test';
    document.querySelector('#password').value = 'fixture-password-123';
    document.querySelector('form').requestSubmit();
  });
  await page.waitForSelector('.bots-home');
  const id = await page.evaluate(async () => {
    const response = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Question fixture' }) });
    return (await response.json()).bot.id;
  });
  const now = Date.now() - 1000;
  const q = (id, text, at) => ({ id, at, role: 'bot', text: '', question: { text, options: ['Yes', 'No'] } });
  const rows = [
    q('old-direct', 'May I publish the old distinct artifact?', now - 1000),
    { id: 'direct-answer', at: now - 999, role: 'operator', answerTo: 'old-direct', text: 'Yes' },
    q('old-pending', 'Which separate project remains pending?', now - 998),
    ...Array.from({ length: 310 }, (_, i) => ({ id: 'history-' + i, at: now - 900 + i, role: 'bot', text: 'Progress ' + i })),
    q('legacy', 'Choose the completed legacy option', now),
    { id: 'legacy-answer', at: now + 1, role: 'operator', text: 'Yes' },
    q('ambiguous', 'Should this historical choice remain available?', now + 2),
    { id: 'unrelated', at: now + 3, role: 'operator', text: 'Please inspect another issue.' },
    q('current', 'Choose the new independent scope', now + 4),
    { id: 'terminal-fixture', at: now + 5, role: 'terminal-ask', settled: true, text: 'A terminal approval is separate', pane: 'not-live', askId: 'ask-fixture', options: [] },
  ];
  const chat = path.join(config, 'bots', id, 'chat.jsonl');
  fs.appendFileSync(chat, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const original = fs.readFileSync(chat);
  await page.goto(base + '/#bot:' + id);
  await page.waitForSelector('.bot-question[data-qid="current"]');
  const pendingIds = () => page.locator('[data-question-jump]').evaluateAll(buttons => buttons.map(button => button.dataset.questionJump).sort());
  assert.deepEqual(await pendingIds(), ['ambiguous', 'current', 'old-pending']);
  assert.equal(await page.locator('.bot-question[data-qid="old-direct"]').count(), 0, 'direct answer beyond the window stays resolved');
  assert.equal(await page.locator('.bot-question[data-qid="legacy"].answered').count(), 1, 'legacy exact choice disables the original card');
  assert.equal(await page.locator('.bot-question[data-qid="legacy"] [data-answer]:enabled').count(), 0);
  await page.locator('.bot-unanswered').evaluate(element => { element.open = true; });
  await page.locator('[data-question-jump="old-pending"]').click();
  assert.equal(await page.locator('.bot-question[data-qid="old-pending"]').evaluate(element => document.activeElement === element), true, 'old unanswered original remains findable');
  const denied = await page.evaluate(async ({ id }) => {
    const post = async questionId => {
      const response = await fetch('/api/bot/question/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, questionId }) });
      return { status: response.status, body: await response.json() };
    };
    return [await post('not-a-question'), await post('terminal-fixture')];
  }, { id });
  assert.ok(denied.every(result => result.status >= 400 && result.body.error), 'invalid and terminal targets cannot be resolved by this route');
  await page.locator('.bot-question[data-qid="ambiguous"] [data-resolve-question]').click();
  await page.waitForFunction(() => document.querySelector('.bot-question[data-qid="ambiguous"]')?.classList.contains('answered'));
  assert.deepEqual(await pendingIds(), ['current', 'old-pending']);
  assert.equal(await page.locator('.bot-question[data-qid="ambiguous"] [data-answer]:enabled').count(), 0);
  await page.reload(); await page.waitForSelector('.bot-question[data-qid="current"]');
  assert.deepEqual(await pendingIds(), ['current', 'old-pending'], 'resolution is durable after page reload');
  const saved = fs.readFileSync(chat);
  assert.ok(saved.subarray(0, original.length).equals(original), 'all original questions and replies remain byte-for-byte');
  const resolutions = saved.toString().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.role === 'question-resolution');
  assert.equal(resolutions.length, 1); assert.equal(resolutions[0].questionId, 'ambiguous');
  assert.equal(fs.existsSync(called), false, 'resolving and rendering never invokes either provider');
  assert.deepEqual(errors, []);
});
