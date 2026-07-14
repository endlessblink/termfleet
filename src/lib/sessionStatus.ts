import type { AttentionState } from "./terminalAttention";
import { terminalLooksActivelyWorking, terminalLooksAtRest } from "./terminalHeaderDisplay";

/**
 * THE single source of truth for a terminal's Running/Waiting/Idle state.
 *
 * Every UI surface (split header, sidebar row, map node) MUST derive its badge from
 * this one reconciler, fed the same signals, so the views can never contradict each
 * other (the "Running here, Idle there" bug). It fuses signals by priority rather than
 * letting each view guess:
 *
 *   1. On-screen "turn finished" marker ("Cooked/Worked for")  → idle   (beats stale hook)
 *   2. Explicit waiting (hook Notification / summary waiting)   → waiting
 *   3. Live on-screen "generating" marker / running command     → running (current truth)
 *   4. Hook says "working" AND the status is FRESH              → running
 *   5. Hook says "working" but STALE (no update in a while)     → idle   (turn really ended)
 *   6. otherwise                                                → idle
 *
 * Rule 5 is what fixes a finished agent that shows Running forever: without a turn-end
 * hook, a "working" status that stopped updating is treated as a finished turn. Rule 3
 * covers the gap while the model streams its final answer (the "esc to interrupt" marker
 * keeps output fresh even between tool calls).
 */
export type SessionLifecycle = "running" | "waiting" | "idle";

export interface SessionStatus {
  lifecycle: SessionLifecycle;
  attention: AttentionState;
  /** True when a "working" hook status was overridden to idle for going stale. */
  stale: boolean;
}

export interface SessionSignals {
  /** The hook-derived summary status (working | idle | waiting | blocked | done). */
  summaryStatus?: string | null;
  /** Live on-screen evidence a turn is generating now (markers) or a running command. */
  activelyRunning?: boolean;
  /** On-screen "turn finished" marker. */
  atRest?: boolean;
  /** When the pane last produced output / updated (ms epoch). */
  lastActivityAt?: number | null;
  /** Current time (ms epoch); pass Date.now() from the component. */
  now?: number | null;
}

// A "working" hook status older than this with no live marker is a finished turn whose
// end signal never arrived — treat it as idle rather than Running-forever.
export const WORKING_STALE_MS = 45_000;

export function reconcileSessionStatus(signals: SessionSignals): SessionStatus {
  const idle = (stale = false): SessionStatus => ({ lifecycle: "idle", attention: "idle", stale });
  const running: SessionStatus = { lifecycle: "running", attention: "running", stale: false };
  const waiting: SessionStatus = { lifecycle: "waiting", attention: "waiting", stale: false };

  const status = String(signals.summaryStatus ?? "").toLowerCase();

  // 1. A visible "done" marker is the strongest signal — it overrides a stale hook.
  if (signals.atRest) return idle();

  // 2. Explicit waiting → the operator is the blocker.
  if (status === "waiting" || status === "blocked") return waiting;

  // 3. A live generating marker / running command is current truth.
  if (signals.activelyRunning) return running;

  // 4/5. Trust a "working" hook only while it is FRESH.
  if (status === "working") {
    const fresh =
      typeof signals.lastActivityAt === "number" &&
      typeof signals.now === "number" &&
      signals.now - signals.lastActivityAt < WORKING_STALE_MS;
    // No timestamps available → trust the hook (better a rare stale Running than flicker).
    if (fresh || signals.lastActivityAt == null || signals.now == null) return running;
    return idle(true);
  }

  // 6. idle / done / unknown.
  return idle();
}

/**
 * Convenience wrapper: compute the badge state for a terminal from its raw fields, the
 * SAME way in every view. `visibleText` drives the on-screen markers; `summaryStatus`
 * is the hook status; `lastActivityAt` is when the pane last changed.
 */
export function sessionAttention(input: {
  visibleText?: string | null;
  durableActivityStatus?: string | null;
  summaryStatus?: string | null;
  lastActivityAt?: number | null;
  now?: number | null;
}): AttentionState {
  return reconcileSessionStatus({
    summaryStatus: input.summaryStatus,
    activelyRunning:
      terminalLooksActivelyWorking(input.visibleText) ||
      input.durableActivityStatus === "running",
    atRest: terminalLooksAtRest(input.visibleText),
    lastActivityAt: input.lastActivityAt,
    now: input.now,
  }).attention;
}
