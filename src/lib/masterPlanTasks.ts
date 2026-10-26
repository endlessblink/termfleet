import { AGENT_STATE_COLOR, taskStateOf } from "./agentState";
import type { MasterPlanTaskStatus } from "./types";

export interface MasterPlanTask {
  id: string;
  title: string;
  status: MasterPlanTaskStatus;
  rawStatus: string;
  checklist?: MasterPlanTaskChecklistItem[];
  /** P0–P3 when the plan states one (a Priority column or a "(P1, M)" title suffix). */
  priority?: string;
  /** Effort/size label such as "S", "M", "S–M" when the plan states one. */
  size?: string;
  /** The full original text when the title had to be shortened to a headline. */
  detail?: string;
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
  // "IN_PROGRESS (core shipped …)": the words before the note decide, the note only breaks a tie.
  const head = classifyStatus(value.split("(")[0]);
  return head === "unknown" ? classifyStatus(value) : head;
}

function classifyStatus(value: string): MasterPlanTaskStatus {
  if (/(^|[^a-z])(done|completed?|shipped|cancell?ed|superseded|wont[_ -]?fix|closed)([^a-z]|$)/.test(value)) return "done";
  if (/(^|[^a-z])(blocked?|blocking)([^a-z]|$)/.test(value)) return "blocked";
  if (/(^|[^a-z])(in[_ -]?progress|progress|doing|verifying|in[_ -]?review|review|testing|active)([^a-z]|$)/.test(value)) return "in-progress";
  if (/(^|[^a-z])(todo|to[_ -]do|backlog|pending|planned|open|not[_ -]started|proposed|next)([^a-z]|$)/.test(value)) return "todo";
  return "unknown";
}

const TITLE_COLUMNS = ["title", "task", "name", "summary", "description", "scope"];
const PRIORITY_COLUMNS = ["priority", "pri", "prio"];
const SIZE_COLUMNS = ["effort", "eff", "size", "estimate"];
const HEADLINE_MAX = 96;

function columnIndex(header: string[], names: string[]) {
  return header.findIndex((cell) => names.includes(cell));
}

function normalizePriority(raw: string | undefined) {
  const match = unwrapMarkdown(raw ?? "").match(/\bP([0-4])\b/i);
  return match ? `P${match[1]}` : undefined;
}

/** Pulls a trailing "(P1, M)" / "(P0, S–M)" note out of a title into fields. */
function splitTitleMeta(title: string) {
  const meta = title.match(/\s*\((P[0-4])(?:\s*,\s*([A-Z]{1,2}(?:\s*[–-]\s*[A-Z]{1,2})?))?\)\s*$/);
  if (!meta) return { title };
  return { title: title.slice(0, meta.index).trim(), priority: meta[1], size: meta[2]?.replace(/\s+/g, "") };
}

/** A plan "title" is sometimes a whole paragraph. Keep a readable headline and the full text as detail. */
function headline(text: string) {
  if (text.length <= HEADLINE_MAX) return { title: text };
  const plain = text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
  const breaks = [" — ", " – ", ": ", ". ", "; "]
    .map((mark) => plain.indexOf(mark))
    .filter((index) => index >= 12 && index <= HEADLINE_MAX);
  if (breaks.length) return { title: plain.slice(0, Math.min(...breaks)).replace(/[,.;:]$/, ""), detail: text };
  const cut = plain.lastIndexOf(" ", HEADLINE_MAX - 1);
  return { title: `${plain.slice(0, cut > 40 ? cut : HEADLINE_MAX - 1).replace(/[,.;:]$/, "")}…`, detail: text };
}

function describeTask(rawTitle: string, priority?: string, size?: string) {
  // Inline markdown (`code`, **bold**) reads as noise in a headline; keep the words.
  const meta = splitTitleMeta(cleanTitle(rawTitle).replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*\*/g, ""));
  const short = headline(meta.title);
  return {
    title: short.title,
    ...(short.detail ? { detail: short.detail } : {}),
    ...((priority ?? meta.priority) ? { priority: priority ?? meta.priority } : {}),
    ...((size ?? meta.size) ? { size: size ?? meta.size } : {}),
  };
}

function unwrapMarkdown(value: string) {
  let text = value.trim();
  let wrapped;
  while ((wrapped = text.match(/^(\*\*|__|~~|`)(.+)\1$/s))) text = wrapped[2].trim();
  return text;
}

function cleanTitle(value: string) {
  return unwrapMarkdown(value)
    .replace(/\s+`[^`]+`\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanTaskId(value: string) {
  return unwrapMarkdown(value);
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
        ...describeTask(rawTitle, existing?.priority, existing?.size),
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
    if (!tableCells.length) tableHeader = [];
    if (
      normalizedHeader.includes("id") &&
      TITLE_COLUMNS.some((name) => normalizedHeader.includes(name))
    ) {
      tableHeader = normalizedHeader;
      continue;
    }

    const tableId = tableCells[0] ? cleanTaskId(tableCells[0]) : "";
    const tableMatch = tableId.match(/^[A-Za-z]+-\d+[a-z]?$/i);
    if (tableMatch) {
      const statusColumnIndex = tableHeader.indexOf("status");
      const titleColumnIndex = columnIndex(tableHeader, TITLE_COLUMNS);
      const priorityColumnIndex = columnIndex(tableHeader, PRIORITY_COLUMNS);
      const sizeColumnIndex = columnIndex(tableHeader, SIZE_COLUMNS);
      const statusIndex = statusColumnIndex >= 0
        ? statusColumnIndex
        : tableCells.findIndex((cell, index) => index > 0 && normalizeStatus(cell) !== "unknown");
      const completedIndex = tableHeader.indexOf("completed");
      const rawStatus = completedIndex >= 0 && tableCells[completedIndex]
        ? "DONE" : (statusIndex >= 0 ? tableCells[statusIndex] : undefined) ?? "Unknown";
      // Headerless rows like "| TC-1 | P0 | M | TODO | text |": the title is the longest
      // cell that is not the id, the status, or a short priority/size label.
      const titleIndex = titleColumnIndex >= 0 ? titleColumnIndex : tableCells
        .map((cell, index) => ({ cell, index }))
        .filter(({ cell, index }) => index > 0 && index !== statusIndex && unwrapMarkdown(cell).length > 3)
        .sort((a, b) => b.cell.length - a.cell.length)[0]?.index ?? (statusIndex === 1 ? 2 : 1);
      const title = tableCells[titleIndex] ?? tableId;
      const priority = normalizePriority(priorityColumnIndex >= 0 ? tableCells[priorityColumnIndex]
        : tableCells.find((cell, index) => index > 0 && index !== titleIndex && /^\W*P[0-4]\W*$/i.test(cell)));
      const sizeCell = sizeColumnIndex >= 0 ? unwrapMarkdown(tableCells[sizeColumnIndex] ?? "") : "";
      const earlier = byId.get(tableId);
      byId.set(tableId, {
        id: tableId,
        ...(earlier?.priority ? { priority: earlier.priority } : {}),
        ...(earlier?.size ? { size: earlier.size } : {}),
        ...describeTask(title, priority, /^[A-Z]{1,2}(\s*[–-]\s*[A-Z]{1,2})?$/.test(sizeCell) ? sizeCell.replace(/\s+/g, "") : undefined),
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
  const state = taskStateOf(status);
  if (state === "idle") return "var(--text-secondary)";
  if (state) return AGENT_STATE_COLOR[state];
  return "var(--border-strong)";
}
