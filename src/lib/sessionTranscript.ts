// TC-060. Claude Code and Codex each write a complete session record to disk on
// their own, with no hook involvement — so these facts exist for hand-started,
// long-running, and pre-existing panes, which is exactly the class that used to
// render "Task not captured". Every reader here is a fallible probe: a changed
// vendor format yields fewer facts, never an exception and never a blank pane.
// Drift is caught loudly by the doctor probe, not silently by an empty header.

export interface TranscriptFacts {
  /** A short session title the vendor wrote itself. Never composed here. */
  title?: string;
  /** The operator's own last request, verbatim. The floor rule's source. */
  operatorRequest?: string;
  lastTool?: { name: string; arg?: string };
  /** Turn boundary observed in the record itself — no hook required. */
  lastTurnEndAt?: number;
  lastActivityAt?: number;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\[Image\s+#?\d+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 4 ? text : undefined;
}

function shortArg(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const raw =
    record.file_path ??
    record.path ??
    record.pattern ??
    record.query ??
    record.command;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const tail = raw.split("/").pop() ?? raw;
  return tail.slice(0, 48);
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

// The reader is handed a byte-bounded TAIL, so the first line is routinely a
// fragment. Skipping anything that does not start an object keeps that normal.
function eachRecord(
  text: string,
  visit: (record: Record<string, unknown>) => void,
) {
  for (const line of text.split("\n")) {
    if (!line || line.charCodeAt(0) !== 123) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && typeof record === "object")
      visit(record as Record<string, unknown>);
  }
}

export function parseClaudeTranscript(text: string): TranscriptFacts {
  const facts: TranscriptFacts = {};
  eachRecord(text, (record) => {
    const at = parseTime(record.timestamp);
    if (at) facts.lastActivityAt = at;
    if (record.type === "ai-title")
      facts.title = cleanText(record.aiTitle) ?? facts.title;
    if (record.type === "last-prompt") {
      facts.operatorRequest =
        cleanText(record.lastPrompt) ?? facts.operatorRequest;
    }
    // A subagent's work is not the pane's work.
    if (record.isSidechain === true) return;
    const message = record.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_use"
      ) {
        const tool = block as { name?: string; input?: unknown };
        if (typeof tool.name === "string") {
          facts.lastTool = { name: tool.name, arg: shortArg(tool.input) };
        }
      }
    }
  });
  return facts;
}

export function parseCodexRollout(text: string): TranscriptFacts {
  const facts: TranscriptFacts = {};
  eachRecord(text, (record) => {
    const at = parseTime(record.timestamp);
    if (at) facts.lastActivityAt = at;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    switch (payload.type) {
      case "thread_goal_updated":
        facts.title = cleanText(payload.goal) ?? facts.title;
        break;
      case "user_message":
        facts.operatorRequest =
          cleanText(payload.message) ?? facts.operatorRequest;
        break;
      case "task_complete":
        facts.lastTurnEndAt = at;
        break;
      case "task_started":
        // Newer work supersedes an earlier turn end; otherwise a resumed pane
        // would stay marked finished forever.
        facts.lastTurnEndAt = undefined;
        break;
      case "function_call":
      case "custom_tool_call":
        if (typeof payload.name === "string") {
          facts.lastTool = {
            name: payload.name,
            arg: shortArg(payload.arguments),
          };
        }
        break;
      default:
        break;
    }
  });
  return facts;
}

export function parseTranscript(
  provider: string,
  text: string,
): TranscriptFacts {
  if (provider === "claude") return parseClaudeTranscript(text);
  if (provider === "codex") return parseCodexRollout(text);
  return {};
}
