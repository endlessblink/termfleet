import type { AttentionState } from "./terminalAttention";
import { terminalScreenAttention } from "./operatorQuestionState";

/**
 * THE single source of truth for a terminal's Running/Waiting/Idle state.
 *
 * Every UI surface (split header, sidebar row, map node) reads ONE value stored on the
 * terminal, reconciled here from the agent's reported status plus exact lifecycle chrome
 * on the current terminal screen. It uses no clock or freshness timeout. That is deliberate:
 *  - A time-based "went stale → idle" rule re-evaluated against the clock FLASHED the
 *    badge between Running and Idle as time crossed the threshold.
 *  - Generic prose never counts as state. The screen fallback recognizes only paired TUI
 *    prompts/completion markers, and the newest marker wins over visible history.
 * Hook state remains authoritative whenever the screen has no exact lifecycle marker.
 */
export type SessionLifecycle = "running" | "waiting" | "idle" | "unavailable";

export interface SessionStatus {
  lifecycle: SessionLifecycle;
  attention: AttentionState;
  stale: boolean;
}

export interface SessionSignals {
  /** The hook-derived summary status (working | idle | waiting | blocked | done). */
  summaryStatus?: string | null;
}

export function reconcileSessionStatus(signals: SessionSignals): SessionStatus {
  const idle: SessionStatus = { lifecycle: "idle", attention: "idle", stale: false };
  const running: SessionStatus = { lifecycle: "running", attention: "running", stale: false };
  const waiting: SessionStatus = { lifecycle: "waiting", attention: "waiting", stale: false };
  const unavailable: SessionStatus = { lifecycle: "unavailable", attention: "unavailable", stale: true };

  // PURE EVENT STATE — no clock and no freshness timeout. The badge changes
  // ONLY when the agent's own reported status changes (the status hook writes it on a
  // prompt/tool/turn-end event), so it CANNOT flash: a time-based "went stale → idle"
  // rule re-evaluated against the clock is exactly what made it flicker between Running
  // and Idle. Turn events don't oscillate.
  const status = String(signals.summaryStatus ?? "").toLowerCase();
  if (status === "waiting" || status === "blocked") return waiting;
  if (status === "working") return running;
  if (status === "unavailable") return unavailable;
  // idle / done / stopped / unknown → idle.
  return idle;
}

/** Convenience wrapper for callers that only have the agent's reported status. */
export function sessionAttention(input: { summaryStatus?: string | null }): AttentionState {
  return reconcileSessionStatus({ summaryStatus: input.summaryStatus }).attention;
}

/**
 * The ONE badge computation every view must use, at render time, from the pane's stored
 * status — NOT from a separately-stored badge field. Live telemetry showed a second
 * writer replacing the terminal object and dropping the stored badge, which made the
 * badge flicker (stored value vanished → view fell back → poll re-wrote it). A pure
 * render-time translation of the same store field has nothing to drop or resync.
 */
export function paneBadgeAttention(
  terminal?: {
    statusSummary?: { status?: string | null; updatedAt?: number | null } | null;
    statusSummaryUpdatedAt?: number | null;
    terminalVisibleText?: string | null;
    terminalVisibleTextUpdatedAt?: number | null;
  } | null,
  fallbackStatus?: string | null,
): AttentionState {
  const screenAttention = terminalScreenAttention(terminal?.terminalVisibleText);
  const screenUpdatedAt = terminal?.terminalVisibleTextUpdatedAt ?? 0;
  const summaryUpdatedAt = terminal?.statusSummaryUpdatedAt ?? terminal?.statusSummary?.updatedAt ?? 0;
  // A paired unanswered-question prompt on the current screen is stronger than
  // hook ordering: the hook event may be the transition that opened the prompt.
  // Requiring its timestamp to be newer leaves a visible question labeled Running.
  if (screenAttention === "waiting") return "waiting";
  if (screenAttention && (!summaryUpdatedAt || !screenUpdatedAt || screenUpdatedAt >= summaryUpdatedAt)) {
    return screenAttention;
  }
  return reconcileSessionStatus({
    summaryStatus: terminal?.statusSummary?.status ?? fallbackStatus,
  }).attention;
}
