import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';

/**
 * Whether a terminal is actually alive, taken from the terminal itself rather
 * than from what an agent last claimed. A status record can be minutes stale
 * (or written by a process that has since died); the daemon's own session list
 * cannot be. One call covers every session, so this costs a single round trip
 * however many terminals there are.
 *
 * Two facts come out of it:
 *   alive     — the daemon still owns a session with this id
 *   producing — its output grew since the last look, i.e. something is running
 */
const seen = new Map();      // id -> { bytes, at, lastGrewAt }
const QUIET_AFTER_MS = 20_000;

export async function liveness() {
  let sessions = [];
  try {
    const res = await requestDaemon({ type: 'listSessions' }, defaultDaemonSocket());
    if (!res || res.ok !== true) throw new Error('unavailable');
    sessions = res.value.sessions || [];
  } catch {
    return { reachable: false, byId: new Map() };
  }

  const now = Date.now();
  const byId = new Map();

  for (const s of sessions) {
    const bytes = Number(s.scrollbackBytes || 0);
    const before = seen.get(s.id);
    const grew = before ? bytes > before.bytes : false;
    const lastGrewAt = grew ? now : before?.lastGrewAt ?? null;

    seen.set(s.id, { bytes, at: now, lastGrewAt });

    byId.set(s.id, {
      alive: true,
      exited: s.lastExit != null,
      pid: s.pid ?? null,
      bytes,
      // "Producing" means output moved within the last few seconds. Without a
      // previous sample we say nothing rather than guess.
      producing: lastGrewAt != null && now - lastGrewAt < QUIET_AFTER_MS,
      quietForMs: lastGrewAt == null ? null : now - lastGrewAt,
      firstLook: !before,
    });
  }

  // Sessions the daemon no longer lists have gone.
  for (const id of seen.keys()) {
    if (!byId.has(id)) seen.delete(id);
  }

  return { reachable: true, byId };
}
