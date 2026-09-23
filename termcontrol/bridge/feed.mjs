import { statSync } from 'node:fs';
import * as claude from './adapters/claude.mjs';
import * as codex from './adapters/codex.mjs';
import * as opencode from './adapters/opencode.mjs';

const ADAPTERS = { claude, codex, opencode };

export function adapterFor(pane) {
  return ADAPTERS[pane.provider] || null;
}

export function readFeed(pane, opts = {}) {
  const a = adapterFor(pane);
  if (!a) return { events: [], pending: [], provider: pane.provider, available: false };

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

/** TermControl is a conversation surface; internal tool/hook events stay out of it. */
export function visibleFeed(feed, limit = 60) {
  return {
    ...feed,
    events: (feed.events || []).filter((event) => event.kind !== 'tool').slice(-limit),
    pending: [],
  };
}

function fileSize(file) {
  try { return file ? statSync(file).size : null; } catch { return null; }
}
