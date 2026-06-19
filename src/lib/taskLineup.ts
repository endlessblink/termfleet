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
    .replace(/^(?:i(?:'|’)m\s+going\s+to|i\s+will|we\s+need\s+to|need\s+to|working\s+on|task|todo|next)\s*:?\s*/i, "")
    .replace(/^(?:done|complete|completed|pending|todo|in[-_ ]?progress|blocked|cancelled|canceled)\s*:\s*/i, "")
    .replace(/\.$/, "")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_TASK_TEXT);
}

function inferStatus(raw: string, fallback: TaskLineupStatus): TaskLineupStatus {
  if (/^(?:done|complete|completed)\s*:/i.test(raw)) return "completed";
  if (/^(?:cancelled|canceled)\s*:/i.test(raw)) return "cancelled";
  if (/^(?:in[-_ ]?progress|working)\s*:/i.test(raw)) return "in_progress";
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
