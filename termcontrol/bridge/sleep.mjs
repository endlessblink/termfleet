// Sleep for idle agent terminals. Noam 2026-10-22: 'אני רוצה שתהיה לי גישה לכמה סוכנים שאני
// צריך אבל שהם לא יגנבו הרבה זיכרון במצב idle'. An open claude/codex terminal holds ~0.35 GB
// while it waits. A sleeping one has its programs ended (as a recoverable stop, so the daemon
// keeps its checkpoint) while its card and conversation stay; waking it asks the daemon for the
// same terminal again, which resumes the same conversation in the same folder.
//
// The mark is sleeping/<pane id>.json: the cleanup sweep (idle-cleanup.mjs) checks exactly
// that file and never closes a sleeping card. The PC app reads the same file to show Sleeping.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_IDLE_MINUTES = 20;
const AGENTS = new Set(['claude', 'codex', 'opencode']);
const AGENTS_SERVICE = /termcontrol\/bridge\/server\.mjs/;
const AGENT_CMD = /(^|[\s/])(claude|codex|opencode)(\s|$)/;
// The PC app touches viewing/<id> every few seconds while the terminal is the one in front.
const VIEWING_FRESH_MS = 2 * 60_000;
// Helpers an agent starts as it boots (MCP servers, its own native binary) are part of it.
const BOOT_GRACE_S = 120;
const AGENT_HELPER = /mcp|langserver|language-server|\blsp\b|pyright|tsserver|rust-analyzer|gopls|clangd/i;

const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_');

export function sleepPaths(env = process.env) {
  const data = path.join(env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share'), 'terminal-workspace');
  const root = path.join(data, 'agent-sleep');
  return { sleeping: path.join(data, 'sleeping'), urgent: path.join(data, 'cpu-priority', 'urgent'), root, settings: path.join(root, 'settings.json'), keepAwake: path.join(root, 'keep-awake'), viewing: path.join(root, 'viewing') };
}
const defaults = sleepPaths();

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function readSettings(paths = defaults) {
  const raw = readJson(paths.settings) || {};
  const minutes = Number(raw.idleMinutes);
  return { enabled: raw.enabled !== false, idleMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.round(minutes) : DEFAULT_IDLE_MINUTES };
}

export function writeSettings(paths = defaults, patch = {}) {
  const now = readSettings(paths);
  const minutes = Number(patch.idleMinutes);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : now.enabled,
    idleMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60 ? Math.round(minutes) : now.idleMinutes,
  };
  writeJson(paths.settings, next);
  return next;
}

export const sleepFile = (id, paths = defaults) => path.join(paths.sleeping, `${safe(id)}.json`);
export const isSleeping = (id, paths = defaults) => fs.existsSync(sleepFile(id, paths));
export const readSleep = (id, paths = defaults) => readJson(sleepFile(id, paths));
export const clearSleep = (id, paths = defaults) => fs.rmSync(sleepFile(id, paths), { force: true });

export function listSleeping(paths = defaults) {
  let names = [];
  try { names = fs.readdirSync(paths.sleeping).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJson(path.join(paths.sleeping, n))).filter((r) => r && typeof r.paneId === 'string');
}

export const isKeepAwake = (id, paths = defaults) => fs.existsSync(path.join(paths.keepAwake, safe(id)));
export function setKeepAwake(id, on, paths = defaults) {
  const file = path.join(paths.keepAwake, safe(id));
  if (on) { fs.mkdirSync(paths.keepAwake, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, ''); } else fs.rmSync(file, { force: true });
  return Boolean(on);
}

export function markViewing(id, paths = defaults, at = Date.now()) {
  const file = path.join(paths.viewing, safe(id));
  fs.mkdirSync(paths.viewing, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, '');
  fs.utimesSync(file, at / 1000, at / 1000);
}
export const viewedAt = (id, paths = defaults) => { try { return fs.statSync(path.join(paths.viewing, safe(id))).mtimeMs; } catch { return 0; } };

/** Seconds since boot when `pid` started, from /proc; null when it is gone. */
export function startSeconds(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    return Number.isFinite(ticks) ? ticks / 100 : null;
  } catch { return null; }
}

function subtree(root, table) {
  const kids = new Map();
  for (const p of table) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [], queue = [...(kids.get(root) || [])];
  while (queue.length) { const p = queue.shift(); out.push(p); queue.push(...(kids.get(p.pid) || [])); }
  return out;
}

