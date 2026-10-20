// Noam 2026-10-20 (paper-bot_dev): "The bot could not answer: The brain stopped (exit 143)" — the
// agents service was restarted while the bot was replying. A restart now lets running replies finish,
// keeps messages that arrive meanwhile, and a reply killed anyway is re-run once with no scary error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, runBrain } from '../bridge/bots.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-restart-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (bots, id) => { for (let i = 0; i < 400 && bots.running.has(id); i++) await wait(5); };
const ready = () => { const home = tmp(); fs.mkdirSync(path.join(home, '.claude')); fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}'); fs.writeFileSync(path.join(home, 'daemon.sock'), ''); return { home, socket: path.join(home, 'daemon.sock') }; };

test('a brain killed from outside is reported as killed, not as a failed answer', async () => {
  const dir = tmp(), fake = path.join(dir, 'slow-claude.mjs');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n', { mode: 0o755 });
  const p = runBrain({ id: 'abcdefabcdef', name: 'X', provider: 'claude', cwd: dir, sessions: {} }, 'hi', { bins: { claude: fake } });
  await wait(300);
  execFileSync('pkill', ['-TERM', '-f', fake]);
  const r = await p;
  assert.equal(r.killed, true);
});

test('restart: running reply finishes, a message sent meanwhile is kept and answered after', async () => {
  const dir = tmp();
  let release;
  const answers = [];
  const run = (_bot, text) => new Promise((resolve) => { answers.push(text); if (answers.length === 1) release = () => resolve({ text: 'First answer' }); else resolve({ text: 'Second answer' }); });
  const bots = new Bots({ dir, run, fill: () => null, checks: ready() });
  const { bot } = bots.create({ name: 'Quill', cwd: dir });
  bots.send(bot.id, 'one');
  await wait(20);
  const closing = bots.closeDown({ maxMs: 5000, pause: (ms) => wait(Math.min(ms, 10)) });
  bots.send(bot.id, 'two');               // arrives during the restart
  await wait(30);
  release();
  assert.deepEqual((await closing).unfinished, []);
  assert.equal(answers.length, 1, 'nothing new started while closing');
  assert.deepEqual(bots.read(bot.id).queued, ['two']);
  const after = new Bots({ dir, run, fill: () => null, checks: ready() });  // the new service
  after.resumeInterrupted();
  await settle(after, bot.id);
  const roles = after.view(bot.id).messages.map((m) => [m.role, m.text]);
  assert.deepEqual(roles.filter(([r]) => r === 'bot').map(([, t]) => t), ['First answer', 'Second answer']);
  assert.equal(roles.some(([r]) => r === 'error'), false);
});

test('restart: a reply killed anyway is re-run once after it, no error; killed twice says so plainly', async () => {
  const dir = tmp();
  const kill = async () => ({ killed: true, error: 'The brain stopped (exit 143).', code: 143 });
  const bots = new Bots({ dir, run: (_b, _t, { onStart } = {}) => new Promise((resolve) => { onStart?.(() => {}); setTimeout(() => resolve({ killed: true, error: 'The brain stopped (exit 143).', code: 143 }), 30); }), fill: () => null, checks: ready() });
  const { bot } = bots.create({ name: 'Quill', cwd: dir });
  bots.send(bot.id, 'do the thing');
  await wait(5);
  await bots.closeDown({ maxMs: 2000, pause: (ms) => wait(Math.min(ms, 10)) });
  assert.equal(bots.read(bot.id).inflight.text, 'do the thing', 'kept for after the restart');
  assert.equal(bots.view(bot.id).messages.some((m) => m.role === 'error'), false);
  const texts = [];
  const after = new Bots({ dir, run: async (_b, t) => { texts.push(t); return { text: 'Done after restart' }; }, fill: () => null, checks: ready() });
  after.resumeInterrupted();
  await settle(after, bot.id);
  assert.match(texts[0], /cut off by a restart[\s\S]*do the thing/);
  assert.equal(after.view(bot.id).messages.at(-1).text, 'Done after restart');
  assert.equal(after.view(bot.id).messages.some((m) => m.role === 'error'), false);
  // Killed during the re-run too: the next restart shows one plain line instead of looping.
  const last = new Bots({ dir, run: kill, fill: () => null, checks: ready() });
  const b = last.read(bot.id); b.inflight = { text: 'second job', at: 1, resumed: true }; last.write(b);   // as left by a re-run that was cut too
  last.resumeInterrupted();
  assert.match(last.view(bot.id).messages.at(-1).text, /cut off twice by restarts/);
});

