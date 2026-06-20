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

// Structural cleanup only: bullets, list markers, status/intent prefixes, trailing
// period. No noise rejection — used as-is for the authoritative `todo-write` list.
function structuralCleanTaskContent(value?: string | null) {
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
  return cleaned ? cleaned : undefined;
}

// Authoritative TodoWrite items: keep structural cleanup but SKIP the noise-rejection
// heuristics below. Those heuristics exist to filter junk scraped from terminal
// output; a real declared todo that merely starts with "Read"/"Explore"/"Search" (very
// common in Claude's lists) must NOT be dropped. (TC-033)
export function cleanTodoWriteContent(value?: string | null) {
  const cleaned = structuralCleanTaskContent(value);
  return cleaned ? cleaned.slice(0, MAX_TASK_TEXT) : undefined;
}

export function cleanTaskLineupContent(value?: string | null) {
  const cleaned = structuralCleanTaskContent(value);
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
  // A bare all-caps token (no spaces) is env-var / fragment noise (e.g. "TERM",
  // "PATH", "API"), not a task. Real tasks have spaces or lowercase.
  if (/^[A-Z0-9_.-]+$/.test(cleaned) && /[A-Z]/.test(cleaned)) return undefined;
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
      // The authoritative todo-write list bypasses the heuristic noise filter so
      // verb-first todos ("Read X", "Explore Y") survive; all other sources stay strict.
      const content = source === "todo-write" ? cleanTodoWriteContent(raw) : cleanTaskLineupContent(raw);
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
  // (lower-grade) `operator`/summary cycle overwrite it. EXCEPTION: a fresh
  // todo-write-sourced extraction is the agent's updated real list and MUST replace
  // the prior one — otherwise the panel freezes on the first list the agent wrote.
  const incomingIsTodoWrite = extracted.some((item) => item.source === "todo-write");
  if (existingItems.some((item) => item.source === "todo-write") && !incomingIsTodoWrite) return existingItems;
  if (extracted.length === 0) return existingItems;
  return options.closesRun
    ? completeOpenTaskLineupForRun(extracted, options.runId, options.updatedAt)
    : extracted;
}

/**
 * The task lineup the panel should render. Prefers an authoritative `todo-write`
 * list (the agent's real declared todos); when none exists, falls back to the
 * AI/heuristic-extracted items (operator/summary/structured-signal) so the panel
 * isn't permanently empty (nothing emits the todo-write marker by default). Run
 * scoping is applied to whichever source wins (TC-033 list-empty fix).
 */
export function visibleTaskLineup(items: TaskLineupItem[] | undefined, runId: string | undefined): TaskLineupItem[] {
  const all = items ?? [];
  const todoWrite = all.filter((item) => item.source === "todo-write");
  const chosen = todoWrite.length > 0
    ? taskLineupForVisibleRun(todoWrite, runId)
    // No authoritative list → fall back to AI/heuristic-extracted items, but re-validate
    // each through the content contract so stale/junk extractions (e.g. a bare "TERM")
    // can't surface even when injected directly into the lineup.
    : taskLineupForVisibleRun(all.filter((item) => cleanTaskLineupContent(item.content) !== undefined), runId);
  // The panel shows what's being worked on. If nothing is live (every item is
  // completed/cancelled), it should be EMPTY — not a graveyard of struck-through done
  // items. When there is at least one live task, show the full list for progress context.
  return chosen.some((item) => item.status === "pending" || item.status === "in_progress") ? chosen : [];
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
