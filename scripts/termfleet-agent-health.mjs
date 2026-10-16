#!/usr/bin/env node
// How the agents are doing, day by day (TF-096 goal item 5). Counts, from the
// agents' own conversation records, three things Noam said go wrong:
//   lost   - the agent's memory was squeezed (an automatic compaction): it forgets
//   fixed  - Noam had to correct it ("not what I asked", "I said", "still broken", ...)
//   stuck  - it errored, was cut off, or Noam had to stop it
// Only real chats count: automated runs (claude -p, codex exec) are skipped.
// Rates are per 100 of Noam's messages, so busy and quiet days compare fairly.
// Incremental: each record is read once; later runs read only what was added.
//
//   termfleet-agent-health          update and print the last 14 days
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASELINE = { from: '2026-10-10', to: '2026-10-16' };   // the week before the bots went live
export const AFTER = { from: '2026-10-17', to: '2026-10-23' };      // the week after; verdict from 24 Oct
const KEEP_DAYS = 30;

export const cacheFile = () => process.env.TF_HEALTH_FILE || path.join(os.homedir(), '.cache', 'termfleet', 'agent-health', 'days.json');

export function dayOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CORRECTION = [
  /\b(not what i (asked|meant|said|wanted)|that'?s not (it|what)|i (said|asked|told you)|you (didn'?t|did not|forgot|ignored|missed)|didn'?t (ask|want)|still (not|broken|happening|doesn'?t|isn'?t|the same)|doesn'?t work|not working|wrong|why (did|didn'?t|isn'?t) (you|it)|glossed over|again\?|undo (that|it))\b/i,
  /^(no|nope|not that)\b[,.! ]/i,
  /(לא מה ש|אמרתי|ביקשתי|עדיין לא|לא עובד|שכחת|למה לא|זה לא נכון|לא ביקשתי)/,
];
export const isCorrection = (text) => CORRECTION.some((r) => r.test(String(text || '').slice(0, 600)));

// Text Noam typed (not tool output, command wrappers or injected instructions).
function claudeHumanText(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || o.toolUseResult) return null;
  const c = o.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : '';
  if (!text || Array.isArray(c) && c.some((p) => p.type === 'tool_result')) return null;
  if (/^\s*<(command-|local-command|system-reminder|task-notification|user-prompt-submit)/.test(text)) return null;
  return text;
}

/** One record line -> what it counts for. `state` carries per-file facts (automated?). */
export function classify(kind, line, state) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (kind === 'claude') {
    if (o.entrypoint && state.automated === undefined) state.automated = o.entrypoint !== 'cli';
    const at = o.timestamp;
    if (o.type === 'system' && o.subtype === 'compact_boundary') return { at, lost: 1 };
    if (o.type === 'assistant' && o.isApiErrorMessage) return { at, stuck: 1 };
    const text = claudeHumanText(o);
    if (text === null) return null;
    if (/^\[Request interrupted/.test(text)) return { at, stuck: 1 };
    return { at, said: 1, fixed: isCorrection(text) ? 1 : 0 };
  }
  const at = o.timestamp, p = o.payload || {};
  if (o.type === 'session_meta') { state.automated = p.originator === 'codex_exec'; return null; }
  if (o.type === 'compacted' || (o.type === 'event_msg' && p.type === 'context_compacted')) return { at, lost: 1 };
  if (o.type === 'event_msg' && ['turn_aborted', 'error', 'stream_error'].includes(p.type)) return { at, stuck: 1 };
  if (o.type === 'event_msg' && p.type === 'user_message' && p.message) return { at, said: 1, fixed: isCorrection(p.message) ? 1 : 0 };
  return null;
}

function* records(home = os.homedir(), sinceMs = 0) {
  const claude = path.join(home, '.claude', 'projects');
  let projects = [];
  try { projects = fs.readdirSync(claude); } catch { /* no Claude */ }
  for (const p of projects) {
    let files = [];
    try { files = fs.readdirSync(path.join(claude, p)); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl')) yield { kind: 'claude', file: path.join(claude, p, f) };
  }
  const codex = path.join(home, '.codex', 'sessions');
  const walk = function* (dir, depth) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const full = path.join(dir, n);
      if (depth < 3) yield* walk(full, depth + 1);
      else if (n.endsWith('.jsonl')) yield { kind: 'codex', file: full };
    }
  };
  for (const r of walk(codex, 0)) yield r;
}

