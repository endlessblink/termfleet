import { looksLikeSlug, type TranscriptFacts } from "./sessionTranscript";
import {
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckUserAskLabel,
  stripComposerChrome,
} from "./terminalHeaderQuality";

// TC-060. One ladder, one owner. Every rung is either the agent's own words, the
// operator's own words, or a fixed template over a verified fact — nothing here
// invents or paraphrases. A candidate that reads badly is SKIPPED, never rewritten.
// The last rung cannot fail, which is what makes "never blank" an invariant
// rather than an aspiration.

export type TaskLineSource =
  | "declared"
  | "opening-request"
  | "session-title"
  | "operator-request"
  | "pending-question"
  | "current-step"
  | "agent-said"
  | "current-tool"
  | "completed-task"
  | "recent-activity"
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
  /** The overarching goal — an explicitly declared main task. This is "what the
   *  whole terminal is about", so it leads the line. */
  mainGoal?: string | null;
  /** The current in-progress step. It's a STEP toward the goal, not the goal, so
   *  it ranks BELOW the goal and the session's own plan title. */
  currentStep?: string | null;
  /** @deprecated use mainGoal / currentStep. Kept so existing callers/tests still
   *  resolve; treated as a goal-or-step depending on nothing better being present. */
  declaredTask?: string | null;
  facts?: TranscriptFacts | null;
  /** The most recent COMPLETED declared step. For an agent that finished its work
   *  and went idle, "what it just did" is a far better answer than the folder. */
  lastCompletedTask?: string | null;
  /** The agent's own most recent plain-language note about its work (the status
   *  record's narration / newest activity entry). It is written by the agent for a
   *  human, so it is a far better last resort than saying nothing was declared. */
  recentActivity?: string | null;
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

// Harness plumbing that arrives inside the operator's own prompt field: task
// notifications, tool-result envelopes, command wrappers. None of it is a request.
const SYSTEM_BLOCK = /^\s*<\/?[a-z][\w-]*[\s>]|<\/?(?:task-notification|system-reminder|tool-use-id|output-file|command-name|command-message)\b/i;

