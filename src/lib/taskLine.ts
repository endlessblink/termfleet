import type { TranscriptFacts } from "./sessionTranscript";
import { qualityCheckAuthoritativeTaskLabel } from "./terminalHeaderQuality";

// TC-060. One ladder, one owner. Every rung is either the agent's own words, the
// operator's own words, or a fixed template over a verified fact — nothing here
// invents or paraphrases. A candidate that reads badly is SKIPPED, never rewritten.
// The last rung cannot fail, which is what makes "never blank" an invariant
// rather than an aspiration.

export type TaskLineSource =
  | "declared"
  | "session-title"
  | "operator-request"
  | "current-tool"
  | "running-command"
  | "shell-state";

export interface PaneTaskLine {
  text: string;
  source: TaskLineSource;
  capturedAt: number;
  expiresAt: number | null;
  /** True text that failed the plain-language check. Kept so "rejected" and
   *  "nothing known" can never collapse into one indistinguishable string again. */
  rejected?: string;
}

export interface TaskLineInput {
  now: number;
  declaredTask?: string | null;
  facts?: TranscriptFacts | null;
  runningCommand?: string | null;
  folder?: string | null;
  branch?: string | null;
}

const TOOL_VERBS: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  Write: "Writing",
  Bash: "Running a command",
  Grep: "Searching the code",
  Glob: "Looking for files",
  WebSearch: "Searching the web",
  WebFetch: "Reading a web page",
  TaskCreate: "Planning the work",
  TaskUpdate: "Updating the plan",
  exec_command: "Running a command",
};

const TOOL_TTL_MS = 30_000;

// R4 is about a NON-DEVELOPER reading the line, which is a stricter bar than the
// shared header gate (that one guards developer-facing text too). Shell operators,
// command flags, absolute paths, code fences and markdown headings are all things
// a non-technical viewer cannot read, so they disqualify a candidate here. The
// shared gate is left untouched — its other callers have different needs.
const UNREADABLE =
  /(?:&&|\|\||[|;]\s|\s--?[a-z][\w-]*|(?:^|\s)\/(?:home|media|usr|etc|var|tmp)\/|```|^#{1,6}\s)/i;

function readsPlainly(text: string): boolean {
  return qualityCheckAuthoritativeTaskLabel(text).ok && !UNREADABLE.test(text);
}

function templateTool(tool: { name: string; arg?: string }): string {
  const verb = TOOL_VERBS[tool.name] ?? `Using ${tool.name}`;
  return tool.arg ? `${verb} ${tool.arg}` : verb;
}

export function resolvePaneTaskLine(input: TaskLineInput): PaneTaskLine {
  const { now } = input;
  const facts = input.facts ?? {};
  const turnEnded =
    typeof facts.lastTurnEndAt === "number" && facts.lastTurnEndAt <= now;
  let rejected: string | undefined;

  const consider = (candidate: string | null | undefined): string | null => {
    const value = candidate?.trim();
    if (!value) return null;
    if (readsPlainly(value)) return value;
    if (!rejected) rejected = value;
    return null;
  };

  if (!turnEnded) {
    const declared = consider(input.declaredTask);
    if (declared) {
      return {
        text: declared,
        source: "declared",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    const title = consider(facts.title);
    if (title) {
      return {
        text: title,
        source: "session-title",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
  }

  // The operator's floor rule: when nothing better is known, show what they asked for.
  const request = consider(facts.operatorRequest);
  if (request) {
    return {
      text: request,
      source: "operator-request",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };
  }

  if (facts.lastTool) {
    return {
      text: templateTool(facts.lastTool),
      source: "current-tool",
      capturedAt: now,
      expiresAt: now + TOOL_TTL_MS,
      rejected,
    };
  }

  const command = input.runningCommand?.trim();
  if (command) {
    return {
      text: `Running ${command}`,
      source: "running-command",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };
  }

  const folder = input.folder?.trim() || "this folder";
  const branch = input.branch?.trim();
  return {
    text: branch
      ? `Sitting at a command prompt in ${folder} on ${branch}`
      : `Sitting at a command prompt in ${folder}`,
    source: "shell-state",
    capturedAt: now,
    expiresAt: null,
    rejected,
  };
}
