import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';

/**
 * Every keystroke this bridge puts into a live terminal is recorded. Without
 * it there is no way to answer "did my message actually arrive?" — which is
 * exactly the question a remote control has to be able to answer.
 */
const AUDIT = path.join(
  process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'),
  'sent.log',
);

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true, mode: 0o700 });
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch { /* never let logging break a send */ }
}

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

  // Busy means either the agent says it is working, or the terminal is
  // visibly producing output right now. The second is the more reliable of
  // the two, and catches an agent that never updates its own status.
  const busy = pane.turn === 'working' || pane.producing === true;
  if (busy && !force) {
    return {
      error: 'busy',
      busy: true,
      message: pane.producing
        ? 'This terminal is working right now. Send anyway?'
        : 'The agent is still working. Send anyway?',
    };
  }

  inFlight.add(pane.id);
  try {
    // A newline typed into an agent submits the line. Sending a two-line
    // message raw therefore delivers it as two prompts: the first starts a
    // turn and the second arrives mid-turn and queues, which is what "my
    // message got stuck" looks like. Wrapping it in bracketed paste tells the
    // terminal this is one pasted block, so the newlines stay inside it.
    const wire = body.includes('\n')
      ? `\u001b[200~${body.replace(/\r/g, '')}\u001b[201~`
      : body;

    // Text first, then Enter as its own write: agent TUIs redraw between
    // keystrokes, and a newline arriving inside the same chunk as the text is
    // routinely swallowed. The pause gives the prompt time to settle.
    await ask({ type: 'writeSession', id: pane.id, data: wire });
    await new Promise((r) => setTimeout(r, 120));
    await ask({ type: 'writeSession', id: pane.id, data: '\r' });

    // Don't claim success just because the write returned. Look at what the
    // terminal actually shows and report honestly if the text never appeared.
    const delivered = await appearedInTerminal(pane.id, body);
    audit({
      pane: pane.id, project: pane.project, provider: pane.provider,
      turn: pane.turn, bytes: body.length, ok: true, delivered,
    });
    return { ok: true, delivered, sentAt: Date.now() };
  } catch (error) {
    audit({ pane: pane.id, project: pane.project, bytes: body.length, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error) };
  } finally {
    inFlight.delete(pane.id);
  }
}

/**
 * Read the tail of a session's output and say whether the text we just typed
 * shows up in it. Terminals echo what you type, so absence is a real signal
 * that the keystrokes went nowhere — a wrong pane, a frozen TUI, a dead shell.
 */
async function appearedInTerminal(id, body) {
  // Terminals wrap long lines and paint them with control codes, so compare
  // with all spacing and escapes removed. Matching loose words instead would
  // report success for any busy screen that happens to contain them.
  const squash = (s) => String(s)
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  const needle = squash(body).slice(0, 60);
  if (needle.length < 4) return false;

  for (const delay of [250, 500, 900, 1200]) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const snap = await ask({ type: 'snapshotSession', id });
      if (squash(snap.data || '').includes(needle)) return true;
    } catch { /* try again */ }
  }
  return false;
}

/**
 * Answer whatever the agent is asking. A numbered choice picks that option in
 * the on-screen list; the named choices answer a permission prompt with the
 * provider's own keystroke.
 */
export async function answerPrompt(pane, choice, approval) {
  const key = /^[1-9]$/.test(String(choice)) ? `${choice}\r` : approval?.[choice];
  if (!key) return { error: 'Unknown choice.' };
  const live = await liveSessionIds();
  if (!live.has(pane.id)) return { error: 'That terminal is not running any more.' };
  try {
    await ask({ type: 'writeSession', id: pane.id, data: key });
    audit({ pane: pane.id, project: pane.project, choice, ok: true });
    return { ok: true, sentAt: Date.now() };
  } catch (error) {
    audit({ pane: pane.id, project: pane.project, choice, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error) };
  }
}
