/**
 * Each live terminal's requests (in the operator's words, with their status) written
 * next to the other per-pane status files, so the TermFleet desktop app can show the
 * same requests side panel the Agents chat shows, updating live. The desktop reads it
 * with the status-file reader it already has (no new network path).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Same hash the desktop app uses for its per-pane status files (agentStatusSidecar.ts).
export function fnv(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const asksSidecarName = (paneId) => `asks-${fnv(paneId)}.json`;

export function defaultAsksDir() {
  return process.env.TC_ASKS_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'terminal-workspace', 'agent-status');
}

/** Write one file per live terminal that has requests; only when something changed. */
export function createAsksSidecarWriter({ dir = defaultAsksDir(), asksOf, now = Date.now } = {}) {
  const written = new Map();
  return function write(panes) {
    let count = 0;
    for (const pane of panes || []) {
      if (!pane?.id || pane.live === false) continue;
      let asks = null;
      try { asks = asksOf(pane); } catch { asks = null; }
      if (!asks || !asks.length) continue;
      const nowLabel = pane.sessionAuthority && pane.sessionViewV2?.now && !pane.sessionViewV2.now.stale ? String(pane.sessionViewV2.now.label || '') : '';
      const body = { paneId: pane.id, working: Boolean(pane.producing || pane.turn === 'working'), live: nowLabel || null, asks };
      const key = JSON.stringify(body);
      if (written.get(pane.id) === key) continue;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, asksSidecarName(pane.id));
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ ...body, updatedAt: now() }));
        fs.renameSync(tmp, file);
        written.set(pane.id, key);
        count += 1;
      } catch { /* the panel only shows less */ }
    }
    return count;
  };
}
