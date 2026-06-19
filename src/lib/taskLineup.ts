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
  return cleaned.slice(0, MAX_TASK_TEXT);
}

export function taskLineupSourceLabel(source: TaskLineupSource) {
  if (source === "todo-write") return "operator task list";
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
) {
  return normalizeTaskLineupItems((items ?? []).map((item) => ({
    id: item.id,
    content: item.text,
    status: inferStatus(item.text, fallbackStatus),
    updatedAt: item.at > 0 ? item.at : updatedAt,
  })), source, updatedAt);
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
