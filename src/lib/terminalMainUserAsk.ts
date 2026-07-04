import type { TerminalMainUserAsk, TerminalMainUserAskSource, TerminalPurpose, WorkstreamStatusSummary } from "./types";

declare global {
  interface Window {
    __termfleetHeaderLog?: TerminalHeaderLogEntry[];
  }
}

export interface TerminalHeaderLogEntry {
  at: number;
  terminalId?: string;
  paneId?: string;
  field: "mainUserAsk" | "header";
  source?: string;
  text?: string;
  previousText?: string;
}

function cleanAsk(value?: string | null) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

export function mainUserAskFromSummary(
  summary: WorkstreamStatusSummary | null | undefined,
  source: TerminalMainUserAskSource,
  options: {
    previous?: TerminalMainUserAsk;
    runId?: string;
    now?: number;
  } = {},
): TerminalMainUserAsk | undefined {
  const text = cleanAsk(summary?.userTask);
  if (!text) return options.previous;
  if (options.previous?.text === text && options.previous.source === source) {
    return options.previous;
  }
  return {
    text,
    source,
    updatedAt: options.now ?? Date.now(),
    runId: options.runId ?? options.previous?.runId,
  };
}

export function mainUserAskFromTerminalPurpose(
  purpose: TerminalPurpose | null | undefined,
  options: {
    previous?: TerminalMainUserAsk;
    runId?: string;
    now?: number;
    preferTerminalPrompt?: boolean;
  } = {},
): TerminalMainUserAsk | undefined {
  const text = purpose?.source === "inferred" ? cleanAsk(purpose.title) : undefined;
  if (!text) return options.previous;
  const previous = options.previous;
  const sameRun =
    !previous?.runId ||
    !options.runId ||
    previous.runId === options.runId;
  const previousIsAuthoritative =
    sameRun &&
    previous &&
    previous.source !== "terminal-prompt" &&
    !options.preferTerminalPrompt;
  if (previousIsAuthoritative) return previous;
  if (sameRun && previous?.source === "terminal-prompt" && previous.text === text) {
    return previous;
  }
  return {
    text,
    source: "terminal-prompt",
    updatedAt: options.now ?? Date.now(),
    runId: options.runId ?? previous?.runId,
  };
}

export function recordTerminalHeaderLog(entry: Omit<TerminalHeaderLogEntry, "at">) {
  if (typeof window === "undefined") return;
  const next: TerminalHeaderLogEntry = { ...entry, at: Date.now() };
  window.__termfleetHeaderLog = [...(window.__termfleetHeaderLog ?? []), next].slice(-200);
  if (import.meta.env.DEV) {
    console.info("[termfleet-header]", next);
  }
}
