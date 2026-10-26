import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createEventLog } from '../bridge/events-db.mjs';
import { createTerminalHealth, processAlive, healthPanes, recoverTerminal, recentCommits } from '../bridge/terminal-health.mjs';

const pane = { id: 'terminal-one', provider: 'codex', sessionId: 'conversation-one', cwd: '/project', project: 'Project', task: 'Finishing the report', turn: 'working', updatedAt: 1 };
function fixture(options = {}) {
  let now = 1_000_000;
  const calls = [];
  const state = { reachable: true, panes: [pane], byId: new Map(), agents: new Map() };
  const monitor = createTerminalHealth({ now: () => now, snapshot: async () => state,
    alive: processAlive, activity: () => 1,
    recover: async (p) => { calls.push(['recover', p.id]); return { ok: true }; },
    retire: async (p) => { calls.push(['retire', p.id]); return { ok: true }; }, ...options });
  return { monitor, calls, state, advance: () => { now += 300_001; } };
}
test('confirmed missing process gets grace then exact-pane recovery once', async () => {
  const f = fixture();
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'checking');
  f.advance();
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'recovering');
  await f.monitor.sweep({ repair: true });
  assert.deepEqual(f.calls, [['recover', pane.id]]);
});

test('workspace preserves task, bot and conversation but excludes intentional closes', () => {
  const t = { id: pane.id, providerSessionId: pane.sessionId, agentProvider: 'codex', mainUserAsk: { text: pane.task } };
  const workspace = { tabs: [{ title: 'Project', initialCwd: pane.cwd, terminals: [t, { id: 'closed', manualStopRequested: true }] }] };
  const rows = healthPanes(workspace, [], new Map([[pane.id, { id: 'owner', name: 'Manager' }]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, pane.sessionId);
  assert.equal(rows[0].task, pane.task);
  assert.equal(rows[0].cwd, pane.cwd);
  assert.equal(rows[0].bot.id, 'owner');
  assert.equal(healthPanes(workspace, [{ ...pane, sessionId: 'different' }])[0].identityConflict, true);
});

test('shared stuck state never authorizes killing a live process or a pending question', async () => {
  const f = fixture(); f.state.byId.set(pane.id, { pid: process.pid });
  f.state.panes = [{ ...pane, alive: true, stalledForMs: 1 }];
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'stuck');
  f.state.panes[0].attention = { kind: 'question' };
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'alive');
  assert.deepEqual(f.calls, []);
});

test('recovery requires matching checkpoint and never opens a blank conversation', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], ask = async (request) => { calls.push(request); return { ok: true }; };
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  const stem = path.join(dir, Buffer.from(pane.id).toString('hex'));
  const meta = { recoveryKind: 'agent-terminal', provider: pane.provider, providerSessionId: pane.sessionId, cwd: pane.cwd, sanitizedResumeCommand: `codex resume ${pane.sessionId}` };
  fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  fs.writeFileSync(`${stem}.lifecycle.json`, JSON.stringify('intentional-kill'));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  fs.writeFileSync(`${stem}.lifecycle.json`, JSON.stringify('recoverable'));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  fs.writeFileSync(`${stem}.scrollback`, '');
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, true);
  assert.deepEqual(calls, [{ type: 'ensureSession', id: pane.id, cwd: pane.cwd, command: null }]);
  // Existing daemon synthesizes an exact resume command from provider + id.
  delete meta.sanitizedResumeCommand; fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, true);
  meta.launchProfile = 'unsupported'; fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  delete meta.launchProfile;
  meta.providerSessionId = 'wrong'; fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  meta.providerSessionId = pane.sessionId; meta.recoveryKind = 'shell'; fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
  meta.recoveryKind = 'agent-terminal'; meta.restoreFailureReason = 'auth required'; fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta));
  assert.equal((await recoverTerminal(pane, { ask, dir })).ok, false);
});

test('a replacement shell is never reported as a restored conversation', async () => {
  const f = fixture(); await f.monitor.sweep(); f.advance(); await f.monitor.sweep({ repair: true });
  f.state.byId.set(pane.id, { pid: process.pid });
  assert.equal((await f.monitor.sweep()).terminals[0].status, 'recovering');
  f.advance();
  assert.equal((await f.monitor.sweep()).terminals[0].status, 'blocked');
  f.state.agents.set(pane.id, { provider: pane.provider, sessionId: pane.sessionId });
  assert.equal((await f.monitor.sweep()).terminals[0].status, 'alive');
  assert.equal(f.calls.length, 1);
});

