import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * How the owner wants the fleet arranged. Kept on the machine rather than in
 * the browser so the same order shows up on any phone he signs in from.
 */
const DIR = process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
const FILE = path.join(DIR, 'prefs.json');

const DEFAULTS = { view: 'projects', order: [] };

export function readPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      view: saved.view === 'manual' ? 'manual' : 'projects',
      order: Array.isArray(saved.order) ? saved.order.filter((v) => typeof v === 'string') : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  next.view = next.view === 'manual' ? 'manual' : 'projects';
  next.order = Array.isArray(next.order) ? next.order.slice(0, 500) : [];
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch { /* a failed save must not break the app */ }
  return next;
}

const RANK = { waiting: 0, working: 1, idle: 2 };

/**
 * Group terminals the way the desktop does — by project — while making sure a
 * project with something waiting cannot hide below the fold.
 */
export function byProject(panes) {
  const groups = new Map();
  for (const pane of panes) {
    const key = pane.project || 'Other';
    if (!groups.has(key)) groups.set(key, { project: key, emoji: pane.emoji || null, panes: [] });
    groups.get(key).panes.push(pane);
  }

  for (const group of groups.values()) {
    group.panes.sort((a, b) => (RANK[a.turn] - RANK[b.turn]) || (b.updatedAt - a.updatedAt));
    group.attention = Math.min(...group.panes.map((p) => RANK[p.turn]));
    group.updatedAt = Math.max(...group.panes.map((p) => p.updatedAt));
  }

  return [...groups.values()].sort(
    (a, b) => (a.attention - b.attention) || (b.updatedAt - a.updatedAt),
  );
}

/** The owner's own order; anything new goes to the end, newest first. */
export function inManualOrder(panes, order) {
  const place = new Map(order.map((id, i) => [id, i]));
  return [...panes].sort((a, b) => {
    const ap = place.has(a.id) ? place.get(a.id) : Infinity;
    const bp = place.has(b.id) ? place.get(b.id) : Infinity;
    if (ap !== bp) return ap - bp;
    return b.updatedAt - a.updatedAt;
  });
}
