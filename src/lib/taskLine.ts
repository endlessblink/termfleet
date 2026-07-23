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
  | "agent-said"
  | "current-tool"
  | "completed-task"
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
  /** The most recent COMPLETED declared step. For an agent that finished its work
   *  and went idle, "what it just did" is a far better answer than the folder. */
  lastCompletedTask?: string | null;
  runningCommand?: string | null;
  folder?: string | null;
  branch?: string | null;
  /** The pane's authoritative badge state. Only used by the last rung, so the
   *  fallback never claims a busy terminal is sitting idle at a prompt. */
  busy?: boolean;
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
  exec_command: "Running",
  exec: "Running",
  shell: "Running",
  local_shell: "Running",
  wait: "Waiting for a command to finish",
  write_stdin: "Answering a running command",
  apply_patch: "Editing files",
  update_plan: "Updating the plan",
};

// A verb that needs its object to read as a sentence falls back to a complete
// phrase when the tool call carried no readable object.
const VERB_WITHOUT_OBJECT: Record<string, string> = {
  Running: "Running a command",
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
  if (tool.arg) return `${verb} ${tool.arg}`;
  return VERB_WITHOUT_OBJECT[verb] ?? verb;
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

  // Codex declares no short task, so its own sentence is the most specific true
  // line available before falling back to a template.
  const said = consider(facts.agentSaid);
  if (said) {
    return {
      text: said,
      source: "agent-said",
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

  // An agent that finished its checklist and went idle: its last completed step is
  // what this terminal is about — far better than "sitting at a prompt". Ranks below
  // every LIVE source, so a working pane never shows finished work over current work.
  const done = consider(input.lastCompletedTask);
  if (done) {
    return {
      text: done,
      source: "completed-task",
      capturedAt: now,
      expiresAt: null,
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
  const where = branch ? `${folder} on ${branch}` : folder;
  return {
    text: input.busy
      ? `Working in ${where}`
      : `Sitting at a command prompt in ${where}`,
    source: "shell-state",
    capturedAt: now,
    expiresAt: null,
    rejected,
  };
}
