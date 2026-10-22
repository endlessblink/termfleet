// Noam 2026-10-22: 'אני רוצה שתהיה לי גישה לכמה סוכנים שאני צריך אבל שהם לא יגנבו הרבה זיכרון
// במצב idle'. An idle agent terminal goes to sleep: its programs end, its card and conversation
// stay, and it wakes by resuming the same conversation when it is opened, typed to or sent to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sleepPaths, readSettings, writeSettings, setKeepAwake, isKeepAwake, isSleeping, readSleep,
  markViewing, viewedAt, sleepVerdict, workProcesses, sleepPane, wakePane, sweepSleep, withSleepingLives,
  DEFAULT_IDLE_MINUTES,
} from '../bridge/sleep.mjs';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const MIN = 60_000;
const tmp = () => sleepPaths({ XDG_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-sleep-')) });
const pane = (id, extra = {}) => ({ id, provider: 'claude', sessionId: 'sess-1', cwd: '/work/demo', project: 'demo', alive: true, turn: 'idle', producing: false, lastActiveAt: NOW - 45 * MIN, pid: 100, ...extra });
const calm = (paths, extra = {}) => ({ now: NOW, paths, processes: () => [], visitedAt: () => 0, ...extra });

test('settings default to on and 20 minutes, and can be changed', () => {
  const paths = tmp();
  assert.deepEqual(readSettings(paths), { enabled: true, idleMinutes: DEFAULT_IDLE_MINUTES });
  assert.equal(DEFAULT_IDLE_MINUTES, 20);
  writeSettings(paths, { idleMinutes: 45 });
  assert.deepEqual(readSettings(paths), { enabled: true, idleMinutes: 45 });
  writeSettings(paths, { enabled: false, idleMinutes: 'nonsense' });
  assert.deepEqual(readSettings(paths), { enabled: false, idleMinutes: 45 });
});

test('an idle agent with a saved conversation may sleep', () => {
  assert.equal(sleepVerdict(pane('terminal-a'), calm(tmp())), null);
});

test('never sleeps what is working, waiting, recent, viewed, kept awake, not an agent, or has no conversation', () => {
  const paths = tmp();
  setKeepAwake('terminal-kept', true, paths);
  markViewing('terminal-viewed', paths, NOW - 30_000);
  const cases = [
    [pane('terminal-work', { turn: 'working' }), 'Working right now'],
    [pane('terminal-print', { producing: true }), 'Working right now'],
    [pane('terminal-ask', { turn: 'waiting' }), 'Waiting for you'],
    [pane('terminal-ask2', { attention: { kind: 'question' } }), 'Waiting for you'],
    [pane('terminal-fresh', { lastActiveAt: NOW - 5 * MIN }), 'Used in the last 20 minutes'],
    [pane('terminal-kept'), 'Kept awake'],
    [pane('terminal-viewed'), 'Open on the PC right now'],
    [pane('terminal-shell', { provider: 'shell' }), 'Not an agent'],
    [pane('terminal-nosess', { sessionId: null }), 'No saved conversation to come back to'],
    [pane('terminal-gone', { alive: false }), 'Not running'],
  ];
  for (const [p, reason] of cases) assert.equal(sleepVerdict(p, calm(paths)), reason, p.id);
  assert.equal(sleepVerdict(pane('terminal-phone'), calm(paths, { visitedAt: () => NOW - 3 * MIN })), 'Opened on the phone recently');
  assert.equal(sleepVerdict(pane('terminal-run'), calm(paths, { processes: () => [{ pid: 9, comm: 'npm' }] })), 'Something is still running in it (npm)');
  assert.equal(sleepVerdict(pane('terminal-svc'), calm(paths, { processes: () => [{ pid: 9, comm: 'node', cmd: 'node termcontrol/bridge/server.mjs' }] })), 'Runs the Agents service');
  fs.mkdirSync(paths.urgent, { recursive: true });
  fs.writeFileSync(path.join(paths.urgent, 'terminal-urgent.json'), '{}');
  assert.equal(sleepVerdict(pane('terminal-urgent'), calm(paths)), 'Marked urgent');
  writeSettings(paths, { enabled: false });
  assert.equal(sleepVerdict(pane('terminal-a'), calm(paths)), 'Sleep is off');
});

test('the agent and helpers it started with are not work; a build it started later is', () => {
  const table = [
    { pid: 100, ppid: 1, comm: 'bash', cmd: 'bash -lc claude' },
    { pid: 101, ppid: 100, comm: 'claude', cmd: 'claude --resume x' },
    { pid: 102, ppid: 101, comm: 'node', cmd: 'node lean-ctx mcp' },
    { pid: 103, ppid: 101, comm: 'npm', cmd: 'npm run build' },
    { pid: 104, ppid: 103, comm: 'node', cmd: 'node vite build' },
    { pid: 105, ppid: 101, comm: 'node', cmd: 'node some-mcp-server' },
  ];
  const start = { 100: 1000, 101: 1001, 102: 1005, 103: 1600, 104: 1601, 105: 1700 };
  const work = workProcesses(100, table, (pid) => start[pid]);
  assert.deepEqual(work.map((p) => p.pid), [103, 104]);
  // A program the shell runs beside the agent (a dev server started before it) is work too.
  const beside = [...table.slice(0, 3), { pid: 110, ppid: 100, comm: 'python3', cmd: 'python3 -m http.server' }];
  assert.deepEqual(workProcesses(100, beside, (pid) => start[pid] ?? 990).map((p) => p.pid), [110]);
  // A woken terminal runs the agent as its own process: its boot helpers are still not work.
  // A language server the agent opened later is its own helper, not work.
  const lsp = [...table.slice(0, 2), { pid: 120, ppid: 101, comm: 'basedpyright-la', cmd: 'node basedpyright-langserver --stdio' }];
  assert.deepEqual(workProcesses(100, lsp, (pid) => ({ ...start, 120: 4000 })[pid]), []);
  const woken = [{ pid: 200, ppid: 1, comm: 'claude', cmd: 'claude --resume x' }, { pid: 201, ppid: 200, comm: 'node', cmd: 'node lean-ctx' }, { pid: 202, ppid: 200, comm: 'bash', cmd: 'bash -c helper' }];
  assert.deepEqual(workProcesses(200, woken, (pid) => ({ 200: 5000, 201: 5004, 202: 5010 })[pid]), []);
});

test('sleep records the conversation, ends the programs as recoverable, and measures what it freed', async () => {
  const paths = tmp();
  const asked = [];
  let running = true;
  const ask = async (req) => {
    asked.push(req);
    if (req.type === 'killSession') { running = false; return { ok: true, value: { ok: true } }; }
    if (req.type === 'listSessions') return { ok: true, value: { sessions: running ? [{ id: 'terminal-a', lastExit: null }] : [] } };
    return { ok: false };
  };
  const result = await sleepPane(pane('terminal-a', { title: 'Quill' }), { ask, paths, now: NOW, rssOf: () => 380 * 1024 * 1024 });
  assert.equal(result.ok, true);
  assert.equal(result.freedBytes, 380 * 1024 * 1024);
  assert.deepEqual(asked[0], { type: 'killSession', id: 'terminal-a', user_requested: false });
  const rec = readSleep('terminal-a', paths);
  assert.equal(rec.sessionId, 'sess-1');
  assert.equal(rec.cwd, '/work/demo');
  assert.equal(rec.provider, 'claude');
  assert.equal(rec.sleptAt, NOW);
  assert.equal(rec.pid, 100);
  assert.equal(isSleeping('terminal-a', paths), true);
  // The cleanup agent checks this exact file to never close a sleeping card.
  assert.ok(fs.existsSync(path.join(paths.sleeping, 'terminal-a.json')));
});

test('a sleep the terminal service refuses leaves the terminal awake and unmarked', async () => {
  const paths = tmp();
  const ask = async (req) => (req.type === 'listSessions' ? { ok: true, value: { sessions: [{ id: 'terminal-a', lastExit: null }] } } : { ok: false, error: 'busy' });
  const result = await sleepPane(pane('terminal-a'), { ask, paths, now: NOW, rssOf: () => 0 });
  assert.equal(result.ok, false);
  assert.equal(isSleeping('terminal-a', paths), false);
});

test('wake resumes the same terminal in its folder, clears the mark, and waits until it is ready', async () => {
  const paths = tmp();
  fs.mkdirSync(paths.sleeping, { recursive: true });
  fs.writeFileSync(path.join(paths.sleeping, 'terminal-a.json'), JSON.stringify({ paneId: 'terminal-a', provider: 'claude', sessionId: 'sess-1', cwd: '/work/demo', sleptAt: NOW }));
  const asked = [];
  let readyChecked = false;
  const ask = async (req) => { asked.push(req); return { ok: true, value: { id: 'terminal-a', reused: false } }; };
  const result = await wakePane('terminal-a', { ask, paths, waitReady: async () => { readyChecked = true; } });
  assert.equal(result.ok, true);
  assert.deepEqual(asked[0], { type: 'ensureSession', id: 'terminal-a', cwd: '/work/demo', command: null });
  assert.equal(isSleeping('terminal-a', paths), false);
  assert.equal(readyChecked, true);
  // Waking a terminal that is not asleep is a no-op.
  assert.deepEqual(await wakePane('terminal-a', { ask, paths, waitReady: async () => {} }), { ok: true, already: true });
  assert.equal(asked.length, 1);
});

test('a failed wake keeps the mark so the card still says Sleeping', async () => {
  const paths = tmp();
  fs.mkdirSync(paths.sleeping, { recursive: true });
  fs.writeFileSync(path.join(paths.sleeping, 'terminal-a.json'), JSON.stringify({ paneId: 'terminal-a', cwd: '/w' }));
  const result = await wakePane('terminal-a', { ask: async () => ({ ok: false, error: 'nope' }), paths, waitReady: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(isSleeping('terminal-a', paths), true);
});

test('two wakes at once start the agent once', async () => {
  const paths = tmp();
  fs.mkdirSync(paths.sleeping, { recursive: true });
  fs.writeFileSync(path.join(paths.sleeping, 'terminal-a.json'), JSON.stringify({ paneId: 'terminal-a', cwd: '/w' }));
  let ensures = 0;
  const ask = async () => { ensures++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, value: { id: 'terminal-a' } }; };
  const [a, b] = await Promise.all([wakePane('terminal-a', { ask, paths, waitReady: async () => {} }), wakePane('terminal-a', { ask, paths, waitReady: async () => {} })]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(ensures, 1);
});

test('sleeping cards stay listed as sleeping terminals', () => {
  const paths = tmp();
  fs.mkdirSync(paths.sleeping, { recursive: true });
  fs.writeFileSync(path.join(paths.sleeping, 'terminal-z.json'), JSON.stringify({ paneId: 'terminal-z', cwd: '/work/z' }));
  const byId = new Map([['terminal-a', { alive: true, exited: false }]]);
  withSleepingLives(byId, paths);
  assert.equal(byId.get('terminal-z').sleeping, true);
  assert.equal(byId.get('terminal-z').exited, false);
  assert.equal(byId.get('terminal-z').initialCwd, '/work/z');
  // A list read just before the sleep (same program still listed) never wipes the fresh mark.
  byId.set('terminal-a', { alive: true, exited: false, pid: 500 });
  fs.writeFileSync(path.join(paths.sleeping, 'terminal-a.json'), JSON.stringify({ paneId: 'terminal-a', pid: 500 }));
  withSleepingLives(byId, paths);
  assert.equal(isSleeping('terminal-a', paths), true);
  // A mark left behind for a terminal that runs a NEW program again (woken on the PC) is dropped.
  byId.set('terminal-a', { alive: true, exited: false, pid: 777 });
  withSleepingLives(byId, paths);
  assert.equal(byId.get('terminal-a').sleeping, undefined);
  assert.equal(isSleeping('terminal-a', paths), false);
});

test('the sweep sleeps only eligible agents and reports memory freed', async () => {
  const paths = tmp();
  const slept = [];
  const out = await sweepSleep({
    panes: [pane('terminal-a'), pane('terminal-b', { turn: 'working' }), pane('terminal-c', { sleeping: true })],
    ...calm(paths),
    sleep: async (p) => { slept.push(p.id); return { ok: true, freedBytes: 100 }; },
  });
  assert.deepEqual(slept, ['terminal-a']);
  assert.equal(out.freedBytes, 100);
});

test('keep awake is a per-terminal switch', () => {
  const paths = tmp();
  assert.equal(isKeepAwake('terminal-a', paths), false);
  setKeepAwake('terminal-a', true, paths);
  assert.equal(isKeepAwake('terminal-a', paths), true);
  setKeepAwake('terminal-a', false, paths);
  assert.equal(isKeepAwake('terminal-a', paths), false);
  markViewing('terminal-a', paths, NOW);
  assert.equal(Math.round(viewedAt('terminal-a', paths) / 1000), Math.round(NOW / 1000));
});
