import type {
  Group,
  TaskLineupItem,
  TerminalMainUserAsk,
  TerminalPurposeSource,
  TerminalRuntimeStatus,
  WorkstreamStatusSummary,
} from "./types";
import {
  buildShellTerminalHeaderViewModel,
  type HeaderFieldSource,
} from "./terminalHeaderViewModel";
import { type AttentionState } from "./terminalAttention";
import { reconcileSessionStatus } from "./sessionStatus";
import { resolvePaneTaskLine, type PaneTaskLine } from "./taskLine";

export type TerminalHeaderStatus =
  | "idle"
  | "working"
  | "waiting"
  | "blocked"
  | "done";

export type TerminalHeaderWorkspaceSource = "workspace";
export type TerminalHeaderGoalSource =
  | "task-tool"
  | "user-prompt"
  | "plan-binding"
  | "sidecar-todo"
  | "manual"
  | "workstream"
  // TC-060: derived from the vendor's own session record or the running process.
  | "task-line"
  | "missing"
  | "none";
export type TerminalHeaderActivitySource =
  | "task-tool"
  | "durable-command"
  | "shell-marker"
  | "status-summary"
  | "missing"
  | "neutral";
export type TerminalHeaderPathSource =
  | "live-cwd"
  | "spawn-cwd"
  | "project-root"
  | "unknown";

export interface TerminalHeaderState {
  paneId: string;
  terminalId: string;
  runId?: string;
  workspace: string;
  userGoal: string | null;
  goalLabel: string;
  currentActivity: string;
  fullPath: string;
  status: TerminalHeaderStatus;
  /** Viewer-facing attention state: does this pane need me / is it busy / idle. */
  attention: AttentionState;
  sources: {
    workspace: TerminalHeaderWorkspaceSource;
    goal: TerminalHeaderGoalSource;
    activity: TerminalHeaderActivitySource;
    path: TerminalHeaderPathSource;
  };
  version: number;
  updatedAt: number;
  debug: Record<string, string | boolean | number | undefined>;
}

function goalSourceFrom(
  fieldSource: HeaderFieldSource,
  mainUserAsk?: TerminalMainUserAsk | null,
): TerminalHeaderGoalSource {
  if (fieldSource === "task-list") return "task-tool";
  if (fieldSource === "task-tool") return "task-tool";
  if (fieldSource === "manual") return "manual";
  if (fieldSource === "user-prompt") return "user-prompt";
  if (fieldSource === "plan-binding") return "plan-binding";
  if (fieldSource === "sidecar-todo") return "sidecar-todo";
  if (fieldSource === "workstream") return "workstream";
  if (fieldSource === "task-line") return "task-line";
  if (fieldSource === "missing") return "missing";
  if (fieldSource === "status-summary") return "missing";
  if (fieldSource !== "user-task") return "none";
  switch (mainUserAsk?.source) {
    case "terminal-prompt":
      return "user-prompt";
    case "status-sidecar":
      return "sidecar-todo";
    case "manual":
      return "manual";
    case "workstream":
      return "workstream";
    case "task-tool":
      return "task-tool";
    default:
      return "missing";
  }
}

function activitySourceFrom(
  fieldSource: HeaderFieldSource,
  trustedActivitySummary?: boolean,
): TerminalHeaderActivitySource {
  if (fieldSource === "missing") return "missing";
  if (fieldSource === "task-list") return "task-tool";
  if (trustedActivitySummary) return "durable-command";
  if (fieldSource === "status-summary") return "status-summary";
  return "neutral";
}

function statusFromSummary(
  summary?: WorkstreamStatusSummary | null,
  terminalStatus?: TerminalRuntimeStatus | null,
): TerminalHeaderStatus {
  if (summary?.status === "waiting") return "waiting";
  if (summary?.status === "blocked") return "blocked";
  if (summary?.status === "done") return "done";
  if (summary?.status === "working") return "working";
  if (terminalStatus === "failed") return "blocked";
  if (terminalStatus === "exited") return "done";
  if (terminalStatus === "running" || terminalStatus === "reconnected")
    return "working";
  return "idle";
}

function pathSource(input: {
  liveCwd?: string | null;
  spawnCwd?: string | null;
  project?: Pick<Group, "projectRoot"> | null;
}): TerminalHeaderPathSource {
  if (input.liveCwd) return "live-cwd";
  if (input.spawnCwd) return "spawn-cwd";
  if (input.project?.projectRoot) return "project-root";
  return "unknown";
}

