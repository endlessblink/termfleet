// Messages from other agents to a Codex agent that is mid-turn wait here and are delivered together,
// as one message, when its turn ends (Noam 2026-10-26, approved). Codex folds a message typed
// mid-turn into the running turn and keeps going: 1,972 of 2,098 agent messages on 24-26 Oct
// arrived that way, about 17 per turn, and the work after them was 37% of all Codex tokens.
// Off: TERMFLEET_HOLD_BUSY=0. A busy agent gets them at most HOLD_WINDOW_MS after the first one
// (Noam 2026-10-27 #9): holding until the turn ended left 65 messages waiting 1.5 hours.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const heldDir = (env = process.env) => path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'terminal-workspace', 'held-messages');
const fileOf = (dir, id) => path.join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);

export const HOLD_WINDOW_MS = 3 * 60_000;

/** Hold for a Codex agent that is working right now, unless switched off (TERMFLEET_HOLD_BUSY=0). */
export function shouldHold(pane, env = process.env) {
  return env.TERMFLEET_HOLD_BUSY !== '0' && pane?.provider === 'codex' && pane.turn === 'working';
}

export function holdMessage(paneId, text, { dir = heldDir(), now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(fileOf(dir, paneId), `${JSON.stringify({ at: now, pane: paneId, text })}\n`, { mode: 0o600 });
}

/** Take every held message for a terminal (the file is moved away first, so a new one is never lost). */
export function takeHeld(paneId, { dir = heldDir() } = {}) {
  const file = fileOf(dir, paneId);
  const taking = `${file}.${process.pid}.${Date.now()}.taking`;
  try { fs.renameSync(file, taking); } catch { return []; }
  let rows = [];
  try { rows = fs.readFileSync(taking, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } finally { fs.rmSync(taking, { force: true }); }
  return rows;
}

/** Put messages back (a delivery failed). */
export function putBack(paneId, rows, { dir = heldDir() } = {}) {
  for (const r of rows) holdMessage(paneId, r.text, { dir, now: r.at });
}

export function heldPanes({ dir = heldDir() } = {}) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').split('\n')[0]).pane; } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/** Has the first held message for this terminal waited the whole window? */
function oldestDue(paneId, { dir, now, windowMs }) {
  try {
    const first = fs.readFileSync(fileOf(dir, paneId), 'utf8').split('\n').find(Boolean);
    return now - Number(JSON.parse(first).at || 0) >= windowMs;
  } catch { return true; }
}

/** Several messages read as one: each in full, oldest first. */
export function bundle(texts) {
  if (texts.length === 1) return texts[0];
  return `[${texts.length} messages arrived while you were working. Read all of them, then act on them together.]\n\n${texts.map((t, i) => `--- message ${i + 1} of ${texts.length} ---\n${t}`).join('\n\n')}`;
}

/**
 * One pass: every held terminal that is now idle gets its messages as one. Never typed into a
 * question or approval (waiting), a stuck or a closed terminal: those keep waiting.
 */
export async function deliverHeld({ panes, send, dir = heldDir(), log = () => {}, now = Date.now(), windowMs = HOLD_WINDOW_MS }) {
  const out = [];
  for (const id of heldPanes({ dir })) {
    const pane = panes.find((p) => p.id === id);
    // A working agent takes them too (it folds them into its turn): waiting for its turn to end left
    // messages undelivered for hours. Never into a question/approval or a closed terminal.
    if (!pane || !pane.alive || pane.turn === 'waiting' || pane.attention) continue;
    // A working agent gets them together once the first has waited the window; an idle one at once.
    if (pane.turn === 'working' && !oldestDue(id, { dir, now, windowMs })) continue;
    const rows = takeHeld(id, { dir });
    if (!rows.length) continue;
    const res = await send(pane, bundle(rows.map((r) => r.text)));
    if (res?.error) { putBack(id, rows, { dir }); log(`held messages for ${id} not delivered: ${res.error}`); continue; }
    out.push({ pane: id, count: rows.length });
  }
  return out;
}
