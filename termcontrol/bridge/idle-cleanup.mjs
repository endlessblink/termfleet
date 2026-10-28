// "Clean up idle terminals" (Noam 2026-10-22: "אני רואה שיש מלא טרמינלים פתוחים במפה שהם לא
// בשימוש. למה הם לא נוקו?", then "Yes, build it"). One list of the terminals that are safe to
// close, each with its name, folder and how long it has been idle; every other terminal is
// shown with the plain reason it stays. Closing takes a fresh look first and closes only what
// Noam left ticked and is still safe, through the app's own close (the card's X).
import fs from 'node:fs';
import path from 'node:path';
import {screenPromptAsk} from './asks.mjs';
import {screenStillAsks} from './bot-events.mjs';

export function cleanupScreenState(pane,screen) {
  if(typeof screen!=='string'||!screen.trim())return 'unknown';
  return screenPromptAsk(pane,screen)||screenStillAsks(screen)?'waiting':'clear';
}

export const IDLE_MIN_MS = 15 * 60_000;
// Noam 2026-10-24 (approved the Agent-Manager's ask): a terminal a BOT started closes after 5
// idle minutes once finished, so one bot cannot pile up terminals that eat the machine.
export const BOT_IDLE_MIN_MS = 5 * 60_000;
// Noam 2026-10-22: his own terminals only 'לאחר הצגתם לי אם הם לא פעילים הרבה זמן', '2 hours'.
export const OWN_IDLE_MIN_MS = 2 * 60 * 60_000;
// This threshold selects an idle-age display baseline, never proof that a working turn ended.
// Positive activity, a working turn, approval or an unreadable screen prevents automatic cleanup.
export const STUCK_AGENT_MS = 2 * 60 * 60_000;
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
 * Who started and who follows each terminal, from every bot's full helpers list (R-7214: a
 * start record that scrolled out of the short list made a bot's terminal look like Noam's own).
 * A follow counts only while it lasts: the newest follow entry for that terminal is not ended.
 */
export function helperRoles(bots) {
  const starters = new Map(), latestFollow = new Map();
  for (const b of bots) {
    for (const h of b.helpers || []) {
      if (!h?.paneId) continue;
      if (!h.followed) { if (!starters.has(h.paneId)) starters.set(h.paneId, b); continue; }
      const prev = latestFollow.get(h.paneId);
      if (!prev || (Number(h.at) || 0) >= (Number(prev.h.at) || 0)) latestFollow.set(h.paneId, { b, h });
    }
  }
  const followers = new Map();
  for (const [id, { b, h }] of latestFollow) if (!h.ended) followers.set(id, b);
  return { starters, followers };
}

/**
 * Who started each open terminal, kept across looks: a helper whose parent agent has closed
 * is still a helper (R-7214). `saved` is the last record, `now` this look's; closed ones drop.
 */
export function rememberStarters(saved, now, openIds) {
  const out = new Map();
  for (const [id, who] of Object.entries(saved || {})) if (openIds.has(id) && who?.name) out.set(id, who);
  for (const [id, who] of now) if (openIds.has(id)) out.set(id, who);
  return out;
}

/** Only the helper-terminal tool (termfleet-child) starts a terminal with a child-tasks file. */
export function startedByCommand(command) {
  return /terminal-workspace\/child-tasks\//.test(String(command || '')) ? 'an agent' : null;
}

/**
 * When it was last used. A terminal an agent or bot started counts only real work
 * (`lastWorkedAt`: its agent's record, its conversation, or output that kept moving), since an
 * idle agent repaints its screen now and then (R-7214). Noam's own count any screen change.
 */
function lastUsedFor(pane, starter, now = Date.now()) {
  if (frozenAgent(pane, now)) return Number(pane.recordAt);
  if (starter && pane.lastWorkedAt != null) return Number(pane.lastWorkedAt) || 0;
  return Number(pane.lastActiveAt) || 0;
}

/** An agent whose own conversation (`recordAt`) has not moved for STUCK_AGENT_MS, whatever its screen does. */
function frozenAgent(pane, now) {
  const recordAt = Number(pane.recordAt) || 0;
  return AGENT_PROVIDERS.has(pane.provider) && recordAt > 0 && now - recordAt >= STUCK_AGENT_MS;
}

/**
 * Why this terminal must stay open, or null when it is safe to close.
 * `processes(pane)` lists what runs under it; `unsaved(pane)` its own unsaved files;
 * `followedByBot(pane)` the name of a bot following it.
 */
function reasonToKeep(pane, { now, unsaved, processes, followedByBot, starter, byBot, screenState }) {
  if (pane.turn === 'waiting' || pane.attention) return 'Waiting for you';
  if(pane.pendingTools===true||pane.producing||pane.live==='producing')return 'Working right now';
  if (pane.turn === 'working') return 'Working right now';
  if(AGENT_PROVIDERS.has(pane.provider)){
    let screen;try{screen=screenState(pane);}catch{}
    if(screen==='waiting')return 'Waiting for you';
    if(screen!=='clear')return 'Cannot verify the current terminal prompt';
    if(!['idle','completed','finished'].includes(pane.turn))return 'Cannot verify that the agent finished';
  }
  const lastActive = lastUsedFor(pane, starter, now);
  if (!lastActive && pane.cardless) return 'Cannot tell when it was last used';
  if (lastActive && now - lastActive < (byBot ? BOT_IDLE_MIN_MS : IDLE_MIN_MS)) return 'Used in the last few minutes';
  if (!starter && lastActive && now - lastActive < OWN_IDLE_MIN_MS) return 'Yours, used in the last 2 hours';
  const running = processes(pane);
  if (running.some((p) => AGENTS_SERVICE.test(p.cmd))) return 'Runs the Agents service';
  // A plain shell with a program under it is running something (a server, a watcher):
  // closing would stop it. An agent's own helpers are part of the agent and end with it.
  if (!AGENT_PROVIDERS.has(pane.provider) && running.length) return `Something is still running in it (${running[0].comm})`;
  const bot = followedByBot(pane);
  if (bot) return `${bot} is following it`;
  return null;
}

