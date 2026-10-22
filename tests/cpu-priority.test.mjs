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
