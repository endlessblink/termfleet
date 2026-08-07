import type { AgentStatusSummarizerResult } from "./agentStatusSummarizer";
import type { TerminalState } from "./types";
import { stableAgentProvider } from "./agentProviderIdentity";

function statusPollProjectionFingerprint(terminal: TerminalState) {
  return JSON.stringify({
    agentProvider: terminal.agentProvider ?? null,
    statusSummary: terminal.statusSummary ?? null,
    statusSummarySource: terminal.statusSummarySource ?? null,
    statusSummaryError: terminal.statusSummaryError ?? null,
    mainUserAsk: terminal.mainUserAsk ?? null,
    taskLineup: terminal.taskLineup ?? null,
    // Without this the loop computed a better Task line and then decided nothing had
    // changed, so the line never reached the store.
    taskLine: terminal.taskLine ?? null,
    nowLine: terminal.nowLine ?? null,
  });
}

export function statusPollProjectionChanged(
  current: TerminalState,
  projection: Partial<TerminalState>,
) {
  return (
    statusPollProjectionFingerprint(current) !==
    statusPollProjectionFingerprint({
      ...current,
      ...projection,
    })
  );
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
  if (result.sidecarState !== "stale") {
    return null;
  }

  if (terminal.statusSummarySource !== "sidecar") {
    if (
      !result.summary.completedByCommand ||
      terminal.statusSummary?.completedByCommand
    ) {
      return null;
    }
    return {
      statusSummary: {
        ...(terminal.statusSummary ?? result.summary),
        completedByCommand: true,
      },
      statusSummaryUpdatedAt: updatedAt,
    };
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
    agentProvider: stableAgentProvider(
      terminal.agentProvider,
      result.summary.provider,
    ),
    statusSummary: {
      task: lastRealTask ?? "Task not captured",
      path: terminal.statusSummary?.path ?? result.summary.path,
      now: "Status unavailable",
      status: "unavailable",
      provider: terminal.statusSummary?.provider ?? result.summary.provider,
      confidence: "high",
      completedByCommand:
        result.summary.completedByCommand ||
        terminal.statusSummary?.completedByCommand ||
        undefined,
    },
    statusSummaryUpdatedAt: updatedAt,
    statusSummarySource: "fallback",
    statusSummaryError: undefined,
    // The operator's request and the pane's task list are IDENTITY, not live activity:
    // "there were tasks in the past and there was a goal — why isn't it stated?" (live
    // report 2026-07-26, on a pane with 8 finished tasks and a fresh request). Clearing
    // them here left the task ladder with nothing to say, so the row fell to "No task
    // declared" and the TASKS panel to "No list" while both were known. Only the live
    // lines above go unavailable — the badge and the activity line carry that fact, so
    // keeping these cannot make the pane look busy.
    mainUserAsk: terminal.mainUserAsk,
    taskLineup: terminal.taskLineup,
  };
}
