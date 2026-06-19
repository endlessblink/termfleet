import type {
  TaskLineupItem,
  TaskLineupPriority,
  TaskLineupSource,
  TaskLineupStatus,
  WorkstreamExtractedItem,
} from "./types";

const MAX_TASK_TEXT = 120;
const STATUS_ORDER: Record<TaskLineupStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function cleanTaskLineupContent(value?: string | null) {
  const cleaned = value
    ?.replace(/\s+/g, " ")
    .replace(/^[•*-]\s+/, "")
    .replace(/^(?:\d+[.)]|[-*])\s+/, "")
    .replace(/^(?:\[(?:x|done|complete|completed)\]|[✓✔])\s*/i, "")
    .replace(/\B@filename\b/gi, "the selected file")
    .replace(/^(?:i(?:'|’)m\s+going\s+to|i\s+will|we\s+need\s+to|need\s+to|working\s+on|task|todo|next)\s*:?\s*/i, "")
    .replace(/^(?:done|complete|completed|pending|todo|in[-_ ]?progress|blocked|cancelled|canceled)\s*:\s*/i, "")
    .replace(/\.$/, "")
    .trim();
  if (!cleaned) return undefined;
  if (/^(explored|search|read|ran|verified|working|output|path|signal|now)$/i.test(cleaned)) return undefined;
  if (/^(explored|read|ran|searched)\b/i.test(cleaned)) return undefined;
  if (/\b[A-Za-z][\w.]*\|[A-Za-z][\w.]*\b/.test(cleaned)) return undefined;
  // Runner / verify / build OUTCOMES are status reports, not tasks. Anchored so a
  // real task that merely mentions build/test (e.g. "Fix the frontend build",
  // "Fix 3 failed tests") is kept — only report-shaped lines are dropped.
  if (/^\d+\s+(?:passed|failed)\b/i.test(cleaned)) return undefined;
  if (/^running\s+\d+\s+tests?\b/i.test(cleaned)) return undefined;
  if (/(?:checks?|build|tests?|suite|lint|typecheck)\s+(?:passed|failed)\s*$/i.test(cleaned)) return undefined;
  // Agent/shell prompt chrome is not a task.
  if (/\b(?:esc to interrupt|context left|tab to queue message)\b/i.test(cleaned)) return undefined;
  if (/\b(?:gpt|claude|opus|codex)[-\w.]*\s+default\b/i.test(cleaned)) return undefined;
  return cleaned.slice(0, MAX_TASK_TEXT);
}

export function taskLineupSourceLabel(source: TaskLineupSource) {
  if (source === "todo-write") return "task list";
  if (source === "structured-signal") return "structured signal";
  if (source === "summary") return "summary";
  if (source === "lane-checklist") return "plan checklist";
  return "manual task";
}

export function taskLineupNextLabel(item: Pick<TaskLineupItem, "status" | "priority">) {
  if (item.status === "completed") return "Completed";
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "in_progress") return "Current focus";
  return item.priority ? `Queued after current · ${item.priority} priority` : "Queued after current";
}

function inferStatus(raw: string, fallback: TaskLineupStatus): TaskLineupStatus {
  const text = raw.replace(/\s+/g, " ").trim();
  const unlisted = text.replace(/^(?:\d+[.)]|[-*])\s+/, "");
  if (/^(?:\[(?:x|done|complete|completed)\]|[✓✔])\s*/i.test(unlisted)) return "completed";
  if (/^(?:done|complete|completed)\b\s*[:\-–—]?/i.test(unlisted)) return "completed";
  if (/^(?:cancelled|canceled)\b\s*[:\-–—]?/i.test(unlisted)) return "cancelled";
  if (/^(?:in[-_ ]?progress|working)\b\s*[:\-–—]?/i.test(unlisted)) return "in_progress";
  return fallback;
}

