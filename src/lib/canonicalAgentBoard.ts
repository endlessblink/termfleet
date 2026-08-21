import { invoke } from "@tauri-apps/api/core";

export const CANONICAL_AGENT_OPS_SOURCE = "/media/endlessblink/data/my-projects/ai-development/devops/agent-ops/MASTER_PLAN.md";
export const CANONICAL_AGENT_OPS_MUTATION_BOUNDARY = "/media/endlessblink/data/my-projects/ai-development/devops/agent-ops/agent_ops.py";

export interface CanonicalAuthorityIdentity {
  source: string;
  mutationBoundary: string;
}

export function parseCanonicalAuthorityIdentity(payload: unknown): CanonicalAuthorityIdentity {
  if (!payload || typeof payload !== "object") throw new Error("Canonical authority returned an invalid response");
  const value = payload as { schemaVersion?: unknown; source?: unknown; mutationBoundary?: unknown };
  if (value.schemaVersion !== 1 || value.source !== CANONICAL_AGENT_OPS_SOURCE || value.mutationBoundary !== CANONICAL_AGENT_OPS_MUTATION_BOUNDARY) {
    throw new Error("Canonical authority identity does not match agent-ops");
  }
  return { source: value.source, mutationBoundary: value.mutationBoundary };
}

export const BOARD_STATUSES = [
  "TRIAGE",
  "PLANNED",
  "IN PROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE",
] as const;

export type CanonicalTaskStatus = (typeof BOARD_STATUSES)[number];
export type CanonicalTaskType = "TASK" | "BUG" | "FEATURE" | "INQUIRY" | "ISSUE";
export type CanonicalPriority = "P0" | "P1" | "P2" | "P3";

export interface CanonicalAcceptanceItem {
  text: string;
  complete: boolean;
}

export interface CanonicalProgressEntry {
  text: string;
  date?: string;
}

export interface CanonicalTask {
  id: string;
  type: CanonicalTaskType;
  title: string;
  status: CanonicalTaskStatus;
  priority: CanonicalPriority;
  owner: string;
  source: string;
  workspace: string;
  dependencies: string[];
  description: string;
  acceptance: CanonicalAcceptanceItem[];
  progress: CanonicalProgressEntry[];
  updatedAt?: string;
  completionEvidence?: string;
}

export function taskProjectLabel(task: Pick<CanonicalTask, "workspace">): string {
  const segments = task.workspace.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || "No project linked";
}

export function taskDescriptionSummary(description: string): string {
  const hiddenMetadata = /^(?:\*\*)?(?:Priority|Status|Owner|Updated|Source|Workspace|Dependencies)(?:\*\*)?:/i;
  const summary = description
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, "").replace(/^#{1,6}\s+/, ""))
    .filter((line) => line && !hiddenMetadata.test(line))
    .join(" ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
  return summary || "No description yet";
}

export interface CanonicalTaskFilters {
  query?: string;
  status?: CanonicalTaskStatus;
  type?: CanonicalTaskType;
  priority?: CanonicalPriority;
  owner?: string;
  workspace?: string;
  showDone?: boolean;
}

export type CanonicalTaskGroups = Record<CanonicalTaskStatus, CanonicalTask[]>;

export function emptyTaskGroups(): CanonicalTaskGroups {
  return BOARD_STATUSES.reduce((groups, status) => {
    groups[status] = [];
    return groups;
  }, {} as CanonicalTaskGroups);
}

export function groupCanonicalTasks(tasks: CanonicalTask[]): CanonicalTaskGroups {
  const grouped = emptyTaskGroups();
  for (const task of tasks) grouped[task.status].push(task);
  return grouped;
}

export function filterCanonicalTasks(tasks: CanonicalTask[], filters: CanonicalTaskFilters) {
  const query = filters.query?.trim().toLowerCase();
  return tasks.filter((task) => {
    if (!filters.showDone && task.status === "DONE") return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.type && task.type !== filters.type) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.owner && task.owner !== filters.owner) return false;
    if (filters.workspace && task.workspace !== filters.workspace) return false;
    if (query && !`${task.id} ${task.title} ${task.description} ${task.owner} ${task.workspace}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function parseCanonicalTasks(payload: unknown): CanonicalTask[] {
  if (!payload || typeof payload !== "object") throw new Error("Canonical queue returned an invalid response");
  const value = payload as { schemaVersion?: unknown; tasks?: unknown };
  if (value.schemaVersion !== 1 || !Array.isArray(value.tasks)) {
    throw new Error("Canonical queue returned an unsupported schema");
  }
  return value.tasks.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Canonical queue returned an invalid task");
    const task = raw as Partial<CanonicalTask>;
    if (!task.id || !task.title || !BOARD_STATUSES.includes(task.status as CanonicalTaskStatus)) {
      throw new Error("Canonical queue returned an incomplete task");
    }
    return {
      id: task.id,
      type: task.type ?? "TASK",
      title: task.title,
      status: task.status as CanonicalTaskStatus,
      priority: task.priority ?? "P3",
      owner: task.owner ?? "unassigned",
      source: task.source ?? "",
      workspace: task.workspace ?? "",
      dependencies: task.dependencies ?? [],
      description: task.description ?? "",
      acceptance: task.acceptance ?? [],
      progress: task.progress ?? [],
      updatedAt: task.updatedAt,
      completionEvidence: task.completionEvidence,
    };
  });
}

export async function readCanonicalTasks(includeDone = true) {
  await readCanonicalAuthority();
  const payload = await invoke<unknown>("agent_ops", { operation: "list", includeDone });
  return parseCanonicalTasks(payload);
}

export async function readCanonicalAuthority() {
  const payload = await invoke<unknown>("agent_ops", { operation: "authority" });
  return parseCanonicalAuthorityIdentity(payload);
}

export async function transitionCanonicalTask(taskId: string, status: CanonicalTaskStatus, agent: string) {
  const payload = await invoke<unknown>("agent_ops", { operation: "transition", taskId, status, agent });
  const task = (payload as { task?: unknown }).task;
  const tasks = parseCanonicalTasks({ schemaVersion: 1, tasks: [task] });
  return tasks[0];
}
