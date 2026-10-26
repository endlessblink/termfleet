import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

test('terminal health is explicit, readable on phone and desktop, and optional on older servers', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-health-browser-'));
  const port = 8300 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: dir, TC_NO_AGENT_HEALTH: '1', TC_NO_TERMINAL_HEALTH: '1', TC_NO_WATCHDOG: '1', TC_BOTS_HOME: path.join(dir, 'home') }, stdio: 'ignore',
  });
  let browser;
  try {
    for (let n = 0; n < 100; n++) {
      try { await fetch(base + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    browser = await chromium.launch();
    for (const [width, language] of [[390, 'en'], [1600, 'he']]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(({ language }) => {
        localStorage.setItem('termcontrol-fleet-tab', 'health');
        localStorage.setItem('termcontrol-language', language);
      }, { language });
      await page.route('**/api/bots', (route) => route.fulfill({ json: { bots: [], groups: [], providers: [] } }));
      await page.route('**/api/panes*', (route) => route.fulfill({ json: { daemon: true, panes: [], groups: [] } }));
      await page.route('**/api/waiting*', (route) => route.fulfill({ json: { items: [] } }));
      await page.route('**/api/agent-health', (route) => route.fulfill({ json: { days: [] } }));
      const statuses = ['alive', 'stuck', 'sleeping', 'unknown', 'checking', 'dead', 'recovering', 'retired', 'blocked'];
      await page.route('**/api/terminals/health', (route) => route.fulfill({ json: {
        checkedAt: Date.now(), daemon: true, intervalMs: 120000, graceMs: 300000,
        terminals: statuses.map((status) => ({ id: status, project: `${status} project`, task: '<script>bad()</script>', status, reason: 'A safe reason', lastActivityAt: Date.now() - 600000 })),
      } }));
      await page.goto(base);
      await page.waitForSelector('#password');
      await page.evaluate(() => {
        const email = document.querySelector('#email'); if (email) email.value = 'owner@example.test';
        document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit();
      });
      await page.waitForSelector('.terminal-health [data-health="dead"]', { timeout: 10000 });
      for (const status of statuses) assert.equal(await page.locator(`.terminal-health [data-health="${status}"]`).count(), 1);
      assert.match(await page.locator('.terminal-health [data-health="dead"]').innerText(), language === 'he' ? /מת/ : /Dead/);
      assert.match(await page.locator('.terminal-health [data-health="recovering"]').innerText(), language === 'he' ? /משחזר/ : /Restoring/);
      assert.equal(await page.locator('.terminal-health script').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      if (process.env.TC_HEALTH_SCREENSHOTS === '1') {
        await page.screenshot({ path: `/tmp/termcontrol-health-${language}-${width}-top.png` });
        await page.locator('.terminal-health [data-health="recovering"]').evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `/tmp/termcontrol-health-${language}-${width}-recovery.png` });
      }
      await page.unroute('**/api/terminals/health');
      await page.route('**/api/terminals/health', (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
      await page.evaluate(() => { const next = Date.now() + 31000; Date.now = () => next; });
      await page.locator('.fleet-tabs [data-tab="health"]').click();
      await page.waitForSelector('.terminal-health [role="status"]');
      assert.match(await page.locator('.terminal-health [role="status"]').innerText(), language === 'he' ? /לא זמינה/ : /unavailable/);
      await page.reload();
      await page.waitForSelector('.health-page');
      assert.equal(await page.locator('.terminal-health').count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close(); child.kill('SIGKILL');
    await new Promise((resolve) => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
