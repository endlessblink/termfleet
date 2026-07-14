import type { TerminalHeaderStatus } from "./terminalHeaderState";

/**
 * The one question the cockpit must always answer for a non-technical viewer:
 * does this terminal need me, is it busy, or is nothing happening? This is a
 * SEPARATE axis from the task/description text — it stays honest even when the
 * task reads "Task not captured", and it replaces the vague "Working" fallback.
 *
 * Crucially it is NOT derived from "is a PTY attached" (every open shell is), but
 * from real activity evidence: the header status for waiting, and the same
 * `activelyWorking` signal the header already computes (a live agent turn, a
 * running command, a visible "esc to interrupt" marker) for running. No model.
 */
export type AttentionState = "waiting" | "running" | "idle";

export interface AttentionBadge {
  state: AttentionState;
  /** Plain-language label shown to the operator. */
  label: string;
  /** CSS custom-property color token for the dot/pill. */
  color: string;
}

const BADGES: Record<AttentionState, AttentionBadge> = {
  // Amber — YOU are the blocker: a prompt wants input, or a pane is stuck. "blocked"
  // folds in here because a stuck pane also needs a human.
  waiting: { state: "waiting", label: "Waiting for you", color: "var(--accent-warning)" },
  // Green — a command or agent turn is actively working right now (positive evidence).
  running: { state: "running", label: "Running", color: "var(--accent-success)" },
  // Grey — empty prompt, nothing running, nobody waiting. The DEFAULT: an attached
  // shell sitting at a prompt is idle, not "running".
  idle: { state: "idle", label: "Idle", color: "var(--text-tertiary)" },
};

export function badgeForAttention(state: AttentionState): AttentionBadge {
  return BADGES[state];
}

/**
 * Collapse the header signals to the three viewer-facing states. Waiting wins
 * (it means the operator is blocked); otherwise a pane is "running" ONLY with
 * positive activity evidence, and "idle" by default — so an attached-but-quiet
 * shell reads Idle, not Running.
 */
export function attentionStateFrom(input: {
  headerStatus: TerminalHeaderStatus;
  activelyWorking?: boolean;
}): AttentionState {
  if (input.headerStatus === "waiting" || input.headerStatus === "blocked") return "waiting";
  if (input.activelyWorking) return "running";
  return "idle";
}