test('a reply killed outside a restart is re-run once in place; only a second kill shows an error', async () => {
  const dir = tmp();
  let n = 0;
  const bots = new Bots({ dir, run: async () => (++n === 1 ? { killed: true, error: 'The brain stopped (exit 143).', code: 143 } : { text: 'Answer on the second try' }), fill: () => null, checks: ready() });
  const { bot } = bots.create({ name: 'Quill', cwd: dir });
  bots.send(bot.id, 'hi');
  await settle(bots, bot.id);
  const msgs = bots.view(bot.id).messages;
  assert.equal(msgs.at(-1).text, 'Answer on the second try');
  assert.equal(msgs.some((m) => m.role === 'error'), false);
  const always = new Bots({ dir, run: async () => ({ killed: true, error: 'The brain stopped (exit 143).', code: 143 }), fill: () => null, checks: ready() });
  always.send(bot.id, 'again');
  await settle(always, bot.id);
  assert.equal(always.view(bot.id).messages.at(-1).role, 'error');
});

// The real service: a throwaway bot mid-reply while the service gets the restart signal.
test('real service restart with a throwaway bot mid-reply', { timeout: 120000 }, async () => {
  const root = tmp(), cfg = path.join(root, 'cfg'), home = path.join(root, 'home');
  for (const d of [cfg, home]) fs.mkdirSync(d);
  const fake = path.join(root, 'fake-claude.mjs'), count = path.join(root, 'count');
  fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const n = (Number(fs.existsSync('${count}') ? fs.readFileSync('${count}', 'utf8') : 0) || 0) + 1;
fs.writeFileSync('${count}', String(n));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: '11111111-1111-4111-8111-11111111111' + n });
setTimeout(() => out({ type: 'result', subtype: 'success', result: 'Reply number ' + n }), Number(process.env.FAKE_MS || 3000));
`, { mode: 0o755 });
  const start = (extra = {}) => {
    const port = 7300 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, [path.resolve('termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: cfg, TC_HOST: '127.0.0.1', TC_BOTS_HOME: home, TC_NO_AGENT_HEALTH: '1', TC_CLAUDE_BIN: fake, TC_DESK_STT: '0', ...extra }, stdio: 'ignore' });
    child.exited = new Promise((r) => child.on('exit', () => r(Date.now())));
    return { port, child };
  };
  const up = async (port) => { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await wait(150); } } };
  const browser = await chromium.launch();
  const chat = (id) => new Bots({ dir: path.join(cfg, 'bots'), run: async () => ({}) }).messages(id);
  const login = async (port) => {
    const p = await (await browser.newContext()).newPage();
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
    return p;
  };
  const say = (p, id, text) => p.evaluate(async ([botId, t]) => (await fetch('/api/bot/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: botId, text: t }) })).status, [id, text]);
  try {
    // 1) Restart while replying: the service waits for the reply, and a message sent meanwhile is answered after.
    let s = start({ FAKE_MS: '3000' }); await up(s.port);
    let p = await login(s.port);
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Restart throwaway' }) })).json()).bot.id);
    await say(p, id, 'first question');
    await wait(800);
    const signalled = Date.now();
    s.child.kill('SIGTERM');
    await wait(300);
    assert.equal(await say(p, id, 'asked during the restart'), 200, 'the phone still works while it waits');
    const exitedAt = await s.child.exited;
    assert.ok(exitedAt - signalled > 1500, 'it waited for the reply before stopping');
    assert.ok(chat(id).some((m) => m.role === 'bot' && m.text === 'Reply number 1'));
    s = start({ FAKE_MS: '200' }); await up(s.port);
    for (let i = 0; i < 100 && !chat(id).some((m) => m.text === 'Reply number 2'); i++) await wait(100);
    assert.ok(chat(id).some((m) => m.text === 'Reply number 2'), 'the message sent during the restart got its answer');
    s.child.kill('SIGTERM'); await s.child.exited;
    // 2) A reply longer than the wait: it is cut, then re-run after the restart with no error in the chat.
    s = start({ FAKE_MS: '20000', TC_RESTART_WAIT_MS: '500' }); await up(s.port);
    p = await login(s.port);
    await say(p, id, 'a long job');
    await wait(800);
    s.child.kill('SIGTERM'); await s.child.exited;
    try { execFileSync('pkill', ['-KILL', '-f', fake]); } catch { /* already gone */ }   // what systemd does to leftovers
    s = start({ FAKE_MS: '200' }); await up(s.port);
    for (let i = 0; i < 100 && !chat(id).some((m) => m.text === 'Reply number 4'); i++) await wait(100);
    const tail = chat(id).slice(-3).map((m) => [m.role, m.text]);
    assert.deepEqual(tail, [['operator', 'a long job'], ['system', 'Restart throwaway was cut off by a restart and is picking up where it was.'], ['bot', 'Reply number 4']]);
    assert.equal(chat(id).some((m) => m.role === 'error'), false);
    s.child.kill('SIGTERM'); await s.child.exited;
  } finally { await browser.close(); try { execFileSync('pkill', ['-KILL', '-f', fake]); } catch { /* none */ } fs.rmSync(root, { recursive: true, force: true }); }
});
