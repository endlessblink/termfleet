// CPU priority for agent terminals. Noam 2026-10-22: 'אין דרך להגביל את מידת השימוש במעבד לכל
// הסוכנים האלו אלא אם זה משהו דחוף?'
//
// Every terminal lives under the PTY daemon's systemd unit. That unit runs at a LOW CPU/disk
// weight (default 20, against 100 for Noam's own apps and 1000 for the TermFleet window), so
// agents still use idle CPU but yield the moment his apps want it. Weights only share CPU under
// contention; nothing is capped, paused or killed.
//
// The daemon already gives every terminal its own small group inside its service
// (…/termfleet-daemon-*.service/termfleet-pane-<hash>-<n>, pty.rs) and ends a closed terminal's
// programs through it. Weights inside the service can only split the service's own low share, so
// Urgent moves one terminal's whole process tree OUT, into a sibling transient scope
// (termfleet-urgent-<hash>.scope) at normal weight. Programs it starts later are born inside the
// scope. Turning Urgent off moves the processes back into their own terminal group (the scope
// then empties and systemd collects it); if the kernel refuses, the scope is lowered to the
// agent weight instead. The scope is bound to the daemon service, so stopping the service stops
// it as before; a terminal closed while urgent (its own group is gone) has its programs ended by
// reconcileUrgent() exactly as the close would have. The intent is a marker file, so a restarted
// agent can be re-promoted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DEFAULT_AGENT_WEIGHT = 20;
export const URGENT_WEIGHT = 100;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 100;
const DAEMON_CGROUP = /\/termfleet-daemon-[^/]+\.service(\/termfleet-pane-[^/]+)?$/;
const URGENT_CGROUP = /\/termfleet-urgent-[0-9a-f]{12}\.scope$/;
const serviceOf = (cgroup) => (cgroup ? cgroup.match(/^(.*\/termfleet-daemon-[^/]+\.service)/)?.[1] || null : null);

const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_');

export function priorityPaths(env = process.env) {
  const data = path.join(env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share'), 'terminal-workspace');
  const root = path.join(data, 'cpu-priority');
  return { root, settings: path.join(root, 'settings.json'), urgent: path.join(root, 'urgent') };
}
const defaults = () => priorityPaths();

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const validWeight = (value) => Number.isInteger(value) && value >= MIN_WEIGHT && value <= MAX_WEIGHT;

export function readPrioritySettings(paths = defaults()) {
  const weight = Number(readJson(paths.settings)?.agentWeight);
  return { agentWeight: validWeight(weight) ? weight : DEFAULT_AGENT_WEIGHT };
}

export function writePrioritySettings(paths = defaults(), patch = {}) {
  const now = readPrioritySettings(paths);
  const weight = typeof patch.agentWeight === 'number' ? Math.round(patch.agentWeight) : NaN;
  const next = { agentWeight: validWeight(weight) ? weight : now.agentWeight };
  writeJson(paths.settings, next);
  return next;
}

export const paneScopeName = (paneId) =>
  `termfleet-urgent-${createHash('sha1').update(String(paneId)).digest('hex').slice(0, 12)}.scope`;
const markerFile = (paneId, paths) => path.join(paths.urgent, `${safe(paneId)}.json`);

// --- the real system -------------------------------------------------------------------------
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
const props = (map) => Object.entries(map).flatMap(([key, value]) => (Array.isArray(value)
  ? [key, 'as', String(value.length), ...value.map(String)]
  : key === 'MemoryHigh' || typeof value === 'number' ? [key, 't', String(value)] : [key, 's', String(value)]));

export const systemd = {
  startScope(name, pids, properties) {
    const all = { ...properties, Slice: 'app.slice', Description: 'TermFleet urgent terminal' };
    const sv = props(all);
    try {
      sh('busctl', ['--user', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
        'StartTransientUnit', 'ssa(sv)a(sa(sv))', name, 'fail', String(Object.keys(all).length + 1),
        'PIDs', 'au', String(pids.length), ...pids.map(String), ...sv, '0']);
      return true;
    } catch { return false; }
  },
  setProperty(unit, properties) {
    try { sh('systemctl', ['--user', 'set-property', unit, ...Object.entries(properties).map(([k, v]) => `${k}=${v}`)]); return true; } catch { return false; }
  },
  daemonUnits() {
    try {
      return sh('systemctl', ['--user', 'list-units', 'termfleet-daemon-*.service', '--state=active', '--no-legend', '--plain'])
        .split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((unit) => unit && unit.endsWith('.service'));
    } catch { return []; }
  },
  memoryHigh(unit) {
    try { const value = sh('systemctl', ['--user', 'show', unit, '-p', 'MemoryHigh', '--value']).trim(); return /^\d+$/.test(value) ? value : null; } catch { return null; }
  },
  // Writing a pid into a cgroup's cgroup.procs moves it; the user owns its own app.slice.
  writeProcs(cgroup, pid, cgroupRoot = '/sys/fs/cgroup') {
    try { fs.writeFileSync(path.join(cgroupRoot, cgroup, 'cgroup.procs'), String(pid)); return true; } catch { return false; }
  },
  // Only for a terminal already closed while urgent: what the daemon's close would have done.
  killCgroup(cgroup, cgroupRoot = '/sys/fs/cgroup') {
    try { fs.writeFileSync(path.join(cgroupRoot, cgroup, 'cgroup.kill'), '1'); return true; } catch { return false; }
  },
};

// --- finding a terminal's processes ----------------------------------------------------------
function readProc(procRoot) {
  const list = [];
  let names = [];
  try { names = fs.readdirSync(procRoot).filter((name) => /^\d+$/.test(name)); } catch { return list; }
  for (const pid of names) {
    try {
      const stat = fs.readFileSync(path.join(procRoot, pid, 'stat'), 'utf8');
      const ppid = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1];
      const cgroup = (fs.readFileSync(path.join(procRoot, pid, 'cgroup'), 'utf8').match(/^0::(.*)$/m) || [])[1] || '';
      list.push({ pid, ppid, cgroup: cgroup.trim(), procRoot });
    } catch { /* the process ended while we looked */ }
  }
  return list;
}
const paneOf = (proc) => {
  try { return fs.readFileSync(path.join(proc.procRoot, proc.pid, 'environ'), 'utf8').match(/(?:^|\0)TERMFLEET_PANE_ID=([^\0]+)/)?.[1] || null; } catch { return null; }
};