export function normalizeTaskLineupItems(
  items: Array<Partial<TaskLineupItem> & { text?: string }>,
  source: TaskLineupSource,
  updatedAt = Date.now(),
  runId?: string,
): TaskLineupItem[] {
  const seen = new Set<string>();
  let activeSeen = false;
  return items
    .map((item, index) => {
      const raw = item.content ?? item.text ?? "";
      const content = cleanTaskLineupContent(raw);
      if (!content) return null;
      const inferred = inferStatus(raw, item.status ?? (index === 0 ? "in_progress" : "pending"));
      const status = inferred === "in_progress" && activeSeen ? "pending" : inferred;
      if (status === "in_progress") activeSeen = true;
      const id = item.id?.trim() || `${source}:${hashText(content)}`;
      const priority = item.priority && ["high", "medium", "low"].includes(item.priority)
        ? item.priority as TaskLineupPriority
        : undefined;
      const key = `${id}:${content}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id,
        ...(item.runId ?? runId ? { runId: item.runId ?? runId } : {}),
        content,
        status,
        ...(priority ? { priority } : {}),
        source,
        updatedAt: item.updatedAt ?? updatedAt,
      };
    })
    .filter((item): item is TaskLineupItem => Boolean(item))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.updatedAt - b.updatedAt);
}

export function taskLineupFromExtractedItems(
  items: WorkstreamExtractedItem[] | undefined,
  source: TaskLineupSource,
  fallbackStatus: TaskLineupStatus = "pending",
  updatedAt = Date.now(),
  runId?: string,
) {
  return normalizeTaskLineupItems((items ?? []).map((item) => ({
    id: item.id,
    content: item.text,
    status: inferStatus(item.text, fallbackStatus),
    updatedAt: item.at > 0 ? item.at : updatedAt,
  })), source, updatedAt, runId);
}

export function taskLineupStats(items: TaskLineupItem[]) {
  const open = items.filter((item) => item.status === "pending" || item.status === "in_progress").length;
  const done = items.filter((item) => item.status === "completed").length;
  const blocked = items.filter((item) => item.status === "cancelled").length;
  return {
    total: items.length,
    open,
    done,
    blocked,
  };
}

export function completeOpenTaskLineup(items: TaskLineupItem[] | undefined, updatedAt = Date.now()) {
  return (items ?? []).map((item) =>
    item.status === "pending" || item.status === "in_progress"
      ? { ...item, status: "completed" as const, updatedAt }
      : item
  );
}

export function completeOpenTaskLineupForRun(items: TaskLineupItem[] | undefined, runId: string | undefined, updatedAt = Date.now()) {
  if (!runId) return completeOpenTaskLineup(items, updatedAt);
  const hasMatchingRun = (items ?? []).some((item) => item.runId === runId);
  const fallbackRunId = !hasMatchingRun ? latestTaskLineupRunId(items) : undefined;
  return (items ?? []).map((item) =>
    (item.runId === runId || item.runId === fallbackRunId) && (item.status === "pending" || item.status === "in_progress")
      ? { ...item, status: "completed" as const, updatedAt }
      : item
  );
}

function latestTaskLineupRunId(items: TaskLineupItem[] | undefined) {
  return (items ?? [])
    .filter((item) => Boolean(item.runId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.runId;
}

/**
 * Merge a status-summary-derived (`operator`) lineup into the terminal's existing
 * lineup WITHOUT clobbering a live `todo-write` list. The sidebar/map renderers
 * display only `source === "todo-write"`, so letting the 650ms summary cycle replace
 * the lineup with `operator` items empties the visible TASKS panel (TC-033 T1).
 * Decision: TodoWrite wins — operator items populate the lineup only when no
 * `todo-write` items exist.
 */
export function mergeShellSummaryTaskLineup(
  existing: TaskLineupItem[] | undefined,
  extracted: TaskLineupItem[],
  options: { closesRun: boolean; runId: string | undefined; updatedAt?: number },
): TaskLineupItem[] {
  const existingItems = existing ?? [];
  // A populated todo-write list is the source-of-truth for the panel; never let a
  // summary cycle overwrite it. Its lifecycle (completion on run close) is owned by
  // the dedicated todo-write / structured-signal paths, not the summary path.
  if (existingItems.some((item) => item.source === "todo-write")) return existingItems;
  if (extracted.length === 0) return existingItems;
  return options.closesRun
    ? completeOpenTaskLineupForRun(extracted, options.runId, options.updatedAt)
    : extracted;
}

export function taskLineupForVisibleRun(items: TaskLineupItem[] | undefined, runId: string | undefined) {
  const allItems = items ?? [];
  if (!runId) return allItems;
  const scopedItems = allItems.filter((item) => item.runId === runId);
  const hasAnyScopedItems = allItems.some((item) => Boolean(item.runId));
  if (!hasAnyScopedItems || scopedItems.length > 0) return hasAnyScopedItems ? scopedItems : allItems;
  const fallbackRunId = latestTaskLineupRunId(allItems);
  return fallbackRunId ? allItems.filter((item) => item.runId === fallbackRunId) : [];
}

export function terminalOutputClosesTaskLineup(output: string | undefined) {
  if (!output) return false;
  return /(?:^|\n)\s*[-•]?\s*Worked for\s+\d+[^\n]*$/im.test(output) ||
    /(?:^|\n)\s*[-•]?\s*Goal achieved\b[^\n]*$/im.test(output) ||
    /(?:^|\n)\s*[-•]?\s*Task complete\b[^\n]*$/im.test(output);
}
