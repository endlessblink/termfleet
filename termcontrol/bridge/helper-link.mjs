import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { completionEnrollment } from './adapters/codex.mjs';

/** Owner-authenticated correction only: callers must authenticate before invoking.
 * Adds observation, never spawn ownership, worker input, or a request assignment.
 */
export function linkObservedHelper({ botId, requestId, paneId }, { items, panes, bots, now = Date.now() }) {
  const refuse = (error) => ({ ok: false, error });
  if (typeof botId !== 'string' || !/^[0-9a-f]{12}$/.test(botId) || !bots.read(botId)) return refuse('Unknown bot.');
  const item = items instanceof Map ? items.get(requestId) : Array.isArray(items) ? items.find((entry) => entry?.id === requestId) : null;
  if (!item || item.id !== requestId || item.source !== `bot:${botId}`) return refuse('The request does not belong to that bot.');
  const assignment = Array.isArray(item.assigned) ? item.assigned.at(-1) : null;
  if (typeof paneId !== 'string' || !paneId || assignment?.pane !== paneId || typeof assignment.delivery !== 'string' || !assignment.delivery.trim()) return refuse('The latest request assignment does not match that terminal.');
  const pane = Array.isArray(panes) ? panes.find((entry) => entry?.id === paneId) : null;
  if (!pane || pane.alive !== true || typeof pane.sessionId !== 'string' || !pane.sessionId.trim()) return refuse('That terminal has no verified live conversation.');
  const at = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(at)) return refuse('The observation time is unavailable.');

  // Bots.helpers() returns only the last 20 entries. Read the complete history
  // from the server-resolved folder so correction cannot erase older ownership.
  const file = path.join(bots.folder(botId), 'helpers.json');
  let helpers;
  try {
    helpers = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(helpers)) return refuse('The helper history is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') return refuse('The helper history is unavailable.');
    helpers = [];
  }
  const existing = helpers.findLast((helper) => helper?.paneId === paneId);
  if (existing) return { ok: true, helper: existing, created: false };

  const helper = {
    paneId, provider: pane.provider || null, cwd: pane.cwd || null,
    followed: true, requestId, delivery: assignment.delivery,
    sessionId: pane.sessionId, linkedBy: 'owner-correction', at,
    ...(pane.provider === 'codex' ? { completionEnrollment: completionEnrollment(pane, at) } : {}),
  };
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify([...helpers, helper], null, 1), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ok: true, helper, created: true };
}
