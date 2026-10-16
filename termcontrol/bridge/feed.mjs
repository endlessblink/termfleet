import { statSync } from 'node:fs';
import * as claude from './adapters/claude.mjs';
import * as codex from './adapters/codex.mjs';
import * as opencode from './adapters/opencode.mjs';

const ADAPTERS = { claude, codex, opencode };

export function adapterFor(pane) {
  return ADAPTERS[pane.provider] || null;
}

const FEED_CACHE_MS = 3000;
const FEED_CACHE_MAX = 40;
const feedCache = new Map();   // key -> { at, value }

function recordStamp(file) {
  try { const s = statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return 'none'; }
}

/**
 * A long conversation record is read in widening slices of up to 48 MB, and the
 * phone, rooms and other agents ask for the same one within seconds. Reusing the
 * answer while the record has not changed keeps those reads from piling up in
 * memory (2026-10-16: the bridge peaked at 5.2 GB). Bounded in age and count.
 */
export function readFeed(pane, opts = {}) {
  const a = adapterFor(pane);
  if (!a) return { events: [], pending: [], provider: pane.provider, available: false };
  const file = a.transcriptPath(pane);
  const key = `${pane.provider}|${pane.id}|${pane.sessionId || ''}|${opts.limit ?? 60}|${file || ''}|${recordStamp(file)}`;
  const now = Date.now();
  const hit = feedCache.get(key);
  if (hit && now - hit.at < FEED_CACHE_MS) return hit.value;
  const value = readFeedUncached(pane, a, opts);
  for (const [k, v] of feedCache) if (now - v.at >= FEED_CACHE_MS) feedCache.delete(k);
  while (feedCache.size >= FEED_CACHE_MAX) feedCache.delete(feedCache.keys().next().value);
  feedCache.set(key, { at: now, value });
  return value;
}

export function feedCacheSize() { return feedCache.size; }

function readFeedUncached(pane, a, opts) {

  // A recent slice of a large transcript can be almost entirely machine
  // noise — reasoning blobs, tool payloads — leaving only a handful of real
  // messages. Widen the window until there is enough to read, or until it is
  // clear there is no more history to find.
  const limit = opts.limit ?? 60;
  let feed = { events: [], pending: [] };
  let reachedStart = false;

  for (const bytes of [512 * 1024, 3 * 1024 * 1024, 12 * 1024 * 1024, 48 * 1024 * 1024]) {
    const attempt = visibleFeed(a.readFeed(pane, { ...opts, limit: Math.min(limit * 8, 1600), bytes }), limit);
    if (attempt.events.length >= feed.events.length) feed = attempt;
    if (feed.events.length >= limit) break;
    const size = fileSize(a.transcriptPath(pane));
    if (size != null && bytes >= size) { reachedStart = true; break; }
  }

  return {
    ...feed,
    provider: pane.provider,
    available: Boolean(a.transcriptPath(pane)),
    reachedStart: reachedStart || feed.events.length < limit,
  };
}

/**
 * TF-096 part 6: work an agent handed to a teammate shows in its own chat too
 * (the receiver already shows "From the X agent").
 */
export function handoffLine(event) {
  const m = /termfleet-team\s+(send|ask)\s+(?:--interrupt\s+)?(\S+)\s+(?:--file\s+\S+|["']?([\s\S]*?)["']?)\s*$/.exec(String(event?.summary || ''));
  if (!m) return null;
  const what = (m[3] || '').trim();
  return { kind: 'notice', at: event.at, text: `↪ Handed to ${m[2]}${what ? `: ${what.slice(0, 160)}` : ''}` };
}

/**
 * A reply the agent sends while it keeps working (`termfleet-say "<text>"`). A
 * plain mid-turn reply is often not saved before the next tool runs, so the phone
 * never showed it (2026-10-16: "Messages I send here disappear and you dont
 * respond to them"); the command call is always saved.
 */
export function sayLine(event) {
  const m = /^termfleet-say\s+(?:"([\s\S]*)"|'([\s\S]*)'|([\s\S]+))$/.exec(String(event?.summary || '').trim());
  return m ? { kind: 'assistant', at: event.at, text: (m[1] ?? m[2] ?? m[3]).trim() } : null;
}

/** TermControl is a conversation surface; internal tool/hook events stay out of it. */
export function visibleFeed(feed, limit = 60) {
  return {
    ...feed,
    events: (feed.events || []).map((event) => (event.kind === 'tool' ? sayLine(event) || handoffLine(event) || event : event)).filter((event) => event.kind !== 'tool').slice(-limit),
    pending: [],
  };
}

function fileSize(file) {
  try { return file ? statSync(file).size : null; } catch { return null; }
}