test('a corrupt recovery journal disables actions without taking down health reporting', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-health-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'health.json'); fs.writeFileSync(file, 'invalid');
  const f = fixture({ file });
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'unknown');
  f.advance(); await f.monitor.sweep({ repair: true });
  assert.deepEqual(f.calls, []);
  assert.equal(fs.readFileSync(file, 'utf8'), 'invalid');
});

test('git discovery includes work saved before subsequent activity', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-health-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'Saved task work');
  assert.deepEqual(recentCommits(dir), [git('rev-parse', 'HEAD').trim()]);
});

test('real process death plus SQL inactivity recovers once across monitor restart with history link', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-health-integration-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  let time = Date.now();
  const db = createEventLog({ file: path.join(dir, 'events.db'), now: () => time });
  t.after(() => { child.kill(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.logEvent(pane.id, 'Manager', 'codex', 'message', { source_id: 'original' });
  const state = { reachable: true, panes: [pane], byId: new Map([[pane.id, { pid: child.pid }]]), agents: new Map() };
  let recovered = 0;
  const options = { file: path.join(dir, 'health.json'), now: () => time, snapshot: async () => state,
    activity: db.lastActivity, commits: () => ['saved-commit'], recover: async (p) => { assert.equal(p.id, pane.id); recovered++; return { ok: true }; },
    retire: async () => assert.fail('unfinished work must not close'),
    log: (p, evidence) => db.logEvent(p.id, 'Manager', p.provider, 'stall', { healthRecovery: evidence }) };
  const health = createTerminalHealth(options);
  assert.equal((await health.sweep({ repair: true })).terminals[0].status, 'alive');
  const ended = once(child, 'exit'); child.kill(); await ended;
  time += 300_001;
  assert.equal((await health.sweep({ repair: true })).terminals[0].status, 'checking');
  time += 300_001;
  assert.equal((await health.sweep({ repair: true })).terminals[0].status, 'recovering');
  await createTerminalHealth(options).sweep({ repair: true });
  assert.equal(recovered, 1);
  const events = db.queryEvents({ terminal_id: pane.id });
  assert.equal(events.length, 2);
  assert.equal(events[1].payload.healthRecovery.predecessor_terminal_id, pane.id);
  assert.deepEqual(events[1].payload.healthRecovery.commits, ['saved-commit']);
});
test('quiet live processes, provider owners and intentional sleep are protected', async () => {
  for (const life of [{ pid: process.pid }, { sleeping: true }]) {
    const f = fixture(); f.state.byId.set(pane.id, life);
    await f.monitor.sweep({ repair: true }); f.advance();
    await f.monitor.sweep({ repair: true }); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.state.agents.set(pane.id, { sessionId: pane.sessionId });
  await f.monitor.sweep(); f.advance(); await f.monitor.sweep({ repair: true });
  assert.deepEqual(f.calls, []);
  assert.equal(processAlive(process.pid), true);
});
test('unknown daemon, unknown SQL activity, and read-only reports cannot recover', async () => {
  const f = fixture(); await f.monitor.sweep(); f.advance(); await f.monitor.sweep();
  assert.deepEqual(f.calls, []); f.state.reachable = false;
  assert.equal((await f.monitor.sweep({ repair: true })).terminals[0].status, 'unknown');
  assert.deepEqual(f.calls, []);
  const g = fixture({ activity: () => null }); await g.monitor.sweep(); g.advance();
  await g.monitor.sweep({ repair: true }); assert.deepEqual(g.calls, []);
});
test('finished work retires while another conversation owner blocks recovery', async () => {
  const f = fixture(); f.state.panes = [{ ...pane, task: null, turn: 'idle', todos: [] }];
  await f.monitor.sweep(); f.advance(); await f.monitor.sweep({ repair: true });
  assert.deepEqual(f.calls, [['retire', pane.id]]);
  const g = fixture(); await g.monitor.sweep(); g.advance();
  g.state.agents.set('another-pane', { sessionId: pane.sessionId });
  assert.equal((await g.monitor.sweep({ repair: true })).terminals[0].status, 'blocked');
  assert.deepEqual(g.calls, []);
});
test('fresh activity and a process returning during final recheck prevent action', async () => {
  const f = fixture(); await f.monitor.sweep(); f.advance();
  f.state.panes = [{ ...pane, updatedAt: 2_000_000 }];
  await f.monitor.sweep({ repair: true }); assert.deepEqual(f.calls, []);
  let reads = 0, state;
  const g = fixture({ snapshot: async () => {
    if (++reads >= 3) state.agents.set(pane.id, { sessionId: pane.sessionId });
    return state;
  } }); state = g.state;
  await g.monitor.sweep(); g.advance(); await g.monitor.sweep({ repair: true });
  assert.deepEqual(g.calls, []);
});
