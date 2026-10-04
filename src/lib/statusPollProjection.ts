import type { AgentStatusSummarizerResult } from "./agentStatusSummarizer";
import type { TerminalState } from "./types";
import type { Tab, WorkstreamMetadata } from "./types";
import { stableAgentProvider } from "./agentProviderIdentity";
import { qualityCheckGoalLabel } from "./terminalHeaderQuality";

function validPaneGoal(value: string | undefined, source: string | undefined) {
  const text = value?.trim() ?? "";
  if (!text) return false;
  if (source === "opening-request" && text.length <= 220 && !/[…]$/.test(text)) {
    return true;
  }
  const qualityInput = source === "opening-request" && text.endsWith("?")
    ? `${text.slice(0, -1)}.`
    : text;
  return qualityCheckGoalLabel(qualityInput, {
    allowAboutWhatVoice: true,
    allowTrustedAboutWhat:
      source === "about-what" ||
      source === "opening-request" ||
      source === "user-prompt",
    maxLength: source === "opening-request" || source === "user-prompt" ? 220 : 150,
  }).ok;
}

export function terminalMatchesPollTarget(candidate: TerminalState, target: TerminalState) {
  return candidate.paneId === target.paneId;
}


/** Reject asynchronous results if the exact pane was replaced or changed runs. */
export function pollTargetMatchesRun(candidate: TerminalState, target: TerminalState) {
  return terminalMatchesPollTarget(candidate, target) &&
    candidate.activeRunId === target.activeRunId &&
    candidate.providerSessionId === target.providerSessionId &&
    candidate.statusSummary?.sessionId === target.statusSummary?.sessionId;
}

export function reportedSessionChanged(previous: TerminalState["statusSummary"], next: TerminalState["statusSummary"]) {
  return Boolean(previous?.sessionId && next?.sessionId && previous.sessionId !== next.sessionId);
}

/** Keep a previously accepted pane Goal when a live-status projection omits it. */
export function preserveDurablePaneGoal(
  previous: TerminalState["statusSummary"] | undefined,
  next: NonNullable<TerminalState["statusSummary"]>,
) {
  if (reportedSessionChanged(previous, next)) return next;
  if (
    validPaneGoal(next.mainTask, next.mainTaskSource)
  ) return next;
  const previousGoal = previous?.mainTask?.trim();
  const previousSource = previous?.mainTaskSource;
  if (
    !previousGoal ||
    !previousSource ||
    !validPaneGoal(previousGoal, previousSource)
  ) {
    return next;
  }
  return {
    ...next,
    mainTask: previousGoal,
    mainTaskSource: previousSource,
  };
}

export function mirroredWorkstream(
  tab: Tab,
  taskLine: TerminalState["taskLine"] | null | undefined,
  taskLineup?: TerminalState["taskLineup"],
  status?: Pick<
    WorkstreamMetadata,
    "statusSummary" | "statusSummaryUpdatedAt" | "statusSummarySource" | "statusSummaryError"
  >,
) {
  if (!tab.workstream || (!taskLine && !taskLineup && !status)) return tab.workstream;
  return {
    ...tab.workstream,
    ...(taskLine ? { taskLine } : {}),
    ...(taskLineup && taskLineup.length > 0 ? { taskLineup } : {}),
    ...(status ?? {}),
  };
}

function statusPollProjectionFingerprint(terminal: TerminalState) {
  const stableLine = (line: TerminalState["taskLine"] | null | undefined) =>
    line
      ? {
          text: line.text,
          source: line.source,
          expiresAt: line.expiresAt,
        }
      : null;

  return JSON.stringify({
    agentProvider: terminal.agentProvider ?? null,
    statusSummary: terminal.statusSummary ?? null,
    statusSummarySource: terminal.statusSummarySource ?? null,
    statusSummaryError: terminal.statusSummaryError ?? null,
    mainUserAsk: terminal.mainUserAsk ?? null,
    taskLineup: terminal.taskLineup ?? null,
    // Without this the loop computed a better Task line and then decided nothing had
    // changed, so the line never reached the store.
    // `capturedAt` is regenerated while resolving the same unchanged line; it is
    // telemetry, not a projection change. Including it rewrites the whole store on
    // every status sweep and makes WebKit repaint all terminal headers repeatedly.
    taskLine: stableLine(terminal.taskLine),
    nowLine: stableLine(terminal.nowLine),
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
  const newSession = reportedSessionChanged(terminal.statusSummary, result.summary);
  const retainedAsk = newSession && terminal.mainUserAsk?.source !== "manual" ? undefined : terminal.mainUserAsk;
  const durableGoal =
    Boolean(result.summary.mainTask?.trim()) &&
      validPaneGoal(result.summary.mainTask, result.summary.mainTaskSource) ||
    qualityCheckGoalLabel(result.summary.userTask, {
      allowAboutWhatVoice: true,
      allowTrustedAboutWhat: true,
      maxLength: 150,
    }).ok;
  // Expiry removes live activity, not the pane's durable about-what answer. This
  // branch must run before the generic expiry projection: otherwise an old but valid
  // sidecar is converted to a placeholder and the renderer loses its Goal entirely.
  if (result.sidecarState === "stale" && durableGoal) {
    return {
      agentProvider: stableAgentProvider(
        terminal.agentProvider,
        result.summary.provider,
      ),
      statusSummary: {
        ...result.summary,
        task: newSession ? result.summary.task : terminal.statusSummary?.task ?? result.summary.task,
        now: "Status unavailable",
        status: "unavailable",
        confidence: "low",
      },
      statusSummaryUpdatedAt: updatedAt,
      statusSummarySource: "sidecar",
      statusSummaryError: undefined,
      mainUserAsk: retainedAsk,
      taskLine: newSession ? undefined : terminal.taskLine,
      taskLineup: newSession ? [] : terminal.taskLineup,
      nowLine: null,
    };
  }
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
  const knownTask = newSession ? undefined : terminal.statusSummary?.task?.trim();
  const lastRealTask =
    knownTask &&
    !/^(?:Task not captured|Activity not captured|Status unavailable|Idle|Working|Ready|Unknown)$/i.test(
      knownTask,
    )
      ? knownTask
      : retainedAsk?.text?.trim() || undefined;

  return {
    agentProvider: stableAgentProvider(
      terminal.agentProvider,
      result.summary.provider,
    ),
    statusSummary: preserveDurablePaneGoal(terminal.statusSummary, {
      task: lastRealTask ?? "Task not captured",
      path: terminal.statusSummary?.path ?? result.summary.path,
      now: "Status unavailable",
      status: "unavailable",
      provider: terminal.statusSummary?.provider ?? result.summary.provider,
      confidence: "low",
      completedByCommand:
        result.summary.completedByCommand ||
        terminal.statusSummary?.completedByCommand ||
        undefined,
    }),
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
    mainUserAsk: retainedAsk,
    taskLineup: newSession ? [] : terminal.taskLineup,
    ...(newSession ? {taskLine: undefined, nowLine: null} : {}),
  };
}
