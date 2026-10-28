import fs from 'node:fs';

/** Reversible admission/sink pause, not authorization or proof of quiescence.
 * Presence (or an unreadable marker) pauses; nothing expires or replays itself.
 * Already-issued work is not cancelled. Manual routes keep their existing guards.
 */
export function createAutomaticActionBarrier({ file, env = process.env, stat = fs.statSync } = {}) {
  let draining = false;
  const reason = () => {
    if (draining) return 'bridge draining';
    if (env.TC_PAUSE_AUTOMATIC_ACTIONS === '1') return 'startup maintenance pause';
    if (!file) return null;
    try {
      stat(file);
      return 'maintenance marker';
    } catch (error) {
      return error.code === 'ENOENT' ? null : 'maintenance marker unreadable';
    }
  };
  const status = () => {
    const why = reason();
    return { paused: Boolean(why), reason: why, quiescence_verified: false };
  };
  return {
    get paused() { return status().paused; },
    status,
    beginDrain() { draining = true; },
    run(action) { if (!status().paused) return action(); },
    guard(action) {
      return (...args) => status().paused
        ? { error: 'Automatic actions are paused for maintenance.', paused: true, notSent: true, ok: false }
        : action(...args);
    },
  };
}
