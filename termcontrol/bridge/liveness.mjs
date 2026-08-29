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
const seen = new Map();      // id -> { bytes, at, lastGrewAt, pulse: number[] }
const QUIET_AFTER_MS = 20_000;
const PULSE_SAMPLES = 14;

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

    // A short history of how much output arrived between looks. It is what
    // makes the indicator feel alive: a shape that moves, not a lamp.
    const delta = before ? Math.max(0, bytes - before.bytes) : 0;
    const pulse = [...(before?.pulse || []), delta].slice(-PULSE_SAMPLES);

    seen.set(s.id, { bytes, at: now, lastGrewAt, pulse });

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
      pulse,
    });
  }

  // Sessions the daemon no longer lists have gone.
  for (const id of seen.keys()) {
    if (!byId.has(id)) seen.delete(id);
  }

  return { reachable: true, byId };
}

/**
 * The last line a terminal actually printed. Nothing else convinces you a
 * terminal is alive like seeing its own words change, so this is fetched only
 * for the few terminals that are moving, and kept to one short line.
 */
export async function lastLine(id) {
  try {
    const res = await requestDaemon({ type: 'snapshotSession', id }, defaultDaemonSocket());
    if (!res || res.ok !== true) return null;
    const text = String(res.value?.data || '')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')   // window titles
      .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')                        // colours, cursor moves
      .replace(/\r/g, '\n');

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].replace(/\s+/g, ' ');
      // Skip box-drawing chrome and bare prompts: they say nothing.
      if (/^[\u2500-\u257f\s]+$/.test(line)) continue;
      if (line.length < 2) continue;
      return line.slice(0, 120);
    }
  } catch { /* the terminal may have gone */ }
  return null;
}
