import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

test('phone and desktop show actual cards and open bot tasks', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-status-browser-'));
  const port = 7900 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: dir, TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1', TC_BOTS_HOME: path.join(dir, 'home') }, stdio: 'ignore',
  });
  let browser;
  try {
    for (let n = 0; n < 100; n++) {
      try { await fetch(base + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    browser = await chromium.launch();
    for (const width of [390, 1600]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
      const bot = { id: 'status-bot', name: 'Status bot', state: 'pending', openTasks: 2, provider: 'claude', unread: 1 };
      await page.route('**/api/bots', (route) => route.fulfill({ json: { bots: [bot], groups: [], providers: ['claude', 'codex'] } }));
      const pane = (id, attention) => ({ id, project: id, turn: 'waiting', alive: true, attention, updatedAt: Date.now() });
      const panes = [pane('tool-only', null), pane('real-card', { kind: 'permission', title: 'Approve the export?' })];
      await page.route('**/api/panes*', (route) => route.fulfill({ json: { daemon: true, panes, groups: [{ id: 'status', project: 'Status', panes }] } }));
      await page.route('**/api/waiting*', (route) => route.fulfill({ json: { items: [] } }));
      await page.goto(base);
      await page.waitForSelector('#password');
      await page.evaluate(() => {
        const email = document.querySelector('#email'); if (email) email.value = 'owner@example.test';
        document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit();
      });
      await page.waitForSelector('.bot-row[data-bot="status-bot"]');
      const row = page.locator('.bot-row[data-bot="status-bot"]');
      assert.match(await row.innerText(), /2 open tasks/);
      assert.equal(await row.getAttribute('data-state'), 'pending');
      await page.locator('.fleet-tabs [data-tab="terminals"]').click();
      await page.waitForSelector('.pane[data-id="real-card"]');
      assert.equal(await page.locator('.pane[data-id="real-card"]').getAttribute('data-state'), 'needs-you');
      assert.equal(await page.locator('.pane[data-id="tool-only"]').getAttribute('data-state'), 'idle');
      assert.equal(await page.locator('.fleet-tabs [data-tab="terminals"] .tab-need').innerText(), '1');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close(); child.kill('SIGKILL');
    await new Promise((resolve) => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
