// Noam 2026-10-22: "Yes, build it" — one-tap cleanup of idle terminals, on the phone and on the PC
// (the map's Clean up opens the same list at #cleanup). Safe ones come ticked; Noam unticks any;
// one Close tap closes the rest. Terminals that must stay show the reason and have no tick box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const pane = (id, title, turn = 'idle') => ({ id, title, provider: 'claude', project: 'demo', groupName: 'demo', cwd: '/tmp/demo', turn, updatedAt: Date.now(), lastActiveAt: Date.now() - 3 * 3600_000, alive: true, todos: [] });
const plan = {
  offer: [{ id: 'terminal-a', name: 'Render the intro', folder: 'rough-cut', idleText: 'idle 2 days' }, { id: 'terminal-b', name: 'Fix the photo upload', folder: 'botson', idleText: 'idle 3 hours' }, { id: 'terminal-c', name: 'Old test run', folder: 'termfleet', idleText: 'idle 40 minutes' }],
  keep: [{ id: 'terminal-d', name: 'Build the release', folder: 'termfleet', reason: 'Working right now' }, { id: 'terminal-e', name: 'Pick a colour', folder: 'design', reason: 'Waiting for you' }, { id: 'terminal-f', name: 'Health app', folder: 'health-app', reason: 'Unsaved work: MASTER_PLAN.md' }],
};
test('clean up idle terminals: ticked list, untick to keep, one tap closes the rest; kept ones show why', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cleanup-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1400, 900], [390, 844]]) {
      const p = await (await browser.newContext({ viewport: { width, height }, hasTouch: width < 500 })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      const panes = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => pane(`terminal-${x}`, x));
      const posted = [];
      await p.route('**/api/panes', (route) => route.fulfill({ json: { generatedAt: new Date().toISOString(), daemon: true, view: 'projects', panes, groups: [{ id: 'map:g', project: 'demo', panes }] } }));
      await p.route('**/api/cleanup', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: plan });
        const { items } = JSON.parse(route.request().postData()); posted.push(items);
        return route.fulfill({ json: { ok: true, closed: items.length, results: items.map((id) => ({ id, ok: true })) } });
      });
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      await p.evaluate(() => document.querySelector('.fleet-tabs [data-tab="terminals"]')?.click());
      await p.locator('.cleanup-idle').click();
      const sheet = p.locator('.cleanup-sheet .sheet');
      await sheet.locator('.cleanup-offer').waitFor({ timeout: 10000 });
      assert.equal(await sheet.locator('.cleanup-offer input:checked').count(), 3, 'safe ones start ticked');
      assert.match(await sheet.innerText(), /Render the intro[\s\S]*rough-cut · idle 2 days/);
      const kept = await sheet.locator('.cleanup-kept').innerText();
      assert.match(kept, /Build the release[\s\S]*Working right now/);
      assert.match(kept, /Pick a colour[\s\S]*Waiting for you/);
      assert.match(kept, /Health app[\s\S]*Unsaved work: MASTER_PLAN\.md/);
      assert.equal(await sheet.locator('.cleanup-kept input').count(), 0, 'kept ones cannot be ticked');
      assert.equal(await sheet.locator('[data-confirm]').innerText(), 'Close 3 terminals');
      await sheet.locator('.cleanup-offer input[value="terminal-b"]').uncheck();
      assert.equal(await sheet.locator('[data-confirm]').innerText(), 'Close 2 terminals');
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-cleanup-${width}.png` });
      await sheet.locator('[data-confirm]').click();
      await p.waitForFunction(() => !document.querySelector('.cleanup-sheet'), null, { timeout: 5000 });
      assert.deepEqual(posted, [['terminal-a', 'terminal-c']], 'one tap, only what stayed ticked');
      // The PC map's Clean up opens the same list by address.
      await p.goto(base + '/#cleanup-123');
      await p.locator('.cleanup-sheet .cleanup-offer').waitFor({ timeout: 15000 });
      await p.locator('.cleanup-sheet [data-cancel]').click();
      assert.equal(await p.locator('.cleanup-sheet').count(), 0);
      assert.equal(posted.length, 1, 'Cancel closes nothing');
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
