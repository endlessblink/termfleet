import type { MasterPlanTaskStatus } from "./types";

export interface MasterPlanTask {
  id: string;
  title: string;
  status: MasterPlanTaskStatus;
  rawStatus: string;
}

export function masterPlanPath(projectRoot: string) {
  return `${projectRoot.replace(/\/+$/, "")}/MASTER_PLAN.md`;
}

function normalizeStatus(raw: string | undefined): MasterPlanTaskStatus {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("done")) return "done";
  if (value.includes("block")) return "blocked";
  if (value.includes("progress") || value.includes("doing")) return "in-progress";
  if (value.includes("todo") || value.includes("backlog")) return "todo";
  return "unknown";
}

function cleanTitle(value: string) {
  return value
    .replace(/\s+`[^`]+`\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseMasterPlanTasks(contents: string): MasterPlanTask[] {
  const byId = new Map<string, MasterPlanTask>();

  for (const line of contents.split(/\r?\n/)) {
    const tableMatch = line.match(/^\|\s*([A-Za-z]+-\d+)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*([^|]+?)\s*\|/);
    if (tableMatch) {
      const [, id, rawStatus, title] = tableMatch;
      if (id.toLowerCase() === "id") continue;
      byId.set(id, {
        id,
        title: cleanTitle(title),
        status: normalizeStatus(rawStatus),
        rawStatus: rawStatus.trim(),
      });
      continue;
    }

    const headingMatch = line.match(/^#{2,6}\s+([A-Za-z]+-\d+)\s+-\s+(.+?)(?:\s+`([^`]+)`)?\s*$/);
    if (!headingMatch) continue;
    const [, id, rawTitle, rawStatus] = headingMatch;
    byId.set(id, {
      id,
      title: cleanTitle(rawTitle),
      status: normalizeStatus(rawStatus),
      rawStatus: rawStatus?.trim() ?? "Unknown",
    });
  }

  return [...byId.values()];
}

export function taskStatusLabel(status: MasterPlanTaskStatus) {
  if (status === "in-progress") return "In progress";
  return status[0].toUpperCase() + status.slice(1);
}

export function taskStatusColor(status: MasterPlanTaskStatus) {
  if (status === "done") return "var(--accent-live)";
  if (status === "in-progress") return "#7dbac3";
  if (status === "blocked") return "var(--accent-danger)";
  if (status === "todo") return "var(--text-secondary)";
  return "var(--border-strong)";
}
