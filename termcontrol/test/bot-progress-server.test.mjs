import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { takeSteer } from '../bridge/side-reply.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('isolated bridge shows progress in phone and desktop chat before one final reply', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-progress-server-'));
  const config = path.join(dir, 'config'), id = '111111111111';
  const folder = path.join(config, 'bots', id), home = path.join(dir, 'home');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(folder, 'bot.json'), JSON.stringify({ id, name: 'Synthetic progress', provider: 'codex', active: 'codex', cwd: dir, createdAt: 1, sessions: { codex: null }, queued: [] }));
  const release = path.join(dir, 'release'), bin = path.join(dir, 'fake-codex.mjs');
  const sideWaiting = path.join(dir, 'side-waiting'), sideRelease = path.join(dir, 'side-release');
  fs.writeFileSync(bin, `#!/usr/bin/env node
import fs from 'node:fs';
const out = event => process.stdout.write(JSON.stringify(event) + '\\n');
if (process.cwd().endsWith('/side')) {
  fs.writeFileSync(${JSON.stringify(sideWaiting)}, 'waiting');
  const timer=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(sideRelease)}))return;clearInterval(timer);
    out({type:'item.completed',item:{type:'agent_message',text:'REPLY: You meant finecut.\\nPASS_ON: no'}});
    out({type:'turn.completed'});},10);
} else {
out({type:'thread.started',thread_id:'synthetic-progress-server'});
out({type:'item.completed',item:{id:'progress',type:'agent_message',text:'Checking the delayed fixture.'}});
out({type:'item.started',item:{id:'work',type:'command_execution',command:'synthetic delayed check'}});
const timer=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(release)}))return;clearInterval(timer);
out({type:'item.completed',item:{id:'final',type:'agent_message',text:'The fixture returned two findings.'}});
out({type:'turn.completed'});},10);
}
`, { mode: 0o755 });
  const requests = [], socket = path.join(dir, 'daemon.sock');
  const daemon = net.createServer(conn => {
    let raw = ''; conn.on('data', chunk => { raw += chunk; });
    conn.on('end', () => {
      const request = JSON.parse(raw); requests.push(request.type);
      conn.end(JSON.stringify({ type: request.type, sessions: [], reachable: true }));
    });
  });
  await new Promise(resolve => daemon.listen(socket, resolve));
  t.after(() => daemon.close());
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], {
    cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: config,
      TC_BOT_CHECK_HOME: home, TC_CODEX_HOME: home, TC_CODEX_BIN: bin,
      XDG_DATA_HOME: path.join(dir, 'data'), TERMFLEET_DAEMON_SOCKET: socket,
      TERMFLEET_GENTLE_BRAINS: '0', TC_PAUSE_AUTOMATIC_ACTIONS: '1', TC_NO_AGENT_HEALTH: '1',
      TC_NO_CANARY: '1', TC_NO_TERMINAL_HEALTH: '1', TC_NO_WATCHDOG: '1',
      TC_NO_AUTO_CLEANUP: '1', TC_NO_AUTO_SLEEP: '1', TC_NO_DOCK_ICON: '1' },
  });
  t.after(async () => {
    fs.writeFileSync(release, 'release');
    fs.writeFileSync(sideRelease, 'release');
    if (child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 1500);
      await exited; clearTimeout(force);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(origin + '/login')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await delay(50);
  }
  assert.ok(ready, 'disposable bridge started');
  const secret = 'disposable-fixture-only';
  const auth = await fetch(origin + '/setup', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ email: 'fixture@example.test', password: secret, confirm: secret }) });
  assert.equal(auth.status, 302);
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const get = async () => (await fetch(origin + '/api/bot?id=' + id, { headers: { cookie } })).json();
  const sent = await fetch(origin + '/api/bot/send', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ id, text: 'Inspect the delayed fixture.' }) });
  assert.equal(sent.status, 200, JSON.stringify(await sent.json()));
  let during;
  for (let n = 0; n < 100; n++) { during = await get(); if (during.messages.some(row => row.progress)) break; await delay(30); }
  assert.deepEqual(during.messages.filter(row => row.progress).map(row => row.text), ['Checking the delayed fixture.']);
  assert.equal(during.messages.some(row => row.role === 'bot'), false);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const pages = [];
  for (const width of [390, 1400]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block' });
    const split = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin }]);
    const page = await context.newPage(); await page.goto(origin + '/#bot:' + id);
    await page.locator('.bot-activity', { hasText: 'Checking the delayed fixture.' }).waitFor();
    assert.equal(await page.getByText('The fixture returned two findings.', { exact: true }).count(), 0);
    pages.push(page);
  }
  const earlier = 'Where is the finecut project folder?';
  const earlierResponse = await fetch(origin + '/api/bot/send', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ id, text: earlier }) });
  assert.equal((await earlierResponse.json()).side, true);
  for (let n = 0; n < 100 && !fs.existsSync(sideWaiting); n++) await delay(20);
  assert.ok(fs.existsSync(sideWaiting), 'synthetic quick responder is held on old context');
  for (const text of ['finetune', 'finecut לא', 'התכוונתי לfinetuned']) {
    const response = await fetch(origin + '/api/bot/send', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ id, text }) });
    const result = await response.json();
    assert.equal(result.correction, true);
    assert.equal(result.receipt.state, 'queued');
    assert.deepEqual(takeSteer(folder).map(entry => entry.text), [text], 'HTTP correction persists verbatim without side inference');
  }
  fs.writeFileSync(sideRelease, 'release');
  let forwarded = [];
  for (let n = 0; n < 100 && !forwarded.length; n++) { forwarded = takeSteer(folder); if (!forwarded.length) await delay(20); }
  assert.deepEqual(forwarded.map(entry => entry.text), [earlier], 'earlier question survives exactly once');
  assert.ok(forwarded[0].brain.includes('התכוונתי לfinetuned'), 'earlier question carries latest correction context');
  assert.equal((await get()).messages.some(row => row.side), false, 'outdated name acknowledgement is withheld');
  fs.writeFileSync(release, 'release');
  for (const page of pages) {
    const final = page.getByText('The fixture returned two findings.', { exact: true }).filter({ visible: true });
    await final.waitFor();
    assert.equal(await final.count(), 1);
    assert.equal(await page.locator('.bot-activity', { hasText: 'Checking the delayed fixture.' }).count(), 1);
    assert.equal(await page.getByText('You meant finecut.', { exact: true }).count(), 0);
  }
  assert.equal((await get()).messages.filter(row => row.role === 'bot').length, 1);
  assert.ok(requests.every(type => ['listSessions', 'status', 'getSnapshot', 'readSession'].includes(type)), 'fake daemon receives reads only');
});
