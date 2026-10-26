// `termfleet-team close self` from inside Codex (2026-10-24: 15 politic-fighter terminals stayed
// open after closing themselves, load 55). Codex runs every command in a bwrap box with its own
// process space (--as-pid-1 --die-with-parent): when the command ends, the kernel kills every
// process it started, so the detached waiter never lived to close anything. The box can write
// /tmp but not ~/.local/share, and Codex's own hooks run outside the box. So `close self` also
// leaves a note here, and the Stop hook (the reply is saved) starts the waiter from outside.
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGE_MS = 15 * 60_000;
const safe = (paneId) => typeof paneId === 'string' && /^terminal-[A-Za-z0-9-]{1,120}$/.test(paneId);

export function selfCloseDir(env = process.env) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return env.TERMFLEET_SELF_CLOSE_DIR || join('/tmp', `termfleet-self-close-${uid}`);
}

/** Leave the note. True when it was written. */
export function markSelfClose(paneId, { dir = selfCloseDir(), now = Date.now } = {}) {
  if (!safe(paneId)) return false;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${paneId}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ paneId, at: now() }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return true;
  } catch { return false; }
}

/** Take the note if this terminal left a fresh one (it is removed either way). */
export function takeSelfClose(paneId, { dir = selfCloseDir(), now = Date.now, maxAgeMs = MAX_AGE_MS } = {}) {
  if (!safe(paneId)) return false;
  const file = join(dir, `${paneId}.json`);
  let note;
  try { note = JSON.parse(readFileSync(file, 'utf8')); } catch { return false; }
  rmSync(file, { force: true });
  return note?.paneId === paneId && Number(note.at) > 0 && now() - Number(note.at) <= maxAgeMs;
}

/** Start the waiter in its own session. It closes the terminal once the turn has ended. */
export function startSelfCloseWaiter(paneId, { run = spawn } = {}) {
  if (!safe(paneId)) return false;
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'termfleet-close-self.mjs');
  try {
    const child = run(process.execPath, [script, paneId], { detached: true, stdio: 'ignore' });
    child.unref?.();
    return Boolean(child.pid);
  } catch { return false; }
}