// Calls fn(line) for each complete line from `offset`, reading 4 MB at a time (some
// records are hundreds of MB). fn may return false to stop. Returns the offset after
// the last complete line read.
function eachLine(file, offset, fn, { limit = Infinity } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = Math.min(fs.fstatSync(fd).size, offset + limit);
    const buf = Buffer.alloc(4 << 20);
    let pos = offset, carry = Buffer.alloc(0), done = offset;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (!n) break;
      pos += n;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : Buffer.from(buf.subarray(0, n));
      let start = 0, nl;
      while ((nl = data.indexOf(10, start)) >= 0) {
        const line = data.subarray(start, nl);
        done += nl - start + 1;
        start = nl + 1;
        // A single line over 8 MB is a pasted blob, never a message we count.
        if (line.length < 8 << 20 && fn(line.toString('utf8')) === false) return done;
      }
      carry = data.subarray(start);
      if (carry.length > 64 << 20) { done += carry.length; carry = Buffer.alloc(0); }   // skip a runaway line
    }
    return done;
  } finally { fs.closeSync(fd); }
}

/** Reads what was added since last time and returns the updated store. */
export function update({ home = os.homedir(), store = load(), now = Date.now(), peek = 64 * 1024 } = {}) {
  const since = now - KEEP_DAYS * 86400e3;
  store.files ||= {};
  store.days ||= {};
  for (const { kind, file } of records(home)) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.mtimeMs < since) continue;
    const seen = store.files[file] || { offset: 0, state: {} };
    if (seen.state.automated === true || st.size <= seen.offset) { store.files[file] = seen; continue; }
    // Automated runs say so on their first lines; skip them without reading the rest.
    if (seen.offset === 0 && seen.state.automated === undefined) {
      let lines = 0;
      eachLine(file, 0, (line) => { classify(kind, line, seen.state); return ++lines < 20 && seen.state.automated === undefined; }, { limit: peek });
      if (seen.state.automated === true) { seen.offset = st.size; store.files[file] = seen; continue; }
    }
    seen.offset = eachLine(file, seen.offset, (line) => {
      if (!line) return true;
      const hit = classify(kind, line, seen.state);
      if (seen.state.automated === true) return false;
      if (!hit) return true;
      const day = dayOf(hit.at);
      if (!day) return true;
      const d = store.days[day] ||= { said: 0, lost: 0, fixed: 0, stuck: 0 };
      for (const k of ['said', 'lost', 'fixed', 'stuck']) d[k] += hit[k] || 0;
      return true;
    });
    if (seen.state.automated === true) seen.offset = st.size;
    store.files[file] = seen;
  }
  for (const f of Object.keys(store.files)) { try { if (fs.statSync(f).mtimeMs < since) delete store.files[f]; } catch { delete store.files[f]; } }
  const oldest = dayOf(since);
  for (const day of Object.keys(store.days)) if (day < oldest) delete store.days[day];
  store.updatedAt = now;
  return store;
}

export function load() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return { files: {}, days: {} }; } }
export function save(store) {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
  const tmp = cacheFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, cacheFile());
}

const rate = (n, said) => (said ? Math.round((n / said) * 1000) / 10 : null);
function windowTotals(days, { from, to }) {
  const t = { said: 0, lost: 0, fixed: 0, stuck: 0, days: 0 };
  for (const [day, d] of Object.entries(days)) if (day >= from && day <= to) { t.days++; for (const k of ['said', 'lost', 'fixed', 'stuck']) t[k] += d[k]; }
  return { ...t, rates: { lost: rate(t.lost, t.said), fixed: rate(t.fixed, t.said), stuck: rate(t.stuck, t.said) } };
}

/** What the agents app shows: the last 14 days, the week before, the week after, a verdict. */
export function report(store = load(), now = Date.now()) {
  const days = store.days || {};
  const list = [];
  for (let i = 13; i >= 0; i--) {
    const day = dayOf(now - i * 86400e3);
    const d = days[day] || { said: 0, lost: 0, fixed: 0, stuck: 0 };
    list.push({ day, ...d, rates: { lost: rate(d.lost, d.said), fixed: rate(d.fixed, d.said), stuck: rate(d.stuck, d.said) } });
  }
  const before = windowTotals(days, BASELINE), after = windowTotals(days, AFTER);
  const today = dayOf(now);
  let verdict = null;
  if (today > AFTER.to && before.said && after.said) {
    verdict = {};
    for (const k of ['lost', 'fixed', 'stuck']) {
      const a = after.rates[k], b = before.rates[k];
      verdict[k] = b === 0 && a === 0 ? 'same' : a < b * 0.85 ? 'better' : a > b * 1.15 ? 'worse' : 'same';
    }
  }
  return { days: list, baseline: { ...BASELINE, ...before }, after: { ...AFTER, ...after }, checkOn: dayOf(new Date(`${AFTER.to}T12:00:00`).getTime() + 86400e3), verdict, updatedAt: store.updatedAt || null };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const store = update();
  save(store);
  const r = report(store);
  for (const d of r.days) console.log(`${d.day}  your messages ${String(d.said).padStart(4)}  lost track ${d.lost}  you corrected ${d.fixed}  stuck/errors ${d.stuck}`);
  console.log(`week before (${BASELINE.from}..${BASELINE.to}) per 100 messages: lost ${r.baseline.rates.lost} · corrected ${r.baseline.rates.fixed} · stuck ${r.baseline.rates.stuck}`);
}
