// Noam 2026-10-22: the New bot window gets a project folder choice, folded away until tapped;
// inside it he browses the PC, makes a new empty folder, opens it and picks it, without leaving
// the window. The Edit bot window can change the folder later. Runs on a phone and a PC size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.TC_SHOTS_DIR || '';

for (const [label, context] of [['phone', { ...devices['Pixel 7'] }], ['pc', { viewport: { width: 1280, height: 860 } }]]) {
  test(`${label}: a new bot can get a project folder made and picked inside the window`, { timeout: 120000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-folder-'));
    const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home'), projects = path.join(tmp, 'projects');
    const known = path.join(projects, 'known-app'), second = path.join(projects, 'second-app');
    for (const d of [configDir, botsHome, known, second]) fs.mkdirSync(d, { recursive: true });
    const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
    const child = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1', XDG_DATA_HOME: path.join(tmp, 'data'), TERMFLEET_DAEMON_SOCKET: path.join(tmp, 'no-daemon.sock') }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
    const browser = await chromium.launch();
    try {
      const p = await (await browser.newContext(context)).newPage();
      await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
      // A bot already working in a project, so the window has a recent project to offer.
      await p.evaluate(async (cwd) => { await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Old hand', cwd }) }); }, known);
      await p.reload();
      await p.waitForSelector('.new-bot', { timeout: 15000 });
      await p.click('.new-bot');
      await p.waitForSelector('dialog.room-dialog[open]');
      // Folded away by default.
      const folded = await p.evaluate(() => ({ open: document.querySelector('.folder-pick').open, shown: document.querySelector('.folder-body').checkVisibility() }));
      assert.equal(folded.open, false);
      assert.equal(folded.shown, false, 'nothing of the folder picker shows until tapped');
      if (shots) await p.screenshot({ path: path.join(shots, `${label}-1-folded.png`) });

      await p.fill('input[name=name]', 'Folder test');
      await p.click('.folder-pick > summary');
      await p.waitForSelector('.folder-recent button');
      const recent = await p.$$eval('.folder-recent button', (bs) => bs.map((b) => b.textContent));
      assert.deepEqual(recent, ['known-app']);
      // Browsing starts in the projects area.
      assert.equal(await p.textContent('.folder-here'), path.dirname(known));
      // Go into the projects folder list, make a new folder there, and it is picked.
      await p.click('.folder-new-open');
      await p.fill('input[name=newfolder]', 'brand new app');
      if (shots) await p.screenshot({ path: path.join(shots, `${label}-2-browse-new.png`) });
      await p.click('.folder-make');
      await p.waitForFunction((want) => document.querySelector('input[name=cwd]').value === want, path.join(projects, 'brand new app'));
      assert.equal(fs.readdirSync(path.join(projects, 'brand new app')).length, 0, 'made empty');
      assert.equal(await p.textContent('.folder-here'), path.join(projects, 'brand new app'), 'opened the new folder');
      // The same name again is refused and nothing is replaced.
      await p.click('.folder-up');
      await p.waitForFunction((want) => document.querySelector('.folder-here').textContent === want, projects);
      await p.click('.folder-new-open'); await p.fill('input[name=newfolder]', 'known-app'); await p.click('.folder-make');
      await p.waitForFunction(() => /already/.test(document.querySelector('.folder-error').textContent));
      // Browse into second-app and use it instead.
      await p.click(`.folder-list button[data-cwd="${second}"]`);
      await p.waitForFunction((want) => document.querySelector('.folder-here').textContent === want, second);
      await p.click('.folder-use');
      assert.equal(await p.inputValue('input[name=cwd]'), second);
      assert.equal(await p.textContent('.folder-now'), 'second-app');
      const overflow = await p.evaluate(() => document.querySelector('dialog.room-dialog').scrollWidth > document.querySelector('dialog.room-dialog').clientWidth + 1);
      assert.equal(overflow, false, 'nothing sticks out sideways');
      if (shots) await p.screenshot({ path: path.join(shots, `${label}-3-picked.png`) });
      await p.click('.room-create');
      await p.waitForFunction(() => location.hash.startsWith('#bot:'), null, { timeout: 15000 });
      const made = await p.evaluate(async () => (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Folder test'));
      assert.equal(made.cwd, second);
      assert.equal(fs.existsSync(path.join(botsHome, 'Folder-test')), false, 'no own folder made');

      // Later: the Edit bot window shows the folder and can move it back to its own folder.
      await p.click('.bot-menu-button'); await p.click('.bot-menu-sheet [data-act=edit]');
      await p.waitForSelector('dialog.room-dialog[open]');
      assert.equal(await p.textContent('.folder-now'), 'second-app');
      await p.click('.folder-pick > summary');
      await p.waitForFunction((want) => document.querySelector('.folder-here').textContent === want, second);
      if (shots) await p.screenshot({ path: path.join(shots, `${label}-4-edit.png`) });
      await p.click('.folder-clear');
      await p.click('.room-create');
      await p.waitForFunction(() => !document.querySelector('dialog.room-dialog'), null, { timeout: 10000 });
      const after = await p.evaluate(async () => (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === 'Folder test'));
      assert.equal(after.cwd, path.join(botsHome, 'Folder-test'));
      assert.equal(fs.existsSync(second), true, 'the project folder is left alone');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      child.kill();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
