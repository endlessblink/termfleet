import type { MasterPlanTaskStatus } from "./types";

export interface MasterPlanTask {
  id: string;
  title: string;
  status: MasterPlanTaskStatus;
  rawStatus: string;
  checklist?: MasterPlanTaskChecklistItem[];
}

export interface MasterPlanTaskChecklistItem {
  id: string;
  text: string;
  status: MasterPlanTaskStatus;
  rawStatus: string;
}

export interface MasterPlanTaskCacheEntry {
  contents: string;
  tasks: MasterPlanTask[];
}

export function cachedMasterPlanTasks(
  previous: MasterPlanTaskCacheEntry | undefined,
  contents: string,
): MasterPlanTaskCacheEntry {
  if (previous?.contents === contents) return previous;
  return { contents, tasks: parseMasterPlanTasks(contents) };
}

export function masterPlanTaskMapsEqual(
  previous: Record<string, MasterPlanTask[]>,
  next: Record<string, MasterPlanTask[]>,
) {
  const previousRoots = Object.keys(previous);
  const nextRoots = Object.keys(next);
  if (previousRoots.length !== nextRoots.length) return false;
  for (const root of previousRoots) {
    if (!(root in next)) return false;
    if (JSON.stringify(previous[root]) !== JSON.stringify(next[root])) return false;
  }
  return true;
}

export function masterPlanPath(projectRoot: string) {
  return `${projectRoot.replace(/\/+$/, "")}/MASTER_PLAN.md`;
}

function normalizeStatus(raw: string | undefined): MasterPlanTaskStatus {
  const value = (raw ?? "").toLowerCase();
  if (/(^|[^a-z])done([^a-z]|$)/.test(value)) return "done";
  if (/(^|[^a-z])(blocked?|blocking)([^a-z]|$)/.test(value)) return "blocked";
  if (/(^|[^a-z])(in[_ -]?progress|progress|doing)([^a-z]|$)/.test(value)) return "in-progress";
  if (/(^|[^a-z])(todo|backlog)([^a-z]|$)/.test(value)) return "todo";
  return "unknown";
}

function cleanTitle(value: string) {
  return value
    .replace(/\s+`[^`]+`\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanTaskId(value: string) {
  return value.replace(/^~~|~~$/g, "").trim();
}

function cleanChecklistText(value: string) {
  return cleanTitle(value.replace(/^(done|todo|blocked?|in[_ -]?progress|progress|doing)\s*:\s*/i, ""));
}

export function parseMasterPlanTasks(contents: string): MasterPlanTask[] {
  const byId = new Map<string, MasterPlanTask>();
  let tableHeader: string[] = [];
  let currentTaskId: string | null = null;
  let inAcceptance = false;
  let currentChecklistItem: MasterPlanTaskChecklistItem | null = null;

  function appendChecklistContinuation(line: string) {
    if (!currentTaskId || !currentChecklistItem || !inAcceptance) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    currentChecklistItem.text = cleanTitle(`${currentChecklistItem.text} ${trimmed}`);
  }

  function pushChecklistItem(raw: string) {
    if (!currentTaskId) return;
    const task = byId.get(currentTaskId);
    if (!task) return;
    const rawStatus = raw.match(/^(done|todo|blocked?|in[_ -]?progress|progress|doing)\s*:/i)?.[1] ?? "Unknown";
    const item: MasterPlanTaskChecklistItem = {
      id: `${currentTaskId}-${(task.checklist?.length ?? 0) + 1}`,
      text: cleanChecklistText(raw),
      status: normalizeStatus(rawStatus),
      rawStatus,
    };
    task.checklist = [...(task.checklist ?? []), item];
    currentChecklistItem = item;
  }

  for (const line of contents.split(/\r?\n/)) {
    const headingMatch = line.match(/^#{2,6}\s+([A-Za-z]+-\d+)\s*[-:]\s+(.+?)(?:\s+`([^`]+)`)?\s*$/);
    if (headingMatch) {
      const [, id, rawTitle, rawStatus] = headingMatch;
      currentTaskId = id;
      inAcceptance = false;
      currentChecklistItem = null;
      const existing = byId.get(id);
      byId.set(id, {
        id,
        title: cleanTitle(rawTitle),
        status: normalizeStatus(rawStatus ?? existing?.rawStatus),
        rawStatus: rawStatus?.trim() ?? existing?.rawStatus ?? "Unknown",
        ...(existing?.checklist ? { checklist: existing.checklist } : {}),
      });
      continue;
    }

    if (currentTaskId && /^Acceptance:\s*$/i.test(line.trim())) {
      inAcceptance = true;
      currentChecklistItem = null;
      continue;
    }

    if (currentTaskId && inAcceptance && /^#{2,6}\s+/.test(line)) {
      inAcceptance = false;
      currentChecklistItem = null;
    }

    const acceptanceBullet = currentTaskId && inAcceptance ? line.match(/^\s*-\s+(.+)$/) : null;
    if (acceptanceBullet) {
      pushChecklistItem(acceptanceBullet[1]);
      continue;
    }

    if (currentTaskId && inAcceptance && currentChecklistItem && /^\s{2,}\S/.test(line)) {
      appendChecklistContinuation(line);
      continue;
    }

    const tableCells = line.startsWith("|")
      ? line.split("|").slice(1, -1).map((cell) => cell.trim())
      : [];
    const normalizedHeader = tableCells.map((cell) => cell.toLowerCase());
    if (
      normalizedHeader.includes("id") &&
      normalizedHeader.includes("title") &&
      normalizedHeader.includes("status")
    ) {
      tableHeader = normalizedHeader;
      continue;
    }

    const tableId = tableCells[0] ? cleanTaskId(tableCells[0]) : "";
    const tableMatch = tableId.match(/^[A-Za-z]+-\d+[a-z]?$/i);
    if (tableMatch) {
      const statusColumnIndex = tableHeader.indexOf("status");
      const titleColumnIndex = tableHeader.indexOf("title");
      const statusIndex = statusColumnIndex >= 0
        ? statusColumnIndex
        : tableCells.findIndex((cell, index) => index > 0 && normalizeStatus(cell) !== "unknown");
      const rawStatus = statusIndex >= 0 ? tableCells[statusIndex] : "Unknown";
      const titleIndex = titleColumnIndex >= 0 ? titleColumnIndex : statusIndex === 1 ? 2 : 1;
      const title = tableCells[titleIndex] ?? tableId;
      byId.set(tableId, {
        id: tableId,
        title: cleanTitle(title),
        status: normalizeStatus(rawStatus),
        rawStatus: rawStatus.trim(),
        ...(byId.get(tableId)?.checklist ? { checklist: byId.get(tableId)?.checklist } : {}),
      });
      continue;
    }
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
