export type TaskRunState = "registered" | "starting" | "running" | "waiting" | "failed" | "stopped" | "finished";
export type TaskRunHealth = "no-worker" | "claimed-not-running" | "running-and-progressing" | "running-but-idle" | "waiting-for-input" | "stale-heartbeat" | "disconnected" | "failed" | "failed-launch" | "cancelled" | "completed" | "orphaned";

export interface TaskRunRecord {
  runId: string;
  taskId: string;
  mode: "termfleet" | "external";
  agent: string;
  profile?: string;
  workspace?: string;
  runtimeSessionId?: string;
  terminalPaneId?: string;
  startedAt: number;
  heartbeatAt: number;
  activityAt?: number;
  phase?: string;
  action?: string;
  state: TaskRunState;
  logTail: string[];
  tests?: Array<{ name: string; outcome: "passed" | "failed" | "running" | "unknown"; at: number }>;
  stopRequestedAt?: number;
  finishedAt?: number;
  failureReason?: string;
  terminalLink?: string;
  disconnectedAt?: number;
}

export const TASK_RUN_REGISTRY_KEY = "termfleet.canonical-task-runs.v1";
export const RUN_HEARTBEAT_TIMEOUT_MS = 30_000;
export const RUN_ACTIVITY_TIMEOUT_MS = 90_000;
export const MAX_RUN_LOG_LINES = 32;
export const MAX_RUN_LOG_LINE_LENGTH = 400;

const SECRET_PATTERNS = [
  /(Bearer\s+)[^\s]+/gi,
  /(api[_-]?key\s*[=:]\s*)[^\s]+/gi,
  /(token\s*[=:]\s*)[^\s]+/gi,
  /(password\s*[=:]\s*)[^\s]+/gi,
  /(secret\s*[=:]\s*)[^\s]+/gi,
];

export function redactRunLogLine(line: string): string {
  let safe = String(line).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  for (const pattern of SECRET_PATTERNS) safe = safe.replace(pattern, "$1[REDACTED]");
  return safe.length > MAX_RUN_LOG_LINE_LENGTH ? `${safe.slice(0, MAX_RUN_LOG_LINE_LENGTH)}…` : safe;
}

export function boundedRunLog(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines.slice(-MAX_RUN_LOG_LINES).map((line) => redactRunLogLine(String(line)));
}

export function linkedTaskRun(runs: TaskRunRecord[], liveExecutionHandle?: string | null): TaskRunRecord | undefined {
  if (!liveExecutionHandle) return undefined;
  return runs.find((run) => run.runId === liveExecutionHandle);
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readTaskRunRegistry(): TaskRunRecord[] {
  try {
    const raw = storage()?.getItem(TASK_RUN_REGISTRY_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is TaskRunRecord => Boolean(item && typeof item === "object" && "runId" in item && "taskId" in item)).map((run) => ({ ...run, logTail: boundedRunLog(run.logTail) })) : [];
  } catch {
    return [];
  }
}

export function writeTaskRunRegistry(runs: TaskRunRecord[]): void {
  storage()?.setItem(TASK_RUN_REGISTRY_KEY, JSON.stringify(runs.slice(-100).map((run) => ({ ...run, logTail: boundedRunLog(run.logTail) }))));
}

export function classifyTaskRun(run: TaskRunRecord | undefined, now = Date.now(), linkedRunId?: string | null): TaskRunHealth {
  if (linkedRunId === undefined) return "no-worker";
  if (!linkedRunId) return "claimed-not-running";
  if (!run || run.runId !== linkedRunId) return "disconnected";
  if (run.state === "failed") return "failed";
  if (run.state === "starting" && run.heartbeatAt <= run.startedAt) return "failed-launch";
  if (run.state === "stopped") return "cancelled";
  if (run.state === "finished") return "completed";
  if (now - run.heartbeatAt > RUN_HEARTBEAT_TIMEOUT_MS) return run.terminalPaneId ? "stale-heartbeat" : "orphaned";
  if (run.state === "waiting") return "waiting-for-input";
  return run.activityAt && now - run.activityAt <= RUN_ACTIVITY_TIMEOUT_MS ? "running-and-progressing" : "running-but-idle";
}

export function taskRunLabel(health: TaskRunHealth): string {
  return {
    "no-worker": "No worker linked",
    "claimed-not-running": "Claimed · not running",
    "running-and-progressing": "Running · progressing",
    "running-but-idle": "Running · idle",
    "waiting-for-input": "Running · waiting for input",
    "stale-heartbeat": "Stale heartbeat",
    disconnected: "Disconnected",
    failed: "Failed",
    "failed-launch": "Failed to start",
    cancelled: "Cancelled",
    completed: "Completed",
    orphaned: "Orphaned run",
  }[health];
}

export function lifecycleProgress(status: string): { current: string; completed: string[]; next?: string; blocked: boolean } {
  const stages = ["TRIAGE", "PLANNED", "IN PROGRESS", "REVIEW", "DONE"];
  if (status === "BLOCKED") return { current: "BLOCKED", completed: [], next: "Resolve blocker", blocked: true };
  const index = Math.max(0, stages.indexOf(status));
  return { current: status, completed: stages.slice(0, index), next: stages[index + 1], blocked: false };
}

export function acceptanceProgress(items: Array<{ complete: boolean }>): { complete: number; total: number; label: string } {
  const complete = items.filter((item) => item.complete).length;
  return { complete, total: items.length, label: items.length ? `${complete} of ${items.length} acceptance items complete` : "Acceptance progress not recorded" };
}

export function requestTaskRunStop(taskId: string, now = Date.now()): TaskRunRecord | undefined {
  const runs = readTaskRunRegistry();
  const candidates = runs.filter((run) => run.taskId === taskId && !["finished", "failed", "stopped"].includes(run.state));
  const current = candidates[candidates.length - 1];
  if (!current) return undefined;
  // A request is not a process exit. Keep the run live until its real heartbeat
  // or provider exit confirms the outcome.
  const next = { ...current, stopRequestedAt: now };
  writeTaskRunRegistry(runs.map((run) => run.runId === current.runId ? next : run));
  return next;
}
