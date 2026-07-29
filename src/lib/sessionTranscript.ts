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
  /** The operator's FIRST substantive request of the session — what this pane is about,
   *  read from the start of the record. The tail can never carry it (the tail holds the
   *  latest prompt, "/done"), and the agent's own session title is sometimes a slug, so
   *  without this the row said "exercise-demo-gif-pipeline" a week later. */
  openingRequest?: string;
  /** The agent's own last sentence about the work. Truncated at a sentence
   *  boundary — the agent's words, never reworded. */
  agentSaid?: string;
  lastTool?: { name: string; arg?: string };
  /** A question the agent is putting to the OPERATOR right now, from its own record.
   *  When an agent stops to ask, that question is the clearest statement of what is
   *  being decided — and a pane that was blocked on one used to render the placeholder
   *  while the question sat on screen (operator report 2026-07-27). Only set while the
   *  ask is the agent's most recent tool call. */
  pendingQuestion?: { question?: string; header?: string };
  /** Turn boundary observed in the record itself — no hook required. */
  lastTurnEndAt?: number;
  lastActivityAt?: number;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\[Image\s+#?\d+\]/gi, "")
    // The composer's own prompt glyph rides along in the recorded prompt ("❯ I want…").
    // It belongs to the input box, not to what the operator said.
    .replace(/^\s*[❯➜»>]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 4 ? text : undefined;
}

// A shell command is the truest thing an exec-style tool call carries, but the
// whole command line is unreadable to a non-developer (flags, quotes, absolute
// paths). Keep the leading words up to the first flag/path — still the agent's
// own command, just the part a person can read.
function readableCommand(command: string): string | undefined {
  const words: string[] = [];
  for (const word of command.trim().split(/\s+/)) {
    if (
      !word ||
      word.startsWith("-") ||
      word.includes("/") ||
      /["'`$(|;]/.test(word)
    )
      break;
    words.push(word);
    if (words.length === 3) break;
  }
  return words.length ? words.join(" ") : undefined;
}

function shortArg(input: unknown): string | undefined {
  // Codex passes tool arguments as a JSON *string*.
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      return shortArg(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const command = record.cmd ?? record.command;
  if (typeof command === "string" && command.trim())
    return readableCommand(command);
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

// Codex writes prose and nothing shorter, so its own first sentence is the most
// specific true thing available. Cutting at a sentence boundary is truncation,
// not rewriting — every remaining word is the agent's.
function firstSentence(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text || text.startsWith("{") || text.startsWith("[")) return undefined;
  const cut = text.search(/[.!?](?:\s|$)/);
  const sentence = (cut > 0 ? text.slice(0, cut + 1) : text).trim();
  return sentence.length >= 12 && sentence.length <= 96 ? sentence : undefined;
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

/** The first question of an `AskUserQuestion` call, as the agent wrote it. */
function firstQuestion(
  input: unknown,
): { question?: string; header?: string } | undefined {
  const parsed =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input);
          } catch {
            return null;
          }
        })()
      : input;
  if (!parsed || typeof parsed !== "object") return undefined;
  const questions = (parsed as { questions?: unknown }).questions;
  const first = Array.isArray(questions) ? questions[0] : null;
  if (!first || typeof first !== "object") return undefined;
  const record = first as { question?: unknown; header?: unknown };
  const question = cleanText(record.question);
  const header = cleanText(record.header);
  return question || header ? { question, header } : undefined;
}

/** `fix-cockpit-task-display` — a name for a machine, not a sentence for a person. */
export function looksLikeSlug(text: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+){1,}$/.test(text.trim());
}

/**
 * Is this message the operator ASKING for something, rather than harness plumbing, a
 * slash command or a pasted document? Deliberately narrow: the opening line of a pane is
 * shown for as long as the session lives, so a wrong pick is worse than none.
 */
