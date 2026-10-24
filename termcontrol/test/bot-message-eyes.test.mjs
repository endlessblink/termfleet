// Noam 2026-10-24 (R-15305): "עדיין אין עיניים לדוגמה!!!" — when he writes to a bot he wants to
// see at once that it took his message. His message now carries 👀 while the bot works on it and
// a ✓ once the bot has answered it. A message sent while the bot is still busy with an earlier
// one keeps its eyes until the turn that takes it answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markReceipts } from '../bridge/bots.mjs';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-eyes-'));
const statusOf = (chat, opts) => markReceipts(chat, opts).filter((m) => m.role === 'operator').map((m) => m.status || null);

test('eyes while the bot works, a check once its reply covers the message', () => {
  const op = (at) => ({ role: 'operator', at, text: `m${at}` });
  assert.deepEqual(statusOf([op(1)], { busy: true }), ['working']);
  assert.deepEqual(statusOf([op(1), { role: 'bot', at: 5, answered: 2, text: 'ok' }]), ['answered']);
  // Sent while the bot was busy with the first one: the first reply does not cover it.
  assert.deepEqual(statusOf([op(1), op(3), { role: 'bot', at: 5, answered: 2, text: 'ok' }], { busy: true }), ['answered', 'working']);
  // A quick side answer is not the real answer.
  assert.deepEqual(statusOf([op(1), { role: 'bot', side: true, at: 2, text: 'quick' }], { busy: true }), ['working']);
  // A failure or a stop drops the eyes and shows no check.
  assert.deepEqual(statusOf([op(1), { role: 'error', at: 4, answered: 1, text: 'failed' }]), [null]);
  // Replies saved before this change cover everything sent before them.
  assert.deepEqual(statusOf([op(1), op(2), { role: 'bot', at: 4, text: 'old' }]), ['answered', 'answered']);
});

function startBridge() {
  const base = tmp();
  const configDir = path.join(base, 'cfg'), botsHome = path.join(base, 'home'), uploads = path.join(base, 'up');
  for (const d of [configDir, botsHome, uploads]) fs.mkdirSync(d, { recursive: true });
  // A stand-in brain: takes four seconds, then answers. No real model is called.
  const brain = path.join(base, 'claude');
  fs.writeFileSync(brain, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"eyes-test"}'
sleep 4
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Got it, all done."}]}}'
echo '{"type":"result","subtype":"success","result":"Got it, all done."}'
`, { mode: 0o755 });
  const port = 7900 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_UPLOAD_DIR: uploads, TC_CLAUDE_BIN: brain, TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  return { port, stop: () => { child.kill('SIGKILL'); fs.rmSync(base, { recursive: true, force: true }); } };
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await wait(150); } } }

for (const [label, context] of [['phone', devices['Pixel 7']], ['PC', { viewport: { width: 1400, height: 900 } }]]) {
  test(`${label}: his message shows eyes while the bot works, then a check`, { timeout: 90000 }, async () => {
    const b = startBridge(), base = `http://localhost:${b.port}`;
    await ready(b.port);
    const browser = await chromium.launch();
    try {
      const p = await (await browser.newContext(context)).newPage();
      await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
      const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Eyes' }) }); return (await r.json()).bot.id; });
      await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
      await p.waitForSelector('.bot-composer textarea', { timeout: 15000 });
      await p.fill('.bot-composer textarea', 'please check the popups');
      await p.locator('.bot-composer button.send').click();
      await p.waitForSelector('.msg.user .msg-seen.working', { timeout: 15000 });
      assert.equal(await p.locator('.msg.user .msg-seen.working').innerText(), '👀');
      const box = await p.locator('.msg.user .msg-seen.working').boundingBox();
      assert.ok(box && box.width >= 20 && box.height >= 20, 'the eyes are too small to see');
      await p.screenshot({ path: path.join(os.tmpdir(), `bot-eyes-working-${label}.png`) });
      await p.waitForSelector('.msg.user .msg-seen.answered', { timeout: 30000 });
      assert.equal(await p.locator('.msg.user .msg-seen.working').count(), 0);
      assert.match(await p.locator('#main').innerText(), /Got it, all done\./);
      await p.screenshot({ path: path.join(os.tmpdir(), `bot-eyes-answered-${label}.png`) });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); b.stop(); }
  });
}
