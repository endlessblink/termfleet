// Anti-flicker for the cockpit pane header (TC-035).
//
// The pane title + activity line are re-derived on every status poll (~1.2–2s) and the
// sidecar `now` updates on every tool call, so without a floor the header changes multiple
// times a second - distracting and unreadable. This enforces a MINIMUM HOLD: once a
// {title, now} pair is shown it stays put for at least `minHoldMs` before a different pair
// can replace it. A pane that needs attention (failed/exited) bypasses the hold so problems
// surface immediately.
//
// Title and `now` are stabilized AS A UNIT so the header never shows a mismatched pair
// (for example, a new title beside the previous activity line) mid-window.
//
// Held values flush naturally: the status poll keeps re-rendering every ~1.2–2s, so a
// change that arrives mid-window appears on the first render after the hold expires.

export const MIN_HEADER_HOLD_MS = 5000;

export interface StableHeaderValue {
  title: string;
  now: string;
}

// Placeholder/neutral header text — a value the header shows when there is no real
// activity yet (empty, a run-state word, or an "awaiting…" idle line). Upgrading FROM one
// of these to real data must happen immediately; the min-hold only governs thrash between
// two genuine activity descriptions.
const NEUTRAL_HEADER = new Set([
  "",
  "ready",
  "working",
  "idle",
  "needs attention",
  "terminal",
  "terminal activity",
  "awaiting command",
  "awaiting terminal output",
  "awaiting output",
]);

function isNeutralText(value: string): boolean {
  return NEUTRAL_HEADER.has(value.trim().toLowerCase());
}

export interface StableHeaderEntry extends StableHeaderValue {
  committedAt: number;
}

/**
 * Pure reducer: given the previously committed entry and an incoming value, decide what to
 * display and when it was committed. Exported for deterministic unit testing.
 */
export function nextStableHeader(
  prev: StableHeaderEntry | null,
  incoming: StableHeaderValue,
  nowMs: number,
  minHoldMs: number = MIN_HEADER_HOLD_MS,
  bypass: boolean = false,
): StableHeaderEntry {
  if (!prev) return { ...incoming, committedAt: nowMs };
  if (prev.title === incoming.title && prev.now === incoming.now) return prev;
  // Only hold a change when the currently-shown header is itself substantive. If either
  // part is still a placeholder/idle line, the pane hasn't shown real activity yet, so let
  // the real value in immediately — the hold is for thrash between two real descriptions,
  // not for blocking initial population. Failed/exited panes always bypass.
  const prevIsPlaceholder = isNeutralText(prev.title) || isNeutralText(prev.now);
  if (bypass || prevIsPlaceholder || nowMs - prev.committedAt >= minHoldMs) {
    return { ...incoming, committedAt: nowMs };
  }
  return prev;
}

const store = new Map<string, StableHeaderEntry>();

/**
 * Stateful, keyed-by-pane wrapper over `nextStableHeader`. Safe to call during render: it is
 * deterministic in (stored entry, nowMs) and the commit write is idempotent for a given
 * commit, matching the cockpit's existing render-time `Date.now()` usage.
 */
export function stableHeader(
  key: string,
  incoming: StableHeaderValue,
  options: { nowMs: number; minHoldMs?: number; bypass?: boolean },
): StableHeaderValue {
  const prev = store.get(key) ?? null;
  const entry = nextStableHeader(prev, incoming, options.nowMs, options.minHoldMs, options.bypass);
  if (entry !== prev) store.set(key, entry);
  return { title: entry.title, now: entry.now };
}

/** Drop a pane's held value (on close) or the whole store (tests). */
export function resetStableHeader(key?: string): void {
  if (key === undefined) store.clear();
  else store.delete(key);
}
