// Phone side of the Urgent toggle (Noam 2026-10-22: agents yield CPU unless it is urgent).
// Routes:
//   GET  /api/priority                 { agentWeight, urgent: [paneId…] }
//   POST /api/priority/urgent          { pane, on }   move one terminal to full speed / back
//   POST /api/priority/settings        { agentWeight } the share every agent terminal gets (live)
// The work is the shared helper in scripts/lib/cpu-priority.mjs. Nothing is killed or paused.
import {
  readPrioritySettings, writePrioritySettings, setUrgent, urgentStatus, listUrgent,
  reconcileUrgent, applyAgentWeight,
} from '../../scripts/lib/cpu-priority.mjs';

export const isUrgent = (paneId, opts) => urgentStatus(paneId, opts).urgent;

export function priorityState(opts = {}) {
  return { ...readPrioritySettings(opts.paths), urgent: listUrgent(opts.paths).map((m) => m.paneId) };
}

/** Handles /api/priority*; returns true when it answered. `json(res, status, body)` is the bridge's. */
export async function handlePriority(req, res, url, json, opts = {}) {
  if (!url.pathname.startsWith('/api/priority')) return false;
  let body = {};
  if (req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 2048) { json(res, 413, { error: 'Request too large.' }); return true; } }
    try { body = raw ? JSON.parse(raw) : {}; } catch { json(res, 400, { error: 'Invalid request.' }); return true; }
  }
  if (url.pathname === '/api/priority' && req.method === 'GET') { json(res, 200, priorityState(opts)); return true; }
  if (url.pathname === '/api/priority/settings' && req.method === 'POST') {
    const want = Number(body.agentWeight);
    const next = writePrioritySettings(opts.paths, { agentWeight: want });
    if (next.agentWeight !== want) { json(res, 400, { error: 'The share must be a whole number from 1 to 100.' }); return true; }
    applyAgentWeight(opts);
    json(res, 200, priorityState(opts));
    return true;
  }
  if (url.pathname === '/api/priority/urgent' && req.method === 'POST') {
    const id = String(body.pane || '');
    if (!/^terminal-[A-Za-z0-9_-]+$/.test(id)) { json(res, 400, { error: 'That is not a terminal.' }); return true; }
    const r = setUrgent(id, Boolean(body.on), { ...opts, by: 'noam' });
    json(res, r.ok ? 200 : 409, r.ok ? { ok: true, urgent: r.urgent } : { error: r.error });
    return true;
  }
  json(res, 404, { error: 'Not found' });
  return true;
}

/** Keeps Urgent true every so often: re-promotes restarted agents, finishes closes. */
export function startPriorityKeeper({ everyMs = 30_000, ...opts } = {}) {
  const tick = () => { try { reconcileUrgent(opts); } catch { /* next tick */ } };
  return setInterval(tick, everyMs).unref();
}
