import {statusDir,fnv} from '../../scripts/lib/agent-status-paths.mjs';
import path from 'node:path';
import {hydrateSessionSnapshot} from '../../shared/sessionSnapshot.mjs';
import {createSessionState, reduceSessionStatus, selectSessionView} from '../../shared/sessionState.mjs';
import {reduceSessionEnvelope} from '../../shared/sessionEnvelope.mjs';
import fs from 'node:fs';
import { transcriptPath as codexTranscriptPath } from './adapters/codex.mjs';
import { tailLines } from './tail.mjs';

const cache = new Map();

const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function resetAt(value) {
  const number = finite(value);
  if (number != null) return number > 10_000_000_000 ? number : number * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function limitSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const usedPercent = finite(raw.used_percent);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowMinutes: finite(raw.window_minutes),
    resetsAt: resetAt(raw.resets_at),
  };
}

function namedLimits(rateLimits) {
  const candidates = [rateLimits?.primary, rateLimits?.secondary]
    .map(limitSnapshot)
    .filter(Boolean);
  const byMinutes = (minutes) => candidates.find((item) => item.windowMinutes === minutes) || null;
  // Position decides only for older logs that never said how long a window is: a
  // weekly-only record (primary = 10080 min, no secondary) once showed the same
  // weekly figure as both "5-hour" and "weekly" (2026-10-16).
  const unlabelled = (snapshot) => (snapshot && snapshot.windowMinutes == null ? snapshot : null);
  return {
    // Codex calls these primary and secondary. Prefer their declared window lengths.
    fiveHour: byMinutes(300) || unlabelled(limitSnapshot(rateLimits?.primary)),
    weekly: byMinutes(10080) || unlabelled(limitSnapshot(rateLimits?.secondary)),
  };
}

export function foldCodexStatus(records) {
  let workingSince = null;
  let limits = { fiveHour: null, weekly: null };

  for (const record of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (payload.type === 'task_started') {
      const at = Date.parse(String(record.timestamp || ''));
      workingSince = Number.isFinite(at) ? at : workingSince;
    } else if (payload.type === 'task_complete') {
      workingSince = null;
    } else if (payload.type === 'token_count' && payload.rate_limits) {
      limits = namedLimits(payload.rate_limits);
    }
  }

  return { workingSince, limits };
}