export function buildTerminalHeaderState(input: {
  paneId: string;
  terminalId: string;
  runId?: string;
  project?: Pick<Group, "id" | "name" | "projectRoot"> | null;
  liveCwd?: string | null;
  spawnCwd?: string | null;
  liveGitRoot?: string | null;
  terminalStatus?: TerminalRuntimeStatus | null;
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  mainUserAsk?: TerminalMainUserAsk | null;
  statusSummary?: WorkstreamStatusSummary | null;
  summary?: WorkstreamStatusSummary | null;
  neutralTitle?: string | null;
  trustedActivitySummary?: boolean;
  contextPurposeTitle?: string | null;
  contextPurposeSource?: TerminalPurposeSource | null;
  workstreamTitle?: string | null;
  activelyWorking?: boolean;
  updatedAt?: number;
  version?: number;
  // TC-060: the always-true line from the vendor's own session record / process.
  taskLine?: PaneTaskLine | null;
}): TerminalHeaderState {
  const effectiveLiveCwd =
    input.liveCwd ?? input.spawnCwd ?? input.project?.projectRoot;
  const effectiveSummary = input.statusSummary?.tasksFromTodoWrite
    ? undefined
    : input.summary;
  // TC-060 R1: a pane that has not polled yet — or one only ever drawn in the
  // sidebar, never mounted — still gets a true line. The last rung needs no I/O,
  // so nothing can fall through to "Task not captured".
  // Everything this caller ALREADY knows has to be offered to the ladder. Passing only
  // the folder guaranteed the last rung, which is how a pane whose own task list was
  // visible on screen still rendered "Sitting at a command prompt in hermes"
  // (live report 2026-07-25). Filler is only ever legitimate when nothing is known.
  // Deliberately narrow: the in-progress todo and the status summary have their OWN
  // paths through the view model, and feeding them here stole their provenance. Only
  // the two facts nothing else offers the ladder are passed — the last FINISHED step,
  // and the operator's ask for THIS run (an ask from a previous run is not the plan).
  const lastCompletedLineupItem = [...(input.taskLineup ?? [])]
    .reverse()
    .find((item) => item.status === "completed");
  const currentRunId = input.activeRunId ?? input.runId;
  const askIsForThisRun =
    !input.mainUserAsk?.runId ||
    !currentRunId ||
    input.mainUserAsk.runId === currentRunId;
  // A STORED line that is itself the folder template must not outrank what this caller
  // knows. `Terminal.tsx` re-stores the resolver's line on every poll, so a template
  // computed from a thin status file was permanently winning here — the enrichment
  // below could never run. Treat that one source as "nothing known" and re-resolve.
  const storedTaskLine =
    input.taskLine?.source === "shell-state" ? null : input.taskLine;
  // The in-progress item is normally the summary path's to own (`tasksFromTodoWrite`),
  // and feeding it here stole that provenance — two tests catch it. But when the summary
  // CANNOT use it, withholding it just loses the task: 26 panes whose list named their
  // work still rendered "No task declared" on first draw (live report 2026-07-26). So it
  // is offered only in exactly that case.
  // Offered unconditionally. The earlier guard withheld it whenever the summary CLAIMED
  // the list (`tasksFromTodoWrite`), but claiming is not producing: 6 panes whose only
  // item named their work still rendered "No task declared" because the summary then
  // yielded no task row either. Provenance is safe without the guard — the view model
  // takes the summary's description FIRST and only falls back to this line.
  const activeLineupItem = (input.taskLineup ?? []).find(
    (item) => item.status === "in_progress",
  );
  const effectiveTaskLine =
    storedTaskLine ??
    resolvePaneTaskLine({
      now: Date.now(),
      currentStep: activeLineupItem?.content ?? null,
      lastCompletedTask: lastCompletedLineupItem?.content ?? null,
      facts:
        input.mainUserAsk?.text && askIsForThisRun
          ? { operatorRequest: input.mainUserAsk.text }
          : null,
      folder: effectiveLiveCwd?.split("/").filter(Boolean).pop() ?? null,
      busy:
        input.terminalStatus === "running" || input.activelyWorking === true,
    });
  const view = buildShellTerminalHeaderViewModel({
    project: input.project,
    liveCwd: effectiveLiveCwd,
    liveGitRoot: input.liveGitRoot,
    terminalStatus: input.terminalStatus,
    taskLineup: input.taskLineup,
    activeRunId: input.activeRunId ?? input.runId,
    mainUserAsk: input.mainUserAsk,
    statusSummary: input.statusSummary,
    summary: effectiveSummary,
    neutralTitle: input.neutralTitle,
    trustedActivitySummary: input.trustedActivitySummary,
    contextPurposeTitle: input.contextPurposeTitle,
    contextPurposeSource: input.contextPurposeSource,
    workstreamTitle: input.workstreamTitle,
    activelyWorking: input.activelyWorking,
    taskLine: effectiveTaskLine,
  });
  const goalSource = goalSourceFrom(
    view.taskDescription.source,
    input.mainUserAsk,
  );
  const goalLabel = view.taskDescription.text;
  // TC-060: the fallback line always fills the Task row, but it is NOT a declared
  // goal — the activity line must keep treating those panes as goal-less, or a
  // visibly busy terminal stops saying so.
  const hasCapturedGoal =
    goalSource !== "none" &&
    goalSource !== "missing" &&
    goalSource !== "task-line";
  const headerStatus = statusFromSummary(
    input.summary ?? input.statusSummary,
    input.terminalStatus,
  );
  // Badge from the agent's reported status ONLY (pure event state — no clock, no
  // scrollback). Views render paneBadgeAttention(terminal) from the store; this field
  // mirrors the same computation for consumers of the header state.
  const reconcileSummary = input.summary ?? input.statusSummary;
  const attention = reconcileSessionStatus({
    summaryStatus: reconcileSummary?.status,
  }).attention;
  const currentActivity =
    hasCapturedGoal &&
    headerStatus === "working" &&
    /^(?:Working|Thinking|Running terminal command|Command is running)$/i.test(
      view.title.text,
    )
      ? "Activity not captured"
      : view.title.text;
  const activitySource =
    currentActivity === "Activity not captured"
      ? "missing"
      : currentActivity === view.title.text
        ? activitySourceFrom(view.title.source, input.trustedActivitySummary)
        : "missing";

  return {
    paneId: input.paneId,
    terminalId: input.terminalId,
    runId: input.runId ?? input.activeRunId,
    workspace: view.workspace.text,
    userGoal: hasCapturedGoal ? goalLabel : null,
    goalLabel,
    currentActivity,
    fullPath: view.path.text,
    status: headerStatus,
    attention,
    sources: {
      workspace: "workspace",
      goal: goalSource,
      activity: activitySource,
      path: pathSource(input),
    },
    version: input.version ?? 1,
    updatedAt: input.updatedAt ?? Date.now(),
    debug: view.debug,
  };
}
