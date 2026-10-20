// Noam 2026-10-20: he could not remove a bot from the Bots list. Right-click / long-press a bot ->
// Remove bot… -> closes what it runs, a clear confirm, then the bot is archived (restorable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { botClosePlan, removeBot } from '../bridge/bot-close.mjs';
import { Bots } from '../bridge/bots.mjs';
import { Routines } from '../bridge/routines.mjs';

const repo = path.resolve('.');
const makeBots = () => new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botremove-')), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });

test('remove closes everything, archives chat and memory, and can bring the bot back', async () => {
  const bots = makeBots();
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  bots.append(bot.id, { role: 'user', text: 'remember the blue logo' });
  const routines = new Routines({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-r-')), 'r.json') });
  routines.create({ pane: `bot:${bot.id}`, text: 'Morning summary', days: [1], time: '09:00' });
  const helpers = [{ paneId: 'terminal-busy', task: 'Fix the upload' }];
  const panes = [{ id: 'terminal-busy', turn: 'working', alive: true }];
  const plan = botClosePlan({ bot: { ...bots.summary(bot.id), helpers }, panes, routines: routines.forPane(`bot:${bot.id}`), watches: [] });
  const closed = [];
  const out = await removeBot({ bot: bots.summary(bot.id), plan, bots, routines, requestClose: async (id) => { closed.push(id); return { ok: true }; } });
  assert.equal(out.ok, true);
  assert.deepEqual(closed, ['terminal-busy'], 'everything it runs is closed, mid-work too');
  assert.equal(routines.forPane(`bot:${bot.id}`)[0].enabled, false);
  assert.equal(bots.list().length, 0, 'gone from the list');
  assert.deepEqual(bots.archived().map((b) => b.name), ['Quill']);
  assert.equal(bots.restore(bot.id).ok, true);
  assert.equal(bots.list()[0].name, 'Quill');
  assert.ok(bots.messages(bot.id).some((m) => m.text === 'remember the blue logo'), 'chat came back');
});

test('remove stops if something will not close, and the manager needs the extra tick', async () => {
  const bots = makeBots();
  const routines = new Routines({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-r-')), 'r.json') });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  const plan = botClosePlan({ bot: { ...bots.summary(bot.id), helpers: [{ paneId: 't1', task: 'Render' }] }, panes: [{ id: 't1', turn: 'idle', alive: true }] });
  const out = await removeBot({ bot: bots.summary(bot.id), plan, bots, routines, requestClose: async () => ({ ok: false, error: 'TermFleet did not answer' }) });
  assert.equal(out.ok, false);
  assert.match(out.error, /Not removed: Render \(TermFleet did not answer\)/);
  assert.equal(bots.list().length, 1, 'kept in the list');
  const { bot: mgr } = bots.create({ name: 'Agent-Manager', cwd: os.tmpdir() });
  const refused = await removeBot({ bot: bots.summary(mgr.id), plan: botClosePlan({ bot: bots.summary(mgr.id) }), bots, routines, requestClose: async () => ({ ok: true }) });
  assert.equal(refused.ok, false);
  assert.equal(bots.list().length, 2);
  const restoredName = bots.create({ name: 'Twin', cwd: os.tmpdir() }).bot;
  bots.archive(restoredName.id);
  bots.create({ name: 'Twin', cwd: os.tmpdir() });
  assert.match(bots.restore(restoredName.id).error, /already called Twin/);
});

test('Remove bot… from the row menu: confirm sheet, gone from list, Bring back works', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botremove-ui-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const port = 7600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1', TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    for (const [width, touch] of [[1400, false], [390, true]]) {
      const p = await (await browser.newContext({ viewport: { width, height: 860 }, hasTouch: touch })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const ids = await p.evaluate(async () => { const out = {}; for (const name of ['Remove test', 'Agent-Manager']) { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === name); out[name] = have ? have.id : (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()).bot.id; } return out; });
      await p.evaluate(() => { location.hash = ''; document.querySelector('.fleet-tabs [data-tab="bots"]')?.click(); });
      const open = async (r) => {
        if (!touch) return r.click({ button: 'right' });
        const box = await r.boundingBox();
        await r.evaluate((el, at) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: at.x, clientY: at.y })), { x: box.x + 40, y: box.y + 20 });
        await p.waitForTimeout(800);
        await r.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
      };
      const row = p.locator(`.bot-row[data-bot="${ids['Remove test']}"]`);
      await row.waitFor({ timeout: 15000 });
      await open(row);
      await p.locator('.pane-menu [data-remove]').click();
      await p.locator('.close-sheet [data-confirm]').waitFor({ timeout: 5000 });
      const text = await p.locator('.close-sheet .sheet').innerText();
      assert.match(text, /Remove Remove test from your list\?/);
      assert.match(text, /archived, not lost/);
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-remove-${width}.png` });
      await p.locator('.close-sheet [data-confirm]').click();
      await p.waitForFunction(() => !document.querySelector('.close-sheet'), null, { timeout: 10000 });
      await row.waitFor({ state: 'detached', timeout: 10000 });
      await p.locator('.removed-bots summary').click();
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-removed-list-${width}.png` });
      await p.locator(`[data-restore="${ids['Remove test']}"]`).click();
      await row.waitFor({ timeout: 10000 });
      // Agent-Manager: the warning and an extra tick before Remove works.
      await open(p.locator(`.bot-row[data-bot="${ids['Agent-Manager']}"]`));
      await p.locator('.pane-menu [data-remove]').click();
      await p.locator('.close-sheet [data-ack]').waitFor({ timeout: 5000 });
      assert.equal(await p.locator('.close-sheet [data-confirm]').isDisabled(), true);
      await p.locator('.close-sheet [data-ack]').check();
      assert.equal(await p.locator('.close-sheet [data-confirm]').isDisabled(), false);
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-remove-manager-${width}.png` });
      await p.locator('.close-sheet [data-cancel]').click();
      assert.equal(await p.locator(`.bot-row[data-bot="${ids['Agent-Manager']}"]`).count(), 1, 'Cancel removes nothing');
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