function readLegacySessionStatus(pane) {
  if (pane.provider !== 'codex') return { workingSince: null, limits: { fiveHour: null, weekly: null } };
  const file = codexTranscriptPath(pane);
  if (!file) return { workingSince: null, limits: { fiveHour: null, weekly: null } };

  let stat;
  try { stat = fs.statSync(file); } catch { return { workingSince: null, limits: { fiveHour: null, weekly: null } }; }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;

  const records = [];
  for (const line of tailLines(file, 12 * 1024 * 1024)) {
    try { records.push(JSON.parse(line)); } catch { /* a partial vendor record carries no status */ }
  }
  const value = foldCodexStatus(records);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

/** Pure v2 bridge projection. Inventory remains legacy until a verified publisher supplies
 * pane/conversation/run/epoch envelopes; no live transport or mobile UI is switched here. */
export function projectSessionStatusEvents(identity, envelopes, context) {
  let state=createSessionState(identity);
  for (const envelope of envelopes) state=reduceSessionEnvelope(state,envelope,context);
  return {state,view:selectSessionView(state,context.now)};
}

const heads=new Map();
const watchers=new Map();
const subscribers=new Set();
function ensureHeadWatcher(dir) {
 if(watchers.has(dir) || !fs.existsSync(dir)) return;
 try {const watcher=fs.watch(dir,{persistent:false},(_event,name)=>{
  if(name && /^events-[a-f0-9]{8}\.json$/.test(String(name))) {heads.delete(path.join(dir,String(name)));for(const listener of subscribers) listener(String(name));}
 });watcher.on('error',()=>{watchers.delete(dir);heads.clear();});watchers.set(dir,watcher);}catch{/* periodic API verification still reads exact metadata */}
}
export function readSessionEventView(pane,{dir=statusDir(),now=performance.now(),wallNow=Date.now()}={}) {
 ensureHeadWatcher(dir);
 const file=path.join(dir,`events-${fnv(pane.id)}.json`);
 try {
  const stat=fs.statSync(file);if(stat.size>1024*1024) return null;
  let cached=heads.get(file);
  if(!cached || cached.mtime!==stat.mtimeMs || cached.size!==stat.size) {
   cached={mtime:stat.mtimeMs,size:stat.size,head:JSON.parse(fs.readFileSync(file,'utf8'))};heads.set(file,cached);
  }
  const head=cached.head;
  if(head.identity?.paneId!==pane.id || head.provider!==pane.provider || (pane.sessionId && head.identity.sessionId!==pane.sessionId)) return null;
  let state=hydrateSessionSnapshot(head,{now,wallNow});if(!state) return null;
  const goal=pane.operatorGoal;
  if(goal?.source==='manual') state=reduceSessionStatus(state,{identity:state.identity,producer:'operator',source:'operator',id:`manual:${goal.updatedAt}:${goal.text}`,at:goal.updatedAt,kind:'goal.set',goal:{text:goal.text,source:'manual'}},{now,wallNow});
  return selectSessionView(state,now);
 } catch{return null;}
}
export function readSessionStatus(pane,options={}) {
 const legacy=readLegacySessionStatus(pane),view=readSessionEventView(pane,options);
 const authority=options.authority ?? process.env.TERMFLEET_STATUS_AUTHORITY==='on';
 if(!view) return authority ? {...legacy,workingSince:null,turn:'unknown',task:null,sessionAuthority:true}:legacy;
 return {...legacy,sessionViewV2:view,sessionAuthority:authority,
  ...(authority ? {turn:view.lifecycle==='working' ? 'working' : view.lifecycle==='waiting' ? 'waiting' : view.lifecycle==='finished' ? 'completed' : view.lifecycle,
   task:view.task?.text ?? null,workingSince:view.lifecycle==='working' ? legacy.workingSince : null} : {})};
}

/**
 * Claude keeps its own idle / busy / waiting status per running process. When it
 * is present it beats hook records and transcript guesses: a hook can be missed,
 * but this is the agent describing itself (2026-10-12: one live pane was waiting
 * on the operator while the phone said "working").
 */
export function applyVendorStatus(pane) {
  const status = pane?.vendorStatus?.status;
  if (!status) return pane;
  const turn = status === 'busy' ? 'working' : status === 'waiting' ? 'waiting' : pane.turn === 'working' || pane.turn === 'waiting' ? 'idle' : pane.turn;
  const live = pane.sessionAuthority && pane.sessionViewV2
    ? { sessionViewV2: { ...pane.sessionViewV2, lifecycle: status === 'busy' ? 'working' : status === 'waiting' ? 'waiting' : pane.sessionViewV2.lifecycle === 'working' || pane.sessionViewV2.lifecycle === 'waiting' ? 'finished' : pane.sessionViewV2.lifecycle } }
    : {};
  return { ...pane, ...live, turn, turnSource: 'agent' };
}

export const STALL_AFTER_MS = 20 * 60 * 1000;
/** How long a "working" agent has shown no sign of life, or 0. Waiting on the operator is never a stall. */
// An agent with a conversation record is measured by that record: screen output is no proof of
// progress (2026-10-26: a Codex that lost its backend at 12:45 repainted a ticking error clock and
// showed "Working (1h 24m)"). Normal silence inside a working turn is under 90 s at p99.9 for Codex
// and 5 min for Claude (3 days of records), so 20 minutes is a real stall.
export function stalledFor(pane, life, lastActiveAt, now = Date.now(), recordAt = 0) {
  if (pane.turn !== 'working') return 0;
  if (recordAt > 0) {
    const quiet = now - Math.max(recordAt, Number(pane.updatedAt) || 0);
    return quiet >= STALL_AFTER_MS ? quiet : 0;
  }
  if (life.producing || !lastActiveAt) return 0;
  const quiet = now - lastActiveAt;
  return quiet >= STALL_AFTER_MS ? quiet : 0;
}

export function subscribeSessionEventHeads(listener,dir=statusDir()) {
 ensureHeadWatcher(dir);subscribers.add(listener);return ()=>subscribers.delete(listener);
}
