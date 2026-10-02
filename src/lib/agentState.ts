// ONE mapping from every status vocabulary the app has onto the five states the
// design shows: Running, Waiting for you, Idle, Failed, Done (design step 2.1/2.3).
//
//   agent vocabulary    working|running -> running
//                       waiting|needs-attention|blocked (a question) -> waiting
//                       idle -> idle
//                       done|completed -> done
//                       failed|error|provider-failure -> failed
//                       anything else (unknown) -> null  (render nothing)
//   process vocabulary  running|reconnected -> running colour
//                       failed -> failed colour
//                       starting|stale|exited|idle -> secondary text (not a status colour)
//   master-plan task    in-progress -> running, blocked -> waiting, done -> done, todo -> idle
//
// Colours are the --state-* tokens; callers pair them with a glyph and a word.

import type { AttentionState } from "./terminalAttention";
import type { MasterPlanTaskStatus, TerminalRuntimeStatus } from "./types";

export type AgentState = "running" | "waiting" | "idle" | "failed" | "done";

export const AGENT_STATE_COLOR: Record<AgentState, string> = {
  running: "var(--state-running)",
  waiting: "var(--state-waiting)",
  idle: "var(--state-idle)",
  failed: "var(--state-failed)",
  done: "var(--state-done)",
};

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  waiting: "Waiting for you",
  idle: "Idle",
  failed: "Failed",
  done: "Done",
};

/** Agent-status vocabulary (sidecar/status summaries/badges) -> state. Unknown -> null. */
export function agentStateOf(status: string | null | undefined): AgentState | null {
  switch ((status ?? "").trim().toLowerCase()) {
    case "working":
    case "running":
    case "active":
      return "running";
    case "waiting":
    case "waiting-for-you":
    case "needs-attention":
    case "attention":
    case "blocked":
      return "waiting";
    case "idle":
    case "ready":
      return "idle";
    case "done":
    case "completed":
    case "complete":
      return "done";
    case "failed":
    case "error":
    case "provider-failure":
      return "failed";
    default:
      return null;
  }
}

/** Pane attention badge (waiting/running/idle/unavailable) -> state. */
export function attentionToAgentState(state: AttentionState): AgentState {
  if (state === "waiting") return "waiting";
  if (state === "running") return "running";
  return "idle";
}

/** Process (PTY runtime) vocabulary -> colour. Only running/failed are status colours. */
export function processStatusColor(status: TerminalRuntimeStatus | "idle"): string {
  switch (status) {
    case "running":
    case "reconnected":
      return AGENT_STATE_COLOR.running;
    case "failed":
      return AGENT_STATE_COLOR.failed;
    default:
      // starting, stale, exited, idle
      return "var(--text-secondary)";
  }
}

/** Master-plan task status -> state. */
export function taskStateOf(status: MasterPlanTaskStatus): AgentState | null {
  switch (status) {
    case "in-progress":
      return "running";
    case "blocked":
      return "waiting";
    case "done":
      return "done";
    case "todo":
      return "idle";
    default:
      return null;
  }
}
