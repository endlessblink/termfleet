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
  if (terminalStatus === "running" || terminalStatus === "reconnected") return "working";
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
  /**
   * Positive, CURRENT evidence the pane is generating/running right now (a live agent
   * turn, a running command) — used only for the attention badge. Kept separate from
   * `activelyWorking` (which also feeds title fallbacks) so the badge can use a stricter,
   * less-stale signal without shifting title behavior. Falls back to `activelyWorking`.
   */
  activelyRunning?: boolean;
  /**
   * The on-screen turn-finished signal (Codex/OMC "Cooked for …" + rest prompt). When
   * true it forces the attention badge to Idle, overriding a stale hook status that is
   * still stuck on "working" after the turn ended.
   */
  terminalAtRest?: boolean;
  /** When the pane last produced output/changed (ms epoch) — drives the stale-working guard. */
  lastActivityAt?: number | null;
  /** Current time (ms epoch); pass Date.now() from the component. */
  nowMs?: number | null;
  updatedAt?: number;
  version?: number;
}): TerminalHeaderState {
  const effectiveLiveCwd = input.liveCwd ?? input.spawnCwd ?? input.project?.projectRoot;
  const effectiveSummary = input.statusSummary?.tasksFromTodoWrite ? undefined : input.summary;
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
  });
  const goalSource = goalSourceFrom(view.taskDescription.source, input.mainUserAsk);
  const goalLabel = view.taskDescription.text;
  const hasCapturedGoal = goalSource !== "none" && goalSource !== "missing";
  const headerStatus = statusFromSummary(input.summary ?? input.statusSummary, input.terminalStatus);
  // "running" needs positive evidence — but of the RIGHT kind. Trust the agent's own
  // hook status when it explicitly says "working" (the most reliable signal for an agent
  // mid-turn, even when its on-screen indicator scrolled off or rendered garbled). For
  // panes WITHOUT such a summary (a bare shell whose only "working" is an attached PTY),
  // fall back to the live on-screen indicator / running command, so an idle shell reads
  // Idle rather than busy.
  // SINGLE SOURCE OF TRUTH: every view derives its badge from this one reconciler so
  // they can never contradict each other. Priority fusion: on-screen done-marker >
  // explicit waiting > live generating marker > FRESH "working" hook > stale → idle.
  const attention = reconcileSessionStatus({
    summaryStatus: (input.summary ?? input.statusSummary)?.status,
    activelyRunning: input.activelyRunning ?? input.activelyWorking,
    atRest: input.terminalAtRest,
    lastActivityAt: input.lastActivityAt,
    now: input.nowMs,
  }).attention;
  const currentActivity =
    hasCapturedGoal &&
    headerStatus === "working" &&
    /^(?:Working|Thinking|Running terminal command|Command is running)$/i.test(view.title.text)
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
