import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';

/** The daemon wraps every reply as { ok, value } — unwrap or throw. */
async function ask(request) {
  const res = await requestDaemon(request, defaultDaemonSocket());
  if (!res || res.ok !== true) throw new Error(res?.error || 'the terminal service refused');
  return res.value;
}

export async function liveSessionIds() {
  const value = await ask({ type: 'listSessions' });
  return new Set((value.sessions || []).map((s) => s.id));
}

/**
 * Typing into a live agent is the one thing here that can damage a session, so
 * every send is gated: the pane must exist in the daemon, must not be mid-turn,
 * and only one send may be in flight for it at a time.
 */
const inFlight = new Set();

export async function sendToPane(pane, text, { force = false } = {}) {
  const body = String(text ?? '');
  if (!body.trim()) return { error: 'Nothing to send.' };
  if (body.length > 8000) return { error: 'That message is too long.' };

  if (inFlight.has(pane.id)) return { error: 'Still sending your last message.' };

  const live = await liveSessionIds();
  if (!live.has(pane.id)) {
    return { error: 'That terminal is not running any more.' };
  }

  if (pane.turn === 'working' && !force) {
    return { error: 'busy', busy: true, message: 'The agent is still working. Send anyway?' };
  }

  inFlight.add(pane.id);
  try {
    // Text first, then Enter as its own write: some TUIs drop a trailing
    // newline that arrives in the same chunk as a long paste.
    await ask({ type: 'writeSession', id: pane.id, data: body });
    await ask({ type: 'writeSession', id: pane.id, data: '\r' });
    return { ok: true, sentAt: Date.now() };
  } catch (error) {
    return { error: String(error.message || error) };
  } finally {
    inFlight.delete(pane.id);
  }
}

/** Answer a permission prompt using the provider's own keystroke. */
export async function answerPrompt(pane, choice, approval) {
  const key = approval?.[choice];
  if (!key) return { error: 'Unknown choice.' };
  const live = await liveSessionIds();
  if (!live.has(pane.id)) return { error: 'That terminal is not running any more.' };
  try {
    await ask({ type: 'writeSession', id: pane.id, data: key });
    return { ok: true, sentAt: Date.now() };
  } catch (error) {
    return { error: String(error.message || error) };
  }
}
