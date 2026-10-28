// Noam 2026-10-22: "אני רואה שיש מלא טרמינלים פתוחים במפה שהם לא בשימוש. למה הם לא נוקו?"
// and "Yes, build it" to a one-tap cleanup of idle terminals. The list offers only terminals
// that are safe to close; every other one is shown with the plain reason and is never closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlan, closeIdleTerminals, descendantsOf, IDLE_MIN_MS } from '../bridge/idle-cleanup.mjs';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const H = 60 * 60_000;
const pane = (id, extra = {}) => ({ id, provider: 'claude', project: 'demo', cwd: '/work/demo', alive: true, turn: 'idle', producing: false, lastActiveAt: NOW - 3 * H, startedAt: NOW - 5 * H, pid: 100, ...extra });
const quiet = { unsaved: () => [], processes: () => [], followedByBot: () => null, screenState:()=> 'clear' };

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
    panes, now: NOW, screenState:()=> 'clear',
    unsaved: (p) => (p.id === 'terminal-dirty' ? ['src/app.ts', 'README.md'] : []),
    processes: (p) => (p.pid === 200 ? [{ pid: 201, comm: 'vite', cmd: 'node vite' }] : p.pid === 300 ? [{ pid: 301, comm: 'node', cmd: 'node termcontrol/bridge/server.mjs' }] : []),
    followedByBot: (p) => (p.id === 'terminal-followed' ? 'Agent-Manager' : null),
  });
  // Noam 2026-10-22 (Q4): 'Show it to me to decide' — offered unticked with the reason, never auto-closed.
  assert.deepEqual(plan.offer.map((o) => [o.id, o.checked, o.warning || '']), [['terminal-dirty', false, 'Unsaved work: src/app.ts, README.md'], ['terminal-ok', true, '']]);
  assert.deepEqual(Object.fromEntries(plan.keep.map((k) => [k.id, k.reason])), {
    'terminal-work': 'Working right now',
    'terminal-print': 'Working right now',
    'terminal-ask': 'Waiting for you',
    'terminal-ask2': 'Waiting for you',
    'terminal-fresh': 'Used in the last few minutes',
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
  const plan = cleanupPlan({ panes: [pane('terminal-gone', { alive: false }), pane('terminal-16m', { lastActiveAt: NOW - 16 * 60_000 })], now: NOW, ...quiet, startedBy: () => 'Quill' });
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

// Noam 2026-10-22 (via Agent-Manager, his words): 'בוטים שהסוכן פתח בוודאות. טרמינלים שלי - רק לאחר
// הצגתם לי אם הם לא פעילים הרבה זמן ובאישור ישיר שלי', and for his own: '2 hours'.
test('his own terminals are offered only after two hours idle; agent-started ones after fifteen minutes', async () => {
  const { OWN_IDLE_MIN_MS } = await import('../bridge/idle-cleanup.mjs');
  assert.equal(OWN_IDLE_MIN_MS, 2 * H);
  const plan = cleanupPlan({ now: NOW, ...quiet,
    startedBy: (p) => (p.id.startsWith('terminal-helper') ? 'Agent-Manager' : null),
    panes: [pane('terminal-mine-1h', { lastActiveAt: NOW - H }), pane('terminal-mine-3h'), pane('terminal-helper-20m', { lastActiveAt: NOW - 20 * 60_000 })] });
  assert.deepEqual(plan.offer.map((o) => [o.id, o.startedBy]), [['terminal-mine-3h', null], ['terminal-helper-20m', 'Agent-Manager']]);
  assert.deepEqual(plan.keep.map((k) => [k.id, k.reason]), [['terminal-mine-1h', 'Yours, used in the last 2 hours']]);
});

test('the automatic sweep closes only finished terminals an agent or bot started, never Noam\'s own', async () => {
  const { autoCloseFinished } = await import('../bridge/idle-cleanup.mjs');
  const closed = [], notes = [];
  const plan = { offer: [{ id: 'terminal-helper', name: 'Run tests', startedBy: 'Quill' }, { id: 'terminal-mine', name: 'My shell', startedBy: null }], keep: [{ id: 'terminal-busy', name: 'Build', startedBy: 'Quill', reason: 'Working right now' }] };
  const r = await autoCloseFinished({ plan, canClose:async()=>true, requestClose: async (id, { by }) => { closed.push([id, by]); return { ok: true }; }, log: (t) => notes.push(t) });
  assert.deepEqual(closed, [['terminal-helper', 'auto-cleanup']]);
  assert.equal(r.closed, 1);
  assert.match(notes[0], /Closed "Run tests" \(started by Quill\)/);
});

// Agent-Manager 2026-10-22: 23 terminals were still running with no card on the map (~12 GB),
// invisible to Noam. They join the cleanup like any other terminal.
test('terminals running with no card on the map are found, with their state, and judged by the same rules', async () => {
  const { cardlessSessions } = await import('../bridge/idle-cleanup.mjs');
  const live = new Map([
    ['terminal-card', { pid: 1, producing: false, quietForMs: 3 * H }],
    ['terminal-hidden-helper', { pid: 2, producing: false, quietForMs: null, initialCwd: '/w/termfleet' }],
    ['terminal-hidden-busy', { pid: 3, producing: false, quietForMs: 5 * H, initialCwd: '/w/x' }],
    ['terminal-hidden-unknown', { pid: 4, producing: false, quietForMs: null, initialCwd: '/w/y' }],
    ['terminal-ended', { pid: 5, exited: true }],
  ]);
  const panes = cardlessSessions({ liveById: live, ownedIds: new Set(['terminal-card']), now: NOW,
    agents: new Map([['terminal-hidden-busy', { provider: 'codex', vendorStatus: { status: 'busy' } }], ['terminal-hidden-helper', { provider: 'claude', sessionId: 's1', vendorStatus:{status:'idle'} }]]),
    lastUsed: (p) => (p.id === 'terminal-hidden-helper' ? NOW - 20 * H : 0),
    commandOf: (pid) => (pid === 2 ? "bash -lc claude 'Read /home/x/.local/share/terminal-workspace/child-tasks/abc.md and carry out'" : 'bash') });
  assert.deepEqual(panes.map((p) => [p.id, p.provider, p.turn, p.cardless]), [
    ['terminal-hidden-helper', 'claude', 'idle', true], ['terminal-hidden-busy', 'codex', 'working', true], ['terminal-hidden-unknown', 'shell', 'idle', true]]);
  const plan = cleanupPlan({ panes, now: NOW, ...quiet, startedBy: (p) => p.startedBy || null });
  assert.deepEqual(plan.offer.map((o) => [o.id, o.startedBy, o.name]), [['terminal-hidden-helper', 'an agent', 'Hidden terminal in termfleet (no card on the map)']]);
  assert.deepEqual(Object.fromEntries(plan.keep.map((k) => [k.id, k.reason])), { 'terminal-hidden-busy': 'Working right now', 'terminal-hidden-unknown': 'Cannot tell when it was last used' });
});

test('a finished agent terminal with unsaved work of its own is never closed automatically', async () => {
  const { autoCloseFinished } = await import('../bridge/idle-cleanup.mjs');
  const closed = [];
  await autoCloseFinished({ plan: { offer: [{ id: 'terminal-dirty', name: 'D', startedBy: 'Quill', checked: false, warning: 'Unsaved work: a.js' }], keep: [] }, requestClose: async (id) => { closed.push(id); return { ok: true }; } });
  assert.deepEqual(closed, []);
});

// R-7214 (Noam 2026-10-24: 'הסוכנים באמת הורגים טרמינלים שסיימנו בביטחה ואמינות עכשיו?'). The map
// had 20 finished 'politic-fighter · codex' terminals no one closed: their bot's start record had
// scrolled out of its short helpers list, so they counted as Noam's own, and a bot's ended follow
// still read as "following it".
test('who started a terminal survives a long helpers list, and an ended follow no longer keeps it', async () => {
  const { helperRoles } = await import('../bridge/idle-cleanup.mjs');
  const old = { paneId: 'terminal-old', at: 1 };
  const follows = Array.from({ length: 30 }, (_, i) => ({ paneId: 'terminal-old', followed: true, at: 2 + i, ended: 100 }));
  const bots = [{ id: 'b1', name: 'politic-figther_dev', helpers: [old, ...follows, { paneId: 'terminal-watched', followed: true, at: 50 }, { paneId: 'terminal-noam', followed: true, at: 60, ended: 70 }] }];
  const { starters, followers } = helperRoles(bots);
  assert.deepEqual([...starters].map(([id, b]) => [id, b.name]), [['terminal-old', 'politic-figther_dev']]);
  assert.deepEqual([...followers.keys()], ['terminal-watched'], 'a follow that ended is not a reason to keep it');
});

test('a terminal started through the helper-terminal tool counts as agent-started even with no bot record', async () => {
  const { startedByCommand } = await import('../bridge/idle-cleanup.mjs');
  assert.equal(startedByCommand("codex 'Goal: x\nFull instructions: Read /home/n/.local/share/terminal-workspace/child-tasks/9add.md and carry out'; exec bash -l"), 'an agent');
  assert.equal(startedByCommand("codex 'The PC rebooted, read HANDOFF.md'"), null, 'a hand-typed start stays Noam\'s own');
  assert.equal(startedByCommand(''), null);
});

test('a helper is judged by when it last really worked; Noam\'s own still count any screen change', () => {
  const blip = { lastActiveAt: NOW - 60_000, lastWorkedAt: NOW - 5 * H };
  const plan = cleanupPlan({ now: NOW, ...quiet, startedBy: (p) => (p.id === 'terminal-helper' ? 'politic-figther_dev' : null),
    panes: [pane('terminal-helper', blip), pane('terminal-mine', blip)] });
  assert.deepEqual(plan.offer.map((o) => [o.id, o.idleText]), [['terminal-helper', 'idle 5 hours']]);
  assert.deepEqual(plan.keep.map((k) => [k.id, k.reason]), [['terminal-mine', 'Used in the last few minutes']]);
});

test('who started a terminal is remembered after its starter closes; closed terminals are forgotten', async () => {
  const { rememberStarters } = await import('../bridge/idle-cleanup.mjs');
  const saved = { 'terminal-child': { name: 'an agent' }, 'terminal-gone': { name: 'Quill' } };
  const now = new Map([['terminal-new', { name: 'politic-figther_dev', botId: 'b1' }]]);
  const merged = rememberStarters(saved, now, new Set(['terminal-child', 'terminal-new', 'terminal-mine']));
  assert.deepEqual(Object.fromEntries(merged), { 'terminal-child': { name: 'an agent' }, 'terminal-new': { name: 'politic-figther_dev', botId: 'b1' } });
});

// Noam 2026-10-24: a terminal a bot started closes after 5 idle minutes; others keep their floors.
test('a finished bot terminal is offered after 5 idle minutes, an agent one still waits 15', async () => {
  const { cleanupPlan: plan, BOT_IDLE_MIN_MS } = await import('../bridge/idle-cleanup.mjs');
  assert.equal(BOT_IDLE_MIN_MS, 5 * 60_000);
  const now = 10 * 60 * 60_000;
  const pane = (id) => ({ id, provider: 'claude', turn: 'idle', alive: true, lastWorkedAt: now - 6 * 60_000, lastActiveAt: now - 6 * 60_000 });
  const p = plan({ panes: [pane('bot1'), pane('agent1'), pane('mine')], now,screenState:()=> 'clear',
    startedBy: (x) => (x.id === 'mine' ? null : x.id === 'bot1' ? 'Agent-Manager' : 'an agent'),
    startedByBot: (x) => x.id === 'bot1' });
  assert.deepEqual(p.offer.map((o) => o.id), ['bot1']);
  assert.deepEqual(p.keep.map((k) => k.id).sort(), ['agent1', 'mine']);
});

// Noam 2026-10-26: "it still opens terminals willy nilly and doest kill them when not used". A Codex
// an agent started at 00:08 froze at 11:30 (its conversation stopped) while its screen clock kept
// ticking every second, so it read as "Working right now" for 9 hours and was never closed.
test('fresh output prevents destructive frozen-agent cleanup; it does not prove task progress', async () => {
  const { cleanupPlan: plan, cardlessSessions, STUCK_AGENT_MS } = await import('../bridge/idle-cleanup.mjs');
  assert.equal(STUCK_AGENT_MS, 2 * H);
  const ticking = { turn: 'working', producing: true, live: 'producing', lastActiveAt: NOW - 1000, lastWorkedAt: NOW - 1000 };
  const p = plan({ panes: [
    pane('terminal-frozen', { ...ticking, provider: 'codex', recordAt: NOW - 9 * H }),
    pane('terminal-long-step', { ...ticking, provider: 'codex', recordAt: NOW - 90 * 60_000 }),
    pane('terminal-frozen-asks', { ...ticking, recordAt: NOW - 9 * H, attention: { kind: 'question', title: 'Allow?' } }),
    pane('terminal-frozen-mine', { ...ticking, recordAt: NOW - 9 * H }),
    pane('terminal-shell-clock', { ...ticking, provider: 'shell', recordAt: NOW - 9 * H }),
  ], now: NOW, ...quiet, startedBy: (x) => (x.id === 'terminal-frozen-mine' ? null : 'an agent') });
  assert.deepEqual(p.offer, []);
  assert.deepEqual(Object.fromEntries(p.keep.map((k) => [k.id, k.reason])), {
    'terminal-frozen':'Working right now','terminal-frozen-mine':'Working right now',
    'terminal-long-step': 'Working right now', 'terminal-frozen-asks': 'Waiting for you', 'terminal-shell-clock': 'Working right now' });
  // The same Codex with no card: its conversation time travels with the hidden pane.
  const [hidden] = cardlessSessions({ liveById: new Map([['terminal-eec5', { pid: 9, producing: true, quietForMs: 0, busyQuietForMs: 0, initialCwd: '/w/politic' }]]),
    ownedIds: new Set(['terminal-card']), now: NOW, agents: new Map([['terminal-eec5', { provider: 'codex', sessionId: 's9' }]]),
    lastUsed: () => NOW - 9 * H, commandOf: () => "bash -lc codex 'Read /h/.local/share/terminal-workspace/child-tasks/x.md and carry out'" });
  assert.equal(hidden.recordAt, NOW - 9 * H);
  assert.deepEqual(plan({ panes: [hidden], now: NOW, ...quiet, startedBy: (x) => x.startedBy || null }).offer, []);
});
