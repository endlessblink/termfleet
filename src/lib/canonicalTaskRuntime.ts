export type TaskRunState = "registered" | "starting" | "running" | "waiting" | "failed" | "stopped" | "finished";
export type TaskRunHealth = "missing" | "running-and-progressing" | "running-but-idle" | "waiting-for-input" | "stale-heartbeat" | "failed" | "cancelled" | "completed" | "orphaned";

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
}

export const TASK_RUN_REGISTRY_KEY = "termfleet.canonical-task-runs.v1";
export const RUN_HEARTBEAT_TIMEOUT_MS = 30_000;
export const RUN_ACTIVITY_TIMEOUT_MS = 90_000;

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readTaskRunRegistry(): TaskRunRecord[] {
  try {
    const raw = storage()?.getItem(TASK_RUN_REGISTRY_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is TaskRunRecord => Boolean(item && typeof item === "object" && "runId" in item && "taskId" in item)) : [];
  } catch {
    return [];
  }
}

export function writeTaskRunRegistry(runs: TaskRunRecord[]): void {
  storage()?.setItem(TASK_RUN_REGISTRY_KEY, JSON.stringify(runs.slice(-100)));
}

export function classifyTaskRun(run: TaskRunRecord | undefined, now = Date.now()): TaskRunHealth {
  if (!run) return "missing";
  if (run.state === "failed") return "failed";
  if (run.state === "stopped") return "cancelled";
  if (run.state === "finished") return "completed";
  if (now - run.heartbeatAt > RUN_HEARTBEAT_TIMEOUT_MS) return run.terminalPaneId ? "stale-heartbeat" : "orphaned";
  if (run.state === "waiting") return "waiting-for-input";
  return run.activityAt && now - run.activityAt <= RUN_ACTIVITY_TIMEOUT_MS ? "running-and-progressing" : "running-but-idle";
}

export function taskRunLabel(health: TaskRunHealth): string {
  return {
    missing: "No linked run",
    "running-and-progressing": "Running · progressing",
    "running-but-idle": "Running · idle",
    "waiting-for-input": "Running · waiting for input",
    "stale-heartbeat": "Stale heartbeat",
    failed: "Failed",
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
