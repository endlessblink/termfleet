import fs from 'node:fs';

const MAX_BYTES = 256 * 1024;
const time = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const deliveryId = value => typeof value === 'string' && /^D-[0-9a-f]{8}$/.test(value);

function userText(row, provider, sessionId) {
  if (row.sessionId != null && row.sessionId !== sessionId) return null;
  if (provider === 'codex' && row.type === 'event_msg' && row.payload?.type === 'user_message') return typeof row.payload.message === 'string' ? row.payload.message : null;
  const message = provider === 'codex'
    ? row.type === 'response_item' && row.payload?.type === 'message' ? row.payload : null
    : row.type === 'user' ? row.message : null;
  if (!message || message.role !== 'user') return null;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return null;
  return message.content.filter(part => ['input_text', 'text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('\n');
}

/** The caller must select this file from the exact provider/session, never a cwd scan.
 * Only bounded structured user-input records are inspected; no text is returned.
 */
export function scanDeliveryReceipt({ file, provider, sessionId, delivery, since, now = Date.now(), bytes = MAX_BYTES }) {
  const after = time(since), until = time(now);
  if (!file || !['codex', 'claude'].includes(provider) || !sessionId || !deliveryId(delivery) || !Number.isFinite(after) || !Number.isFinite(until) || after > until) return null;
  const limit = Math.min(MAX_BYTES, Math.max(1, Math.trunc(bytes) || MAX_BYTES));
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    // Codex keeps its session binding in the first row, outside a long tail.
    const header = Buffer.alloc(Math.min(stat.size, 16 * 1024));
    fs.readSync(fd, header, 0, header.length, 0);
    const newline = header.indexOf(10);
    if (newline >= 0 || stat.size <= header.length) {
      try {
        const first = JSON.parse(header.subarray(0, newline >= 0 ? newline : header.length).toString('utf8'));
        if (first.type === 'session_meta' && first.payload?.id !== sessionId) return null;
      } catch { /* malformed rows are never input proof */ }
    }
    const start = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let cursor = 0;
    if (start > 0) {
      const previous = Buffer.alloc(1); fs.readSync(fd, previous, 0, 1, start - 1);
      if (previous[0] !== 10) { const boundary = buffer.indexOf(10); if (boundary < 0) return null; cursor = boundary + 1; }
    }
    while (cursor < buffer.length) {
      const end = buffer.indexOf(10, cursor);
      // A trailing row without a newline may still be in the middle of a write.
      if (end < 0) break;
      const offset = start + cursor;
      let row;
      try { row = JSON.parse(buffer.subarray(cursor, end).toString('utf8')); } catch { cursor = end + 1; continue; }
      cursor = end + 1;
      const observed = time(row.timestamp);
      if (!Number.isFinite(observed) || observed < after || observed > until) continue;
      const text = userText(row, provider, sessionId);
      if (text == null) continue;
      for (const token of text.matchAll(/\[delivery (D-[0-9a-f]{8})\]/g)) {
        if (token[1] === delivery) return { session_id: sessionId, file, offset, observed_at: observed };
      }
    }
    return null;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Add receipt evidence only. Task assignment/status authority is never mutated here.
 * recordReceived must durably deduplicate source_id and return false for a duplicate.
 */
export function reconcileQueuedDeliveries({ queued, panes, recordForPane, recordReceived, now = Date.now(), maxBatch = 20, bytes = MAX_BYTES }) {
  const result = { checked: 0, matched: 0, recorded: 0, skipped: 0 };
  const at = typeof now === 'function' ? now() : now;
  const batch = Math.min(20, Math.max(0, Math.trunc(maxBatch) || 0));
  for (const receipt of (Array.isArray(queued) ? queued : []).slice(0, batch)) {
    result.checked++;
    const pane = (Array.isArray(panes) ? panes : []).find(p => p?.id === receipt.terminal_id);
    if (!/^[0-9a-f]{12}$/.test(receipt.bot_id || '') || !deliveryId(receipt.action_id) || !receipt.session_id || (receipt.state != null && receipt.state !== 'queued')
      || !pane || pane.alive !== true || pane.sessionId !== receipt.session_id || !Array.isArray(receipt.request_ids)
      || receipt.request_ids.some(id => typeof id !== 'string' || !/^R-\d+$/.test(id))) { result.skipped++; continue; }
    try {
      const record = recordForPane(pane, receipt);
      if (!record || record.sessionId !== receipt.session_id || record.provider !== pane.provider) { result.skipped++; continue; }
      const proof = scanDeliveryReceipt({ ...record, delivery: receipt.action_id, since: receipt.at ?? receipt.created_at, now: at, bytes });
      if (!proof) { result.skipped++; continue; }
      result.matched++;
      const saved = recordReceived({ bot_id: receipt.bot_id, terminal_id: receipt.terminal_id, session_id: receipt.session_id,
        action_id: receipt.action_id, source_id: `${receipt.action_id}:received`, request_ids: [...receipt.request_ids],
        kind: 'delivery', state: 'received', result_code: 'delivery_input_recorded', proof });
      if (saved !== false && saved != null) result.recorded++;
    } catch { result.skipped++; }
  }
  return result;
}

/** Reuse the service's existing cadence; a cursor prevents old unacknowledged
 * deliveries starving newer ones. Evidence is additive, never task authority.
 */
export function createDeliveryReconciler({ pending, record, recordForPane }) {
  let afterId = 0;
  return (panes, now = Date.now()) => {
    const queued = pending({ afterId, limit: 20 });
    afterId = queued.length ? queued.at(-1).id : 0;
    return reconcileQueuedDeliveries({ queued, panes, recordForPane, now,
      recordReceived: ({ proof, ...event }) => record({ ...event, source_ref: `session:${proof.session_id}/byte:${proof.offset}` }) });
  };
}
