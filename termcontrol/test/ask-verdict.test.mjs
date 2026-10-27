import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, record, loadLedger } from '../bridge/requirements.mjs';

// Noam 2026-10-27: "there is a disconnect between what I ask and what I get". Ten of his requests sat at
// "ready" for days because the only way to say it works, or does not, was typing it to an agent.
test('request verdict API preserves explicit owner feedback without a bot panel', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-verdict-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(botsHome);
  const port = 8100 + Math.floor(Math.random() * 100), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
    browser = await chromium.launch();
    const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForSelector('.bots-home');
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Verdict test' }) })).json()).bot.id);
    const dir = path.join(configDir, 'requirements');
    const items = captureMessage({ text: '1. The login page must not pop up on its own\n2. The question bar must not cover the chat', project: 'termfleet', source: `bot:${id}`, msgId: 'verdict-fixture' }, { dir });
    assert.equal(items.length, 2);
    record(items.flatMap((it) => [{ e: 'status', id: it.id, status: 'ready' }, { e: 'testing-handoff', id: it.id, link: 'https://example.test/try', tryText: 'open the chat and look' }]), { dir });
    await p.goto(base + '/#bot:' + id);
    await p.waitForSelector('.bot-composer');
    const verdict = (id, verdict) => p.evaluate(async body => {
      const r = await fetch('/api/ask/verdict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.status;
    }, { id, verdict });
    assert.equal(await verdict(items[0].id, 'works'), 200);
    assert.equal(await verdict(items[1].id, 'broken'), 200);

    const ledger = loadLedger({ dir }).items;
    const [works, broken] = items.map((it) => ledger.get(it.id));
    assert.equal(works.status, 'done'); assert.equal(works.locked, true); assert.ok(works.confirmedBy, 'recorded as his own word');
    assert.equal(broken.status, 'partial'); assert.match(broken.open.join(' '), /still not fixed/);
    assert.deepEqual(errors, []);
    // Anything but his own signed-in tap is refused.
    const nobody = await fetch(base + '/api/ask/verdict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: items[0].id, verdict: 'works' }) });
    assert.equal(nobody.status, 401);
  } finally { await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
