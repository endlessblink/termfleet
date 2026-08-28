import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.mjs';

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

const PROVIDERS = { claude: 'claude', codex: 'codex', opencode: 'opencode' };

function providerOf(source) {
  const s = String(source || '');
  for (const key of Object.keys(PROVIDERS)) if (s.startsWith(key)) return key;
  return null;
}

/**
 * One pane record as written by the status hooks. The file name is opaque; the
 * record itself carries the identity we care about.
 */
function readPaneRecords() {
  let names = [];
  try { names = fs.readdirSync(PATHS.agentStatus); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.startsWith('pane-') || !name.endsWith('.json')) continue;
    const file = path.join(PATHS.agentStatus, name);
    const rec = readJson(file);
    if (!rec) continue;
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    out.push({ ...rec, _file: name, _mtime: mtime });
  }
  return out;
}

/** Plain-language line describing what this pane is doing, or null. */
function taskLine(rec) {
  const inProgress = (rec.todos || []).find((t) => t.status === 'in_progress');
  const candidate =
    (inProgress && (inProgress.activeForm || inProgress.content)) ||
    rec.mainTask ||
    rec.now ||
    null;
  const text = typeof candidate === 'string' ? candidate.trim() : '';
  return text.length > 0 ? text : null;
}

/** waiting > working > idle, from what the hooks recorded. */
function turnOf(rec) {
  const t = String(rec.turn || '').toLowerCase();
  if (t === 'waiting' || t === 'working' || t === 'idle') return t;
  return 'idle';
}

export function listPanes({ maxAgeMs = null } = {}) {
  const now = Date.now();
  const panes = [];
  for (const rec of readPaneRecords()) {
    const provider = providerOf(rec.source);
    if (!provider) continue;
    if (!rec.sessionId) continue;
    const updatedAt = rec.updatedAt || rec._mtime || 0;
    if (maxAgeMs != null && now - updatedAt > maxAgeMs) continue;

    panes.push({
      id: rec.paneId || rec._file.replace(/^pane-|\.json$/g, ''),
      provider,
      sessionId: rec.sessionId,
      cwd: rec.cwd || null,
      project: rec.cwd ? path.basename(rec.cwd) : 'unknown',
      turn: turnOf(rec),
      turnReason: rec.turnReason || null,
      task: taskLine(rec),
      updatedAt,
      todos: (rec.todos || []).map((t) => ({
        content: t.content,
        activeForm: t.activeForm || null,
        status: t.status,
      })),
    });
  }

  const rank = { waiting: 0, working: 1, idle: 2 };
  panes.sort((a, b) => (rank[a.turn] - rank[b.turn]) || (b.updatedAt - a.updatedAt));
  return panes;
}
