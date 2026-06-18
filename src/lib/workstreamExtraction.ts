import type { WorkstreamExtractedItem, WorkstreamExtractionProvenance } from "./types";

const MAX_EXTRACTED_ITEM_TEXT = 180;
const MAX_EXTRACTED_EXCERPT = 240;

export function cleanExtractedText(value?: string | null) {
  return value?.replace(/\s+/g, " ").replace(/^[•*-]\s+/, "").trim().slice(0, MAX_EXTRACTED_ITEM_TEXT) || undefined;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeExcerpt(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_EXTRACTED_EXCERPT);
}

function itemFromValue(
  value: unknown,
  provenance: WorkstreamExtractionProvenance,
  fallbackExcerpt: string,
  at: number
): WorkstreamExtractedItem | null {
  const rawText = typeof value === "string"
    ? value
    : value && typeof value === "object" && "text" in value && typeof value.text === "string"
      ? value.text
      : undefined;
  const text = cleanExtractedText(rawText);
  if (!text) return null;
  const sourceExcerpt = typeof value === "object" && value && "excerpt" in value && typeof value.excerpt === "string"
    ? value.excerpt
    : fallbackExcerpt || text;
  const excerpt = normalizeExcerpt(sourceExcerpt);
  const sourceHash = typeof value === "object" && value && "sourceHash" in value && typeof value.sourceHash === "string"
    ? value.sourceHash
    : hashText(`${provenance}:${excerpt}:${text}`);
  const itemAt = typeof value === "object" && value && "at" in value && typeof value.at === "number"
    ? value.at
    : at;
  const sourceProvenance = typeof value === "object" && value && "provenance" in value && isExtractionProvenance(value.provenance)
    ? value.provenance
    : provenance;
  return {
    id: typeof value === "object" && value && "id" in value && typeof value.id === "string"
      ? value.id
      : `${sourceProvenance}:${sourceHash}`,
    text,
    provenance: sourceProvenance,
    at: itemAt,
    excerpt,
    sourceHash,
  };
}

function isExtractionProvenance(value: unknown): value is WorkstreamExtractionProvenance {
  return value === "terminal-output" || value === "structured-signal" || value === "operator-prompt" || value === "summary";
}

export function normalizeExtractedItems(
  values: unknown,
  provenance: WorkstreamExtractionProvenance,
  fallbackExcerpt = "",
  at = 0,
  limit = 5
) {
  const sourceValues = Array.isArray(values) ? values : values ? [values] : [];
  const seen = new Set<string>();
  const items: WorkstreamExtractedItem[] = [];
  for (const value of sourceValues) {
    const item = itemFromValue(value, provenance, fallbackExcerpt, at);
    if (!item || seen.has(item.sourceHash)) continue;
    seen.add(item.sourceHash);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

export function mergeExtractedItems(
  existing: WorkstreamExtractedItem[] | undefined,
  incoming: WorkstreamExtractedItem[] | undefined,
  at = Date.now(),
  limit = 12
) {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map((item) => `${item.provenance}:${item.sourceHash}:${item.text}`));
  for (const item of incoming ?? []) {
    const persisted = item.at > 0 ? item : { ...item, at };
    const key = `${persisted.provenance}:${persisted.sourceHash}:${persisted.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(persisted);
  }
  return merged.sort((a, b) => b.at - a.at).slice(0, limit);
}
