import type {
  Group,
  TaskLineupItem,
  TerminalMainUserAsk,
  TerminalRuntimeStatus,
  WorkstreamStatusSummary,
} from "./types";
import {
  buildShellTerminalHeaderViewModel,
  type HeaderFieldSource,
} from "./terminalHeaderViewModel";

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
  | "sidecar"
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
  if (fieldSource === "missing") return "missing";
  if (fieldSource !== "user-task") return "none";
  switch (mainUserAsk?.source) {
    case "terminal-prompt":
      return "user-prompt";
    case "status-sidecar":
      return "sidecar";
    case "manual":
      return "manual";
    case "workstream":
      return "workstream";
    case "task-tool":
      return "task-tool";
    default:
      return "sidecar";
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
  updatedAt?: number;
  version?: number;
}): TerminalHeaderState {
  const effectiveLiveCwd = input.liveCwd ?? input.spawnCwd ?? input.project?.projectRoot;
  const view = buildShellTerminalHeaderViewModel({
    project: input.project,
    liveCwd: effectiveLiveCwd,
    liveGitRoot: input.liveGitRoot,
    terminalStatus: input.terminalStatus,
    taskLineup: input.taskLineup,
    activeRunId: input.activeRunId ?? input.runId,
    mainUserAsk: input.mainUserAsk,
    statusSummary: input.statusSummary,
    summary: input.summary,
    neutralTitle: input.neutralTitle,
    trustedActivitySummary: input.trustedActivitySummary,
  });
  const goalSource = goalSourceFrom(view.taskDescription.source, input.mainUserAsk);
  const goalLabel = view.taskDescription.text;

  return {
    paneId: input.paneId,
    terminalId: input.terminalId,
    runId: input.runId ?? input.activeRunId,
    workspace: view.workspace.text,
    userGoal: goalSource === "none" || goalSource === "missing" ? null : goalLabel,
    goalLabel,
    currentActivity: view.title.text,
    fullPath: view.path.text,
    status: statusFromSummary(input.summary ?? input.statusSummary, input.terminalStatus),
    sources: {
      workspace: "workspace",
      goal: goalSource,
      activity: activitySourceFrom(view.title.source, input.trustedActivitySummary),
      path: pathSource(input),
    },
    version: input.version ?? 1,
    updatedAt: input.updatedAt ?? Date.now(),
    debug: view.debug,
  };
}
