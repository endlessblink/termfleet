import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const composer = '.bot-composer textarea';
const picker = '.bot-composer .skill-picker:not(.mention-picker)';

function skill(root, name, description) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nFollow the ${name} instructions and check the result.\n`);
}

test('installed slash skills filter and insert at the cursor on desktop and RTL phone', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-slash-ui-'));
  const port = 24000 + Math.floor(Math.random() * 20000);
  const providers = path.join(root, 'provider-skills');
  skill(providers, 'impeccable', 'Design interfaces with Impeccable guidance.');
  skill(providers, 'audit', 'Impeccable accessibility and interface audit.');
  for (let i = 0; i < 35; i++) skill(providers, `filler-${String(i).padStart(2, '0')}`, 'A separate installed workflow.');
  fs.mkdirSync(path.join(root, 'cfg'));
  fs.mkdirSync(path.join(root, 'home'));
  const server = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], {
    env: {
      ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1',
      TC_CONFIG_DIR: path.join(root, 'cfg'), TC_BOTS_HOME: path.join(root, 'home'),
      TC_SKILLS_LIBRARY: path.join(root, 'library'), TC_SKILLS_SUGGESTED: path.join(root, 'suggested'),
      TC_SKILLS_BUILTIN: path.join(root, 'builtin'), TC_SKILLS_PROVIDERS: providers,
      TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    let started = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/login`)).ok) { started = true; break; } } catch {}
      await wait(100);
    }
    assert.equal(started, true, 'isolated bridge starts');
    browser = await chromium.launch({ headless: true });
    let storageState;
    for (const [name, options, language] of [
      ['desktop', { viewport: { width: 1280, height: 800 } }, 'en'],
      ['phone', { ...devices['Pixel 7'], locale: 'he-IL' }, 'he'],
    ]) {
      await t.test(name, async () => {
        const context = await browser.newContext({ ...options, ...(storageState ? { storageState } : {}) });
        try {
          await context.addInitScript(language => {
            localStorage.setItem('termcontrol-fleet-tab', 'bots');
            localStorage.setItem('termcontrol-language', language);
          }, language);
          const page = await context.newPage();
          const errors = [], sends = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('request', request => { if (request.url().includes('/api/bot/send')) sends.push(request.url()); });
          await page.goto(`http://localhost:${port}/`);
          if (await page.locator('#email').count()) {
            await page.locator('#email').fill('owner@example.test');
            await page.locator('#password').fill('a-good-password');
            await page.locator('form').evaluate(form => form.requestSubmit());
          }
          await page.waitForSelector('.bots-home');
          storageState = await context.storageState();
          const id = await page.evaluate(async name => (await (await fetch('/api/bots', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Slash ${name}` }),
          })).json()).bot.id, name);
          await page.evaluate(id => { location.hash = `bot:${id}`; }, id);
          await page.waitForSelector(composer);
          const field = page.locator(composer);
          await field.fill('/');
          await page.waitForFunction(() => document.querySelectorAll('.bot-composer [data-name]').length === 37);
          assert.equal(await page.locator(`${picker} [data-name="impeccable"]`).count(), 1, 'last installed skill is not truncated');
          assert.equal(await page.locator(`${picker} [data-provider-command]`).count(), 1, 'provider command remains available');
          await field.fill('/imp');
          await page.waitForFunction(() => document.querySelectorAll('.bot-composer [data-name]').length === 2);
          assert.equal(await page.locator(`${picker} [data-name="audit"]`).count(), 1, 'description search finds Impeccable tools');
          assert.match(await page.locator(`${picker} [data-name="impeccable"]`).innerText(), /Impeccable guidance/);
          await page.screenshot({ path: `/tmp/termfleet-slash-skills-${name}.png`, fullPage: true });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'menu fits the viewport');
          await page.locator(`${picker} [data-name="impeccable"]`).click();
          assert.equal(await field.inputValue(), '/impeccable ');
          assert.equal(await page.locator(picker).isHidden(), true);

          await field.fill('Please /imp');
          await page.locator(`${picker} [data-name="audit"]`).click();
          assert.equal(await field.inputValue(), 'Please /audit ', 'mid-sentence selection keeps preceding text');

          await field.fill('Please /im on this button');
          await field.evaluate(field => {
            field.setSelectionRange('Please /im'.length, 'Please /im'.length);
            field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          });
          await page.locator(`${picker} [data-name="impeccable"]`).click();
          assert.equal(await field.inputValue(), 'Please /impeccable on this button', 'replacement retains the suffix and its spacing');
          assert.equal(await field.evaluate(field => field.selectionStart), 'Please /impeccable'.length);

          for (const text of ['https://example.test/imp', '/home/noam/imp', 'Open ./imp', 'some/imp']) {
            await field.fill(text);
            assert.equal(await page.locator(picker).isHidden(), true, `${text} is ordinary text`);
          }
          await field.fill('/imp');
          await field.press('Escape');
          assert.equal(await page.locator(picker).isHidden(), true, 'Escape dismisses the menu');
          assert.equal(await field.inputValue(), '/imp');
          await field.fill('/impeccable');
          assert.equal(await page.locator(`${picker} [aria-selected="true"]`).getAttribute('data-name'), 'impeccable', 'name matches rank before description matches');
          await field.press('ArrowDown');
          assert.equal(await page.locator(`${picker} [aria-selected="true"]`).getAttribute('data-name'), 'audit');
          await field.press('ArrowUp');
          assert.equal(await page.locator(`${picker} [aria-selected="true"]`).getAttribute('data-name'), 'impeccable');
          await field.press('Enter');
          assert.equal(await field.inputValue(), '/impeccable ', 'keyboard picks a skill');
          assert.deepEqual(sends, [], 'picking a skill never sends a chat message');

          await field.fill('/pro');
          await page.locator(`${picker} [data-provider-command]`).click();
          await page.waitForSelector(`${picker} [data-provider="codex"]`);
          assert.equal(await page.locator(`${picker} [data-provider="claude"]`).count(), 1);

          // A late catalog response must not reopen a menu after its trigger was removed.
          const fresh = await context.newPage();
          let release, requested;
          const gate = new Promise(resolve => { release = resolve; });
          const requestStarted = new Promise(resolve => { requested = resolve; });
          await fresh.route('**/api/skills', async route => { requested(); await gate; await route.continue(); });
          await fresh.goto(`http://localhost:${port}/#bot:${id}`);
          await fresh.waitForSelector(composer);
          await fresh.locator(composer).fill('/imp');
          await requestStarted;
          await fresh.locator(composer).fill('ordinary text');
          const response = fresh.waitForResponse(response => response.url().includes('/api/skills'));
          release();
          await response;
          await fresh.waitForTimeout(50);
          assert.equal(await fresh.locator(picker).isHidden(), true, 'late response leaves an irrelevant picker closed');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
  } finally {
    await browser?.close();
    server.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
