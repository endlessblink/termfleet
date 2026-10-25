import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';
import { Bots } from '../bridge/bots.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function computer(t, run = async () => ({ text: 'Ready' })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-provider-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  for (const dir of ['.claude', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const socket = path.join(root, 'daemon.sock');
  fs.writeFileSync(socket, '');
  const options = { dir: path.join(root, 'bots'), checks: { home, socket }, bins: { claude: '/bin/false', codex: '/bin/false' }, run };
  return { bots: new Bots(options), options, root };
}

async function settle(bots, id) {
  for (let i = 0; i < 200 && bots.running.has(id); i++) await wait(5);
  assert.equal(bots.running.has(id), false, 'bot run should settle');
}

test('provider changes reject missing bots and invalid providers without mutation', t => {
  const { bots, root } = computer(t);
  const { bot } = bots.create({ name: 'Provider validation', cwd: root });
  const before = bots.read(bot.id);
  for (const provider of [undefined, '', 'other', '../codex']) assert.equal(bots.changeProvider(bot.id, provider).ok, false);
  assert.equal(bots.changeProvider('missing-bot', 'codex').ok, false);
  assert.deepEqual(bots.read(bot.id), before);
  assert.equal(bots.changeProvider(bot.id, before.provider).ok, true);
  assert.deepEqual(bots.read(bot.id), before, 'choosing the current provider must preserve its session and settings');
});

test('provider changes during a fallback turn restart the task and preserve unconsumed steering', async t => {
  const calls = [];
  let fallbackStarted;
  const started = new Promise(resolve => { fallbackStarted = resolve; });
  const { bots, root } = computer(t, async (bot, text, options) => {
    calls.push({ provider: bot.provider, text });
    if (calls.length === 1) return { limit: { text: 'usage limit', resetsAt: Date.now() + 60000 }, error: 'usage limit' };
    if (calls.length === 2) return new Promise(resolve => {
      options.onStart(() => resolve({ stopped: true, error: 'Stopped by Noam.' }));
      fallbackStarted();
    });
    return { text: 'Continued after explicit change.' };
  });
  const { bot } = bots.create({ name: 'Fallback provider', cwd: root });
  bots.send(bot.id, 'Keep the current task.');
  await started;
  bots.handOn(bot.id, { at: Date.now(), msgId: 'steer-provider', text: 'Keep this steering message.' }, null);
  const result = bots.changeProvider(bot.id, 'codex');
  assert.equal(result.pending, true);
  await settle(bots, bot.id);
  assert.equal(calls[1].provider, 'codex');
  assert.equal(bots.read(bot.id).provider, 'codex');
  assert.match(calls.slice(2).map(call => call.text).join('\n'), /Keep the current task/);
  assert.match(calls.slice(2).map(call => call.text).join('\n'), /Keep this steering message/);
  assert.ok(!bots.messages(bot.id).some(message => /Stopped by Noam/.test(message.text)));
});

test('idle provider changes preserve memory and chat while resetting target sessions and persisting', t => {
  const { bots, options, root } = computer(t);
  const { bot } = bots.create({ name: 'Provider persistence', cwd: root });
  bots.append(bot.id, { role: 'operator', text: 'Remember the blue logo.' });
  bots.memory(bot.id).add({ text: 'Never push without asking.', kind: 'decision' });
  const saved = bots.read(bot.id);
  saved.model = 'old-claude-model';
  saved.retry = { at: Date.now() + 60000, text: 'a pending request' };
  saved.sessions.codex = 'old-codex-session';
  bots.write(saved);
  const memory = bots.memory(bot.id).card();
  assert.equal(bots.changeProvider(bot.id, 'codex').ok, true);
  const reloaded = new Bots(options);
  const changed = reloaded.read(bot.id);
  assert.equal(changed.provider, 'codex');
  assert.equal(changed.active, 'codex');
  assert.ok(!changed.model);
  assert.ok(!changed.retry);
  assert.equal(changed.sessions.codex, null);
  assert.match(changed.handover, /blue logo/);
  assert.deepEqual(reloaded.memory(bot.id).card(), memory);
  assert.ok(reloaded.messages(bot.id).some(message => message.text === 'Remember the blue logo.'));
  assert.equal(reloaded.changeProvider(bot.id, 'claude').ok, true);
  assert.equal(reloaded.read(bot.id).active, 'claude');
  assert.equal(reloaded.read(bot.id).sessions.claude.started, false);
});

test('busy provider changes stop the current brain and restart its task with queued messages intact', async t => {
  const calls = [];
  let stopped = 0;
  const { bots, root } = computer(t, async (bot, text, options) => {
    calls.push({ provider: bot.active || bot.provider, text });
    if (calls.length === 1) return new Promise(resolve => options.onStart(() => {
      stopped++;
      resolve({ stopped: true, error: 'Stopped by Noam.' });
    }));
    return { text: 'Continued on the requested brain.' };
  });
  const { bot } = bots.create({ name: 'Busy provider', cwd: root });
  bots.send(bot.id, 'Finish the first request.');
  bots.send(bot.id, 'Then handle the queued request.');
  const result = bots.changeProvider(bot.id, 'codex');
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(stopped, 1);
  await settle(bots, bot.id);
  assert.equal(calls[0].provider, 'claude');
  assert.ok(calls.slice(1).every(call => call.provider === 'codex'));
  assert.match(calls.slice(1).map(call => call.text).join('\n'), /Finish the first request/);
  assert.match(calls.slice(1).map(call => call.text).join('\n'), /queued request/);
  assert.equal(bots.read(bot.id).provider, 'codex');
  assert.equal(bots.read(bot.id).active, 'codex');
  assert.equal(bots.messages(bot.id).filter(message => message.role === 'operator').length, 2);
  assert.ok(!bots.messages(bot.id).some(message => /Stopped by Noam/.test(message.text)));
});

