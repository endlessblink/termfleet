import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { Bots } from '../bridge/bots.mjs';
import { markQuestionResolutions } from '../bridge/bot-questions.mjs';

test('dismissal records an honest resolution, validates input and never answers a terminal', () => {
  const messages = [{ id: 'q', role: 'bot', question: { text: 'Old choice?', options: ['Yes', 'No'] } },
    { id: 'terminal', role: 'terminal-ask', text: 'Allow access?' }];
  const fixture = { read: () => ({}), messages: () => messages, append: (_, m) => messages.push({ id: 'audit', ...m }) };
  const resolve = (...args) => Bots.prototype.resolveQuestion.call(fixture, 'bot', ...args);
  assert.ok(resolve('q', 'invalid').error);
  assert.ok(resolve('terminal', 'dismissed').error);
  assert.deepEqual(resolve('q', 'dismissed'), { ok: true });
  assert.equal(markQuestionResolutions(messages)[0].questionResolution.state, 'dismissed');
  resolve('q', 'dismissed');
  assert.equal(messages.filter(m => m.role === 'question-resolution').length, 1);
  assert.equal(messages.some(m => m.role === 'operator'), false);
  messages.push({ id: 'other', role: 'bot', question: { text: 'Another?', options: ['Yes'] } });
  resolve('other');
  assert.equal(markQuestionResolutions(messages).find(m => m.id === 'other').questionResolution.state, 'answered');
});

test('dismissal arriving after an answer preserves the answer and its audit history', () => {
  for (const answer of [{ id: 'reply', role: 'operator', answerTo: 'q', text: 'Yes' },
    { id: 'legacy-reply', role: 'operator', text: 'No' },
    { id: 'resolved', role: 'question-resolution', questionId: 'q', resolution: 'answered' }]) {
    const messages = [{ id: 'q', role: 'bot', question: { text: 'Choice?', options: ['Yes', 'No'] } }, answer];
    const fixture = { read: () => ({}), messages: () => messages, append: (_, m) => messages.push(m) };
    const before = structuredClone(markQuestionResolutions(messages)[0].questionResolution);
    const original = structuredClone(messages);
    assert.deepEqual(Bots.prototype.resolveQuestion.call(fixture, 'bot', 'q', 'dismissed'), { ok: true });
    assert.equal(markQuestionResolutions(messages)[0].questionResolution.state, 'answered');
    assert.deepEqual(markQuestionResolutions(messages)[0].questionResolution, before, 'answer identity, source and text survive stale removal');
    assert.deepEqual(messages, original, 'original answer history stays byte-for-byte equivalent');
    assert.equal(messages.length, 2, 'stale removal does not rewrite a completed answer');
  }
});

test('owner removes old questions through the real bridge, retaining a question arriving during clear', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dismiss-'));
  const configDir = path.join(tmp, 'cfg'), home = path.join(tmp, 'home');
  fs.mkdirSync(configDir); fs.mkdirSync(home);
  const port = 8300 + Math.floor(Math.random() * 100), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env,
    TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: configDir, TC_BOTS_HOME: home,
    TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1' }, stdio: 'ignore' });
  let browser, release;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForSelector('.bots-home');
    const id = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Old questions' }) })).json()).bot.id);
    const store = new Bots({ dir: path.join(configDir, 'bots') });
    const original = ['Which reporting timezone?', 'May the archive be removed?', 'Should the independent check continue?', 'When should delivery start?', 'Where should logs be stored?', 'Who owns this project?', 'How many workers are needed?', 'What filename should the export use?', 'Which language should reports use?']
      .map(text => store.append(id, { role: 'bot', text: '', question: { text, options: ['Yes', 'No'] } }));
    const post = body => page.evaluate(async body => { const r = await fetch('/api/bot/question/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }, body);
    assert.equal((await post({ id, questionId: original[0].id, resolution: 'invalid' })).status, 400);
    const terminal = store.append(id, { role: 'terminal-ask', text: 'Allow access?', pane: 'missing-test-pane' });
    assert.equal((await post({ id, questionId: terminal.id, resolution: 'dismissed' })).status, 400);
    const nobody = await fetch(base + '/api/bot/question/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, questionId: original[0].id, resolution: 'dismissed' }) });
    assert.equal(nobody.status, 401);
    await page.goto(base + '/#bot:' + id);
    await page.waitForSelector('.bot-composer');
    await page.waitForSelector('[data-question-remove]', { state: 'attached' });
    const notesBefore = await page.locator('.bot-note').allTextContents();
    await page.locator('.bot-unanswered summary').click();
    await page.locator(`[data-question-remove="${original[0].id}"]`).click({ timeout: 5000 });
    await page.waitForFunction(qid => !document.querySelector(`[data-question-jump="${qid}"]`), original[0].id);
    assert.match(await page.locator(`[data-qid="${original[0].id}"]`).innerText(), /Dismissed/);
    assert.doesNotMatch(await page.locator(`[data-qid="${original[0].id}"]`).innerText(), /already answered/i);
    assert.equal(await page.locator(`[data-qid="${original[0].id}"]`).evaluate(el => el.classList.contains('answered')), false);
    const sent = []; let started;
    const startedPromise = new Promise(r => { started = r; });
    const held = new Promise(r => { release = r; });
    await page.route('**/api/bot/question/resolve', async route => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) { started(); await held; }
      await route.continue();
    });
    await page.locator('[data-questions-clear]').click();
    await startedPromise;
    const fresh = store.append(id, { role: 'bot', text: '', question: { text: 'New choice arriving during clear?', options: ['Yes', 'No'] } });
    await page.waitForSelector(`[data-question-jump="${fresh.id}"]`, { state: 'attached' });
    release();
    await page.waitForFunction(() => document.querySelectorAll('[data-question-remove]').length === 1 && !document.querySelector('[data-questions-clear]:disabled'));
    assert.deepEqual(sent.map(m => m.questionId).sort(), original.slice(1).map(m => m.id).sort());
    assert.ok(sent.every(m => m.resolution === 'dismissed'));
    await page.reload();
    await page.waitForSelector('.bot-composer');
    await page.locator('.bot-unanswered summary').click();
    assert.equal(await page.locator('[data-question-remove]').count(), 1);
    assert.equal(await page.locator(`[data-question-jump="${fresh.id}"]`).count(), 1);
    assert.deepEqual(await page.locator('.bot-note').allTextContents(), notesBefore, 'internal resolution audits must not become empty or undefined chat messages');
    const history = store.messages(id), audits = history.filter(m => m.role === 'question-resolution');
    assert.equal(audits.length, 9);
    assert.ok(audits.every(m => m.resolution === 'dismissed'));
    assert.ok(original.every(q => history.some(m => m.id === q.id && m.question)));
    assert.equal(history.some(m => m.role === 'operator'), false, 'no answer or work was sent');
    assert.equal(history.some(m => m.questionId === fresh.id || m.questionId === terminal.id), false);
    assert.deepEqual(errors, []);
  } finally { release?.(); await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
