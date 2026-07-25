import type { AgentStatusSummarizerResult } from "./agentStatusSummarizer";
import type { TerminalState } from "./types";

function statusPollProjectionFingerprint(terminal: TerminalState) {
  return JSON.stringify({
    agentProvider: terminal.agentProvider ?? null,
    statusSummary: terminal.statusSummary ?? null,
    statusSummarySource: terminal.statusSummarySource ?? null,
    statusSummaryError: terminal.statusSummaryError ?? null,
    mainUserAsk: terminal.mainUserAsk ?? null,
    taskLineup: terminal.taskLineup ?? null,
  });
}

export function statusPollProjectionChanged(
  current: TerminalState,
  projection: Partial<TerminalState>,
) {
  return statusPollProjectionFingerprint(current) !== statusPollProjectionFingerprint({
    ...current,
    ...projection,
  });
}

/**
 * Convert an authoritative sidecar expiry into an honest cockpit state.
 * Missing or unreadable sidecars are deliberately left alone so a transient read
 * failure cannot erase a live task.
 */
export function projectStatusPollResult(
  terminal: TerminalState,
  result: AgentStatusSummarizerResult,
  updatedAt: number,
): Partial<TerminalState> | null {
  if (terminal.statusSummarySource !== "sidecar" || result.sidecarState !== "stale") {
    return null;
  }

  // The pane's task is not invalidated by the agent going quiet — only its live
  // activity is. Keeping the last real task (with the badge reading unavailable) is
  // both truer and more useful than replacing it with a placeholder.
  const knownTask = terminal.statusSummary?.task?.trim();
  const lastRealTask =
    knownTask &&
    !/^(?:Task not captured|Activity not captured|Idle|Working|Ready|Unknown)$/i.test(
      knownTask,
    )
      ? knownTask
      : undefined;

  return {
    statusSummary: {
      task: lastRealTask ?? "Task not captured",
      path: terminal.statusSummary?.path ?? result.summary.path,
      now: "Status unavailable",
      status: "unavailable",
      provider: terminal.statusSummary?.provider ?? result.summary.provider,
      confidence: "high",
    },
    statusSummaryUpdatedAt: updatedAt,
    statusSummarySource: "fallback",
    statusSummaryError: undefined,
    mainUserAsk: terminal.mainUserAsk?.source === "status-sidecar"
      ? undefined
      : terminal.mainUserAsk,
    taskLineup: terminal.taskLineup?.filter((item) => item.source !== "todo-write") ?? [],
  };
}
