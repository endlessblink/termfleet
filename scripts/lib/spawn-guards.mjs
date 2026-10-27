import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'requirements.txt', 'HANDOFF.md', 'CLAUDE.md', 'AGENTS.md', 'MASTER_PLAN.md'];

/**
 * Why a bot may not start a terminal in this folder, or null. Noam 2026-10-27 ("why was this opened in
 * endlessblink, a root folder, dangerous and messy"): a helper was started in ~/Pictures/termcontrol (a
 * screenshots folder a bot mistook for the UI code) and the app filed it under the home-folder project.
 * Folders outside home, bot home folders, and anything under a project (walking up to, not including,
 * home) pass. Override: TERMFLEET_ALLOW_ANY_FOLDER=1.
 */
export function startFolderProblem(folder, { home = homedir(), botsHome = null, env = process.env } = {}) {
  if (env.TERMFLEET_ALLOW_ANY_FOLDER === '1') return null;
  const dir = path.resolve(String(folder || ''));
  try { if (!statSync(dir).isDirectory()) return `${dir} is not a folder.`; } catch { return `${dir} does not exist.`; }
  const homeDir = path.resolve(home);
  if (dir === '/' || dir === homeDir) return `${dir} is a root folder: a terminal started there works in the middle of everything and cannot be filed under a project.`;
  if (!dir.startsWith(homeDir + path.sep)) return null;
  if (botsHome && (dir === path.resolve(botsHome) || dir.startsWith(path.resolve(botsHome) + path.sep))) return null;
  for (let at = dir; at !== homeDir && at.startsWith(homeDir + path.sep); at = path.dirname(at)) {
    if (PROJECT_MARKERS.some((marker) => existsSync(path.join(at, marker)))) return null;
  }
  return `${dir} is not a project folder (no project files in it or above it inside your home folder).`;
}

// Resource guards for starting new terminals (Agent-Manager 2026-10-24: "one bot opens 13
// terminals and crashes the whole system"). Pure checks; the callers decide what to refuse.

const GB = 1024 ** 3;

/** MemAvailable from /proc/meminfo text, in bytes (null when it cannot be read). */
export function availableMemoryBytes(meminfo) {
  const kb = /^MemAvailable:\s+(\d+)\s*kB/m.exec(String(meminfo || ''))?.[1];
  return kb ? Number(kb) * 1024 : null;
}

/** Refuses when available memory is below the floor (default 4 GB, TERMFLEET_MIN_FREE_GB). */
export function memoryGuard({ env = process.env, readMeminfo = () => readFileSync('/proc/meminfo', 'utf8') } = {}) {
  const minGb = Number(env.TERMFLEET_MIN_FREE_GB) > 0 ? Number(env.TERMFLEET_MIN_FREE_GB) : 4;
  let free;
  try { free = availableMemoryBytes(readMeminfo()); } catch { free = null; }
  // Unknown memory never blocks a start: the guard protects, it does not guess.
  if (free === null || free >= minGb * GB) return { ok: true, freeGb: free === null ? null : free / GB, minGb };
  return { ok: false, freeGb: free / GB, minGb, message: `only ${(free / GB).toFixed(1)} GB of memory is free (the floor is ${minGb} GB), so no new terminal was started. Close a terminal or wait, then try again.` };
}

/** How many terminals one bot may run at once: TERMFLEET_BOT_MAX_TERMINALS, else the bot's own `maxTerminals`, else 3. */
export function botTerminalLimit({ env = process.env, bot = null } = {}) {
  for (const value of [env.TERMFLEET_BOT_MAX_TERMINALS, bot?.maxTerminals]) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 3;
}

/** The terminals a bot started (not ones it only follows) that are still running. */
export function liveBotTerminals(helpers, panes) {
  const alive = new Set((panes || []).filter((p) => p?.alive).map((p) => p.id));
  const ids = new Set();
  for (const h of Array.isArray(helpers) ? helpers : []) if (h?.paneId && !h.followed && !h.ended && alive.has(h.paneId)) ids.add(h.paneId);
  return [...ids];
}