/**
 * What under the terminal is real work that sleep would stop: anything beside the agent, and
 * anything the agent started after it booted (a build, test run or server). The agent itself
 * and what it started while booting (MCP servers, its native binary) end and come back with it.
 */
export function workProcesses(terminalPid, table, startOf = startSeconds) {
  const all = subtree(terminalPid, table);
  // After a wake the terminal's own process IS the agent (the daemon starts `claude --resume` directly).
  const root = table.find((p) => p.pid === terminalPid);
  const isAgent = (p) => AGENTS.has(p.comm) || AGENT_CMD.test(p.cmd || '');
  const agent = root && isAgent(root) && !/^(ba|z|fi)?sh$/.test(root.comm) ? root : all.find((p) => AGENTS.has(p.comm)) || all.find((p) => AGENT_CMD.test(p.cmd || ''));
  if (!agent) return all;
  const agentStart = startOf(agent.pid) ?? 0;
  const under = subtree(agent.pid, table);
  const underIds = new Set(under.map((p) => p.pid));
  // The agent's own ancestors (bash -lc, a node launcher) are its wrapper, not work.
  const ancestors = new Set();
  for (let p = agent; p && p.pid !== terminalPid;) { ancestors.add(p.pid); p = table.find((x) => x.pid === p.ppid); }
  const work = [];
  for (const p of all) {
    if (p.pid === agent.pid || ancestors.has(p.pid)) continue;
    if (!underIds.has(p.pid)) { work.push(p); continue; }
    // Tool servers the agent runs for itself (MCP, language servers) start on demand and end with it.
    if (AGENT_HELPER.test(`${p.comm} ${p.cmd || ''}`)) continue;
    if ((startOf(p.pid) ?? 0) > agentStart + BOOT_GRACE_S) work.push(p);
  }
  return work;
}

/** Why this terminal must stay awake, or null when it may sleep now. */
export function sleepVerdict(pane, { now = Date.now(), paths = defaults, settings = readSettings(paths), processes = () => [], visitedAt = () => 0 } = {}) {
  if (!AGENTS.has(pane.provider)) return 'Not an agent';
  if (pane.sleeping || isSleeping(pane.id, paths)) return 'Already sleeping';
  if (pane.alive === false) return 'Not running';
  if (!pane.sessionId) return 'No saved conversation to come back to';
  if (!settings.enabled) return 'Sleep is off';
  if (isKeepAwake(pane.id, paths)) return 'Kept awake';
  // Marked Urgent (cpu-priority): Noam wants it working, and its programs run outside the pane's own group.
  if (fs.existsSync(path.join(paths.urgent, `${safe(pane.id)}.json`))) return 'Marked urgent';
  if (pane.turn === 'working' || pane.producing || pane.live === 'producing') return 'Working right now';
  if (pane.turn === 'waiting' || pane.attention) return 'Waiting for you';
  const idleMs = settings.idleMinutes * 60_000;
  const lastActive = Number(pane.lastActiveAt) || 0;
  if (!lastActive || now - lastActive < idleMs) return `Used in the last ${settings.idleMinutes} minutes`;
  if (now - viewedAt(pane.id, paths) < VIEWING_FRESH_MS) return 'Open on the PC right now';
  if (now - (Number(visitedAt(pane.id)) || 0) < idleMs) return 'Opened on the phone recently';
  const running = processes(pane);
  if (running.some((p) => AGENTS_SERVICE.test(p.cmd || ''))) return 'Runs the Agents service';
  if (running.length) return `Something is still running in it (${running[0].comm})`;
  return null;
}

/** Memory a terminal's whole program tree holds (what ending it gives back), in bytes. */
export function treeRss(terminalPid, table) {
  let kb = 0;
  for (const pid of [terminalPid, ...subtree(terminalPid, table).map((p) => p.pid)]) {
    // Proportional share (Pss) counts shared libraries once across the tree; RSS when unreadable.
    try { kb += Number(/^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] || 0); continue; } catch { /* fall back */ }
    try { kb += Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] || 0); } catch { /* ended */ }
  }
  return kb * 1024;
}

async function stillRunning(id, ask) {
  const res = await ask({ type: 'listSessions' });
  if (res?.ok !== true) return null;
  return (res.value?.sessions || []).some((s) => s.id === id && s.lastExit == null);
}

