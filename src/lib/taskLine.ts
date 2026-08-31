import {
  looksLikeSlug,
  refersOnlyToExistingWork,
  startsWithRequestAction,
  type TranscriptFacts,
} from "./sessionTranscript";
import {
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckUserAskLabel,
  readsAsActivity,
  stripComposerChrome,
} from "./terminalHeaderQuality";
import { truncateAtWordBoundary } from "./textTruncation";

// TC-060. One ladder, one owner. Every rung is either the agent's own words, the
// operator's own words, or a fixed template over a verified fact — nothing here
// invents or paraphrases. A candidate that reads badly is SKIPPED, never rewritten.
// The last rung cannot fail, which is what makes "never blank" an invariant
// rather than an aspiration.

export type TaskLineSource =
  | "declared"
  | "context-summary"
  | "opening-request"
  | "plan-purpose"
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
  /** Where that declared task came from. Codex's "plan explanation" is a progress NOTE
   *  as often as a goal ("The rendered warning exposed a second bug: draft existence was
   *  treated as proof of unsaved changes"), which tells the operator nothing about what
   *  the pane is for — so it is held back behind the session title and their own ask. */
  mainGoalSource?: "about-what" | "plan-explanation" | "goal-task" | "opening-request" | "user-prompt" | null;
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
// A semicolon inside a SENTENCE is ordinary punctuation ("Verification only; no code
// changes."), so only a shell-shaped chain disqualifies a line: `;` or `|` followed by a
// bare command word.
const UNREADABLE =
  /(?:&&|\|\||[|;]\s*[a-z][\w-]*\s+-{1,2}[a-z]|\s--?[a-z][\w-]*|(?:^|\s)\/(?:home|media|usr|etc|var|tmp)\/|```|^#{1,6}\s)/i;

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
    qualityCheckAuthoritativeTaskLabel(text, {
      maxLength: TASK_LINE_MAX,
      // Internal plan actions are progress metadata, not user goals. They must remain
      // available for diagnostics but cannot become the pane's user-facing identity.
      allowMetaProcess: false,
    }).ok &&
    !UNREADABLE.test(text)
  );
}

// Session titles sometimes become release notes after the agent finishes a turn.
// They are useful evidence, but they are not a durable answer to "what is this pane
// about?" Prefer the opening request or another real goal over a sentence that only
// reports commits, pull requests, and checks.
function isCompletionReport(text: string): boolean {
  return (
    /\b(?:committed|merged|deployed|passed|failed|released)\b/i.test(text) &&
    /\b(?:branch|pull request|checks?|tests?|build|production)\b/i.test(text)
  );
}

function completionReportPurpose(text: string): string | null {
  if (!isCompletionReport(text)) return null;
  if (/\bredesign\b/i.test(text) && /\bpull request\b/i.test(text)) {
    return "Reviewing the redesign pull request";
  }
  if (/\bproduction\b|\bdeployed\b/i.test(text)) {
    return "Checking the production release";
  }
  if (/\bpull request\b/i.test(text)) return "Reviewing the pull request";
  return "Reviewing the completed changes";
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
  "context-summary": 1,
  "session-title": 2,
  "operator-request": 2,
  "opening-request": 2,
  "plan-purpose": 2,
  "current-step": 2,
  "pending-question": 3,
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

/**
 * The pane's SECOND line: what it is doing right now, under the goal.
 *
 * Same inputs, same gates, but only the momentary rungs — the ones deliberately kept OUT
 * of the goal row so it stops flickering. The operator asked for both at once: "Goal on
 * top, current step under it". Returns null when the pane has nothing live to say, and
 * never repeats the goal it sits under.
 */
export function resolvePaneNowLine(
  input: TaskLineInput,
  goalText?: string | null,
): PaneTaskLine | null {
  const { now } = input;
  const facts = input.facts ?? {};
  const goal = (goalText ?? "").trim().toLowerCase();
  const take = (
    text: string | null | undefined,
    source: TaskLineSource,
    expiresAt: number | null = null,
  ): PaneTaskLine | null => {
    const value = text?.trim();
    if (!value) return null;
    if (value.toLowerCase() === goal) return null;
    if (!readsPlainly(value)) return null;
    // Now is a statement of work in progress or a completed outcome, never an
    // instruction copied from a plan ("Check the remote") or a prompt event
    // ("Prompt submitted"). Reject those here so the header falls back to the
    // truthful lifecycle state instead of presenting stale instructions as live work.
    if (!readsAsActivity(value)) return null;
    return { text: value, source, capturedAt: now, expiresAt };
  };

  const question = questionLine(facts.pendingQuestion, (candidate) => {
    const value = candidate?.trim();
    return value && readsPlainly(value) ? value : null;
  });
  if (question)
    return {
      text: question,
      source: "pending-question",
      capturedAt: now,
      expiresAt: null,
    };

  // A completed turn has no live activity. Hooks can leave the final step, report sentence,
  // or tool call in the sidecar, but keeping any of those under "Now" makes an idle card lie.
  const turnEnded =
    typeof facts.lastTurnEndAt === "number" && facts.lastTurnEndAt <= now;
  if (turnEnded) return null;

  // The agent's own in-progress step is the plainest statement of "right now" there is.
  const step = take(input.currentStep, "current-step");
  if (step) return step;

  const said = take(facts.agentSaid, "agent-said");
  if (said) return said;

  const note = take(input.recentActivity, "recent-activity");
  if (note) return note;

  if (facts.lastTool) {
    const tool = take(
      templateTool(facts.lastTool),
      "current-tool",
      now + TOOL_TTL_MS,
    );
    if (tool) return tool;
  }

  const done = take(input.lastCompletedTask, "completed-task");
  if (done) return done;

  return null;
}

export function resolvePaneTaskLine(input: TaskLineInput): PaneTaskLine {
  const { now } = input;
  const facts = input.facts ?? {};
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
  const readsAsAsk = (text: string): boolean => {
    // A concrete user question can be the work itself ("Is there a free tool I
    // can use for this?"), while a bare clarification/correction must not become
    // a durable goal. Keep the shared gate strict for the latter, but evaluate a
    // concrete question without its sentence punctuation.
    const candidate = text.replace(/\?+$/, "").trim();
    if (/^(?:what does (?:this|it) mean|what now|what changed|why no free content|how is this|where is)\b/i.test(candidate)) {
      return false;
    }
    if (
      /^(?:let['’]?s|we should)\s+continue\b/i.test(candidate) ||
      /^continue from where we left off\b/i.test(candidate) ||
      candidate.toLowerCase().startsWith("continue previous coding session")
    ) {
      return false;
    }
    return (
      qualityCheckUserAskLabel(candidate, { maxLength: TASK_LINE_MAX }).ok &&
      !UNREADABLE.test(text) &&
      !SYSTEM_BLOCK.test(text)
    );
  };

  const considerAsk = (candidate: string | null | undefined): string | null => {
    const value = candidate?.trim();
    if (!value) return null;
    // A machine slug can arrive through the sidecar's operatorRequest field even
    // when it is not a vendor title; it names a workspace, not the work itself.
    if (looksLikeSlug(value)) {
      if (!rejected) rejected = value;
      return null;
    }
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
    const lengthCheckText = value.replace(/\?+$/, "").trim();
    if (
      qualityCheckUserAskLabel(lengthCheckText, { maxLength: TASK_LINE_MAX }).reason !==
      "too-long"
    )
      return null;
    // Fitting is for a long REQUEST, not for a pasted document. The status hooks cap the
    // recorded ask at 220 characters, so anything at that scale is text the operator
    // pasted or a harness injected — 30 of the 53 over-length records on this machine
    // were exactly that (a Hebrew spec sheet, `<task-notification>` blocks, subagent
    // preambles, JS snippets), and one of them rendered as the Task row on a live pane
    // (operator report 2026-07-28). Its first 92 characters are never the ask.
    if (
      value.length >= 1_000 ||
      (value.length >= 200 && !startsWithRequestAction(value)) ||
      SYSTEM_BLOCK.test(value)
    ) {
      if (!rejected) rejected = value;
      return null;
    }
    const fitted = truncateAtWordBoundary(value, TASK_LINE_MAX);
    return readsAsAsk(fitted) ? fitted : null;
  };

  // A hook-marked opening request is already provenance-bound to the operator's
  // conversation. Keep that request's wording even when the generic ask gate rejects
  // informal first-person phrasing; structural junk, paths, and pasted harness text
  // still fail closed.
  const considerAuthoritativeOpening = (
    candidate: string | null | undefined,
  ): string | null => {
    const value = candidate?.trim();
    if (
      !value ||
      SYSTEM_BLOCK.test(value) ||
      UNREADABLE.test(value) ||
      refersOnlyToExistingWork(value)
    )
      return null;
    const fitted = truncateAtWordBoundary(value, TASK_LINE_MAX);
    const quality = qualityCheckAuthoritativeTaskLabel(fitted, {
      maxLength: TASK_LINE_MAX,
      allowMetaProcess: true,
    });
    if (quality.ok) return fitted;
    // Opening requests are the operator's provenance-bearing words. The generic
    // quality gate intentionally rejects prompt-shaped complaints, but that semantic
    // rejection must not erase an otherwise readable opening request from the card.
    if (
      !["prompt-fragment", "vague"].includes(quality.reason ?? "") ||
      fitted.length < 20 ||
      !/\s/.test(fitted) ||
      /^(?:go|done|sure|yes|ok|continue|proceed)\b/i.test(fitted)
    ) {
      return null;
    }
    if (
      /(?:hard fail|low quality|not enough context|didn['’]?t fix|didn['’]?t work|nothing to show for it)/i.test(
        fitted,
      )
    ) {
      return null;
    }
    return fitted;
  };

  // MAIN-PLAN sources lead the line: the whole point is "what is this part of".
  // An explicit overarching goal, then the session's own plan title, then the
  // operator's main request — all rank ABOVE the momentary in-progress step.
  // A GOAL does not expire when a turn ends: what the pane is ABOUT is still true while
  // it sits idle, and blanking it left finished panes saying "No task declared" with a
  // perfectly good goal on record. Only the moment expires — that is `resolvePaneNowLine`
  // and the summarizer's `expired` flag.
  {
    const planNote = input.mainGoalSource === "plan-explanation";
    const explicitlyDeclaredGoal =
      !input.mainGoalSource || input.mainGoalSource === "goal-task";
    const goal = explicitlyDeclaredGoal
      ? considerLongAsk(input.mainGoal ?? input.declaredTask)
      : null;
    if (goal) {
      return {
        text: goal,
        source: "declared",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    const planPurpose = facts.planPurpose && readsAsAsk(facts.planPurpose)
      ? facts.planPurpose.trim()
      : null;
    if (planPurpose) {
      return {
        text: planPurpose,
        source: "plan-purpose",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // The active plan step is progress, not the durable goal. It is resolved by
    // resolvePaneNowLine and must never fill the Task row when no user-facing goal
    // was captured first.
    // An OVERARCHING description leads when the vendor wrote one. Claude keeps its own
    // session title current as the work drifts, so it answers "what is this pane about"
    // in a way no single message does: the rows underneath are mid-conversation replies
    // ("add it yoyurself", "how can I find this from the cms?") that read as chatter to
    // anyone who was not in the room (operator, 2026-07-28). A SLUG title is not a
    // description, so it stays below the operator's own words, de-slugged, further down.
    // A session title is a summary the vendor wrote FOR a person, so it is judged for
    // readability, not for polish: the strict gate called "Debug mobile audio and boot
    // sequence on real device" an implementation detail and threw away a perfectly clear
    // description of the pane.
    // The operator's OPENING ask is the durable source of intent. Vendor-generated
    // titles can mutate into slugs or completion reports as a session progresses, so
    // they may summarize a goal only when the original request is unavailable.
    const explicitOpening =
      input.mainGoalSource === "opening-request"
        ? considerAuthoritativeOpening(stripComposerChrome(input.mainGoal))
        : null;
    const opening =
      explicitOpening ??
      considerLongAsk(stripComposerChrome(facts.openingRequest));
    if (opening) {
      return {
        text: opening,
        source: "opening-request",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    const readableTitle =
      facts.title &&
      !looksLikeSlug(facts.title) &&
      !isCompletionReport(facts.title) &&
      !refersOnlyToExistingWork(facts.title)
        ? considerAsk(facts.title)
        : null;
    if (readableTitle) {
      return {
        text: readableTitle,
        source: "session-title",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // Only then the newest request — for a session whose opening message was a nudge.
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
    // Only now the agent's plan NOTE, when nothing above spoke. It is still the agent's
    // own statement about the work, so it beats saying nothing.
    if (planNote) {
      const note = considerLongAsk(input.mainGoal ?? input.declaredTask);
      if (note) {
        return {
          text: note,
          source: "declared",
          capturedAt: now,
          expiresAt: null,
          rejected,
        };
      }
    }
    const reportPurpose = facts.title
      ? consider(completionReportPurpose(facts.title))
      : null;
    if (reportPurpose) {
      return {
        text: reportPurpose,
        source: "session-title",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    }
    // A slug is the agent's own words, just written for a machine. Spacing it out is
    // formatting, not invention — and it is only ever reached when nothing above spoke.
    const desluggedTitle = deslug(facts.title);
    const title =
      desluggedTitle &&
      (desluggedTitle.toLowerCase().startsWith("continue previous coding session") ||
        desluggedTitle.toLowerCase().startsWith("continue from where we left off"))
        ? null
        : consider(desluggedTitle);
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

  // Everything momentary — the in-progress step, the agent's last sentence, the tool of
  // the second, the last finished step, the latest note — is NOT a goal, and no longer
  // competes for this row. `resolvePaneNowLine` resolves those separately and the card
  // renders them UNDER the goal, which is the layout the operator chose. Leaving them
  // here is what put "Updating the plan" in the goal row and changed it every few
  // seconds (report 2026-07-28).

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

  // The pane's own FINISHED plan, before giving up: an idle agent whose only record of
  // the work is its completed task list still has a goal on record — the last completed
  // step is the agent's own one-line statement of what the pane was about ("Closing the
  // payment release with evidence"). It sits this low because it is history, not intent:
  // any declared goal, ask, title or live command above it still wins, and it is static
  // while the pane idles so the row cannot flicker (the reason momentary sources were
  // banished from this row). Junk is filtered by the same plain-language gate as
  // everything else. Live case: pane-6d077586 (2026-07-30) — ask was "go", all todos
  // completed with empty activeForms, row said "No task declared".
  const finishedPlan = consider(input.lastCompletedTask);
  if (finishedPlan) {
    return {
      text: finishedPlan,
      source: "completed-task",
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
    rejected: rejected ?? input.currentStep?.trim(),
  };
}
