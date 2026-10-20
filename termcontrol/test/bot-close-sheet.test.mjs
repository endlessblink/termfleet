// Noam 2026-10-20: right-click (computer) or long-press (phone) a bot -> Close this bot -> a sheet
// listing what it runs; mid-work items start unticked; only the ticked ones are closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const repo = path.resolve('.');
const PLAN = (name, warning) => ({ bot: { name }, ...(warning ? { warning } : {}), items: [
  { id: 'turn', kind: 'turn', label: 'Its reply right now', now: 'Reading the photo upload code', busy: true, checked: false, loses: 'The reply it is writing stops halfway. You can ask again any time.' },
  { id: 'terminal:terminal-done', kind: 'terminal', label: 'Run the phone tests', now: 'Finished: All 14 checks pass', busy: false, checked: true },
  { id: 'terminal:terminal-busy', kind: 'terminal', label: 'Fix the photo upload on your phone', now: 'Working: halfway through', busy: true, checked: false, loses: 'It stops in the middle; anything it has not saved is lost.' },
  { id: 'routine:r1', kind: 'routine', label: 'Scheduled message, weekdays at 09:00', now: 'Morning summary', busy: false, checked: true, note: 'Paused, not deleted.' },
] });
test('closing a bot: a checklist sheet, mid-work unticked, only ticked items closed', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botsheet-'));
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
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      const ids = await p.evaluate(async () => { const out = {}; for (const name of ['Close test', 'Agent-Manager']) { const have = (await (await fetch('/api/bots')).json()).bots.find((b) => b.name === name); out[name] = have ? have.id : (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()).bot.id; } return out; });
      const posted = [];
      await p.route('**/api/bot-close*', async (route) => {
        const req = route.request();
        if (req.method() === 'POST') { posted.push(JSON.parse(req.postData())); return route.fulfill({ json: { ok: true, results: [] } }); }
        const bot = new URL(req.url()).searchParams.get('bot');
        return route.fulfill({ json: bot === ids['Agent-Manager'] ? PLAN('Agent-Manager', 'Agent-Manager manages your other agents. While it is closed nothing checks on them; message it to start it again.') : PLAN('Close test') });
      });
      await p.evaluate(() => { location.hash = ''; document.querySelector('.fleet-tabs [data-tab="bots"]')?.click(); });
      const row = p.locator(`.bot-row[data-bot="${ids['Close test']}"]`);
      await row.waitFor({ timeout: 15000 });
      const open = async (r) => {
        if (!touch) return r.click({ button: 'right' });
        const box = await r.boundingBox();
        await r.evaluate((el, at) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: at.x, clientY: at.y })), { x: box.x + 40, y: box.y + 20 });
        await p.waitForTimeout(800);
        await r.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
      };
      await open(row);
      await p.locator('.pane-menu [data-close]').click();
      await p.locator('.bot-close-list input').first().waitFor({ timeout: 5000 });
      const look = await p.evaluate(() => ({
        ticks: [...document.querySelectorAll('.bot-close-list input')].map((b) => [b.value, b.checked]),
        text: document.querySelector('.close-sheet .sheet').innerText,
        inside: (() => { const s = document.querySelector('.close-sheet .sheet').getBoundingClientRect(); return s.left >= 0 && s.right <= innerWidth && s.bottom <= innerHeight; })(),
      }));
      assert.deepEqual(look.ticks, [['turn', false], ['terminal:terminal-done', true], ['terminal:terminal-busy', false], ['routine:r1', true]]);
      assert.match(look.text, /Close Close test\?/);
      assert.match(look.text, /anything it has not saved is lost/);
      assert.match(look.text, /chat and memory are kept/);
      assert.equal(look.inside, true);
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-botclose-${width}.png` });
      await p.locator('.bot-close-list input[value="routine:r1"]').uncheck();
      await p.locator('.close-sheet [data-confirm]').click();
      await p.waitForFunction(() => !document.querySelector('.close-sheet'), null, { timeout: 5000 });
      assert.deepEqual(posted, [{ bot: ids['Close test'], items: ['terminal:terminal-done'] }]);
      // The manager bot: same sheet, with a clear warning first.
      const manager = p.locator(`.bot-row[data-bot="${ids['Agent-Manager']}"]`);
      await open(manager);
      await p.locator('.pane-menu [data-close]').click();
      await p.locator('.bot-close-warning').waitFor({ timeout: 5000 });
      assert.match(await p.locator('.bot-close-warning').innerText(), /manages your other agents/);
      if (process.env.TC_SHOT) await p.screenshot({ path: `${process.env.TC_SHOT}-botclose-manager-${width}.png` });
      await p.locator('.close-sheet [data-cancel]').click();
      assert.equal(posted.length, 1, 'Cancel closes nothing');
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
