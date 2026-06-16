import type { AgentProvider, WorkstreamMetadata, WorkstreamStatus, WorkstreamStatusSummary } from "./types";
import { workstreamActivityText } from "./workstreamActivity";
import { formatWorkstreamIsolation, pathLabel } from "./workstreamOpsContext";

export type AgentStatusLifecycle = WorkstreamStatusSummary["status"];
export type AgentStatusConfidence = "low" | "medium" | "high";

export type AgentStatusSummary = WorkstreamStatusSummary & {
  provider: AgentProvider;
  confidence: AgentStatusConfidence;
};

export interface AgentStatusSummaryInput {
  mission?: string;
  prompt?: string;
  provider?: AgentProvider;
  status?: WorkstreamStatus;
  phase?: WorkstreamMetadata["phase"];
  cwd?: string;
  cwdLabel?: string;
  gitRoot?: string;
  gitBranch?: string;
  worktreePath?: string;
  isolationMode?: WorkstreamMetadata["isolationMode"];
  isolationStatus?: WorkstreamMetadata["isolationStatus"];
  currentActivity?: string;
  lastSummary?: string;
  nextAction?: string;
  terminalOutput?: string;
  events?: Array<{
    kind?: string;
    label?: string;
    detail?: string;
    status?: string;
  }>;
  evidence?: string;
  risk?: string;
}

const NOISY_ACTIVITY_PATTERNS = [
  /^\/clear$/i,
  /^hi[!.]?$/i,
  /^hello[!.]?$/i,
  /^web\$ /i,
  /^bash[$#]?\s*/i,
  /^codex: command is not available/i,
  /^claude: command is not available/i,
  /^opencode: command is not available/i,
  /command is not available in browser preview/i,
  /^provider (acknowledged cancellation|process exited)/i,
];

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function isNoisyActivity(value?: string | null) {
  const text = cleanText(value);
  if (!text) return true;
  return NOISY_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeLifecycle(input: Pick<AgentStatusSummaryInput, "status" | "phase">): AgentStatusLifecycle {
  if (input.status === "done" || input.phase === "complete" || input.phase === "reviewed") return "done";
  if (input.status === "failed" || input.phase === "blocked") return "blocked";
  if (input.status === "waiting" || input.phase === "needs-input") return "waiting";
  if (input.status === "stopped" || input.phase === "interrupted") return "stopped";
  if (input.status === "running" || input.phase === "active" || input.phase === "launching" || input.phase === "queued") return "working";
  return "idle";
}

function pathFromInput(input: AgentStatusSummaryInput) {
  const root = cleanText(input.worktreePath) ?? cleanText(input.gitRoot) ?? cleanText(input.cwd);
  const label = cleanText(input.cwdLabel) ?? pathLabel(root);
  const branch = cleanText(input.gitBranch);
  if (label && branch) return `${label} · ${branch}`;
  return label ?? "workspace path unknown";
}

function fallbackNow(input: AgentStatusSummaryInput, task: string, status: AgentStatusLifecycle) {
  const activity = cleanText(input.currentActivity);
  if (activity && !isNoisyActivity(activity)) return activity;

  const next = cleanText(input.nextAction);
  if (next && !isNoisyActivity(next)) return next;

  const summary = cleanText(input.lastSummary);
  if (summary && !isNoisyActivity(summary)) return summary;

  if (status === "blocked") return "Needs operator attention";
  if (status === "done") return "Ready for review";
  if (status === "waiting") return "Waiting for input";
  if (status === "stopped") return "Stopped by operator";
  if (status === "idle") return "Idle until the next prompt";
  return `Working on ${task}`;
}

export function fallbackAgentStatusSummary(input: AgentStatusSummaryInput): AgentStatusSummary {
  const task =
    cleanText(input.mission) ??
    cleanText(input.prompt) ??
    "Supervised agent run";
  const status = normalizeLifecycle(input);
  return {
    task,
    path: pathFromInput(input),
    now: fallbackNow(input, task, status),
    status,
    provider: input.provider ?? "codex",
    confidence: cleanText(input.currentActivity) && !isNoisyActivity(input.currentActivity) ? "medium" : "low",
    proof: cleanText(input.evidence),
    blocker: status === "blocked" ? cleanText(input.risk) ?? cleanText(input.lastSummary) : undefined,
  };
}

export function agentStatusSummaryInputFromWorkstream(workstream: WorkstreamMetadata): AgentStatusSummaryInput {
  return {
    mission: workstream.mission,
    prompt: workstream.prompt,
    provider: workstream.provider,
    status: workstream.status,
    phase: workstream.phase,
    cwd: workstream.cwd,
    cwdLabel: workstream.cwdLabel,
    gitRoot: workstream.gitRoot,
    gitBranch: workstream.gitBranch,
    worktreePath: workstream.worktreePath,
    isolationMode: workstream.isolationMode,
    isolationStatus: workstream.isolationStatus,
    currentActivity: workstreamActivityText(workstream, ""),
    lastSummary: workstream.lastSummary,
    nextAction: workstream.nextAction,
    terminalOutput: workstream.terminalOutput,
    events: (workstream.events ?? []).slice(-8).map((event) => ({
      kind: event.kind,
      label: event.label,
      detail: event.detail,
      status: event.status,
    })),
    evidence: workstream.evidence,
    risk: workstream.risk,
  };
}

export function parseAgentStatusSummaryResponse(raw: string, fallback: AgentStatusSummary): AgentStatusSummary {
  try {
    const parsed = JSON.parse(raw) as Partial<AgentStatusSummary>;
    const task = cleanText(parsed.task);
    const path = cleanText(parsed.path);
    const now = cleanText(parsed.now);
    if (!task || !path || !now) return fallback;
    return {
      ...fallback,
      ...parsed,
      task,
      path,
      now: isNoisyActivity(now) ? fallback.now : now,
      status: parsed.status ?? fallback.status,
      provider: parsed.provider ?? fallback.provider,
      confidence: parsed.confidence ?? "medium",
    };
  } catch {
    return fallback;
  }
}

function persistedAgentStatusSummary(workstream: WorkstreamMetadata, fallback: AgentStatusSummary): AgentStatusSummary | null {
  const persisted = workstream.statusSummary;
  if (!persisted) return null;
  const task = cleanText(persisted?.task);
  const path = cleanText(persisted?.path);
  const now = cleanText(persisted?.now);
  if (!task || !path || !now) return null;
  return {
    ...fallback,
    ...persisted,
    task,
    path,
    now: isNoisyActivity(now) ? fallback.now : now,
    status: persisted.status ?? fallback.status,
    provider: persisted.provider ?? fallback.provider,
    confidence: persisted.confidence ?? fallback.confidence,
  };
}

export function agentStatusSummaryFromWorkstream(workstream?: WorkstreamMetadata): AgentStatusSummary | null {
  if (!workstream || workstream.kind !== "agent") return null;
  const fallback = fallbackAgentStatusSummary(agentStatusSummaryInputFromWorkstream(workstream));
  return persistedAgentStatusSummary(workstream, fallback) ?? fallback;
}

export function agentStatusChipText(workstream: WorkstreamMetadata, summary: AgentStatusSummary) {
  return [
    summary.provider,
    summary.status,
    summary.proof ? "has proof" : summary.blocker ? "blocked" : formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus),
  ].join(" · ");
}
