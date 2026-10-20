// Noam 2026-10-20: "צריך להיות מסוגל להרוג טרמינל מהתצוגה הזו בפלאפון ובמחשב".
// A terminal row offers Close (right-click or ⋯ on a computer, long press on a phone); it always
// asks "Close <name>? Its work stops." first, Cancel changes nothing, Close removes the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const pane = (id, title) => ({ id, title, provider: 'shell', project: 'demo', groupName: 'demo', cwd: '/tmp/demo', turn: 'idle', updatedAt: Date.now(), lastActiveAt: Date.now(), alive: true, todos: [] });
test('closing a terminal from the list asks first and then removes its row', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-closeui-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [width, touch] of [[1400, false], [390, true]]) {
      const p = await (await browser.newContext({ viewport: { width, height: 860 }, hasTouch: touch })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      let panes = [pane('terminal-t1-p1', 'Render the intro'), pane('terminal-t2-p2', 'Fix the photo upload')];
      const closed = [];
      await p.route('**/api/panes', (route) => route.fulfill({ json: { generatedAt: new Date().toISOString(), daemon: true, view: 'projects', panes, groups: [{ id: 'map:g', project: 'demo', panes }] } }));
      await p.route('**/api/close', async (route) => { const { pane: id } = JSON.parse(route.request().postData()); closed.push(id); panes = panes.filter((x) => x.id !== id); await route.fulfill({ json: { ok: true } }); });
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      await p.evaluate(() => document.querySelector('.fleet-tabs [data-tab="terminals"]')?.click());
      const row = p.locator('.pane[data-id="terminal-t1-p1"]');
      await row.waitFor({ timeout: 15000 });
      if (!touch) {
        await row.click({ button: 'right' });
      } else {
        const tap = await row.boundingBox();
        await row.tap(); // a quick tap opens nothing
        assert.equal(await p.locator('.pane-menu').count(), 0);
        await p.goBack().catch(() => {});
        await p.evaluate(() => document.querySelector('.fleet-tabs [data-tab="terminals"]')?.click());
        await row.waitFor();
        await p.waitForFunction(() => new Promise((ok) => { const m = document.querySelector('main'), y = m?.scrollTop; setTimeout(() => ok(m?.scrollTop === y), 400); }), null, { timeout: 10000 }); // the list restores its scroll after Back
        const at = await row.boundingBox();
        await row.evaluate((el, at) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: at.x, clientY: at.y })), { x: at.x + 40, y: at.y + 20 });
        await p.waitForTimeout(800);
        await row.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
      }
      await p.locator('.pane-menu [data-close]').waitFor({ timeout: 3000 });
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-close-menu-${width}.png` });
      await p.locator('.pane-menu [data-close]').click();
      const sheet = p.locator('.close-sheet .sheet');
      assert.match(await sheet.innerText(), /Close Render the intro\?\s+Its work stops\./);
      await p.locator('.close-sheet [data-cancel]').click();
      assert.equal(await p.locator('.close-sheet').count(), 0);
      assert.deepEqual(closed, [], 'Cancel closes nothing');
      assert.equal(await row.count(), 1);
      if (!touch) { await row.hover(); await p.locator('.pane[data-id="terminal-t1-p1"] .pane-more').click(); }
      else { await row.evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 300 }))); }
      await p.locator('.pane-menu [data-close]').click();
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-close-sheet-${width}.png` });
      await p.locator('.close-sheet [data-confirm]').click();
      await p.waitForFunction(() => !document.querySelector('.pane[data-id="terminal-t1-p1"]'), null, { timeout: 5000 });
      assert.deepEqual(closed, ['terminal-t1-p1']);
      assert.equal(await p.locator('.pane[data-id="terminal-t2-p2"]').count(), 1, 'only that one');
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
