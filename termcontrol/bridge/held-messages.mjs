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

/**
 * Hold only when switched on (TERMFLEET_HOLD_BUSY=1). Off by default since 2026-10-27 17:50: with it on, five
 * corrections from Noam to a working helper were held, the helper closed before the window ended, and the bot
 * had told him they were passed on. A saving in tokens is never worth losing his words.
 */
export function shouldHold(pane, env = process.env) {
  return env.TERMFLEET_HOLD_BUSY === '1' && pane?.provider === 'codex' && pane.turn === 'working';
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

// ---------------------------------------------------------------------------------------------------
// Held messages must never be lost without the sender knowing (Noam 2026-10-27: five corrections were held
// for a helper that was closed 3 minutes later, and the bot had told him they were passed on).

export const STRAND_GRACE_MS = 15_000;      // a terminal gone this long: its held messages cannot go in
export const STRAND_STUCK_MS = 5 * 60_000;  // a terminal waiting on a person this long: tell the sender once
export const STRAND_STALE_MS = 30 * 60_000; // older than this: file it quietly, the work moved on

const told = new Set();

/** The bot a framed message came from ("(bot:<id>)" in its first line), or null. */
export function senderOf(text) {
  const m = /\(bot:([0-9a-f]{6,})\)/.exec(String(text || '').slice(0, 400));
  return m ? m[1] : null;
}

function readRows(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/**
 * One pass over the hold queue. A terminal that is gone: its rows are filed in an ".undelivered" file (nothing is
 * lost) and each sending bot is told, in words, what did not arrive. A terminal waiting on a person for a long time:
 * the sender is told once and the messages stay held.
 * `notify({ sender, pane, rows, reason })` does the telling. Returns what it did, for tests and the log.
 */
export function sweepStranded({ panes, notify, dir = heldDir(), now = Date.now() }) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return out; }
  for (const name of names) {
    const file = path.join(dir, name);
    const rows = readRows(file);
    if (!rows.length) continue;
    const paneId = rows[0].pane;
    const pane = panes.find((p) => p.id === paneId);
    const newest = Math.max(...rows.map((r) => Number(r.at) || 0));
    const oldest = Math.min(...rows.map((r) => Number(r.at) || now));
    const gone = !pane || !pane.alive;
    const waiting = !gone && (pane.turn === 'waiting' || pane.attention) && now - oldest >= STRAND_STUCK_MS;
    if (gone && now - newest >= STRAND_GRACE_MS) {
      const taken = takeHeld(paneId, { dir });
      if (!taken.length) continue;
      try { fs.appendFileSync(`${file}.undelivered`, taken.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 }); } catch { /* the notice still goes */ }
      const fresh = taken.filter((r) => now - Number(r.at || 0) < STRAND_STALE_MS);
      const senders = new Set(fresh.map((r) => senderOf(r.text)).filter(Boolean));
      for (const sender of senders) {
        const mine = fresh.filter((r) => senderOf(r.text) === sender);
        try { notify({ sender, pane: paneId, rows: mine, reason: 'closed' }); } catch { /* filed already */ }
        out.push({ pane: paneId, sender, count: mine.length, reason: 'closed' });
      }
      if (!senders.size) out.push({ pane: paneId, sender: null, count: taken.length, reason: fresh.length ? 'closed' : 'stale' });
    } else if (waiting && !told.has(`${paneId}|${oldest}`)) {
      told.add(`${paneId}|${oldest}`);
      for (const sender of new Set(rows.map((r) => senderOf(r.text)).filter(Boolean))) {
        const mine = rows.filter((r) => senderOf(r.text) === sender);
        try { notify({ sender, pane: paneId, rows: mine, reason: 'waiting' }); } catch { /* next pass cannot repeat it */ }
        out.push({ pane: paneId, sender, count: mine.length, reason: 'waiting' });
      }
    }
  }
  return out;
}

/** The plain sentence the sending bot is woken with. */
export function strandedText({ pane, rows, reason }) {
  const first = String(rows[0]?.text || '').replace(/^\[Message from[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160);
  const count = rows.length === 1 ? 'Your message' : `Your ${rows.length} messages`;
  return reason === 'closed'
    ? `NOT delivered: ${count} to terminal ${pane} never arrived, because that terminal was closed before it could take them (first one: "${first}"). Nobody has read them. Start a fresh terminal and send them again, or tell Noam plainly that they were lost.`
    : `NOT delivered yet: ${count} to terminal ${pane} still wait, because that terminal has been waiting for a person for over 5 minutes (a question or a menu) and cannot read them (first one: "${first}"). Tell Noam what it is asking, or replace the terminal.`;
}
