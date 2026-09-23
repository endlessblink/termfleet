/**
 * Ground truth for the Running/Waiting/Idle badge from the process table.
 *
 * The badge follows the agent's own hook events, but several real transitions fire
 * none: an Esc/Ctrl+C interrupt, a crash, `/exit`, or one tool call that outlives the
 * sidecar TTL. The process table settles those without a clock, so the badge keeps
 * its no-flicker property (TF-044):
 *  - the agent that wrote this pane's record is gone → Idle, whatever the hook said.
 * An alive agent is never forced to Running from an old record; see below.
 *
 * Only a record stamped with THIS pane's id counts: the agent that wrote it carries
 * the same TERMFLEET_PANE_ID, so the process lookup is keyed identically and a
 * missing process is real, not a key mismatch.
 */
export const AGENT_ABSENT_POLLS_BEFORE_IDLE = 2;

export interface BadgeLivenessInput {
  /** The status the hook record reports (working | waiting | blocked | idle | …). */
  hookStatus?: string | null;
  sidecarState?: "fresh" | "stale" | "missing" | "error";
  /** The pane id the hook stamped into the record. */
  sidecarPaneId?: string | null;
  /** The key this pane was polled (and its process looked up) under. */
  pollKey: string;
  /** true/false from the process table; null when it could not be read. */
  agentAlive: boolean | null;
  /** Consecutive polls (including this one) that found no agent process. */
  absentStreak: number;
}

export type BadgeLivenessOverride = "idle" | null;

interface ReportedStatus {
  status?: string | null;
  updatedAt?: number | null;
  statusFromAgentLog?: boolean;
}

/**
 * The stored status may only be replaced by a NEWER report. Two writers (the poll loop
 * and a mounted pane's own refresh) used to take turns writing an old hook record over
 * a liveness-corrected Idle, so the badge flipped Running↔Idle (TF-044).
 *
 * A status read from the agent's own session log is owned by the poll loop, which
 * re-reads that log every sweep; a hook record never replaces it here.
 */
export function keepNewerReportedStatus<T extends ReportedStatus>(
  stored: ReportedStatus | null | undefined,
  next: T,
): T {
  if (!stored?.status) return next;
  const storedAt = stored.updatedAt ?? 0;
  if (!stored.statusFromAgentLog && storedAt <= (next.updatedAt ?? 0)) return next;
  return {
    ...next,
    status: stored.status,
    updatedAt: storedAt,
    statusFromAgentLog: stored.statusFromAgentLog,
  } as T;
}

export function badgeLivenessOverride(input: BadgeLivenessInput): BadgeLivenessOverride {
  if (input.agentAlive === null) return null;
  if (!input.sidecarPaneId || input.sidecarPaneId !== input.pollKey) return null;
  if (input.sidecarState !== "fresh" && input.sidecarState !== "stale") return null;
  const status = String(input.hookStatus ?? "").toLowerCase();
  if (input.agentAlive) {
    // An alive agent with an aged-out "working" record is NOT proof of work: Codex
    // panes kept "working" for 14 h after their hooks were switched off and never
    // reported the turn's end. A genuinely long tool call is proven by the live
    // spinner footer on screen instead (see operatorQuestionState).
    return null;
  }
  const busy = status === "working" || status === "waiting" || status === "blocked";
  return busy && input.absentStreak >= AGENT_ABSENT_POLLS_BEFORE_IDLE ? "idle" : null;
}
