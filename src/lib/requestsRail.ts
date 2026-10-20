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
  /** What is happening on it right now (in-work row only), else the short title. */
  main: string;
  sub: string;
}

export const RAIL_VISIBLE_ROWS = 4;

/** A request as one short plain line: no attachment notes, file paths, relay wrappers or shell fragments. */
export function cleanTitle(text: string): string {
  let s = String(text || "");
  const quoted = /words?:\s*["\u201c](.+?)["\u201d]\s*(?:\.|\)|$)/s.exec(s);
  if (quoted) s = quoted[1];
  s = s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:Answer in|Ask the operator)[^)]*\)?/gi, " ")
    .replace(/(?:^|\s)(?:~|\.{0,2})?\/[\w.\-~/@%+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["\u201c'`]+|["\u201d'`]+$/g, "");
  return (s.split(/(?<=[.!?])\s/)[0] || s).replace(/[.!?]+$/, "");
}

export function shorten(text: string, max: number): string {
  const s = cleanTitle(text);
  return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}\u2026` : s;
}

export function cleanNote(note: string | undefined): string {
  const s = String(note || "").replace(/\s*(?:\d?>&?\d*\s*)?\|.*$/, "").replace(/\s*\d>&\d.*$/, "").trim();
  return !s || /[/|;`$<>&]/.test(s) ? "" : shorten(s, 48);
}

export function asksSidecarFileName(paneId: string): string {
  return `asks-${fnv(paneId)}.json`;
}

export function parseAsksSidecar(raw: string | null): { asks: RailAsk[]; working: boolean; live: string } | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { asks?: unknown; working?: unknown; live?: unknown };
    if (!Array.isArray(data.asks)) return null;
    const asks = data.asks
      .filter((a): a is RailAsk => Boolean(a) && typeof (a as RailAsk).n === "number" && typeof (a as RailAsk).text === "string")
      .map((a) => ({ n: a.n, text: a.text, status: String(a.status || "open"), note: a.note ? String(a.note) : "" }));
    return asks.length ? { asks, working: Boolean(data.working), live: typeof data.live === "string" ? data.live : "" } : null;
  } catch {
    return null;
  }
}

/** "In work" only while the agent is actually busy: the newest open request. */
export function railRows(asks: RailAsk[], working: boolean, live = ""): RailRow[] {
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
      const title = shorten(a.text, 60);
      const note = tone === "done" || tone === "partial" ? cleanNote(a.note) : "";
      const liveText = tone === "working" ? shorten(live, 60) : "";
      return {
        n: a.n, word, tone, text: title, note,
        main: liveText || title,
        sub: liveText ? `${word} \u00b7 ${shorten(a.text, 34)}` : [word, note].filter(Boolean).join(" \u00b7 "),
      };
    });
}
