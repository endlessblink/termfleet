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

function isThinFollowUp(value?: string) {
  if (!value) return true;
  const text = value
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:Prompt submitted|go|continue|implement|ok implement|do it|this|that|these|those|both|and this|and that|the rest is good|should we add (?:it|that)|[$/][a-z][\w:-]*)\??$/i.test(text)) {
    return true;
  }
  if (/^(?:it|this|that)\s+(?:doesn['’]?t|isn['’]?t|won['’]?t|can['’]?t)(?:\s*\.{2,})?$/i.test(text)) return true;
  if (/^(?:it|this|that)\s+must\s+be\s+clear\b/i.test(text)) return true;
  if (/\buse\s+the\s+tasks?\s+list\s+tool\b/i.test(text)) return true;
  if (/^(?:just\s+)?(?:push|deploy|publish)(?:\s+to)?\s+production(?:\s+safely)?$/i.test(text)) return true;
  return text.endsWith("?") && /\b(?:what|why|how|when|where|who|which|should|can|could|would|will|do|does|did|is|are|was|were)\b/i.test(text);
}

export function mainUserAskForRunChange(
  previous: TerminalMainUserAsk | undefined,
  runChanged: boolean,
) {
  if (!runChanged) return previous;
  // Sidecar/manual/task-tool asks are pane or conversation identity, not shell
  // command identity. Only a prompt scraped from the terminal is run-scoped.
  return previous?.source === "terminal-prompt" ? undefined : previous;
}

export function persistedMainUserAsk(
  ask: TerminalMainUserAsk | undefined,
): TerminalMainUserAsk | undefined {
  if (!ask) return undefined;
  return ask.source === "manual" || ask.source === "task-tool" || ask.source === "workstream"
    ? ask
    : undefined;
}

function terminalHeaderLogEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_TERMINAL_HEADER_LOG === "1";
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
  if (!text && source === "status-sidecar") return undefined;
  if (!text) return options.previous;
  if (isThinFollowUp(text)) return options.previous;
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
  if (!terminalHeaderLogEnabled()) return;
  if (typeof window === "undefined") return;
  const next: TerminalHeaderLogEntry = { ...entry, at: Date.now() };
  window.__termfleetHeaderLog = [...(window.__termfleetHeaderLog ?? []), next].slice(-200);
  console.info("[termfleet-header]", next);
}
