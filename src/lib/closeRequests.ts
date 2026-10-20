// Close requests (Noam 2026-10-20: "צריך להיות מסוגל להרוג טרמינל מהתצוגה הזו בפלאפון ובמחשב").
// The phone bridge and `termfleet-team close` drop a request in this user's own
// close-requests folder; the app closes the card exactly as the card's X does.
// Whether a close is wanted (Noam confirmed it, or a bot's own finished terminal)
// is decided before a request is written. The app only refuses what it cannot do
// cleanly: an unknown or stale request, a card it no longer has, a card holding
// several terminals (closing it would stop more than was asked).

export const CLOSE_REQUEST_MAX_AGE_MS = 60_000;

export interface CloseRequest {
  requestId: string;
  paneId: string;
  by?: string;
  createdAt: number;
}

interface TabLike {
  id: string;
  title?: string;
  terminals: { id: string }[];
}

export type ClosePlan =
  | { ok: true; request: CloseRequest; tabId: string; title: string }
  | { ok: false; requestId: string | null; reason: "invalid" | "expired" | "not-found" | "several-terminals" };

export function planCloseRequest(raw: string, tabs: TabLike[], now: number): ClosePlan {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, requestId: null, reason: "invalid" };
  }
  const v = value as Record<string, unknown>;
  const requestId = typeof v?.requestId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v.requestId) ? v.requestId : null;
  if (!requestId || v.kind !== "close" || typeof v.paneId !== "string" || !v.paneId.startsWith("terminal-") || typeof v.createdAt !== "number") {
    return { ok: false, requestId, reason: "invalid" };
  }
  if (now - v.createdAt > CLOSE_REQUEST_MAX_AGE_MS) return { ok: false, requestId, reason: "expired" };
  const paneId = v.paneId;
  const tab = tabs.find((candidate) => candidate.terminals.some((terminal) => `terminal-${candidate.id}-${terminal.id}` === paneId));
  if (!tab) return { ok: false, requestId, reason: "not-found" };
  if (tab.terminals.length !== 1) return { ok: false, requestId, reason: "several-terminals" };
  return {
    ok: true,
    tabId: tab.id,
    title: tab.title || paneId,
    request: { requestId, paneId, by: typeof v.by === "string" ? v.by.slice(0, 120) : undefined, createdAt: v.createdAt },
  };
}