/** The terminal's shell and every descendant that still lives under the daemon or its own scope. */
export function panePids(paneId, { procRoot = '/proc', sessionPid = null } = {}) {
  const procs = readProc(procRoot).filter((p) => DAEMON_CGROUP.test(p.cgroup) || URGENT_CGROUP.test(p.cgroup));
  const children = new Map();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
  const seeds = procs.filter((p) => (sessionPid != null && p.pid === String(sessionPid)) || paneOf(p) === paneId);
  const found = new Map();
  const stack = [...seeds];
  while (stack.length) {
    const p = stack.pop();
    if (found.has(p.pid)) continue;
    found.set(p.pid, p);
    stack.push(...(children.get(p.pid) || []));
  }
  const list = [...found.values()];
  return {
    pids: list.map((p) => p.pid),
    procs: list,
    // The terminal's own group inside the daemon service (where Off moves programs back to).
    homeCgroup: seeds.map((p) => p.cgroup).find((c) => DAEMON_CGROUP.test(c))
      || list.map((p) => p.cgroup).find((c) => DAEMON_CGROUP.test(c)) || null,
  };
}

const scopeCgroupOf = (scope, homeCgroup) => { const service = serviceOf(homeCgroup); return service ? path.join(path.dirname(service), scope) : null; };
const cgroupExists = (cgroupRoot, cgroup) => Boolean(cgroup) && fs.existsSync(path.join(cgroupRoot, cgroup));
const cgroupProcs = (cgroupRoot, cgroup) => {
  try { return fs.readFileSync(path.join(cgroupRoot, cgroup, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
};

// --- Urgent on / off -------------------------------------------------------------------------
export function urgentStatus(paneId, { paths = defaults(), cgroupRoot = '/sys/fs/cgroup' } = {}) {
  const marker = readJson(markerFile(paneId, paths));
  const scope = paneScopeName(paneId);
  const active = Boolean(marker?.scopeCgroup && cgroupProcs(cgroupRoot, marker.scopeCgroup).length);
  return { paneId, urgent: Boolean(marker), active, scope, since: marker?.since ?? null, by: marker?.by ?? null, reason: marker?.reason ?? null };
}

export function listUrgent(paths = defaults()) {
  let names = [];
  try { names = fs.readdirSync(paths.urgent).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJson(path.join(paths.urgent, n))).filter((m) => m?.paneId);
}

export function setUrgent(paneId, on, {
  paths = defaults(), procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', sys = systemd,
  sessionPid = null, by = 'noam', reason = null, now = Date.now(),
} = {}) {
  const scope = paneScopeName(paneId);
  const marker = readJson(markerFile(paneId, paths));
  const write = (cgroup, pid) => sys.writeProcs(cgroup, pid, cgroupRoot);
  if (!on) {
    fs.rmSync(markerFile(paneId, paths), { force: true });
    const scopeCgroup = marker?.scopeCgroup;
    const back = cgroupExists(cgroupRoot, marker?.homeCgroup) ? marker.homeCgroup : serviceOf(marker?.homeCgroup);
    const left = scopeCgroup ? cgroupProcs(cgroupRoot, scopeCgroup) : [];
    let refused = 0;
    for (const pid of left) if (!back || !write(back, pid)) refused += 1;
    if (refused) {
      const { agentWeight } = readPrioritySettings(paths);
      sys.setProperty(scope, { CPUWeight: agentWeight, IOWeight: agentWeight });
    }
    return { ok: true, paneId, urgent: false, moved: left.length - refused, lowered: refused > 0 };
  }

  const found = panePids(paneId, { procRoot, sessionPid });
  const homeCgroup = found.homeCgroup || marker?.homeCgroup || null;
  const scopeCgroup = scopeCgroupOf(scope, homeCgroup);
  const outside = () => panePids(paneId, { procRoot, sessionPid }).procs.filter((p) => DAEMON_CGROUP.test(p.cgroup)).map((p) => p.pid);
  const pending = outside();
  const inScope = scopeCgroup ? cgroupProcs(cgroupRoot, scopeCgroup).length > 0 : false;
  if (!pending.length && !inScope) {
    return { ok: false, paneId, urgent: false, error: 'This terminal has no running programs to speed up.' };
  }
  if (pending.length) {
    if (inScope) {
      for (const pid of pending) write(scopeCgroup, pid);
    } else {
      const service = path.basename(serviceOf(homeCgroup));
      const memoryHigh = sys.memoryHigh(service);
      const properties = { CPUWeight: URGENT_WEIGHT, IOWeight: URGENT_WEIGHT, ...(memoryHigh ? { MemoryHigh: memoryHigh } : {}), BindsTo: [service] };
      if (!sys.startScope(scope, pending, properties)) {
        return { ok: false, paneId, urgent: false, error: 'The system refused to give this terminal its own priority group.' };
      }
    }
    // Programs forked while we moved their parents: catch them on a second and third pass.
    for (let pass = 0; pass < 2; pass += 1) for (const pid of outside()) write(scopeCgroup, pid);
  }
  sys.setProperty(scope, { CPUWeight: URGENT_WEIGHT, IOWeight: URGENT_WEIGHT });
  const next = { paneId, since: marker?.since ?? now, by: marker?.by ?? by, reason: marker?.reason ?? reason, homeCgroup, scopeCgroup };
  writeJson(markerFile(paneId, paths), next);
  return { ok: true, paneId, urgent: true, scope, moved: pending.length };
}

/**
 * Keep urgent marks true: re-promote a terminal whose agent restarted (new programs are back
 * under the daemon), and finish the close of a terminal closed while urgent.
 */
export function reconcileUrgent(opts = {}) {
  const paths = opts.paths || defaults();
  const cgroupRoot = opts.cgroupRoot || '/sys/fs/cgroup';
  const sys = opts.sys || systemd;
  return listUrgent(paths).map((m) => {
    if (m.homeCgroup && !cgroupExists(cgroupRoot, m.homeCgroup)) {
      // The daemon closed this terminal (its own group is gone): end what the close would have.
      if (m.scopeCgroup && cgroupExists(cgroupRoot, m.scopeCgroup)) sys.killCgroup(m.scopeCgroup, cgroupRoot);
      fs.rmSync(markerFile(m.paneId, paths), { force: true });
      return { paneId: m.paneId, ok: true, closed: true };
    }
    const found = panePids(m.paneId, { procRoot: opts.procRoot || '/proc' });
    if (!found.procs.some((p) => DAEMON_CGROUP.test(p.cgroup))) return { paneId: m.paneId, ok: true, moved: 0 };
    return setUrgent(m.paneId, true, { ...opts, paths, by: m.by, reason: m.reason });
  });
}

/** Apply the low agent weight to every running daemon unit (live, no restart). */
export function applyAgentWeight({ paths = defaults(), sys = systemd } = {}) {
  const { agentWeight } = readPrioritySettings(paths);
  const units = sys.daemonUnits();
  for (const unit of units) sys.setProperty(unit, { CPUWeight: agentWeight, IOWeight: agentWeight });
  return { agentWeight, units };
}

/** An agent may promote its own terminal only when Noam asked for urgency. */
export function selfRequestAllowed({ noamSaid = '', ownerWords = null, verify = null } = {}) {
  if (ownerWords) {
    const entry = verify ? verify(ownerWords) : null;
    return entry ? { ok: true, reason: `Noam (verified): ${entry.text}` } : { ok: false, error: 'Those owner words could not be verified as Noam\'s.' };
  }
  const said = String(noamSaid || '').trim();
  if (!said) return { ok: false, error: 'An agent can make its own terminal urgent only when Noam asked for it: pass his words.' };
  return { ok: true, reason: `Noam said: ${said}` };
}
