// Noam 2026-10-22: 'אין דרך להגביל את מידת השימוש במעבד לכל הסוכנים האלו אלא אם זה משהו דחוף?'
// Agent terminals run at a low CPU/disk share by default (they still use idle CPU, they only
// yield when Noam's own apps want it). One terminal can be made Urgent: its programs move into
// their own group at normal share, and back when Urgent is turned off. Nothing is ever killed
// or paused.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  priorityPaths, readPrioritySettings, writePrioritySettings, paneScopeName, panePids,
  setUrgent, urgentStatus, listUrgent, reconcileUrgent, applyAgentWeight, selfRequestAllowed,
  DEFAULT_AGENT_WEIGHT, URGENT_WEIGHT,
} from '../scripts/lib/cpu-priority.mjs';

const APP = 'user.slice/user-1000.slice/user@1000.service/app.slice';
const SERVICE = `/${APP}/termfleet-daemon-prestart-1.service`;
// The daemon gives every terminal its own small group inside its service (pty.rs) and ends a
// closed terminal's programs through it.
const DAEMON = `${SERVICE}/termfleet-pane-0a1b2c3d-7`;
const PANE = 'terminal-tab1-pane1';

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-prio-'));
  const procRoot = path.join(root, 'proc');
  const cgroupRoot = path.join(root, 'cgroup');
  const paths = priorityPaths({ XDG_DATA_HOME: path.join(root, 'data') });
  const cg = (rel) => path.join(cgroupRoot, rel);
  fs.mkdirSync(cg(DAEMON), { recursive: true });
  fs.writeFileSync(path.join(cg(DAEMON), 'cgroup.procs'), '');
  // Moving a pid = rewriting its /proc/<pid>/cgroup line, like the kernel does.
  const procs = (dir) => { try { return fs.readFileSync(path.join(dir, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  const proc = (pid, ppid, cgroup, env = {}, cmd = 'bash') => {
    const dir = path.join(procRoot, String(pid));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stat'), `${pid} (${cmd}) S ${ppid} 1 1 0`);
    fs.writeFileSync(path.join(dir, 'cmdline'), cmd);
    fs.writeFileSync(path.join(dir, 'environ'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\0'));
    fs.writeFileSync(path.join(dir, 'cgroup'), `0::${cgroup}\n`);
    const file = path.join(cg(cgroup), 'cgroup.procs');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${pid}\n`);
  };
  const cgroupOf = (pid) => fs.readFileSync(path.join(procRoot, String(pid), 'cgroup'), 'utf8').trim().slice(3);
  const calls = [];
  // The fake systemd + kernel: starting a scope creates its cgroup and moves the pids in;
  // writing a pid into cgroup.procs moves it.
  const move = (pid, cgroup) => {
    const from = cgroupOf(pid);
    fs.writeFileSync(path.join(cg(from), 'cgroup.procs'), procs(cg(from)).filter((p) => p !== String(pid)).join('\n'));
    fs.mkdirSync(cg(cgroup), { recursive: true });
    fs.appendFileSync(path.join(cg(cgroup), 'cgroup.procs'), `${pid}\n`);
    fs.writeFileSync(path.join(procRoot, String(pid), 'cgroup'), `0::${cgroup}\n`);
    if (!procs(cg(from)).length && /termfleet-urgent-/.test(from)) fs.rmSync(cg(from), { recursive: true, force: true });
  };
  const sys = {
    startScope(name, pids, props) { calls.push(['startScope', name, [...pids], props]); for (const p of pids) move(p, `/${APP}/${name}`); return true; },
    setProperty(unit, props) { calls.push(['setProperty', unit, props]); return true; },
    daemonUnits() { return ['termfleet-daemon-prestart-1.service']; },
    memoryHigh() { return '42030663680'; },
    writeProcs(cgroup, pid) { calls.push(['writeProcs', cgroup, pid]); move(pid, cgroup); return true; },
    killCgroup(cgroup) { calls.push(['killCgroup', cgroup]); return true; },
  };
  return { root, procRoot, cgroupRoot, paths, proc, cgroupOf, calls, sys, opts: { paths, procRoot, cgroupRoot, sys } };
}

test('the default agent weight is low and can be changed within sane bounds', () => {
  const { paths } = world();
  assert.equal(DEFAULT_AGENT_WEIGHT, 20);
  assert.equal(URGENT_WEIGHT, 100);
  assert.deepEqual(readPrioritySettings(paths), { agentWeight: 20 });
  assert.deepEqual(writePrioritySettings(paths, { agentWeight: 35 }), { agentWeight: 35 });
  assert.deepEqual(readPrioritySettings(paths), { agentWeight: 35 });
  writePrioritySettings(paths, { agentWeight: 0 });
  writePrioritySettings(paths, { agentWeight: 5000 });
  writePrioritySettings(paths, { agentWeight: 'fast' });
  assert.deepEqual(readPrioritySettings(paths), { agentWeight: 35 });
});

test('a terminal\'s programs are its shell and every descendant, never the daemon or other terminals', () => {
  const w = world();
  w.proc(10, 1, SERVICE, {}, 'termfleet');                             // the daemon itself
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });                // the shell
  w.proc(101, 100, DAEMON, { TERMFLEET_PANE_ID: PANE }, 'claude');
  w.proc(102, 101, DAEMON, {}, 'cargo');                               // env scrubbed, still a child
  w.proc(200, 10, `${SERVICE}/termfleet-pane-99999999-8`, { TERMFLEET_PANE_ID: 'terminal-other' }); // another terminal
  w.proc(300, 1, `/${APP}/termcontrol.service`, { TERMFLEET_PANE_ID: PANE }, 'node'); // the bridge: not ours to move
  assert.deepEqual(panePids(PANE, w.opts).pids.sort(), ['100', '101', '102']);
  assert.deepEqual(panePids(PANE, { ...w.opts, sessionPid: 100 }).pids.sort(), ['100', '101', '102']);
});

test('Urgent moves the whole terminal into its own normal-share group, and Off moves it back', () => {
  const w = world();
  w.proc(10, 1, SERVICE, {}, 'termfleet');
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  w.proc(101, 100, DAEMON, { TERMFLEET_PANE_ID: PANE }, 'claude');
  const scope = paneScopeName(PANE);
  assert.match(scope, /^termfleet-urgent-[0-9a-f]{12}\.scope$/);

  const on = setUrgent(PANE, true, { ...w.opts, by: 'noam', now: 1000 });
  assert.equal(on.ok, true);
  assert.equal(on.urgent, true);
  const start = w.calls.find((c) => c[0] === 'startScope');
  assert.equal(start[1], scope);
  assert.deepEqual(start[2].sort(), ['100', '101']);
  assert.equal(start[3].CPUWeight, 100);
  assert.equal(start[3].IOWeight, 100);
  assert.equal(start[3].MemoryHigh, '42030663680');
  // If the terminal service itself stops, the urgent group stops with it, as before.
  assert.deepEqual(start[3].BindsTo, ['termfleet-daemon-prestart-1.service']);
  assert.equal(w.cgroupOf(100), `/${APP}/${scope}`);
  assert.equal(w.cgroupOf(10), SERVICE, 'the daemon never moves');
  assert.equal(urgentStatus(PANE, w.opts).urgent, true);
  assert.equal(urgentStatus(PANE, w.opts).active, true);
  assert.equal(urgentStatus(PANE, w.opts).by, 'noam');
  assert.deepEqual(listUrgent(w.paths).map((u) => u.paneId), [PANE]);

  // A program the terminal starts while urgent but that slipped in before the move is caught.
  w.proc(103, 101, DAEMON, {}, 'cargo');
  setUrgent(PANE, true, { ...w.opts, by: 'noam' });
  assert.equal(w.cgroupOf(103), `/${APP}/${scope}`);

  const off = setUrgent(PANE, false, { ...w.opts, by: 'noam' });
  assert.equal(off.ok, true);
  assert.equal(off.urgent, false);
  for (const pid of [100, 101, 103]) assert.equal(w.cgroupOf(pid), DAEMON, 'back into its own terminal group');
  assert.equal(urgentStatus(PANE, w.opts).urgent, false);
  assert.equal(urgentStatus(PANE, w.opts).active, false);
  assert.deepEqual(listUrgent(w.paths), []);
});

test('if moving back is refused, Off still drops the group to the agent share (nothing is killed)', () => {
  const w = world();
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  setUrgent(PANE, true, { ...w.opts, by: 'noam' });
  const sys = { ...w.sys, writeProcs() { return false; } };
  writePrioritySettings(w.paths, { agentWeight: 25 });
  const off = setUrgent(PANE, false, { ...w.opts, sys, by: 'noam' });
  assert.equal(off.ok, true);
  const lowered = w.calls.filter((c) => c[0] === 'setProperty').pop();
  assert.deepEqual(lowered, ['setProperty', paneScopeName(PANE), { CPUWeight: 25, IOWeight: 25 }]);
});

test('a terminal with no running programs cannot be made urgent, but says why', () => {
  const w = world();
  const res = setUrgent('terminal-empty', true, { ...w.opts, by: 'noam' });
  assert.equal(res.ok, false);
  assert.match(res.error, /no running programs/i);
  assert.equal(urgentStatus('terminal-empty', w.opts).urgent, false);
});

test('reconcile re-applies Urgent after the agent in that terminal restarted', () => {
  const w = world();
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  setUrgent(PANE, true, { ...w.opts, by: 'noam' });
  // The agent restarted: old programs gone, new ones are back under the daemon.
  fs.rmSync(path.join(w.cgroupRoot, APP, paneScopeName(PANE)), { recursive: true, force: true });
  fs.writeFileSync(path.join(w.cgroupRoot, DAEMON, 'cgroup.procs'), '');
  fs.rmSync(path.join(w.procRoot, '100'), { recursive: true, force: true });
  w.proc(110, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  const res = reconcileUrgent(w.opts);
  assert.deepEqual(res.map((r) => [r.paneId, r.ok]), [[PANE, true]]);
  assert.equal(w.cgroupOf(110), `/${APP}/${paneScopeName(PANE)}`);
});

test('a terminal closed while urgent ends its programs exactly as a normal close would', () => {
  const w = world();
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  setUrgent(PANE, true, { ...w.opts, by: 'noam' });
  // Still open: reconcile leaves it alone.
  reconcileUrgent(w.opts);
  assert.equal(w.calls.filter((c) => c[0] === 'killCgroup').length, 0);
  // Closed: the daemon removed the terminal's own group.
  fs.rmSync(path.join(w.cgroupRoot, DAEMON), { recursive: true, force: true });
  const res = reconcileUrgent(w.opts);
  assert.deepEqual(res.map((r) => [r.paneId, r.closed]), [[PANE, true]]);
  assert.deepEqual(w.calls.filter((c) => c[0] === 'killCgroup'), [['killCgroup', `/${APP}/${paneScopeName(PANE)}`]]);
  assert.deepEqual(listUrgent(w.paths), []);
});

test('the agent weight is applied to every running terminal service and to non-urgent groups', () => {
  const w = world();
  writePrioritySettings(w.paths, { agentWeight: 30 });
  const res = applyAgentWeight(w.opts);
  assert.deepEqual(res.units, ['termfleet-daemon-prestart-1.service']);
  assert.deepEqual(w.calls.find((c) => c[0] === 'setProperty'), ['setProperty', 'termfleet-daemon-prestart-1.service', { CPUWeight: 30, IOWeight: 30 }]);
});

test('an agent may make itself urgent only with Noam\'s words attached', () => {
  assert.equal(selfRequestAllowed({}).ok, false);
  assert.equal(selfRequestAllowed({ noamSaid: '  ' }).ok, false);
  assert.equal(selfRequestAllowed({ noamSaid: 'זה דחוף, תסיים מהר' }).ok, true);
  assert.equal(selfRequestAllowed({ ownerWords: 'm1', verify: () => null }).ok, false);
  assert.equal(selfRequestAllowed({ ownerWords: 'm1', verify: () => ({ text: 'urgent please' }) }).ok, true);
});

// Agent-Manager 2026-10-22 (Noam: PC still unusable): bot brains run under the phone bridge at
// full priority, and disk weights have no effect here (no io controller for user programs;
// SATA uses mq-deadline, which honours the idle disk class). So brains start in their own
// gentle scope with idle disk priority, and terminal programs get the idle disk class too.
test('disk priority follows the share choice: Gentle idle, Medium lowest normal, Normal untouched', async () => {
  const { ioClassFor } = await import('../scripts/lib/cpu-priority.mjs');
  assert.deepEqual(ioClassFor(20), ['-c3']);
  assert.deepEqual(ioClassFor(50), ['-c2', '-n7']);
  assert.equal(ioClassFor(100), null);
});

test('a bot brain starts in its own gentle scope with idle disk priority, same pid and pipes', async () => {
  const { gentleCommand } = await import('../scripts/lib/cpu-priority.mjs');
  const w = world();
  const { bin, args } = gentleCommand('/usr/bin/claude', ['-p', 'hi'], { paths: w.paths, unit: 'termfleet-bot-abc-1', hasSystemdRun: true });
  assert.equal(bin, 'systemd-run');
  assert.deepEqual(args.slice(0, 5), ['--user', '--scope', '--quiet', '--collect', '--slice=app.slice']);
  assert.ok(args.includes('--unit=termfleet-bot-abc-1'));
  assert.ok(args.includes('CPUWeight=20'));
  assert.ok(args.some((a) => a.startsWith('MemoryHigh=')));
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['ionice', '-c3', '/usr/bin/claude', '-p', 'hi']);
  const plain = gentleCommand('/usr/bin/claude', ['-p'], { paths: w.paths, unit: 'u', hasSystemdRun: false });
  assert.deepEqual(plain, { bin: 'ionice', args: ['-c3', '/usr/bin/claude', '-p'] });
  writePrioritySettings(w.paths, { agentWeight: 100 });
  assert.deepEqual(gentleCommand('/usr/bin/claude', ['-p'], { paths: w.paths, unit: 'u', hasSystemdRun: false }), { bin: '/usr/bin/claude', args: ['-p'] });
});

test('the disk sweep marks terminal programs and brains, never the daemon, and urgent ones normal', async () => {
  const { applyIoPriority } = await import('../scripts/lib/cpu-priority.mjs');
  const w = world();
  w.proc(10, 1, SERVICE, {}, 'termfleet');
  w.proc(100, 10, DAEMON, { TERMFLEET_PANE_ID: PANE });
  w.proc(300, 1, `/${APP}/termfleet-bot-abc-1.scope`, {}, 'claude');
  w.proc(400, 1, `/${APP}/${paneScopeName('terminal-x-y')}`, {}, 'cargo');
  w.proc(500, 1, `/${APP}/termcontrol.service`, {}, 'node');   // the bridge itself stays normal
  w.proc(600, 1, `/${APP}/freelance-desk-home.service`, {}, 'python3');  // its main process serves its UI
  w.proc(601, 600, `/${APP}/freelance-desk-home.service`, {}, 'claude'); // its bot brain
  const seen = [];
  const sys = { ...w.sys, mainPid: () => '600', ionice(cls, pids) { seen.push([cls.join(' '), [...pids].sort()]); return true; } };
  const cache = new Map();
  const gentleServices = ['freelance-desk-home.service'];
  applyIoPriority({ ...w.opts, sys, cache, gentleServices });
  assert.deepEqual(seen, [['-c3', ['100', '300', '601']], ['-c2 -n4', ['400']]]);
  seen.length = 0;
  applyIoPriority({ ...w.opts, sys, cache, gentleServices });
  assert.deepEqual(seen, [], 'already marked programs are not touched again');
});

// Noam 2026-10-22: 'אבל לחכות ללא הגבלה לא יכול להיות הפתרון כאן'. A guard lowers (never kills)
// the heaviest background disk users after 15 s of high disk pressure and restores them when calm.
test('the pressure guard lowers background disk hogs after 15 s, never foreground apps, and restores when calm', async () => {
  const { pressureGuardStep, isBackgroundCgroup } = await import('../scripts/lib/cpu-priority.mjs');
  assert.equal(isBackgroundCgroup(`/${APP}/freelance-desk-home.service`), true);
  assert.equal(isBackgroundCgroup(`/${APP}/termcontrol.service`), true);
  assert.equal(isBackgroundCgroup(DAEMON), true);
  assert.equal(isBackgroundCgroup(`/${APP}/app-flatpak-app.zen_browser.zen-1.scope`), false, 'his browser');
  assert.equal(isBackgroundCgroup(`/${APP}/termfleet-desktop-1.service`), false, 'the TermFleet window');
  assert.equal(isBackgroundCgroup(`/${APP}/${paneScopeName(PANE)}`), false, 'an urgent terminal');
  assert.equal(isBackgroundCgroup('/user.slice/user-1000.slice/user@1000.service/session.slice/plasma-plasmashell.service'), false);

  const calls = [];
  const sys = { ionice(cls, pids) { calls.push([cls.join(' '), [...pids]]); return true; }, ioClassOf: () => '-c2 -n4' };
  const state = { highSince: null, calmSince: null, lowered: new Map() };
  const hogs = [{ pid: '7', bytes: 300e6, cgroup: `/${APP}/freelance-desk-home.service`, cmd: 'git' }, { pid: '8', bytes: 2e6, cgroup: `/${APP}/x.service`, cmd: 'small' }];
  const step = (t, io) => pressureGuardStep({ now: t, ioSome: io, hogs, state, sys, log: () => {} });
  step(0, 40);
  assert.deepEqual(calls, [], 'not before 15 s');
  step(16_000, 45);
  assert.deepEqual(calls, [['-c3', ['7']]], 'only the heavy one is lowered');
  step(20_000, 2);
  step(50_000, 2);
  assert.equal(calls.length, 1, 'not restored before a full minute of calm');
  step(81_000, 2);
  assert.deepEqual(calls[1], ['-c2 -n4', ['7']], 'restored to what it had');
  assert.equal(state.lowered.size, 0);
});

test('a service the guard had to lower starts its next programs gentle for 30 minutes', async () => {
  const { pressureGuardStep, stickyGentleServices } = await import('../scripts/lib/cpu-priority.mjs');
  const sys = { ionice() { return true; }, ioClassOf: () => '-c0' };
  const state = { highSince: null, calmSince: null, lowered: new Map(), sticky: new Map() };
  const hogs = [{ pid: '9', bytes: 900e6, cgroup: `/${APP}/jellyfin-importer.service`, cmd: 'worker' },
    { pid: '10', bytes: 900e6, cgroup: DAEMON, cmd: 'cargo' }];
  pressureGuardStep({ now: 0, ioSome: 50, hogs, state, sys });
  pressureGuardStep({ now: 16_000, ioSome: 50, hogs, state, sys });
  assert.deepEqual(stickyGentleServices(state, 16_000 + 29 * 60_000), ['jellyfin-importer.service']);
  assert.deepEqual(stickyGentleServices(state, 16_000 + 31 * 60_000), []);
});
