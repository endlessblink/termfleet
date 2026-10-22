// Noam 2026-10-22: "אני רואה שיש מלא טרמינלים פתוחים במפה שהם לא בשימוש. למה הם לא נוקו?"
// and "Yes, build it" to a one-tap cleanup of idle terminals. The list offers only terminals
// that are safe to close; every other one is shown with the plain reason and is never closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlan, closeIdleTerminals, descendantsOf, IDLE_MIN_MS } from '../bridge/idle-cleanup.mjs';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const H = 60 * 60_000;
const pane = (id, extra = {}) => ({ id, provider: 'claude', project: 'demo', cwd: '/work/demo', alive: true, turn: 'idle', producing: false, lastActiveAt: NOW - 3 * H, startedAt: NOW - 5 * H, pid: 100, ...extra });
const quiet = { unsaved: () => [], processes: () => [], followedByBot: () => null };

test('idle terminals are offered with name, folder and how long they have been idle', () => {
  const plan = cleanupPlan({ panes: [pane('terminal-a', { profile: { name: 'Quill' } }), pane('terminal-b', { statedTask: 'Render the intro', lastActiveAt: NOW - 2 * 24 * H })], now: NOW, ...quiet });
  assert.deepEqual(plan.offer.map((o) => [o.id, o.name, o.folder, o.idleText]), [
    ['terminal-b', 'Render the intro', 'demo', 'idle 2 days'],
    ['terminal-a', 'Quill', 'demo', 'idle 3 hours'],
  ]);
  assert.deepEqual(plan.keep, []);
});

test('working, waiting, recently used, unsaved work, running something, bot-followed and the Agents service are kept with a plain reason', () => {
  const panes = [
    pane('terminal-work', { turn: 'working' }),
    pane('terminal-print', { producing: true }),
    pane('terminal-ask', { turn: 'waiting' }),
    pane('terminal-ask2', { attention: { kind: 'question', title: 'Pick one' } }),
    pane('terminal-fresh', { lastActiveAt: NOW - 2 * 60_000 }),
    pane('terminal-dirty'),
    pane('terminal-shell', { provider: 'shell', pid: 200 }),
    pane('terminal-service', { provider: 'shell', pid: 300 }),
    pane('terminal-followed'),
    pane('terminal-ok'),
  ];
  const plan = cleanupPlan({
    panes, now: NOW,
    unsaved: (p) => (p.id === 'terminal-dirty' ? ['src/app.ts', 'README.md'] : []),
    processes: (p) => (p.pid === 200 ? [{ pid: 201, comm: 'vite', cmd: 'node vite' }] : p.pid === 300 ? [{ pid: 301, comm: 'node', cmd: 'node termcontrol/bridge/server.mjs' }] : []),
    followedByBot: (p) => (p.id === 'terminal-followed' ? 'Agent-Manager' : null),
  });
  assert.deepEqual(plan.offer.map((o) => o.id), ['terminal-ok']);
  assert.deepEqual(Object.fromEntries(plan.keep.map((k) => [k.id, k.reason])), {
    'terminal-work': 'Working right now',
    'terminal-print': 'Working right now',
    'terminal-ask': 'Waiting for you',
    'terminal-ask2': 'Waiting for you',
    'terminal-fresh': 'Used in the last few minutes',
    'terminal-dirty': 'Unsaved work: src/app.ts, README.md',
    'terminal-shell': 'Something is still running in it (vite)',
    'terminal-service': 'Runs the Agents service',
    'terminal-followed': 'Agent-Manager is following it',
  });
});

test('an agent terminal may have its own helpers running; the Agents service inside it still keeps it', () => {
  const plan = cleanupPlan({ panes: [pane('terminal-a'), pane('terminal-b', { pid: 300 })], now: NOW, ...quiet,
    processes: (p) => (p.pid === 300 ? [{ pid: 1, comm: 'claude', cmd: 'claude' }, { pid: 2, comm: 'node', cmd: 'node /x/termcontrol/bridge/server.mjs' }] : [{ pid: 1, comm: 'claude', cmd: 'claude' }, { pid: 3, comm: 'node', cmd: 'node mcp-server.js' }]) });
  assert.deepEqual([plan.offer.map((o) => o.id), plan.keep.map((k) => k.reason)], [['terminal-a'], ['Runs the Agents service']]);
});

test('closed terminals are not listed at all, and the idle limit is fifteen minutes', () => {
  assert.equal(IDLE_MIN_MS, 15 * 60_000);
  const plan = cleanupPlan({ panes: [pane('terminal-gone', { alive: false }), pane('terminal-16m', { lastActiveAt: NOW - 16 * 60_000 })], now: NOW, ...quiet });
  assert.deepEqual([plan.offer.map((o) => o.id), plan.keep], [['terminal-16m'], []]);
});

test('closing takes a fresh look and closes only ticked terminals that are still safe', async () => {
  const closed = [];
  const fresh = { offer: [{ id: 'terminal-a', name: 'A' }, { id: 'terminal-c', name: 'C' }], keep: [{ id: 'terminal-b', name: 'B', reason: 'Working right now' }] };
  const r = await closeIdleTerminals({ ids: ['terminal-a', 'terminal-b', 'terminal-x'], plan: fresh, requestClose: async (id) => { closed.push(id); return { ok: true }; } });
  assert.deepEqual(closed, ['terminal-a'], 'unticked C stays, B became busy, X is gone');
  assert.equal(r.ok, false);
  assert.deepEqual(r.results.map((x) => [x.id, x.ok, x.error || '']), [
    ['terminal-a', true, ''],
    ['terminal-b', false, 'Not closed: Working right now'],
    ['terminal-x', false, 'Not closed: it is no longer open'],
  ]);
});

test('a refused close is reported, and all-good says how many closed', async () => {
  const plan = { offer: [{ id: 'terminal-a', name: 'A' }, { id: 'terminal-b', name: 'B' }], keep: [] };
  const r = await closeIdleTerminals({ ids: ['terminal-a', 'terminal-b'], plan, requestClose: async () => ({ ok: true }) });
  assert.deepEqual([r.ok, r.closed], [true, 2]);
  const bad = await closeIdleTerminals({ ids: ['terminal-a'], plan, requestClose: async () => ({ ok: false, error: 'TermFleet did not answer.' }) });
  assert.deepEqual([bad.ok, bad.results[0].error], [false, 'TermFleet did not answer.']);
});

test('the process tree under a terminal is read from the process table', () => {
  const table = [{ pid: 10, ppid: 1, comm: 'bash', cmd: 'bash' }, { pid: 11, ppid: 10, comm: 'node', cmd: 'node vite' }, { pid: 12, ppid: 11, comm: 'esbuild', cmd: 'esbuild' }, { pid: 13, ppid: 1, comm: 'x', cmd: 'x' }];
  assert.deepEqual(descendantsOf(10, table).map((p) => p.pid), [11, 12]);
  assert.deepEqual(descendantsOf(null, table), []);
});
