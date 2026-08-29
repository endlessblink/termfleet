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

  await check('every terminal is labelled with the project it is really in', () => {
    // A terminal can be reused in a different folder than the lane it was
    // opened under, and the lane's name is then simply wrong.
    const wrong = panes.panes
      .filter((p) => p.cwd)
      .map((p) => ({ shown: p.project, actual: p.cwd.split('/').filter(Boolean).pop() }))
      .filter((r) => r.shown !== r.actual);
    eq(wrong.length, 0, wrong.map((w) => `shown as ${w.shown}, actually in ${w.actual}`).join('; '));
    return `${panes.panes.length} correct`;
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

  await check('a busy terminal reads as live, a quiet one does not', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { liveness } = await import(path.join(here, '..', 'bridge', 'liveness.mjs'));

    const busy = 'tc-live-busy-' + Date.now();
    const quiet = 'tc-live-quiet-' + Date.now();
    await ask({ type: 'ensureSession', id: busy, cwd: '/tmp', command: "/bin/bash -lc 'while true; do date; sleep 1; done'", cols: 80, rows: 24 });
    await ask({ type: 'ensureSession', id: quiet, cwd: '/tmp', command: '/bin/bash', cols: 80, rows: 24 });
    await wait(1200);

    // Liveness is sampled: the first look sets a baseline and the next one
    // sees whether output grew. Give it a few samples rather than one.
    let b = null;
    let q = null;
    for (let i = 0; i < 6; i++) {
      await wait(1200);
      const now = await liveness();
      b = now.byId.get(busy);
      q = now.byId.get(quiet);
      if (b && b.producing) break;
    }
    await ask({ type: 'killSession', id: busy, reviewed: true }).catch(() => {});
    await ask({ type: 'killSession', id: quiet, reviewed: true }).catch(() => {});

    ok(b && b.producing === true, 'a terminal printing every second must read as live');
    ok(q && q.producing === false, 'an idle shell must not read as live');
    return 'told apart correctly';
  });

  await check('a live terminal shows its own latest line', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { liveness, lastLine } = await import(path.join(here, '..', 'bridge', 'liveness.mjs'));

    const id = 'tc-heartbeat-' + Date.now();
    await ask({ type: 'ensureSession', id, cwd: '/tmp', command: "/bin/bash -lc 'while true; do echo HEARTBEAT-$RANDOM; sleep 1; done'", cols: 80, rows: 24 });
    await wait(1400);

    let life = null;
    for (let i = 0; i < 6; i++) {
      await wait(1100);
      life = (await liveness()).byId.get(id);
      if (life?.producing) break;
    }
    const line = await lastLine(id);
    await ask({ type: 'killSession', id, reviewed: true }).catch(() => {});

    ok(life?.producing, 'a printing terminal should read as live');
    ok(/HEARTBEAT-/.test(line || ''), `expected its own output, got ${JSON.stringify(line)}`);
    ok(life.pulse.some((v) => v > 0), 'the activity trace should show output arriving');
    return 'shows what it is printing';
  });

  await check('a quiet terminal offers no false movement', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { liveness } = await import(path.join(here, '..', 'bridge', 'liveness.mjs'));

    const id = 'tc-still-' + Date.now();
    await ask({ type: 'ensureSession', id, cwd: '/tmp', command: '/bin/bash', cols: 80, rows: 24 });
    await wait(1200);
    await liveness(); await wait(2500);
    const life = (await liveness()).byId.get(id);
    await ask({ type: 'killSession', id, reviewed: true }).catch(() => {});
    ok(life && life.producing === false, 'an idle shell must not look alive');
  });

  await check('a terminal that has gone stops being listed at all', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { liveness } = await import(path.join(here, '..', 'bridge', 'liveness.mjs'));

    const doomed = 'tc-live-gone-' + Date.now();
    await ask({ type: 'ensureSession', id: doomed, cwd: '/tmp', command: '/bin/bash', cols: 80, rows: 24 });
    await wait(900);
    ok((await liveness()).byId.has(doomed), 'it should be listed while it exists');

    await ask({ type: 'killSession', id: doomed, reviewed: true }).catch(() => {});
    await wait(1200);
    ok(!(await liveness()).byId.has(doomed), 'a closed terminal must not still read as alive');
    return 'disappears when closed';
  });

  await check('the fleet reports liveness for every terminal', async () => {
    const r = await req('/api/panes');
    const j = await r.json();
    const missing = j.panes.filter((p) => typeof p.producing !== 'boolean');
    eq(missing.length, 0, `${missing.length} terminals without a live reading`);
    const live = j.panes.filter((p) => p.producing).length;
    return `${live} of ${j.panes.length} producing output`;
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
    // Re-read: a terminal can finish between listing and sending.
    const fresh = await (await req('/api/panes')).json();
    const busy = fresh.panes.find((p) => p.producing || p.turn === 'working');
    if (!busy) return 'nothing busy right now — skipped';
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

    // A terminal that swallows input without echoing it: exactly the shape of
    // a session where your keystrokes go nowhere visible. An exited shell is
    // racy here — the daemon may still echo before it reaps the session.
    const dead = 'termcontrol-silent-' + Date.now();
    await ask({ type: 'ensureSession', id: dead, cwd: '/tmp', command: "/bin/bash -lc 'stty -echo -icanon 2>/dev/null; exec sleep 600'", cols: 80, rows: 24 });
    // Wait until the shell has actually turned echo off — sending before that
    // races the setup and the terminal echoes after all.
    for (let i = 0; i < 20; i++) {
      await wait(300);
      const probe = 'echo-probe-' + i;
      await ask({ type: 'writeSession', id: dead, data: probe });
      await wait(250);
      const snap = String((await ask({ type: 'snapshotSession', id: dead })).data || '');
      if (!snap.includes(probe)) break;          // echo is off; safe to test
    }
    const bad = await sendToPane({ id: dead, turn: 'idle' }, 'zzqx-unechoed-marker-' + Date.now());
    await ask({ type: 'killSession', id: dead, reviewed: true }).catch(() => {});
    ok(bad.delivered === false, 'a terminal that never showed the text must not be reported as delivered');
    return 'confirms both ways';
  });

  await check('a multi-line message arrives as one message, not several', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { sendToPane } = await import(path.join(here, '..', 'bridge', 'send.mjs'));

    // `cat -v` shows control codes, so we can see exactly what the terminal got.
    const id = 'tc-paste-' + Date.now();
    await ask({ type: 'ensureSession', id, cwd: '/tmp', command: "/bin/bash -lc 'cat -v'", cols: 100, rows: 24 });
    await wait(1100);
    await sendToPane({ id, turn: 'idle' }, 'first line\nsecond line');
    await wait(1400);
    const got = String((await ask({ type: 'readSession', id, offset: 0 })).data || '');
    await ask({ type: 'killSession', id, reviewed: true }).catch(() => {});

    // Bracketed paste: the terminal is told "this is one pasted block", so a
    // newline inside it does not submit the first line on its own.
    ok(got.includes('^[[200~') && got.includes('^[[201~'), 'the message was not sent as a single paste');
    return 'sent as one paste';
  });

  await check('a single-line message is sent plainly', async () => {
    const m = await import(path.join(here, '..', '..', 'scripts', 'termfleetctl.mjs'));
    const sock = m.defaultDaemonSocket();
    const ask = async (r) => { const x = await m.requestDaemon(r, sock); if (!x.ok) throw new Error('daemon refused'); return x.value; };
    const { sendToPane } = await import(path.join(here, '..', 'bridge', 'send.mjs'));

    const id = 'tc-plain-' + Date.now();
    await ask({ type: 'ensureSession', id, cwd: '/tmp', command: "/bin/bash -lc 'cat -v'", cols: 100, rows: 24 });
    await wait(1000);
    await sendToPane({ id, turn: 'idle' }, 'just one line');
    await wait(1200);
    const got = String((await ask({ type: 'readSession', id, offset: 0 })).data || '');
    await ask({ type: 'killSession', id, reviewed: true }).catch(() => {});
    ok(!got.includes('^[[200~'), 'a one-line message should not be wrapped');
  });

  await check('an image sent from the phone lands on the machine', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'screenshot.png');
    const r = await fetch(base + '/api/upload', { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
    const j = await r.json();
    eq(r.status, 200, 'status');
    ok(j.path && fs.existsSync(j.path), 'the image was not written to disk');
    ok(fs.readFileSync(j.path).equals(png), 'the image on disk does not match what was sent');
    fs.unlinkSync(j.path);
    return 'saved and identical';
  });

  await check('an image cannot be sent without signing in', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    const r = await fetch(base + '/api/upload', { method: 'POST', body: form });
    eq(r.status, 401, 'status');
  });

  await check('a file that is not an image is refused', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'note.txt');
    const r = await fetch(base + '/api/upload', { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
    const j = await r.json();
    ok(/not supported/i.test(j.error || ''), `expected a refusal, got ${JSON.stringify(j)}`);
  });

  await check('a pending question is offered with its options', async () => {
    const { pendingAsk } = await import(path.join(here, '..', 'bridge', 'asks.mjs'));
    // A pane recorded as waiting always gets the standard answers, even when
    // the question itself is only drawn on screen.
    const ask = pendingAsk({ provider: 'codex', turn: 'waiting', cwd: '/tmp', sessionId: 'none' });
    ok(ask && ask.options.length === 3, 'a waiting agent should offer answers');
    ok(ask.options.some((o) => /yes/i.test(o.label)) && ask.options.some((o) => /no/i.test(o.label)), 'expected yes and no');
    const quiet = pendingAsk({ provider: 'codex', turn: 'idle', cwd: '/tmp', sessionId: 'none' });
    ok(quiet === null, 'an idle agent must not appear to be asking anything');
    return 'offered when waiting, silent when not';
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

  child.kill('SIGKILL');
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
