import { fnv } from "./agentStatusSidecar";

/**
 * The requests side panel on TermFleet's own terminal cards. The bridge keeps one
 * file per live terminal (termcontrol/bridge/asks-sidecar.mjs) with the operator's
 * requests in his own words and their status; this turns it into rows, oldest at the
 * top and newest at the bottom, like a chat.
 */
export interface RailAsk {
  n: number;
  text: string;
  status: string;
  note?: string;
}

export interface RailRow {
  n: number;
  word: string;
  tone: "working" | "waiting" | "done" | "partial" | "dropped";
  text: string;
  note: string;
}

export const RAIL_VISIBLE_ROWS = 4;

export function asksSidecarFileName(paneId: string): string {
  return `asks-${fnv(paneId)}.json`;
}

export function parseAsksSidecar(raw: string | null): { asks: RailAsk[]; working: boolean } | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { asks?: unknown; working?: unknown };
    if (!Array.isArray(data.asks)) return null;
    const asks = data.asks
      .filter((a): a is RailAsk => Boolean(a) && typeof (a as RailAsk).n === "number" && typeof (a as RailAsk).text === "string")
      .map((a) => ({ n: a.n, text: a.text, status: String(a.status || "open"), note: a.note ? String(a.note) : "" }));
    return asks.length ? { asks, working: Boolean(data.working) } : null;
  } catch {
    return null;
  }
}

/** "In work" only while the agent is actually busy: the newest open request. */
export function railRows(asks: RailAsk[], working: boolean): RailRow[] {
  const open = asks.filter((a) => a.status === "open").map((a) => a.n);
  const current = working && open.length ? Math.max(...open) : null;
  return asks
    .slice()
    .sort((x, y) => x.n - y.n)
    .map((a) => {
      const tone: RailRow["tone"] =
        a.status === "open" ? (a.n === current ? "working" : "waiting")
          : a.status === "done" ? "done" : a.status === "partial" ? "partial" : "dropped";
      const word = { working: "In work", waiting: "Waiting", done: "\u2713 Done", partial: "Partly done", dropped: "Dropped" }[tone];
      return { n: a.n, word, tone, text: a.text.length > 140 ? `${a.text.slice(0, 139)}\u2026` : a.text, note: a.note || "" };
    });
}