/** Put one terminal to sleep: mark it first (so the app shows Sleeping, not "exited"), then end its programs. */
export async function sleepPane(pane, { ask, paths = defaults, now = Date.now(), rssOf = () => 0, why = 'idle' }) {
  const freedBytes = rssOf(pane);
  writeJson(sleepFile(pane.id, paths), {
    version: 1, paneId: pane.id, pid: pane.pid || null, provider: pane.provider, sessionId: pane.sessionId || null, cwd: pane.cwd || null,
    project: pane.project || null, title: pane.profile?.name || pane.title || pane.goal || null, sleptAt: now, freedBytes, why,
  });
  let res;
  try { res = await ask({ type: 'killSession', id: pane.id, user_requested: false }); } catch (error) { res = { ok: false, error: error.message }; }
  const running = await stillRunning(pane.id, ask).catch(() => null);
  if (res?.ok !== true || running !== false) {
    clearSleep(pane.id, paths);
    return { ok: false, error: res?.error || 'The terminal did not stop.' };
  }
  return { ok: true, freedBytes };
}

/** Wait until a resumed agent has drawn its screen and gone quiet, so typed text lands in its prompt. */
export async function waitUntilReady(id, { ask, minMs = 3000, quietMs = 2500, maxMs = 45_000, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const start = Date.now();
  let last = -1, stableSince = Date.now();
  while (Date.now() - start < maxMs) {
    await pause(500);
    const res = await ask({ type: 'listSessions' }).catch(() => null);
    const s = (res?.value?.sessions || []).find((x) => x.id === id);
    const bytes = Number(s?.scrollbackBytes || 0);
    if (bytes !== last) { last = bytes; stableSince = Date.now(); }
    if (Date.now() - start >= minMs && Date.now() - stableSince >= quietMs) return true;
  }
  return false;
}

const waking = new Map();

/** Wake one sleeping terminal: the daemon restarts it and resumes its conversation. Safe to call twice. */
export function wakePane(id, { ask, paths = defaults, waitReady = (paneId) => waitUntilReady(paneId, { ask }) }) {
  if (waking.has(id)) return waking.get(id);
  const rec = readSleep(id, paths);
  if (!rec) return Promise.resolve({ ok: true, already: true });
  const run = (async () => {
    let res;
    try { res = await ask({ type: 'ensureSession', id, cwd: rec.cwd || null, command: null }); } catch (error) { res = { ok: false, error: error.message }; }
    if (res?.ok !== true || res.value?.error) return { ok: false, error: res?.error || res?.value?.error || 'The terminal could not be started again.' };
    clearSleep(id, paths);
    await waitReady(id);
    return { ok: true, sleptAt: rec.sleptAt || null };
  })().finally(() => waking.delete(id));
  waking.set(id, run);
  return run;
}

/**
 * Keep sleeping cards in the terminal list, as sleeping, so the phone and the map still show
 * them. A mark left for a terminal that runs again (opened on the PC) is cleared.
 */
export function withSleepingLives(byId, paths = defaults) {
  for (const rec of listSleeping(paths)) {
    const life = byId.get(rec.paneId);
    // A mark is stale only when a NEW program runs there (woken on the PC). A list read just
    // before the sleep still shows the old program; that must not wipe a fresh mark.
    if (life && !life.exited && !life.sleeping) {
      if (life.pid && rec.pid && life.pid !== rec.pid) clearSleep(rec.paneId, paths);
      continue;
    }
    byId.set(rec.paneId, { alive: true, exited: false, sleeping: true, sleptAt: rec.sleptAt || null, pid: null, initialCwd: rec.cwd || null, bytes: 0, producing: false, quietForMs: null, firstLook: false, pulse: [] });
  }
  return byId;
}

/** One pass: sleep every terminal that may sleep now. */
export async function sweepSleep({ panes, sleep, log = () => {}, ...ctx }) {
  let freedBytes = 0;
  const slept = [];
  for (const pane of panes) {
    if (pane.sleeping) continue;
    if (sleepVerdict(pane, ctx) !== null) continue;
    const r = await sleep(pane);
    if (r?.ok) { freedBytes += r.freedBytes || 0; slept.push(pane.id); log(pane, r); }
  }
  return { slept, freedBytes };
}
