// Noam 2026-10-27: "I asked for reliability". Every few hours TermFleet proves its own plumbing end to
// end with a throwaway terminal that no card, tab or health row ever shows: start it on the daemon,
// type into it, read its screen back, close it, and check it is gone. One plain line on the Health tab;
// a failure goes to his phone once. The terminal always removes itself (idle cleanup would list it).
import fs from 'node:fs';
import path from 'node:path';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';
import { screenOf } from './liveness.mjs';

export const CANARY_EVERY_MS = 6 * 3600_000;
export const CANARY_PREFIX = 'canary-';
const ask = (request) => requestDaemon(request, defaultDaemonSocket());
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One full round trip on the real daemon. Never throws: a failure is the result. */
export async function runCanary({ send = ask, screen = (id) => screenOf(id), wait = pause, now = Date.now } = {}) {
  const id = `${CANARY_PREFIX}${now()}`;
  const started = now();
  let step = 'start';
  const result = (ok, error) => ({ ok, at: started, ms: now() - started, ...(ok ? {} : { error, step }) });
  let failure = null;
  try {
    const made = await send({ type: 'ensureSession', id, cwd: '/tmp', command: 'cat', cols: 80, rows: 24 });
    if (!made?.ok) throw new Error('The terminal service would not start a test terminal.');
    step = 'type';
    await wait(300);
    const typed = await send({ type: 'writeSession', id, data: `canary-ping-${started}\n` });
    if (!typed?.ok) throw new Error('Typing into a test terminal failed.');
    step = 'read';
    let seen = false;
    for (let n = 0; n < 20 && !seen; n++) { await wait(150); seen = String(await screen(id) || '').includes(`canary-ping-${started}`); }
    if (!seen) throw new Error('What was typed never showed up on the terminal screen.');
  } catch (error) { failure = String(error.message || error); }
  // Always remove it, whatever happened above.
  try { await send({ type: 'killSession', id, userRequested: true }); } catch (error) { failure ||= `The test terminal could not be closed: ${error.message || error}`; step = failure && step; }
  try {
    const listed = await send({ type: 'listSessions' });
    const rows = listed?.value?.sessions || listed?.sessions || [];
    if (Array.isArray(rows) && rows.some((s) => (s.id || s) === id)) { failure ||= 'The test terminal is still there after closing it.'; step = 'close'; }
  } catch { /* the listing is a second check, not the first */ }
  return failure ? result(false, failure) : result(true);
}

export const canaryFile = (dir) => path.join(dir, 'canary.json');
export function readCanary(dir) { try { return JSON.parse(fs.readFileSync(canaryFile(dir), 'utf8')); } catch { return null; } }

/** Runs it, saves the result, and calls `notify` once when it newly fails. */
export async function checkCanary({ dir, notify = () => {}, run = runCanary, now = Date.now } = {}) {
  const before = readCanary(dir);
  const out = await run();
  const saved = { ...out, checkedAt: now() };
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(canaryFile(dir), JSON.stringify(saved)); } catch { /* the line just stays old */ }
  if (!out.ok && before?.ok !== false) notify({ title: 'TermFleet self-test failed', body: String(out.error || '').slice(0, 200), url: '/#health' });
  return saved;
}
