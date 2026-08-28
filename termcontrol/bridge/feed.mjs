import * as claude from './adapters/claude.mjs';
import * as codex from './adapters/codex.mjs';

const ADAPTERS = { claude, codex };

export function adapterFor(pane) {
  return ADAPTERS[pane.provider] || null;
}

export function readFeed(pane, opts) {
  const a = adapterFor(pane);
  if (!a) return { events: [], pending: [], provider: pane.provider, available: false };
  const feed = a.readFeed(pane, opts);
  return { ...feed, provider: pane.provider, available: Boolean(a.transcriptPath(pane)) };
}
