import fs from 'node:fs';
import { createRequire } from 'node:module';
import { isNoise, clean } from '../noise.mjs';
import { PATHS } from '../paths.mjs';

export const provider = 'opencode';

const require = createRequire(import.meta.url);

/**
 * OpenCode stores every conversation in one SQLite database (message + part
 * rows), not one transcript file per session. `node:sqlite` is experimental
 * and may be missing on an older runtime, and the database may be absent
 * entirely on a machine that never ran OpenCode. Neither is an error the phone
 * should see — the adapter simply reports "nothing to read" and the app falls
 * back to the terminal's screen, exactly as it does for a plain shell.
 */
let sqlite;            // undefined = not tried yet, null = unavailable
let database = null;

function driver() {
  if (sqlite === undefined) {
    try { sqlite = require('node:sqlite'); } catch { sqlite = null; }
  }
  return sqlite;
}

function db() {
  if (database) return database;
  const nodeSqlite = driver();
  if (!nodeSqlite) return null;
  try {
    const file = PATHS.opencodeDb;
    if (!fs.existsSync(file)) return null;   // retried later: OpenCode may not have run yet
    database = new nodeSqlite.DatabaseSync(file, { readOnly: true });
  } catch {
    database = null;
  }
  return database;
}

/** A locked/corrupt/stale handle must not poison every later read. */
function reset() {
  try { database?.close(); } catch { /* already gone */ }
  database = null;
}

function query(sql, params) {
  const d = db();
  if (!d) return null;
  try {
    return d.prepare(sql).all(...params);
  } catch {
    reset();
    return null;
  }
}

/** The database is the transcript. A mismatch means the pane's session is gone. */
export function transcriptPath(pane) {
  if (!pane?.sessionId) return null;
  const rows = query('SELECT 1 AS ok FROM session WHERE id = ? LIMIT 1', [pane.sessionId]);
  return rows && rows.length ? PATHS.opencodeDb : null;
}

const MESSAGE_SCAN_CAP = 2000;
const PART_CHUNK = 400;

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** One human line for a tool call; the phone hides tools, but the feed stays honest. */
function summariseTool(tool, input) {
  const name = String(tool || '');
  const i = input && typeof input === 'object' ? input : {};
  const first = (value) => String(value ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 140) || '';
  const detail = i.command || i.filePath || i.path || i.pattern || i.query || i.url || i.description;
  return { name: name || 'tool', summary: detail ? first(detail) : '' };
}

/**
 * Walk the conversation newest-first so a long session costs the same as a
 * short one, then reverse into reading order. Only `text` and `tool` parts are
 * conversation; reasoning, step markers and patches are machinery.
 */
export function readFeed(pane, { limit = 60 } = {}) {
  if (!pane?.sessionId) return { events: [], pending: [] };

  const messages = query(
    `SELECT id, time_created, data FROM message
      WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ?`,
    [pane.sessionId, Math.min(Math.max(limit, 1), MESSAGE_SCAN_CAP)],
  );
  if (!messages) return { events: [], pending: [] };
  if (!messages.length) return { events: [], pending: [] };

  const meta = new Map();
  for (const message of messages) {
    try {
      const parsed = JSON.parse(message.data);
      const role = parsed?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      meta.set(message.id, {
        role,
        at: Number(parsed?.time?.created) || Number(message.time_created) || null,
      });
    } catch { /* a partial vendor row carries nothing to read */ }
  }
  if (!meta.size) return { events: [], pending: [] };

  const parts = new Map();
  for (const ids of chunk([...meta.keys()], PART_CHUNK)) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = query(
      `SELECT message_id, data FROM part
        WHERE message_id IN (${placeholders}) ORDER BY time_created ASC, id ASC`,
      ids,
    );
    if (!rows) return { events: [], pending: [] };
    for (const row of rows) {
      if (!parts.has(row.message_id)) parts.set(row.message_id, []);
      parts.get(row.message_id).push(row.data);
    }
  }

  const events = [];
  for (const [id, { role, at }] of meta) {
    const texts = [];
    const tools = [];
    for (const raw of parts.get(id) || []) {
      let part;
      try { part = JSON.parse(raw); } catch { continue; }
      if (part?.type === 'text' && part.text) texts.push(String(part.text));
      else if (part?.type === 'tool') tools.push(summariseTool(part.tool, part.state?.input));
    }

    const body = texts.join('\n').trim();
    const text = body ? clean(body) : '';
    if (text && !isNoise(body)) events.push({ kind: role, at, text });
    for (const tool of tools) events.push({ kind: 'tool', at, name: tool.name, summary: tool.summary });
  }

  return { events: events.reverse(), pending: [] };
}

/**
 * The permission dialog is a selectable list whose keys are its own: Enter
 * picks the highlighted option ("Allow once" is first), the right arrow moves
 * to the next ("Allow always"), and Escape is bound to "Reject" (`escapeKey`).
 * Source: the permission component in the installed OpenCode binary.
 */
export const approval = { yes: '\r', yesAlways: '\u001b[C\r', no: '\u001b' };
