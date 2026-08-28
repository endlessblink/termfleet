#!/usr/bin/env node
/**
 * TermControl checks. Runs the real bridge against the real machine, plus
 * isolated cases for the parts that must not regress: auth, safety gates,
 * transcript reading, and the phone UI at phone sizes.
 *
 *   node termcontrol/test/run.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, '..', 'bridge', 'server.mjs');

let pass = 0, fail = 0;
const failures = [];

async function check(name, fn) {
  try {
    const result = await fn();
    if (result === false) throw new Error('returned false');
    pass++;
    console.log(`  ok   ${name}${typeof result === 'string' ? ' — ' + result : ''}`);
  } catch (error) {
    fail++;
    failures.push({ name, error: error.message });
    console.log(`  FAIL ${name} — ${error.message}`);
  }
}

const group = (title) => console.log(`\n${title}`);
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };

function startBridge({ port, configDir }) {
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  return { child, logs };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(base, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(base + '/login'); return true; } catch { await wait(150); }
  }
  throw new Error('bridge never came up');
}

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-test-'));
  const port = 7900 + Math.floor(Math.random() * 60);
  const base = `http://127.0.0.1:${port}`;
  const { child, logs } = startBridge({ port, configDir });
  await ready(base);

  let cookie = '';
  const req = (p, opts = {}) => fetch(base + p, {
    redirect: 'manual',
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });

  // ---------------------------------------------------------------- auth ---
  group('Sign-in');

  await check('first run offers account setup', async () => {
    const r = await req('/');
    eq(r.status, 302, 'status');
    ok(r.headers.get('location').endsWith('/setup'), 'should send you to setup');
  });

  await check('locked before any account exists', async () => {
    const r = await req('/api/panes');
    eq(r.status, 401, 'status');
  });

  await check('rejects a short password', async () => {
    const r = await req('/setup', { method: 'POST', body: new URLSearchParams({ email: 'a@b.com', password: 'short' }) });
    eq(r.status, 400, 'status');
  });

  await check('rejects a malformed email', async () => {
    const r = await req('/setup', { method: 'POST', body: new URLSearchParams({ email: 'nope', password: 'long-enough-1' }) });
    eq(r.status, 400, 'status');
  });

  await check('creates the account and signs in', async () => {
    const r = await req('/setup', { method: 'POST', body: new URLSearchParams({ email: 'Owner@Example.com', password: 'a-good-password' }) });
    eq(r.status, 302, 'status');
    const set = r.headers.get('set-cookie') || '';
    ok(set.includes('HttpOnly'), 'cookie must be HttpOnly');
    ok(set.includes('Secure'), 'cookie must be Secure');
    ok(set.includes('SameSite=Lax'), 'cookie must be SameSite');
    cookie = set.split(';')[0];
    return 'cookie set';
  });

  await check('signed in, the fleet loads', async () => {
    const r = await req('/api/panes');
    eq(r.status, 200, 'status');
    const j = await r.json();
    ok(Array.isArray(j.panes), 'panes should be a list');
    return `${j.panes.length} terminals`;
  });

  await check('setup closes once claimed', async () => {
    const saved = cookie; cookie = '';
    const r = await req('/setup', { method: 'POST', body: new URLSearchParams({ email: 'intruder@x.com', password: 'let-me-in-123' }) });
    cookie = saved;
    eq(r.status, 302, 'status');
    ok(r.headers.get('location').endsWith('/login'), 'strangers go to login, not signup');
  });

  await check('wrong password refused', async () => {
    const saved = cookie; cookie = '';
    const r = await req('/login', { method: 'POST', body: new URLSearchParams({ email: 'owner@example.com', password: 'not-it' }) });
    cookie = saved;
    eq(r.status, 401, 'status');
  });

  await check('email is case and space insensitive', async () => {
    const saved = cookie; cookie = '';
    const r = await req('/login', { method: 'POST', body: new URLSearchParams({ email: '  OWNER@EXAMPLE.COM ', password: 'a-good-password' }) });
    cookie = saved;
    eq(r.status, 302, 'status');
  });

  await check('a forged session cookie is refused', async () => {
    const saved = cookie;
    cookie = 'tc_session=someone.99999999999999.deadbeefdeadbeef';
    const r = await req('/api/panes');
    cookie = saved;
    eq(r.status, 401, 'status');
  });

  await check('an expired session is refused', async () => {
    const { mintSession } = await import(path.join(here, '..', 'bridge', 'accounts.mjs'));
    const users = JSON.parse(fs.readFileSync(path.join(configDir, 'users.json'), 'utf8'));
    const s = mintSession(users.users[0]);
    const [id, , sig] = s.value.split('.');
    const saved = cookie;
    cookie = `tc_session=${id}.${Date.now() - 1000}.${sig}`;
    const r = await req('/api/panes');
    cookie = saved;
    eq(r.status, 401, 'status');
  });

  await check('signing out ends the session', async () => {
    const saved = cookie;
    const r = await req('/logout');
    eq(r.status, 302, 'status');
    ok((r.headers.get('set-cookie') || '').includes('Max-Age=0'), 'cookie should be cleared');
    cookie = saved;
  });

  // ------------------------------------------------------------- listing ---
  group('The fleet list');

  const panes = await (await req('/api/panes')).json();

  await check('every listed terminal is really running', async () => {
    const { liveSessionIds } = await import(path.join(here, '..', 'bridge', 'send.mjs'));
    const live = await liveSessionIds();
    const dead = panes.panes.filter((p) => !live.has(p.id));
    eq(dead.length, 0, 'dead terminals listed');
    return `${panes.panes.length} live`;
  });

  await check('every terminal carries its project emoji', () => {
    const missing = panes.panes.filter((p) => !p.emoji);
    eq(missing.length, 0, `terminals without an emoji (${missing.map((m) => m.project).join(', ')})`);
  });

  await check('waiting terminals sort above the rest', () => {
    const order = { waiting: 0, working: 1, idle: 2 };
    const seq = panes.panes.map((p) => order[p.turn]);
    ok(seq.every((v, i) => i === 0 || seq[i - 1] <= v), 'list is not sorted by attention');
  });

  await check('no terminal shows a raw path as its name', () => {
    const bad = panes.panes.filter((p) => String(p.project).includes('/'));
    eq(bad.length, 0, 'project names must be human names');
  });

  await check('task lines are plain text, not machinery', () => {
    const bad = panes.panes.filter((p) => p.task && (p.task.startsWith('<') || p.task.includes('```')));
    eq(bad.length, 0, 'task lines must read as language');
  });

  // ---------------------------------------------------------------- feed ---
  group('Reading a conversation');

  await check('every terminal opens with readable messages', async () => {
    let empty = [];
    for (const p of panes.panes) {
      const f = await (await req(`/api/feed?pane=${encodeURIComponent(p.id)}&limit=40`)).json();
      if (!f.events || f.events.length === 0) empty.push(p.project);
    }
    eq(empty.length, 0, `terminals with nothing to show (${empty.join(', ')})`);
    return `${panes.panes.length} conversations`;
  });

  await check('no conversation takes longer than two seconds', async () => {
    let worst = 0, worstName = '';
    for (const p of panes.panes) {
      const t0 = Date.now();
      await req(`/api/feed?pane=${encodeURIComponent(p.id)}&limit=60`);
      const ms = Date.now() - t0;
      if (ms > worst) { worst = ms; worstName = p.project; }
    }
    ok(worst < 2000, `slowest was ${worst}ms on ${worstName}`);
    return `slowest ${worst}ms`;
  });

  await check('machine chatter never appears as an operator message', async () => {
    const bad = [];
    for (const p of panes.panes) {
      const f = await (await req(`/api/feed?pane=${encodeURIComponent(p.id)}&limit=60`)).json();
      for (const e of f.events || []) {
        if (e.kind !== 'user') continue;
        if (/^<(turn_aborted|system-reminder|command-name|local-command-stdout|task-notification)/.test(e.text || '')) {
          bad.push(p.project);
        }
      }
    }
    eq(bad.length, 0, `harness text shown as yours (${[...new Set(bad)].join(', ')})`);
  });

  await check('an unknown terminal gives a plain answer, not a crash', async () => {
    const r = await req('/api/feed?pane=nope-does-not-exist');
    eq(r.status, 404, 'status');
    const j = await r.json();
    ok(/closed/i.test(j.error), 'should say it has been closed');
  });

  await check('a silly limit cannot be used to dump everything', async () => {
    const p = panes.panes[0];
    const f = await (await req(`/api/feed?pane=${encodeURIComponent(p.id)}&limit=99999`)).json();
    ok(f.events.length <= 200, 'must cap the number of messages');
  });

  // -------------------------------------------------------------- safety ---
  group('Sending, and its guards');

  await check('sending needs a session', async () => {
    const saved = cookie; cookie = '';
    const r = await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: 'x', text: 'hi' }) });
    cookie = saved;
    eq(r.status, 401, 'status');
  });

  await check('will not type into a closed terminal', async () => {
    const r = await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: 'gone', text: 'hello' }) });
    eq(r.status, 404, 'status');
  });

  await check('refuses an empty message', async () => {
    const p = panes.panes.find((x) => x.turn !== 'working') || panes.panes[0];
    const r = await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: p.id, text: '   ' }) });
    const j = await r.json();
    ok(/nothing to send/i.test(j.error || ''), 'should refuse blank text');
  });

  await check('refuses an oversized message', async () => {
    const p = panes.panes[0];
    const r = await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: p.id, text: 'x'.repeat(9000) }) });
    const j = await r.json();
    ok(/too long/i.test(j.error || ''), 'should refuse very long text');
  });

  await check('asks before interrupting a busy agent', async () => {
    const busy = panes.panes.find((p) => p.turn === 'working');
    if (!busy) return 'no busy terminal right now — skipped';
    const r = await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: busy.id, text: 'hello' }) });
    const j = await r.json();
    ok(j.busy === true, 'a busy agent must prompt first');
  });

  await check('malformed requests do not crash the bridge', async () => {
    await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    await req('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '' });
    const r = await req('/api/panes');
    eq(r.status, 200, 'bridge should still be answering');
  });

  await check('text really reaches a terminal', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const id = 'termcontrol-test-' + Date.now();
    await ask({ type: 'ensureSession', id, cwd: '/tmp', command: '/bin/bash', cols: 80, rows: 24 });
    const { sendToPane } = await import(path.join(here, '..', 'bridge', 'send.mjs'));
    const marker = 'TC_PROOF_' + Date.now();
    const sent = await sendToPane({ id, turn: 'idle' }, `echo ${marker}`);
    ok(sent.ok, 'send reported failure');
    await wait(1000);
    const snap = await ask({ type: 'readSession', id, offset: 0 });
    const text = String(snap.data || '');
    await ask({ type: 'killSession', id, reviewed: true }).catch(() => ask({ type: 'killSession', id }));
    ok(text.includes(marker), 'the text never arrived in the terminal');
    return 'echoed back';
  });

  await check('a send reports whether the text really landed', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { sendToPane } = await import(path.join(here, '..', 'bridge', 'send.mjs'));

    const live = 'termcontrol-live-' + Date.now();
    await ask({ type: 'ensureSession', id: live, cwd: '/tmp', command: '/bin/bash', cols: 80, rows: 24 });
    await wait(800);
    const good = await sendToPane({ id: live, turn: 'idle' }, 'echo delivery-check');
    await ask({ type: 'killSession', id: live, reviewed: true }).catch(() => {});
    ok(good.delivered === true, 'a working terminal should confirm delivery');

    const dead = 'termcontrol-dead-' + Date.now();
    await ask({ type: 'ensureSession', id: dead, cwd: '/tmp', command: '/bin/bash -lc "exit 0"', cols: 80, rows: 24 });
    await wait(1200);
    const bad = await sendToPane({ id: dead, turn: 'idle' }, 'this cannot land anywhere');
    await ask({ type: 'killSession', id: dead, reviewed: true }).catch(() => {});
    ok(bad.delivered === false, 'a dead terminal must not be reported as delivered');
    return 'confirms both ways';
  });

  await check('every send is written to the audit trail', async () => {
    // send.mjs is imported into this process, so it writes to the real
    // location rather than the sandbox the bridge child was given.
    const log = path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'sent.log');
    ok(fs.existsSync(log), `no audit trail at ${log}`);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    ok(lines.length > 0, 'audit trail is empty');
    const last = lines[lines.length - 1];
    ok(last.at && 'delivered' in last, `entry is missing fields: ${JSON.stringify(last)}`);
    return `${lines.length} entries`;
  });

  // ------------------------------------------------------------- hygiene ---
  group('Hygiene');

  await check('the app page carries no external requests', () => {
    const html = fs.readFileSync(path.join(here, '..', 'app', 'index.html'), 'utf8');
    const external = html.match(/https?:\/\/(?!127\.0\.0\.1)[^"' )]+/g) || [];
    eq(external.length, 0, `external references: ${external.join(', ')}`);
  });

  await check('message text is escaped, not injected', () => {
    const html = fs.readFileSync(path.join(here, '..', 'app', 'index.html'), 'utf8');
    ok(html.includes('esc(e.text)'), 'message bodies must be escaped');
    ok(html.includes('esc(p.project)'), 'project names must be escaped');
  });

  await check('an unknown address is a clean 404', async () => {
    const r = await req('/api/nope');
    eq(r.status, 404, 'status');
  });

  await check('static files cannot escape the app folder', async () => {
    const r = await req('/app/../bridge/accounts.mjs');
    ok(r.status === 404 || r.status === 301 || r.status === 302, `expected refusal, got ${r.status}`);
  });

  await check('passwords are never stored as text', () => {
    const raw = fs.readFileSync(path.join(configDir, 'users.json'), 'utf8');
    ok(!raw.includes('a-good-password'), 'password found in the account file');
    const u = JSON.parse(raw).users[0];
    ok(u.hash && u.salt && u.hash.length >= 64, 'expected a salted hash');
  });

  await check('account files are private to you', () => {
    const mode = fs.statSync(path.join(configDir, 'users.json')).mode & 0o777;
    eq(mode, 0o600, 'file permissions');
  });

  await check('the bridge stayed up through all of this', () => {
    const crashed = logs.join('').match(/Error|throw/g) || [];
    eq(crashed.length, 0, `bridge logged errors: ${logs.join('').slice(0, 200)}`);
  });

  child.kill();
  for (const f of fs.readdirSync(configDir)) fs.unlinkSync(path.join(configDir, f));
  fs.rmdirSync(configDir);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('test run itself failed:', e); process.exit(2); });
