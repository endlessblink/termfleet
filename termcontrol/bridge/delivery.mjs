import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Delivery receipts (TF-102 part 4). A message "sent" to a terminal used to count as
 * delivered when its text flashed on screen or the scrollback grew. Idle Codex terminals
 * then held the message in their input box (or sat on a startup prompt) and the bot
 * believed the work was handed over (politic-fighter bot, 2026-10-22).
 *
 * Now a message is received only when its delivery mark ("[delivery D-…]") is in the
 * agent's own conversation record, or the agent started a turn after it arrived. Anything
 * else is an error the sender sees. Codex's "Hooks need review" startup prompt is answered
 * when every hook waiting for review is TermFleet's (or Noam's own) hook; any other hook is
 * reported to the sender instead of being trusted.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Is the delivery mark in the last few MB of the agent's conversation record? */
export function transcriptHas(file, token, { bytes = 4 * 1024 * 1024 } = {}) {
  if (!file || !token) return false;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8').includes(token);
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/** Codex's startup hook review on screen, with the number of its "Trust all and continue" choice. */
export function codexTrustPrompt(screen) {
  const s = String(screen || '');
  if (!/hooks? (?:needs?|need) review|Hooks need review/i.test(s)) return null;
  const pick = /(?:^|\n)\s*(?:[›>❯]\s*)?(\d)[.)]\s*Trust all and continue/i.exec(s);
  const skip = /(?:^|\n)\s*(?:[›>❯]\s*)?(\d)[.)]\s*Continue without trusting/i.exec(s);
  return { trustOption: pick ? pick[1] : null, skipOption: skip ? skip[1] : null };
}

const snake = (ev) => ev.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

/** Hooks in Codex's hook files that have no trust record yet (what the review prompt lists). */
export function pendingCodexHooks({ home = os.homedir(), cwd = process.cwd() } = {}) {
  let config = '';
  try { config = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'); } catch { config = ''; }
  const pending = [];
  for (const file of new Set([path.join(home, '.codex', 'hooks.json'), path.join(cwd, '.codex', 'hooks.json')])) {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const hooks = data?.hooks || data || {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((g, gi) => (g?.hooks || []).forEach((h, hi) => {
        const key = `${file}:${snake(event)}:${gi}:${hi}`;
        if (!config.includes(`[hooks.state."${key}"]`)) pending.push({ key, file, event, command: String(h?.command || '') });
      }));
    }
  }
  return pending;
}

/** A hook TermFleet installed (or Noam's own in ~/.claude/hooks), never a project's unknown hook. */
export function ownHook(command, { home = os.homedir(), root = repoRoot } = {}) {
  const c = String(command || '');
  return [root, path.join(home, '.local', 'share', 'termfleet'), path.join(home, '.claude', 'hooks')].some((p) => c.includes(`${p}/`));
}

/**
 * What to do about a trust prompt on screen: { press } to answer it, { error } to report, or
 * null when there is none.
 */
export function trustDecision(screen, { pending = pendingCodexHooks(), home, root } = {}) {
  const prompt = codexTrustPrompt(screen);
  if (!prompt) return null;
  const foreign = pending.filter((h) => !ownHook(h.command, { home, root }));
  if (foreign.length) return { error: `The new Codex terminal is waiting for Noam to review ${foreign.length} unknown hook${foreign.length === 1 ? '' : 's'} (${foreign.map((h) => h.command.slice(0, 80)).join('; ')}). It will not start until he does; tell him in one plain sentence.` };
  if (!prompt.trustOption) return { error: 'The new Codex terminal shows its hook review, but its "Trust all and continue" choice is not on screen; it will not start until someone answers it.' };
  return { press: prompt.trustOption };
}

/**
 * Wait until the agent has actually received a message.
 * deps: panes() → fresh pane list; screen(id) → screen text; transcript(pane) → record path;
 * write(id, data) → keys into the terminal.
 */
export async function confirmReceipt(pane, { token, wasBusy = false, timeoutMs = 25000, pollMs = 1500, deps }) {
  const { panes, screen, transcript, write, pending } = deps;
  const deadline = Date.now() + timeoutMs;
  const notes = [];
  let answered = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const now = (await panes()).find((p) => p.id === pane.id) || pane;
    if (transcriptHas(transcript(now), token)) return { received: true, how: 'transcript', notes };
    const working = now.turn === 'working' || now.producing === true;
    if (!wasBusy && working && now.turn === 'working') return { received: true, how: 'turn', notes };
    const shown = await screen(pane.id);
    const trust = trustDecision(shown, { pending: pending ? pending(now) : pendingCodexHooks({ cwd: now.cwd || process.cwd() }) });
    if (trust?.error) return { received: false, reason: 'trust-prompt', message: trust.error, notes };
    if (trust?.press && answered < 2) {
      await write(pane.id, trust.press);
      await new Promise((r) => setTimeout(r, 200));
      await write(pane.id, '\r');
      answered += 1;
      notes.push('Answered Codex\'s hook review with "Trust all and continue" (only TermFleet\'s own hooks were waiting).');
    }
  }
  if (wasBusy) return { received: false, queued: true, reason: 'busy', message: 'It is in the middle of a turn: the message is typed in but it has not read it yet.', notes };
  return { received: false, reason: 'not-received', message: 'The terminal did not receive the message: it is not in its conversation and no turn started. It may be stuck on a prompt or its input box; look with termfleet-team read, then send again.', notes };
}

/** A new terminal has really started its task: a turn began, or its first message is recorded. */
export async function confirmStarted(paneId, { token = null, timeoutMs = 90000, pollMs = 2000, deps }) {
  const { panes, screen, transcript, write, pending } = deps;
  const deadline = Date.now() + timeoutMs;
  const notes = [];
  let answered = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const pane = (await panes()).find((p) => p.id === paneId);
    if (!pane) continue;
    if (pane.turn === 'working' || (token && transcriptHas(transcript(pane), token))) return { started: true, notes };
    const shown = await screen(paneId);
    const trust = trustDecision(shown, { pending: pending ? pending(pane) : pendingCodexHooks({ cwd: pane.cwd || process.cwd() }) });
    if (trust?.error) return { started: false, reason: 'trust-prompt', message: trust.error, notes };
    if (trust?.press && answered < 2) {
      await write(paneId, trust.press);
      await new Promise((r) => setTimeout(r, 200));
      await write(paneId, '\r');
      answered += 1;
      notes.push('Answered Codex\'s hook review with "Trust all and continue" (only TermFleet\'s own hooks were waiting).');
    }
  }
  return { started: false, reason: 'not-started', message: 'The new terminal has not started its task: nothing is in its conversation yet. Look at it with termfleet-team read.', notes };
}