export function opensAsRequest(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // Operators append their own shortcuts to a real request ("… and $save", "… /done").
  // The words before the shortcut are the request; the shortcut belongs to the composer.
  const value = text
    .trim()
    .replace(/\s+(?:and\s+)?[$/][a-z][\w:-]*\s*$/i, "")
    .trim();
  if (value.length < 12) return undefined;
  // Harness blocks, tool envelopes, command wrappers, slash commands, Claude's local-command
  // caveat, and the agent preambles subagents receive.
  if (/^[<$/]/.test(value)) return undefined;
  if (/^(?:caveat:|you are\b|##\s)/i.test(value)) return undefined;
  // Bracketed harness notices ride inside user messages ("[Request interrupted by user
  // for tool use]") and are not the operator speaking.
  if (/^\[[^\]]+\]$/.test(value)) return undefined;
  // Snippets the operator pasted into the prompt to be RUN are not requests.
  if (/=>|\(\)|document\.|window\.|querySelector|console\.|;\s*\w+\(/.test(value))
    return undefined;
  // A nudge or a complaint is not a goal. "this keeps reseting" is the operator's own
  // text, but it names no work — as the Task row it says less than the request it would
  // replace. Four words minimum, and a short message that opens with a demonstrative
  // ("this/that/it") is pointing at something rather than asking for it.
  const words = value.split(/\s+/);
  if (words.length < 4) return undefined;
  if (words.length < 8 && /^(?:this|that|it|these|those)\b/i.test(value))
    return undefined;
  // A short remark ("still seeing only this", "it keeps resetting") is the operator
  // reacting, not stating work. A short message therefore has to name an action or a
  // question; anything of real length speaks for itself.
  if (words.length < 8 && !ASKS_FOR_SOMETHING.test(value)) return undefined;
  return value;
}

// Verbs and question openers that make a short message a request rather than a reaction.
const ASKS_FOR_SOMETHING =
  /\b(?:add|allow|build|change|check|clean|clear|close|commit|connect|convert|create|debug|delete|deploy|design|disable|enable|find|fix|generate|handle|implement|improve|install|integrate|investigate|make|merge|migrate|move|open|plan|prevent|publish|pull|push|refactor|release|remove|rename|research|restart|restore|revert|run|show|split|start|stop|support|test|update|upgrade|use|verify|write|why|how|what|can we|can you|i want|i need|we should|should we|let's|lets|please)\b/i;

/** The text of a Claude `user` record, whether it is a string or content blocks. */
function userMessageText(record: Record<string, unknown>): string {
  const message = record.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block) =>
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text",
    )
    .map((block) => (block as { text?: string }).text ?? "")
    .join(" ");
}

/** The operator's first real request, from the START of a Claude record. */
export function parseClaudeOpeningRequest(text: string): string | undefined {
  let found: string | undefined;
  eachRecord(text, (record) => {
    if (found || record.type !== "user" || record.isSidechain === true) return;
    found = opensAsRequest(cleanText(userMessageText(record)));
  });
  return found;
}

/** The same, from the START of a Codex rollout. */
export function parseCodexOpeningRequest(text: string): string | undefined {
  let found: string | undefined;
  eachRecord(text, (record) => {
    if (found) return;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload?.type !== "user_message") return;
    found = opensAsRequest(cleanText(payload.message));
  });
  return found;
}

export function parseOpeningRequest(
  provider: string,
  text: string,
): string | undefined {
  if (provider === "claude") return parseClaudeOpeningRequest(text);
  if (provider === "codex") return parseCodexOpeningRequest(text);
  return undefined;
}

export function parseClaudeTranscript(text: string): TranscriptFacts {
  const facts: TranscriptFacts = {};
  eachRecord(text, (record) => {
    const at = parseTime(record.timestamp);
    if (at) facts.lastActivityAt = at;
    if (record.type === "ai-title") {
      // The vendor REWRITES this title as the session goes on, and the newest is not the
      // clearest: the exercise session's readable "Find free exercise visualization tool
      // for fitness bot" was replaced by the slug "exercise-demo-gif-pipeline", which is
      // what reached the operator's screen. Keep the first title that reads as words.
      const next = cleanText(record.aiTitle);
      if (next && (!facts.title || (looksLikeSlug(facts.title) && !looksLikeSlug(next)))) {
        facts.title = next;
      }
    }
    if (record.type === "last-prompt") {
      // Gated like every other operator message: this record holds whatever was typed
      // last, including "go", "$done" and "this keeps reseting" — none of which name the
      // work, and all of which used to take the row from a real request.
      const asked = opensAsRequest(cleanText(record.lastPrompt));
      if (asked) facts.operatorRequest = asked;
    }
    // A subagent's work is not the pane's work.
    if (record.isSidechain === true) return;
    // The NEWEST thing the operator actually asked. `last-prompt` is usually a thin
    // follow-up ("/done", "go"), and without this the row fell back to the session's
    // opening question long after the work had moved on — the operator saw the goal
    // "keep resetting" to where the session started (report 2026-07-28).
    if (record.type === "user") {
      const asked = opensAsRequest(cleanText(userMessageText(record)));
      if (asked) facts.operatorRequest = asked;
    }
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
          // A question counts as pending only while it is the LAST thing the agent did;
          // any later tool call means the operator already answered.
          facts.pendingQuestion =
            tool.name === "AskUserQuestion"
              ? (firstQuestion(tool.input) ?? facts.pendingQuestion)
              : undefined;
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
      case "user_message": {
        // Same rule as Claude: a thin follow-up must not erase the real request, and it
        // must not become one either — "$done" kept reaching the goal row through this
        // fallback and was then rejected downstream, leaving the pane silent.
        const asked = opensAsRequest(cleanText(payload.message));
        if (asked) facts.operatorRequest = asked;
        break;
      }
      case "agent_message":
        facts.agentSaid = firstSentence(payload.message) ?? facts.agentSaid;
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