/** Its own unsaved work, said plainly; null when there is none. Noam decides these himself (Q4). */
function unsavedWarning(pane, unsaved) {
  const files = unsaved(pane);
  return files.length ? `Unsaved work: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` : null;
}

export function cleanupPlan({ panes, now = Date.now(), unsaved = () => [], processes = () => [], followedByBot = () => null, startedBy = () => null, startedByBot = () => false, isSleeping = () => false, screenState = () => null }) {
  const offer = [], keep = [];
  for (const pane of panes) {
    // A sleeping terminal (its programs ended, card kept to wake later) is never a candidate.
    if (pane.alive === false || isSleeping(pane.id)) continue;
    // Who started it: an agent (its parent on the map) or a bot; null when Noam opened it himself.
    const starter = startedBy(pane) || null;
    const base = { id: pane.id, name: terminalName(pane), folder: pane.cwd ? path.basename(pane.cwd) : clip(pane.project || ''), provider: pane.provider || 'shell', sessionId:pane.sessionId??null,pid:pane.pid??null, startedBy: starter };
    const reason = reasonToKeep(pane, { now, unsaved, processes, followedByBot, starter, byBot: Boolean(starter && startedByBot(pane)),screenState });
    if (reason) { keep.push({ ...base, reason }); continue; }
    const idleMs = Math.max(0, now - (lastUsedFor(pane, starter, now) || Number(pane.startedAt) || now));
    const warning = unsavedWarning(pane, unsaved);
    offer.push({ ...base, idleMs, idleText: idleText(idleMs), checked: !warning, ...(warning ? { warning } : {}) });
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

/**
 * Noam 2026-10-22: terminals an agent or bot started close by themselves once finished and
 * safe ('בוטים שהסוכן פתח בוודאות'). Only those: his own terminals wait for his tap.
 */
export async function autoCloseFinished({ plan, requestClose, canClose = async()=>false, log = () => {} }) {
  let closed = 0;
  // Only finished helpers with nothing unsaved; one with unsaved work waits for Noam (Q4).
  for (const o of plan.offer.filter((x) => x.startedBy && !x.warning)) {
    try{if(!await canClose(o))continue;}catch{continue;}
    let r;
    try { r = await requestClose(o.id, { by: 'auto-cleanup' }); } catch (error) { r = { ok: false, error: error.message }; }
    if (r.ok) closed++;
    log(r.ok ? `Closed "${o.name}" (started by ${o.startedBy}); it was finished${o.idleText ? ` and ${o.idleText}` : ''}.` : `Not closed "${o.name}": ${r.error}`, o, r.ok);
  }
  return { closed };
}

/**
 * Terminals the daemon still runs that no card on the map owns (their card was lost or closed
 * without ending them). Noam cannot see them, so the cleanup lists them too. Built from the
 * daemon's own list; `lastUsed(pane)` is when its conversation last changed (0 when unknown).
 */
export function cardlessSessions({ liveById, ownedIds, agents = new Map(), now = Date.now(), lastUsed = () => 0, commandOf = () => '', isSleeping = () => false }) {
  const out = [];
  for (const [id, life] of liveById) {
    if (life?.exited || ownedIds.has(id) || isSleeping(id)) continue;
    const agent = agents.get(id) || {};
    const cwd = life.initialCwd || null;
    const status = agent.vendorStatus?.status;
    const pane = {
      id, alive: true, cardless: true, provider: agent.provider || 'shell', sessionId: agent.sessionId || null, cwd,
      project: cwd ? path.basename(cwd) : 'unknown', pid: life.pid ?? null, producing: Boolean(life.producing),
      turn: status === 'busy' ? 'working' : status === 'waiting' ? 'waiting' : status === 'idle' ? 'idle' : AGENT_PROVIDERS.has(agent.provider) ? 'unknown' : 'idle',
    };
    pane.title = `Hidden terminal in ${pane.project} (no card on the map)`;
    pane.recordAt = Number(lastUsed(pane)) || 0;
    pane.lastActiveAt = Math.max(Number(lastUsed(pane)) || 0, life.quietForMs != null ? now - life.quietForMs : 0);
    pane.lastWorkedAt = Math.max(Number(lastUsed(pane)) || 0, life.busyQuietForMs != null ? now - life.busyQuietForMs : 0);
    // Started by an agent: termfleet-child gives every helper a task file to read.
    if (startedByCommand(commandOf(life.pid))) pane.startedBy = 'an agent';
    out.push(pane);
  }
  return out;
}
