// Evidence index in agent_events.db, never a task authority or a transcript store.
const KINDS = new Set(['tool', 'turn', 'delivery', 'diagnosis']);
const STATES = new Set(['started', 'succeeded', 'failed', 'queued', 'received', 'interrupted']);
const identifier = (value, required = false) => {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_.:@/-]{1,200}$/u.test(value)) throw new TypeError('Invalid evidence identifier');
  return value;
};

export function createActionEvidence(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS action_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, source_id TEXT NOT NULL,
    action_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    terminal_id TEXT, session_id TEXT, message_id TEXT, turn_id TEXT, tool TEXT,
    result_code TEXT, created_at TEXT NOT NULL, UNIQUE(bot_id,source_id));
    CREATE TABLE IF NOT EXISTS action_evidence_requests (
      evidence_id INTEGER NOT NULL REFERENCES action_evidence(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, PRIMARY KEY(request_id,evidence_id));
    CREATE INDEX IF NOT EXISTS action_evidence_bot ON action_evidence(bot_id,id);
    CREATE INDEX IF NOT EXISTS action_evidence_session ON action_evidence(bot_id,session_id,id);
    CREATE INDEX IF NOT EXISTS action_evidence_message ON action_evidence(bot_id,message_id,id);
    CREATE INDEX IF NOT EXISTS action_evidence_terminal ON action_evidence(bot_id,terminal_id,id);`);
  db.transaction(() => {
    if (!db.prepare('PRAGMA table_info(action_evidence)').all().some(column => column.name === 'source_ref')) db.exec('ALTER TABLE action_evidence ADD COLUMN source_ref TEXT');
  }).immediate();
  db.exec(`CREATE INDEX IF NOT EXISTS action_evidence_pending ON action_evidence(kind,state,id);
    CREATE INDEX IF NOT EXISTS action_evidence_receipt ON action_evidence(bot_id,action_id,state);`);
  db.transaction(() => {
    db.prepare('DELETE FROM action_evidence WHERE created_at < ?').run(new Date(now() - 7 * 86_400_000).toISOString());
    db.exec('DELETE FROM action_evidence_requests WHERE evidence_id NOT IN (SELECT id FROM action_evidence)');
  })();
  const columns = ['bot_id', 'source_id', 'action_id', 'kind', 'state', 'terminal_id', 'session_id', 'message_id', 'turn_id', 'tool', 'result_code', 'source_ref'];
  const insert = db.prepare(`INSERT OR IGNORE INTO action_evidence (${columns.join(',')},created_at) VALUES (${columns.map(() => '?').join(',')},?)`);
  const link = db.prepare('INSERT OR IGNORE INTO action_evidence_requests VALUES (?,?)');
  const recordActionEvidence = db.transaction(event => {
    if (!KINDS.has(event.kind)) throw new TypeError('Invalid evidence kind');
    if (!STATES.has(event.state)) throw new TypeError('Invalid evidence state');
    const values = columns.map(k => identifier(event[k], ['bot_id', 'source_id', 'action_id', 'kind', 'state'].includes(k)));
    const requests = [...new Set(event.request_ids || [])];
    if (requests.length > 100 || requests.some(id => !/^R-\d+$/.test(id))) throw new TypeError('Invalid evidence requests');
    const inserted = insert.run(...values, new Date(now()).toISOString());
    if (!inserted.changes) return null;
    const id = Number(inserted.lastInsertRowid);
    for (const request of requests) link.run(id, request);
    return id;
  });
  function queryActionEvidence(filters = {}) {
    if (!filters.bot_id) throw new TypeError('A bot scope is required');
    const clauses = ['e.bot_id = ?'], values = [identifier(filters.bot_id, true)];
    for (const key of ['terminal_id', 'session_id', 'message_id', 'turn_id', 'action_id']) {
      if (filters[key] != null) { clauses.push(`e.${key} = ?`); values.push(identifier(filters[key], true)); }
    }
    if (filters.request_id) {
      clauses.push('e.id IN (SELECT evidence_id FROM action_evidence_requests WHERE request_id=?)');
      values.push(identifier(filters.request_id, true));
    }
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(filters.limit) || 20)));
    const links = db.prepare('SELECT request_id FROM action_evidence_requests WHERE evidence_id=? ORDER BY request_id');
    return db.prepare(`SELECT e.* FROM action_evidence e WHERE ${clauses.join(' AND ')} ORDER BY e.id DESC LIMIT ?`).all(...values, limit)
      .map(row => ({ ...row, request_ids: links.all(row.id).map(r => r.request_id) }));
  }
  // Internal maintenance query. Public evidence retrieval still requires a bot scope.
  function pendingActionDeliveries({ afterId = 0, limit = 20 } = {}) {
    const cursor = Math.max(0, Math.trunc(Number(afterId) || 0));
    const cap = Math.min(20, Math.max(1, Math.trunc(Number(limit) || 20)));
    const rows = db.prepare(`SELECT e.* FROM action_evidence e
      WHERE e.kind='delivery' AND e.state='queued' AND e.id>?
        AND e.terminal_id IS NOT NULL AND e.session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM action_evidence r WHERE r.bot_id=e.bot_id
          AND r.action_id=e.action_id AND r.kind='delivery' AND r.state='received'
          AND r.terminal_id=e.terminal_id AND r.session_id=e.session_id)
      ORDER BY e.id LIMIT ?`).all(cursor, cap);
    const links = db.prepare('SELECT request_id FROM action_evidence_requests WHERE evidence_id=? ORDER BY request_id');
    return rows.map(row => ({ ...row, request_ids: links.all(row.id).map(r => r.request_id) }));
  }
  return { recordActionEvidence, queryActionEvidence, pendingActionDeliveries };
}

/** Bounded per-item retrieval prevents noisy recent tools from burying another request. */
export function retrieveActionEvidence({ query, bot_id, requests = [], now = Date.now(), maxAgeMs = 10 * 60_000 }) {
  try {
    const items = requests.slice(0, 15).map(item => {
      const events = query({ bot_id, request_id: item.id, limit: 5 }).filter(e => e.bot_id === bot_id && e.request_ids?.includes(item.id));
      return { request_id: item.id, status: item.status, owner: item.where || null, assignment_receipt: item.delivery || null,
        events, fresh: events.some(e => { const age = now - Date.parse(e.created_at); return age >= 0 && age <= maxAgeMs; }),
        missing: events.length ? 'Tool success is not product completion; no scheduling reason unless recorded.' : 'No recorded action outcome for this request.' };
    });
    const result = { available: true, generated_at: new Date(now).toISOString(), items, omitted: Math.max(0, requests.length - items.length),
      recent: query({ bot_id, limit: 12 }).filter(e => e.bot_id === bot_id),
      coverage: 'Platform bot tools, turns, team delivery/start receipts and bot inbox writes only. Arbitrary terminal shell actions, hook consumption and unrecorded decisions are not covered.' };
    // Keep complete structured rows within a fixed prompt budget; never cut JSON mid-record.
    while (Buffer.byteLength(JSON.stringify(result)) > 16000) {
      result.truncated = true;
      if (result.recent.length) { result.recent.pop(); continue; }
      const item = [...items].reverse().find(item => item.events.length);
      if (!item) break;
      item.events.pop();
      item.omitted_events = (item.omitted_events || 0) + 1;
    }
    return result;
  } catch { return { available: false, items: [], recent: [], missing: 'Action evidence storage or retrieval failed. Investigation is required.' }; }
}

export const needsDiagnosis = (incoming, evidence) => {
  const question = incoming.join(' ');
  if (!evidence?.available || /\bwhy\b|למה|מדוע/i.test(question)) return true;
  const status = /\bstatus\b|\bprogress\b|what.*happen|מה.*קורה|נקודות|מה.*המצב/i.test(question);
  return status && (evidence.truncated || evidence.omitted > 0 || evidence.items.some(item => !item.fresh));
};

/** Called only after the existing delivery adapter has checked its receipt. Never stores payloads. */
export function recordTeamDelivery(record, { bot_id, terminal_id, session_id = null, delivery, request_ids = [], state, started = false }) {
  if (!/^[0-9a-f]{12}$/.test(String(bot_id || '')) || !delivery) return false;
  try {
    record({ bot_id, terminal_id, session_id, action_id: delivery, source_id: `${delivery}:${state}`, request_ids,
      kind: 'delivery', state, result_code: started ? 'worker_started' : state === 'received' ? 'delivery_received' : state === 'queued' ? 'delivery_queued' : 'delivery_not_confirmed' });
    return true;
  } catch { console.error('[action evidence] team receipt recording unavailable'); return false; }
}