test('a newer provider choice replaces a pending choice before the old brain finishes stopping', async t => {
  let finishStopping;
  const calls = [];
  const { bots, root } = computer(t, async (bot, text, options) => {
    calls.push(bot.provider);
    if (calls.length === 1) return new Promise(resolve => {
      options.onStart(() => {});
      finishStopping = () => resolve({ stopped: true, error: 'Stopped by Noam.' });
    });
    return { text: 'Continuing with the latest choice.' };
  });
  const { bot } = bots.create({ name: 'Latest provider', cwd: root });
  bots.send(bot.id, 'Keep working.');
  assert.equal(bots.changeProvider(bot.id, 'codex').pending, true);
  assert.equal(bots.changeProvider(bot.id, 'claude').ok, true);
  finishStopping();
  await settle(bots, bot.id);
  assert.equal(bots.read(bot.id).provider, 'claude');
  assert.deepEqual(calls, ['claude', 'claude']);
});

test('bot slash provider command survives unavailable skills and retries safely in RTL', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-provider-ui-'));
  const port = 24000 + Math.floor(Math.random() * 20000);
  fs.mkdirSync(path.join(root, 'cfg'), { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  const server = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: path.join(root, 'cfg'), TC_HOST: '127.0.0.1', TC_BOTS_HOME: path.join(root, 'home'), TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/login`)).ok) break; } catch {}
      await wait(100);
    }
    browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      localStorage.setItem('termcontrol-fleet-tab', 'bots');
      localStorage.setItem('termcontrol-language', 'he');
    });
    await page.route('**/api/skills', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Catalog unavailable' }) }));
    let displayedState = null;
    await page.route('**/api/bot?*', async route => {
      const response = await route.fetch();
      const data = await response.json();
      if (displayedState && data.bot) data.bot.state = displayedState;
      await route.fulfill({ response, json: data });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://localhost:${port}/`);
    if (await page.locator('#email').count()) {
      await page.locator('#email').fill('owner@example.test');
      await page.locator('#password').fill('a-good-password');
      await page.locator('form').evaluate(form => form.requestSubmit());
    }
    await page.waitForSelector('.bots-home');
    const id = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Provider browser' }) })).json()).bot.id);
    await page.evaluate(id => { location.hash = `bot:${id}`; }, id);
    await page.waitForSelector('.bot-composer textarea');
    await page.waitForFunction(() => document.querySelector('.bot-names bdi')?.textContent === 'Provider browser');
    await page.locator('.bot-composer textarea').fill('/');
    await page.waitForSelector('[data-provider-command]', { timeout: 5000 });
    await page.locator('[data-provider-command]').click();
    await page.waitForSelector('[data-provider="codex"]');
    await page.screenshot({ path: '/tmp/termfleet-bot-provider-picker.png', fullPage: true });
    assert.equal(await page.locator('[data-provider="claude"]').count(), 1);
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    let attempts = 0;
    await page.route('**/api/provider', route => {
      attempts++;
      assert.deepEqual(route.request().postDataJSON(), { botId: id, provider: 'codex' });
      return attempts === 1
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Please try again.' }) })
        : route.continue();
    });
    await page.locator('[data-provider="codex"]').click();
    for (let i = 0; i < 100 && attempts < 1; i++) await wait(10);
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-provider="codex"]');
      return button && !button.disabled && button.getBoundingClientRect().height > 0;
    });
    await page.locator('[data-provider="codex"]').click();
    await page.waitForFunction(() => /Codex/.test(document.querySelector('.bot-brain')?.textContent || ''));
    assert.equal(attempts, 2);
    const persisted = await page.evaluate(async id => (await (await fetch('/api/bots')).json()).bots.find(bot => bot.id === id), id);
    assert.equal(persisted.provider, 'codex');
    assert.equal(persisted.active, 'codex');
    await page.reload();
    await page.waitForFunction(() => /Codex/.test(document.querySelector('.bot-brain')?.textContent || ''));
    displayedState = 'working';
    await page.waitForFunction(() => getComputedStyle(document.querySelector('header .bot-avatar.head')).animationName.includes('bot-working-pulse'));
    const workingAvatar = await page.locator('header .bot-avatar.head').elementHandle();
    await page.waitForResponse(response => response.url().includes('/api/bot?'));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('header .bot-avatar.head').evaluate((element, previous) => element === previous, workingAvatar), true, 'polling must preserve the working avatar so its animation continues');
    await page.screenshot({ path: '/tmp/termfleet-bot-provider-working.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('header .bot-avatar.head')).animationName === 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    displayedState = 'idle';
    await page.waitForFunction(() => !document.querySelector('header .bot-avatar.head').classList.contains('working'));
    assert.equal(await page.locator('header .bot-avatar.head').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.screenshot({ path: '/tmp/termfleet-bot-provider-idle.png', fullPage: true });
    displayedState = 'needs-you';
    await page.reload();
    await page.waitForSelector('header .bot-avatar.head');
    assert.equal(await page.locator('header .bot-avatar.head').evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