/** `fix-cockpit-task-display` → `Fix cockpit task display`. Non-slugs pass through. */
function deslug(text: string | undefined): string | undefined {
  if (!text || !looksLikeSlug(text)) return text;
  const words = text.trim().replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The row is a fixed two-line box, so a request may run to two lines before it is cut.
// The paste ceiling (200) still applies — a document is never fitted, only a request.
const TASK_LINE_MAX = 150;

function readsPlainly(text: string): boolean {
  return (
    qualityCheckAuthoritativeTaskLabel(text, { maxLength: TASK_LINE_MAX }).ok &&
    !UNREADABLE.test(text)
  );
}

function templateTool(tool: { name: string; arg?: string }): string {
  const verb = TOOL_VERBS[tool.name] ?? `Using ${tool.name}`;
  if (tool.arg) return `${verb} ${tool.arg}`;
  return VERB_WITHOUT_OBJECT[verb] ?? verb;
}

/**
 * Which of two lines a pane should keep.
 *
 * `shell-state` is the rung that means "this pane has nothing to say", so it must never
 * replace a line that named the work — that overwrite is how the old folder template
 * used to stick. Every writer (the central poll loop, the per-pane poll, the header)
 * goes through this, because a rule that lives in only one of them leaks.
 */
/**
 * How steady each rung is. The top four answer "what is this pane FOR" and barely change;
 * the rest are momentary — the tool of the second, the step of the minute — and a pane
 * that swapped between them looked like it was resetting itself while the operator sat
 * and watched ("still jumpy even without me typing anything", 2026-07-28).
 */
const RUNG_RANK: Record<TaskLineSource, number> = {
  declared: 0,
  "operator-request": 1,
  "opening-request": 1,
  "session-title": 2,
  "pending-question": 3,
  "current-step": 4,
  "agent-said": 5,
  "current-tool": 6,
  "completed-task": 7,
  "recent-activity": 8,
  "running-command": 9,
  "shell-state": 10,
};

export function preferPaneTaskLine(
  current: PaneTaskLine | null | undefined,
  next: PaneTaskLine | null | undefined,
): PaneTaskLine | undefined {
  if (!next) return current ?? undefined;
  if (!current) return next;
  // A weaker rung never takes the row from a stronger one. Same rung → the newer text
  // wins, so a genuinely new request still lands and a live step still follows the work.
  if (RUNG_RANK[next.source] > RUNG_RANK[current.source]) return current;
  return next;
}

/**
 * "Waiting on your answer: <the agent's question>", or the short subject when the
 * question itself is too long to read in one row. Both forms go through the same
 * plain-language gate as every other rung.
 */
function questionLine(
  pending: { question?: string; header?: string } | undefined,
  consider: (candidate: string | null | undefined) => string | null,
): string | null {
  if (!pending) return null;
  const asked = pending.question?.trim().replace(/\?+$/, "").trim();
  if (asked) {
    const full = consider(`Waiting on your answer: ${lowerFirst(asked)}`);
    if (full) return full;
  }
  const subject = pending.header?.trim().replace(/\?+$/, "").trim();
  if (subject)
    return consider(`Waiting on your answer about ${lowerFirst(subject)}`);
  return null;
}

// Only the first character changes case, and only when the word is not an acronym or a
// proper name the agent capitalised on purpose.
function lowerFirst(text: string): string {
  if (/^[A-Z]{2,}/.test(text)) return text;
  const [first = "", ...rest] = text;
  return /^[A-Z]$/.test(first) && !/^[A-Z]/.test(rest[0] ?? "")
    ? `${first.toLowerCase()}${rest.join("")}`
    : text;
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
    if (SYSTEM_BLOCK.test(value)) {
      if (!rejected) rejected = value;
      return null;
    }
    if (readsPlainly(value)) return value;
    if (!rejected) rejected = value;
    return null;
  };

  // Length alone must not throw the operator's goal away. 43 of the 216 records on this
  // machine held a real request that failed ONLY the 96-character limit, and the row
  // then said "No task declared" while the goal sat right there (live report
  // 2026-07-26). The row renders one ellipsised line anyway, so a long ask is fitted at
  // a word boundary — the operator's own words, cut, with the full text in the tooltip.
  // Anything that fails for a REASON other than length is still skipped, never trimmed
  // into looking acceptable.
  // The OPERATOR's own words get the operator's gate, not the agent's.
  //
  // The strict gate exists to stop scraped junk from becoming a task, so it rejects typos
  // ("dont"), first-person openers and report shapes — reasonable for text the app found
  // on a screen, wrong for a message the operator actually typed, which is authoritative
  // by definition. It threw away "tasks still dont appear properly - do a super deep
  // dive" and left the card showing the agent's own session slug (report 2026-07-28).
  // Readability rules still apply in full: length, code, paths, commands, pastes,
  // harness blocks, slash commands, bare acknowledgements.
  const readsAsAsk = (text: string): boolean =>
    qualityCheckUserAskLabel(text, { maxLength: TASK_LINE_MAX }).ok &&
    !UNREADABLE.test(text) &&
    !SYSTEM_BLOCK.test(text);

  const considerAsk = (candidate: string | null | undefined): string | null => {
    const value = candidate?.trim();
    if (!value) return null;
    if (readsAsAsk(value)) return value;
    if (!rejected) rejected = value;
    return null;
  };

  const considerLongAsk = (
    candidate: string | null | undefined,
  ): string | null => {
    const value = candidate?.trim();
    if (!value) return null;
    const direct = considerAsk(value);
    if (direct) return direct;
    if (
      qualityCheckUserAskLabel(value, { maxLength: TASK_LINE_MAX }).reason !==
      "too-long"
    )
      return null;
    // Fitting is for a long REQUEST, not for a pasted document. The status hooks cap the
    // recorded ask at 220 characters, so anything at that scale is text the operator
    // pasted or a harness injected — 30 of the 53 over-length records on this machine
    // were exactly that (a Hebrew spec sheet, `<task-notification>` blocks, subagent
    // preambles, JS snippets), and one of them rendered as the Task row on a live pane
    // (operator report 2026-07-28). Its first 92 characters are never the ask.
    if (value.length >= 200 || SYSTEM_BLOCK.test(value)) {
      if (!rejected) rejected = value;
      return null;
    }
    const fitted = `${value
      .slice(0, TASK_LINE_MAX - 4)
      .replace(/\s+\S*$/, "")
      .trim()}…`;
    return readsAsAsk(fitted) ? fitted : null;
  };

  // MAIN-PLAN sources lead the line: the whole point is "what is this part of".
  // An explicit overarching goal, then the session's own plan title, then the
  // operator's main request — all rank ABOVE the momentary in-progress step.
  if (!turnEnded) {
    const goal = consider(input.mainGoal ?? input.declaredTask);
    if (goal) {
      return {
        text: goal,
        source: "declared",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // The NEWEST thing the operator asked leads: a long session drifts, and pinning the
    // row to the session's first question made the goal look like it kept resetting to
    // where the work began (report 2026-07-28). A thin follow-up ("/done", "go", "make
    // all high") fails the gate here and the opening request below takes over, so the
    // row never degrades into an acknowledgement.
    const latestAsk = considerLongAsk(stripComposerChrome(facts.operatorRequest));
    if (latestAsk) {
      return {
        text: latestAsk,
        source: "operator-request",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // What the OPERATOR asked when this pane started — the line that still means
    // something a week later. It outranks the agent's own session title because that
    // title is sometimes a slug ("exercise-demo-gif-pipeline"), which answers nothing.
    const opening = considerLongAsk(stripComposerChrome(facts.openingRequest));
    if (opening) {
      return {
        text: opening,
        source: "opening-request",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // A slug is the agent's own words, just written for a machine. Spacing it out is
    // formatting, not invention — and it is only ever reached when nothing above spoke.
    const title = consider(deslug(facts.title));
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

  // The operator's floor rule: when no explicit goal exists, their own request is
  // the plan. Ranked above the step because it is the "why", not the "how".
  // Composer chrome from a pasted attachment ("[Image #1] got stuck") is dropped first:
  // the placeholder belongs to the input box, the words after it are the operator's.
  // That is normalisation of their own text, not the rewriting R2 forbids.
  const request = considerLongAsk(stripComposerChrome(facts.operatorRequest));
  if (request) {
    return {
      text: request,
      source: "operator-request",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };
  }

  // A pane that has stopped to ask the operator something: the question IS the
  // current state of the work, and it is the operator's own decision that is pending.
  // Templated (never echoed raw) because a bare question fails the plain-language gate
  // on its trailing "?" — the words after the prefix are still the agent's own.
  const question = questionLine(facts.pendingQuestion, consider);
  if (question) {
    return {
      text: question,
      source: "pending-question",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };
  }

  // The current in-progress step — a STEP toward the goal, used as the line only
  // when no overarching plan above was available.
  if (!turnEnded) {
    const step = consider(input.currentStep);
    if (step) {
      return {
        text: step,
        source: "current-step",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
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

  // The agent's own newest note about what it is doing. Ranks under everything
  // declared, but above admitting nothing is known — the words are the agent's.
  const recent = consider(input.recentActivity);
  if (recent) {
    return {
      text: recent,
      source: "recent-activity",
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

  // Nothing is known: no goal, no session plan, no operator ask, no step, no tool, no
  // finished work, no running command. The old wording here was a template over the
  // folder name ("Working in <folder>", "Sitting at a command prompt in <folder>"), and
  // the operator rejected it twice as low quality — correctly: the Task row promises
  // what is being done in relation to what they asked for, and the folder name answers
  // neither. It also READ like content, which hid a broken pipeline behind a full-
  // looking line. Saying so plainly is both true and visibly a gap. The row is still
  // never blank (TC-060 R1).
  return {
    text: "No task declared",
    source: "shell-state",
    capturedAt: now,
    expiresAt: null,
    rejected,
  };
}
