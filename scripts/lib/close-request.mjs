// Ask the TermFleet app to close one terminal card, the same way its X does
// (src/lib/closeRequestLoop.ts). Whether the close is wanted is decided by the
// caller before this runs: Noam confirmed it on the phone, or a bot's own
// finished terminal passed `termfleet-team close` checks.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requestDaemon, defaultDaemonSocket } from '../termfleetctl.mjs';

/** Is that terminal still running in the daemon? null when the daemon cannot be asked. */
async function stillRunning(paneId) {
  try {
    const res = await requestDaemon({ type: 'listSessions' }, defaultDaemonSocket());
    if (res?.ok !== true) return null;
    return (res.value?.sessions || []).some((s) => s.id === paneId && s.lastExit == null);
  } catch { return null; }
}

/** Stop a terminal in the daemon as an intentional close (it is not brought back on restart). */
async function stopInDaemon(paneId) {
  try {
    const res = await requestDaemon({ type: 'killSession', id: paneId, user_requested: true }, defaultDaemonSocket());
    return res?.ok === true && (await stillRunning(paneId)) === false;
  } catch { return false; }
}

export function closeRequestsDir(env = process.env) {
  return join(env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share'), 'terminal-workspace', 'close-requests');
}

const REASONS = {
  'not-found': 'TermFleet no longer has that terminal.',
  'several-terminals': 'That card holds several terminals; close it on the PC.',
  expired: 'The request waited too long. Nothing was closed.',
  invalid: 'TermFleet refused the request. Nothing was closed.',
  'close-failed': 'TermFleet could not close it. Check the PC.',
};

export async function requestClose(paneId, { by = 'unknown', timeoutMs = 10_000, dir = closeRequestsDir(), pause = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, running = stillRunning, stop = stopInDaemon } = {}) {
  if (typeof paneId !== 'string' || !paneId.startsWith('terminal-')) return { ok: false, error: 'That is not a terminal.' };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const requestId = randomUUID();
  const requestPath = join(dir, `${requestId}.request.json`), resultPath = join(dir, `${requestId}.result.json`);
  writeFileSync(`${requestPath}.tmp`, JSON.stringify({ version: 1, kind: 'close', requestId, paneId, by: String(by).slice(0, 120), createdAt: now() }), { mode: 0o600 });
  renameSync(`${requestPath}.tmp`, requestPath);
  const until = now() + timeoutMs;
  while (now() < until) {
    await pause(250);
    if (!existsSync(resultPath)) continue;
    let result;
    try { result = JSON.parse(readFileSync(resultPath, 'utf8')); } catch { continue; } // still being written
    rmSync(resultPath, { force: true });
    if (!result.ok && result.reason === 'not-found') {
      // The app has no such card. Already ended in the daemon: that is closed. Still running:
      // an app from before the 2026-10-20 close fix (it matched the wrong id), so the daemon
      // stops it as an intentional close; its empty card goes with the next relaunch.
      // Noam 2026-10-21: closing has to work on what runs today, not only after a restart.
      const live = await running(paneId);
      if (live === false) return { ok: true, alreadyClosed: true, title: null };
      if (live === true) {
        const stopped = await stop(paneId);
        return stopped
          ? { ok: true, stoppedInDaemon: true, title: null, note: 'Stopped. Its empty card stays on the map until TermFleet is next relaunched.' }
          : { ok: false, reason: 'app-outdated', error: 'TermFleet on the PC needs one relaunch before it can close terminals. Nothing was closed; the terminal keeps running.' };
      }
    }
    return result.ok ? { ok: true, title: result.title || null } : { ok: false, reason: result.reason, error: REASONS[result.reason] || 'TermFleet did not close it.' };
  }
  // Not picked up: take the request back so it can never fire later by surprise.
  let taken = false;
  try { rmSync(requestPath); taken = true; } catch { /* the app took it just now */ }
  return taken
    ? { ok: false, reason: 'no-answer', error: 'TermFleet did not answer. If it was just updated, it needs one relaunch first. Nothing was closed.' }
    : { ok: false, reason: 'unconfirmed', uncertain: true, error: 'TermFleet took the request but did not confirm. Check the PC.' };
}
