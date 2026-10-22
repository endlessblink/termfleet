// "Clean up idle terminals" (Noam 2026-10-22: "אני רואה שיש מלא טרמינלים פתוחים במפה שהם לא
// בשימוש. למה הם לא נוקו?", then "Yes, build it"). One list of the terminals that are safe to
// close, each with its name, folder and how long it has been idle; every other terminal is
// shown with the plain reason it stays. Closing takes a fresh look first and closes only what
// Noam left ticked and is still safe, through the app's own close (the card's X).
import fs from 'node:fs';
import path from 'node:path';

export const IDLE_MIN_MS = 15 * 60_000;
const AGENTS_SERVICE = /termcontrol\/bridge\/server\.mjs/;
const AGENT_PROVIDERS = new Set(['claude', 'codex', 'opencode']);

const clip = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function idleText(ms) {
  const min = Math.floor(ms / 60_000);
  const say = (n, unit) => `idle ${n} ${unit}${n === 1 ? '' : 's'}`;
  if (min < 60) return say(min, 'minute');
  if (min < 48 * 60) return say(Math.floor(min / 60), 'hour');
  return say(Math.floor(min / (24 * 60)), 'day');
}

/** The name its row shows on the phone: its own name, else what it is about; never a pasted message header. */
export function terminalName(pane) {
  const session = pane.sessionAuthority ? pane.sessionViewV2 : null;
  const tries = [pane.profile?.name, pane.title, pane.goal, session?.task?.label, session?.now?.label, pane.statedTask, pane.task];
  const pick = tries.map((t) => String(t || '').trim()).find((t) => t && !/^\[(Message|Noam)/.test(t) && !/^(Goal|Task):/i.test(t));
  return clip(pick || pane.project || pane.id);
}

/** Every process under `pid` (children, grandchildren…), from a [{ pid, ppid, comm, cmd }] table. */
export function descendantsOf(pid, table) {
  if (!pid) return [];
  const kids = new Map();
  for (const p of table) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [], queue = [...(kids.get(pid) || [])];
  while (queue.length) { const p = queue.shift(); out.push(p); queue.push(...(kids.get(p.pid) || [])); }
  return out;
}

/** The machine's process table, read from /proc. */
export function processTable() {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const id of ids) {
    try {
      const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const comm = stat.slice(stat.indexOf('(') + 1, close);
      const ppid = Number(stat.slice(close + 2).split(' ')[1]);
      const cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      out.push({ pid: Number(id), ppid, comm, cmd });
    } catch { /* ended while we looked */ }
  }
  return out;
}

/**
 * Why this terminal must stay open, or null when it is safe to close.
 * `processes(pane)` lists what runs under it; `unsaved(pane)` its own unsaved files;
 * `followedByBot(pane)` the name of a bot following it.
 */
function reasonToKeep(pane, { now, unsaved, processes, followedByBot }) {
  if (pane.turn === 'waiting' || pane.attention) return 'Waiting for you';
  if (pane.turn === 'working' || pane.producing || pane.live === 'producing') return 'Working right now';
  const lastActive = Number(pane.lastActiveAt) || 0;
  if (lastActive && now - lastActive < IDLE_MIN_MS) return 'Used in the last few minutes';
  const running = processes(pane);
  if (running.some((p) => AGENTS_SERVICE.test(p.cmd))) return 'Runs the Agents service';
  // A plain shell with a program under it is running something (a server, a watcher):
  // closing would stop it. An agent's own helpers are part of the agent and end with it.
  if (!AGENT_PROVIDERS.has(pane.provider) && running.length) return `Something is still running in it (${running[0].comm})`;
  const bot = followedByBot(pane);
  if (bot) return `${bot} is following it`;
  const files = unsaved(pane);
  if (files.length) return `Unsaved work: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`;
  return null;
}

export function cleanupPlan({ panes, now = Date.now(), unsaved = () => [], processes = () => [], followedByBot = () => null }) {
  const offer = [], keep = [];
  for (const pane of panes) {
    if (pane.alive === false) continue;
    const base = { id: pane.id, name: terminalName(pane), folder: pane.cwd ? path.basename(pane.cwd) : clip(pane.project || ''), provider: pane.provider || 'shell' };
    const reason = reasonToKeep(pane, { now, unsaved, processes, followedByBot });
    if (reason) { keep.push({ ...base, reason }); continue; }
    const idleMs = Math.max(0, now - (Number(pane.lastActiveAt) || Number(pane.startedAt) || now));
    offer.push({ ...base, idleMs, idleText: idleText(idleMs) });
  }
  offer.sort((a, b) => b.idleMs - a.idleMs);
  return { offer, keep, checkedAt: now };
}

/**
 * Close what Noam ticked, judged against a plan made just now: a terminal that became busy
 * or closed since the list was shown is not closed, and says why.
 */
export async function closeIdleTerminals({ ids, plan, requestClose, by = 'cleanup' }) {
  const results = [];
  for (const id of [...new Set((ids || []).map(String))]) {
    const offered = plan.offer.find((o) => o.id === id);
    if (!offered) {
      const kept = plan.keep.find((k) => k.id === id);
      results.push({ id, name: kept?.name || id, ok: false, error: `Not closed: ${kept ? kept.reason : 'it is no longer open'}` });
      continue;
    }
    let r;
    try { r = await requestClose(id, { by }); } catch (error) { r = { ok: false, error: error.message }; }
    results.push(r.ok ? { id, name: offered.name, ok: true } : { id, name: offered.name, ok: false, error: r.error || 'TermFleet did not close it.' });
  }
  const closed = results.filter((r) => r.ok).length;
  return { ok: results.length > 0 && closed === results.length, closed, results };
}
