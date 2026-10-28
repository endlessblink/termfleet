import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { adapterFor } from './feed.mjs';
import { createActionEvidence } from './action-evidence.mjs';

const DAY = 86_400_000;
const IDLE_MS = 60_000;
const TYPES = new Set(['start', 'message', 'tool_use', 'stall', 'close', 'token_usage']);
const defaultFile = path.join(process.env.TC_CONFIG_DIR || fileURLToPath(new URL('../', import.meta.url)), 'data', 'agent_events.db');

/** One local table; activity is inferred from events, not measured CPU/billable time. */
export function createEventLog({ file = defaultFile, now = Date.now } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  if (file !== ':memory:') fs.chmodSync(file, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  const actions = createActionEvidence(db, { now });
  const previous = db.prepare("SELECT sql FROM sqlite_master WHERE name='agent_events'").get();
  // SQLite cannot alter a CHECK constraint; rebuild atomically while preserving IDs.
  if (previous && !previous.sql.includes("'token_usage'")) db.transaction(() => {
    db.exec('ALTER TABLE agent_events RENAME TO agent_events_previous');
    db.exec(previous.sql.replace("'close'", "'close','token_usage'"));
    db.exec('INSERT INTO agent_events SELECT * FROM agent_events_previous; DROP TABLE agent_events_previous');
  })();
  db.exec(`CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id TEXT NOT NULL,
    bot_name TEXT,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('start','message','tool_use','stall','close','token_usage')),
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_terminal_time ON agent_events(terminal_id, created_at, id);
  CREATE INDEX IF NOT EXISTS events_time ON agent_events(created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS events_source ON agent_events(terminal_id, json_extract(payload, '$.source_id'))
    WHERE json_extract(payload, '$.source_id') IS NOT NULL;`);
  db.prepare('DELETE FROM agent_events WHERE created_at < ?').run(new Date(now() - 7 * DAY).toISOString());
  const insert = db.prepare('INSERT OR IGNORE INTO agent_events (terminal_id,bot_name,provider,event_type,payload,created_at) VALUES (?,?,?,?,?,?)');
  const latest = db.prepare("SELECT * FROM agent_events WHERE terminal_id = ? AND event_type != 'token_usage' ORDER BY created_at DESC,id DESC LIMIT 1");
  const latestStart = db.prepare("SELECT created_at FROM agent_events WHERE terminal_id = ? AND event_type = 'start' ORDER BY id DESC LIMIT 1");
  const tracked = new Map();
  const stamps = new Map();
  for (const row of db.prepare("SELECT e.* FROM agent_events e WHERE event_type != 'token_usage' AND id = (SELECT id FROM agent_events WHERE terminal_id=e.terminal_id AND event_type != 'token_usage' ORDER BY created_at DESC,id DESC LIMIT 1)").all()) {
    if (row.event_type !== 'close') tracked.set(row.terminal_id, row);
  }

  function append(terminal_id, bot_name, provider, event_type, payload, at = now()) {
    if (!terminal_id || typeof terminal_id !== 'string' || !TYPES.has(event_type)) throw new TypeError('Invalid terminal or event type');
    const result = insert.run(terminal_id, bot_name || null, provider || 'unknown', event_type, JSON.stringify(payload ?? {}), new Date(at).toISOString());
    return result.changes ? Number(result.lastInsertRowid) : null;
  }
  function logEvent(terminal_id, bot_name, provider, event_type, payload) {
    return append(terminal_id, bot_name, provider, event_type, payload);
  }
  function queryEvents(filters = {}) {
    const clauses = [], values = [];
    for (const key of ['terminal_id', 'bot_name', 'provider', 'event_type']) {
      if (filters[key] !== undefined) { clauses.push(`${key} IS ?`); values.push(filters[key]); }
    }
    for (const [key, column, op] of [['since', 'created_at', '>='], ['until', 'created_at', '<='], ['after_id', 'id', '>']]) {
      if (filters[key] !== undefined) { clauses.push(`${column} ${op} ?`); values.push(filters[key]); }
    }
    const limit = Math.max(1, Math.min(1000, Math.trunc(Number(filters.limit) || 100)));
    return db.prepare(`SELECT * FROM agent_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id ${filters.order === 'desc' ? 'DESC' : 'ASC'} LIMIT ?`)
      .all(...values, limit).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  // Lifecycle close/stall and token billing are not terminal activity.
  function lastActivity(terminalId) {
    const row = db.prepare("SELECT MAX(created_at) AS at FROM agent_events WHERE terminal_id = ? AND event_type IN ('start','message','tool_use')").get(terminalId);
    return row?.at ? Date.parse(row.at) : null;
  }
  function getStats() {
    const at = now(), since = new Date(at - 7 * DAY).toISOString();
    const terminals = new Map();
    // Stream rows rather than copying the entire retained log into memory.
    for (const event of db.prepare("SELECT terminal_id,event_type,created_at FROM agent_events WHERE created_at >= ? AND event_type != 'token_usage' ORDER BY created_at,id").iterate(since)) {
      const time = Math.min(at, Date.parse(event.created_at));
      let terminal = terminals.get(event.terminal_id);
      if (!terminal) {
        terminal = { terminal_id: event.terminal_id, active_ms: 0, idle_ms: 0, state: 'closed', last_event_at: event.created_at, last: time };
        terminals.set(event.terminal_id, terminal);
      }
      accrue(terminal, time);
      terminal.state = event.event_type === 'close' ? 'closed' : event.event_type === 'stall' ? 'idle' : 'active';
      terminal.last = time;
      terminal.last_event_at = event.created_at;
    }
    for (const terminal of terminals.values()) accrue(terminal, at);
    return {
      since, generatedAt: new Date(at).toISOString(), idleAfterMs: IDLE_MS,
      timing: 'Estimated from observed events; silence beyond idleAfterMs counts as idle. Closed intervals are excluded.',
      eventsPerBot: db.prepare('SELECT bot_name,COUNT(*) AS events FROM agent_events WHERE created_at >= ? GROUP BY bot_name ORDER BY events DESC,bot_name').all(since),
      eventsPerProvider: db.prepare('SELECT provider,COUNT(*) AS events FROM agent_events WHERE created_at >= ? GROUP BY provider ORDER BY events DESC,provider').all(since),
      terminals: [...terminals.values()].map(({ last, ...terminal }) => terminal),
    };
  }
  function accrue(terminal, end) {
    const duration = Math.max(0, end - terminal.last);
    if (terminal.state === 'closed') return;
    const active = terminal.state === 'active' ? Math.min(IDLE_MS, duration) : 0;
    terminal.active_ms += active;
    terminal.idle_ms += duration - active;
    if (duration >= IDLE_MS) terminal.state = 'idle';
  }

  // The existing adapters keep reads bounded and retain tool events, unlike the UI feed.
  // Payloads keep metadata only: no message text, tool input or private transcript copy.
  function readNewFeed(pane) {
    const adapter = adapterFor(pane);
    if (pane.provider === 'opencode') return adapter?.readFeed(pane, { limit: 1600 }).events || [];
    const file = adapter?.transcriptPath(pane);
    if (!file) return [];
    const stat = fs.statSync(file), stamp = `${pane.sessionId}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (stamps.get(pane.id) === stamp) return [];
    const events = adapter.readFeed(pane, { limit: 1600, bytes: 512 * 1024 }).events;
    stamps.set(pane.id, stamp);
    return events;
  }
  /** Call only with a successfully reached daemon's complete tracked inventory. */
  function observe(panes, read = readNewFeed) {
    panes = panes.filter((pane) => !pane.sleeping);
    const at = now(), ids = new Set(panes.map((p) => p.id));
    for (const pane of panes) {
      const bot = pane.bot_name || null;
      if (!tracked.has(pane.id)) {
        append(pane.id, bot, pane.provider, 'start', { reason: 'inventory_observed', session_id: pane.sessionId || null }, at);
        tracked.set(pane.id, latest.get(pane.id));
      }
      const since = Date.parse(latestStart.get(pane.id)?.created_at || new Date(at).toISOString());
      try {
        const occurrences = new Map();
        for (const event of read(pane) || []) {
          const time = typeof event.at === 'number' ? event.at : Date.parse(event.at);
          if (!['assistant', 'user', 'tool'].includes(event.kind) || !Number.isFinite(time) || time < since || time > at) continue;
          const hash = createHash('sha256').update(JSON.stringify([pane.sessionId, event.source_id || event])).digest('hex');
          const occurrence = occurrences.get(hash) || 0;
          occurrences.set(hash, occurrence + 1);
          append(pane.id, bot, pane.provider, event.kind === 'tool' ? 'tool_use' : 'message', {
            source_id: `${hash}:${occurrence}`, session_id: pane.sessionId || null,
            ...(event.kind === 'tool' ? { name: event.name } : { role: event.kind, characters: (event.text || '').length }),
          }, time);
        }
      } catch (error) { console.error('[agent events] feed unavailable:', error.code || 'read failed'); }
      const last = latest.get(pane.id);
      if (!['stall', 'close'].includes(last.event_type) && at - Date.parse(last.created_at) >= IDLE_MS) {
        append(pane.id, bot, pane.provider, 'stall', { reason: 'no_observed_activity', idle_after_ms: IDLE_MS }, Date.parse(last.created_at) + IDLE_MS);
      }
      tracked.set(pane.id, latest.get(pane.id));
    }
    for (const [id, last] of tracked) if (!ids.has(id)) {
      append(id, last.bot_name, last.provider, 'close', { reason: 'left_tracked_inventory' }, at);
      tracked.delete(id);
      stamps.delete(id);
    }
  }
  return { ...actions, logEvent, queryEvents, lastActivity, getStats, observe, close: () => { if (db.open) db.close(); } };
}

let store;
const defaultStore = () => store ||= createEventLog();
export const logEvent = (...args) => defaultStore().logEvent(...args);
export const queryEvents = (filters) => defaultStore().queryEvents(filters);
export const getStats = () => defaultStore().getStats();
export const observeEvents = (panes) => defaultStore().observe(panes);
export const lastActivity = (terminalId) => defaultStore().lastActivity(terminalId);
export const recordActionEvidence = event => defaultStore().recordActionEvidence(event);
export const queryActionEvidence = filters => defaultStore().queryActionEvidence(filters);
