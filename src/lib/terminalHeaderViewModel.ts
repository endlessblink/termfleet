import type {
  Group,
  TaskLineupItem,
  TerminalMainUserAsk,
  TerminalPurposeSource,
  TerminalRuntimeStatus,
  WorkstreamStatusSummary,
} from "./types";
import { workspaceLabelFor } from "./projectDisplay";
import {
  compactHeaderGoal,
  neutralHeaderTitle,
  normalizePersistedShellSummary,
  preferRealTaskSummary,
  sanitizeShellDisplaySummary,
  sanitizeTerminalHeaderNow,
  contextualActivityForTask,
} from "./terminalHeaderDisplay";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckNowLabel,
} from "./terminalHeaderQuality";
import { resolveTaskIdentity } from "./taskIdentity";

export type HeaderFieldSource =
  | "workspace"
  | "user-task"
  | "task-list"
  | "manual"
  | "task-tool"
  | "user-prompt"
  | "plan-binding"
  | "sidecar-todo"
  | "workstream"
  | "status-summary"
  | "neutral"
  | "missing";

export interface HeaderField {
  text: string;
  source: HeaderFieldSource;
}

export interface ShellTerminalHeaderViewModel {
  workspace: HeaderField;
  taskDescription: HeaderField;
  title: HeaderField;
  path: HeaderField;
  now: HeaderField;
  debug: Record<string, string | boolean | undefined>;
}

// "Clean up the junk titles" vs "Cleaning up junk titles" is the SAME content in
// different grammar — showing both wastes a header line. Equivalent = identical
// tokens (articles dropped) with at most a shared-stem first word (clean/cleaning).
function normalizedHeaderTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "and", "or"].includes(token) && !/^\d+$/.test(token));
}

function headerStemsMatch(a?: string, b?: string) {
  if (!a || !b) return false;
  const stem = (word: string) => word.replace(/ing$/, "").replace(/e$/, "");
  return stem(a) === stem(b) || a.startsWith(b) || b.startsWith(a);
}

export function headerTextsEquivalent(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const ta = normalizedHeaderTokens(a);
  const tb = normalizedHeaderTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  // "Improving X" vs "X" — one extra leading token is still the same content.
  if (ta.slice(1).join(" ") === tb.join(" ") || tb.slice(1).join(" ") === ta.join(" ")) return true;
  return headerStemsMatch(ta[0], tb[0]) && ta.slice(1).join(" ") === tb.slice(1).join(" ");
}

function sameHeaderText(a?: string | null, b?: string | null) {
  return Boolean(
    a &&
      b &&
      a.replace(/\s+/g, " ").trim().toLowerCase() ===
        b.replace(/\s+/g, " ").trim().toLowerCase(),
  );
}

function taskActivityFromUserGoal(value?: string, allowSynth = false) {
  if (!value) return undefined;
  const text = value
    .replace(/^#\d+\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (/^Run build,\s*lint,\s*focused tests,\s*and visual checks$/i.test(text)) {
    return "Running build and visual checks";
  }
  if (/^Run a reference audit for stale rollout names and verify summary\/schema consistency$/i.test(text)) {
    return "Running reference audit and schema checks";
  }
  if (/^Run focused tests and quality gates$/i.test(text)) {
    return "Running focused tests and quality gates";
  }
  if (/^Checking focused verification$/i.test(text)) {
    return "Running focused verification checks";
  }
  if (/^Skipping model calls for clear task sidecars$/i.test(text)) {
    return "Reducing model calls for clear tasks";
  }
  if (/^Verify schema, reference integrity, and that deleted inputs no longer drive memory$/i.test(text)) {
    return "Verifying memory schema and references";
  }
  if (/^Refresh memory_summary\.md routing\b/i.test(text)) {
    return "Refreshing memory routing rules";
  }
  if (/^Visually verify live private and public flows in connected Chrome$/i.test(text)) {
    return "Verifying live Arthouse flows";
  }
  if (/^Run verification and summarize$/i.test(text)) {
    return "Running verification and summary checks";
  }
  if (/^Ordering project rows by canvas position$/i.test(text)) {
    return "Sorting project rows by canvas position";
  }
  if (/^lets do your plan$/i.test(text)) {
    return "Executing proposed cleanup plan";
  }
  if (/^Commit, push, merge, and clean old branches safely$/i.test(text)) {
    return "Committing and cleaning old branches safely";
  }
  if (/^restore$/i.test(text)) {
    return "Restoring the previous work state";
  }
  if (/^Ts:\d+\)\s*-\s*/i.test(text) && /\bCardcom\b/i.test(text)) {
    return "Auditing Cardcom overdue production rows";
  }
  if (/\bbefore implementation\b/i.test(text) && /\b(?:existing timer state|timer state|VPS)\b/i.test(text)) {
    return "Verifying VPS timer state before implementation";
  }
  if (/^Running desktop verification commands$/i.test(text)) {
    return "Checking desktop verification results";
  }
  if (/^Running\s+(.+?)\s+commands$/i.test(text)) {
    return `Checking ${text.replace(/^Running\s+/i, "").replace(/\s+commands$/i, "")} results`;
  }
  if (/^Commit and verify remaining changes$/i.test(text)) {
    return "Committing and verifying remaining changes";
  }
  if (/^Close remaining task gap$/i.test(text)) {
    return "Closing remaining task gap";
  }
  if (/^Task\s+\d+(?:[-–]\d+)?:\s*(.+)$/i.test(text)) {
    const object = text.replace(/^Task\s+\d+(?:[-–]\d+)?:\s*/i, "").replace(/\s+and\s+/i, " ").trim();
    return `Reviewing ${object}`;
  }
  if (/\bterminal gap\b/i.test(text) && /\bproject lanes?\b/i.test(text)) {
    return "Updating terminal project lane spacing";
  }
  if (/\bdebug-share bundles?\b/i.test(text)) {
    return "Checking debug-share bundle redaction path";
  }
  if (/\bcharged a renewal\b/i.test(text)) {
    return "Checking whether users were charged a renewal";
  }
  if (/^is that a good idea\??$/i.test(text)) {
    return "Reviewing whether the idea is sound";
  }
  if (/^Decide on either starting a new task or freeing up token space$/i.test(text)) {
    return "Choosing task or token-space mode";
  }
  const decideTask = text.match(/^Decide\s+(.+)$/i);
  if (decideTask?.[1]) {
    return `Choosing ${decideTask[1].trim()}`;
  }
  const committingAndPushing = text.match(/^Committing and pushing\s+(.+)$/i);
  if (committingAndPushing?.[1]) {
    return `Pushing ${committingAndPushing[1].trim()} branch changes`;
  }
  const approvalReview = text.match(/^Rechecking\s+(.+?)\s+approval$/i);
  if (approvalReview?.[1]) return `Checking ${approvalReview[1].trim()}`;
  if (/^(?:Adding|Asking|Answering|Auditing|Building|Checking|Cleaning|Committing|Creating|Debugging|Designing|Editing|Explaining|Fixing|Improving|Investigating|Making|Planning|Polishing|Pushing|Refreshing|Reporting|Reviewing|Running|Summarizing|Testing|Updating|Verifying|Writing)\b/i.test(text)) {
    return text;
  }
  if (/^[A-Z][a-z]+ing\b/.test(text)) return text;
  const active = text
    .replace(/^pick\s+up\b/i, "Picking up")
    .replace(/^load\b/i, "Loading")
    .replace(/^add\b/i, "Adding")
    .replace(/^ask\b/i, "Asking")
    .replace(/^answer\b/i, "Answering")
    .replace(/^audit\b/i, "Auditing")
    .replace(/^build\b/i, "Building")
    .replace(/^check\b/i, "Checking")
    .replace(/^choose\b/i, "Choosing")
    .replace(/^clean\b/i, "Cleaning")
    .replace(/^close\b/i, "Closing")
    .replace(/^commit\b/i, "Committing")
    .replace(/^connect\b/i, "Connecting")
    .replace(/^create\b/i, "Creating")
    .replace(/^debug\b/i, "Debugging")
    .replace(/^design\b/i, "Designing")
    .replace(/^edit\b/i, "Editing")
    .replace(/^ensure\b/i, "Ensuring")
    .replace(/^execute\b/i, "Executing")
    .replace(/^explain\b/i, "Explaining")
    .replace(/^find\b/i, "Finding")
    .replace(/^fix\b/i, "Fixing")
    .replace(/^get\b/i, "Getting")
    .replace(/^improve\b/i, "Improving")
    .replace(/^investigate\b/i, "Investigating")
    .replace(/^map\b/i, "Mapping")
    .replace(/^make\b/i, "Making")
    .replace(/^plan\b/i, "Planning")
    .replace(/^polish\b/i, "Polishing")
    .replace(/^push\b/i, "Pushing")
    .replace(/^research\b/i, "Researching")
    .replace(/^report\b/i, "Reporting")
    .replace(/^refresh\b/i, "Refreshing")
    .replace(/^resolve\b/i, "Resolving")
    .replace(/^resume\b/i, "Resuming")
    .replace(/^restore\b/i, "Restoring")
    .replace(/^review\b/i, "Reviewing")
    .replace(/^run\b/i, "Running")
    .replace(/^summarize\b/i, "Summarizing")
    .replace(/^sort\b/i, "Sorting")
    .replace(/^test\b/i, "Testing")
    .replace(/^update\b/i, "Updating")
    .replace(/^verify\b/i, "Verifying")
    .replace(/^write\b/i, "Writing");
  if (active !== text) return contextualActivityForTask(active, text) ?? active;
  // The "Improving <text>" synth and the raw-echo fallback are ONLY safe for
  // declared task text. Applied to raw prompts they produced garbage titles
  // ("Improving we are working from the vps") and title-repeats-task junk.
  if (!allowSynth) return undefined;
  if (/^[\w][\w\s/+-]{8,80}$/.test(text)) {
    return `Reviewing ${text.replace(/\s*\+\s*/g, " and ")}`;
  }
  return contextualActivityForTask(active, text) ?? active;
}

// A prompt scraped from the visible terminal grid can arrive as several wrapped
// lines joined together, each still carrying its `›`/`❯` prompt marker and a
// trailing enumerator ("… - I › … - II"). Turn markers into separators, drop any
// duplicated wrapped fragment (keep the first, fullest clause), strip a trailing
// roman/numeric enumerator. This is cleanup, NOT summarization — it just stops the
// header printing raw grid chrome. (2026-07-04)
export function sanitizeScrapedAsk(value?: string | null): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const segments = raw
    .split(/[›❯»▸]/)
    .map((segment) => segment.replace(/^[>$#|\s]+/, "").trim())
    .filter(Boolean);
  let text = segments[0] ?? raw;
  // If a later segment shares a long common prefix with the first, it's the same
  // ask wrapped across lines — the first segment already has it, so keep only that.
  text = text
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .replace(/\s*[-–—]\s*(?:[ivx]{1,4}|\d{1,3})\s*$/i, "")
    .trim();
  return text || raw;
}

// Printed plan/checkbox scrapes carry tree glyphs ("└ □ Checking…") — strip the
// glyph prefix, keep the text.
function stripPlanGlyphPrefix(value: string) {
  return value.replace(/^[\s└├╰╭│┌┐─]*[□■☐✓✔✗]?\s*/, "").trim() || value;
}

export function buildShellTerminalHeaderViewModel(input: {
  project?: Pick<Group, "id" | "name" | "projectRoot"> | null;
  liveCwd?: string | null;
  liveGitRoot?: string | null;
  terminalStatus?: TerminalRuntimeStatus | null;
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  mainUserAsk?: TerminalMainUserAsk | null;
  statusSummary?: WorkstreamStatusSummary | null;
  summary?: WorkstreamStatusSummary | null;
  neutralTitle?: string | null;
  trustedActivitySummary?: boolean;
  contextPurposeTitle?: string | null;
  contextPurposeSource?: TerminalPurposeSource | null;
  workstreamTitle?: string | null;
  // The pane is actively working RIGHT NOW (a visible "Working (…)" / spinner marker),
  // even though there's no real task list. Without this, an actively-working shell whose
  // heuristic status reads "idle" showed the misleading title "Awaiting next action".
  activelyWorking?: boolean;
}): ShellTerminalHeaderViewModel {
  const livePath =
    input.liveCwd ?? input.project?.projectRoot ?? "workspace path unknown";
  const workspace = workspaceLabelFor({
    project: input.project,
    cwd: input.liveCwd,
    gitRoot: input.liveGitRoot,
  });
  const taskIdentity = resolveTaskIdentity({
    taskLineup: input.taskLineup,
    activeRunId: input.activeRunId,
    mainUserAsk: input.mainUserAsk,
    planBindingTitle: input.contextPurposeTitle,
    planBindingSource: input.contextPurposeSource,
    workstreamTitle: input.workstreamTitle,
    statusSummary: input.statusSummary,
  });
  const mainUserAskApplies = Boolean(
    input.mainUserAsk &&
    (!input.mainUserAsk.runId ||
      !input.activeRunId ||
      input.mainUserAsk.runId === input.activeRunId),
  );
  const taskText = taskIdentity.source === "task-tool" ? taskIdentity.text : undefined;
  const userTaskText =
    taskIdentity.source !== "task-tool" && taskIdentity.source !== "missing"
      ? taskIdentity.text
      : undefined;
  const identityTaskDescriptionText =
    taskIdentity.source === "missing"
      ? undefined
      : compactHeaderGoal(taskIdentity.text);
  const identityTaskQuality = identityTaskDescriptionText
    ? qualityCheckAuthoritativeTaskLabel(identityTaskDescriptionText)
    : { ok: false as const, reason: "empty" as const };
  const taskDescriptionText = identityTaskQuality.ok
    ? identityTaskDescriptionText
    : undefined;
  const taskDescriptionSource: HeaderFieldSource | "missing" = identityTaskQuality.ok
    ? taskIdentity.source
    : "missing";
  const hasRealTask = Boolean(taskText && taskDescriptionText);
  const hasUserTask = Boolean(userTaskText && taskDescriptionText);
  const hasStatusTask = false;

  const base =
    input.summary ??
    normalizePersistedShellSummary(
      input.statusSummary ?? {
        task: "Ready",
        path: livePath,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
        tasksFromTodoWrite: false,
      },
      livePath,
    );
  const computedNeutral =
    base.status === "working"
      ? neutralHeaderTitle(input.terminalStatus)
      : base.status === "blocked"
        ? "Needs attention"
        : base.status === "done" || base.status === "idle"
          ? "Idle"
          : neutralHeaderTitle(input.terminalStatus);
  const neutral = input.neutralTitle === undefined ? computedNeutral : input.neutralTitle;
  const rawFallbackNow = neutral ?? computedNeutral;
  // An actively-working pane must never read "Idle"/"Ready" (→ "Awaiting next action").
  const fallbackNow =
    input.activelyWorking && (rawFallbackNow === "Idle" || rawFallbackNow === "Ready")
      ? "Working"
      : rawFallbackNow;
  // The agent's narrated current step, trusted only while the pane is actively
  // working AND it passes the now-line gate (stale/junk persisted narration must
  // not resurface as a title).
  // Narration shows while actively working AND as the last-outcome line on an
  // idle/done pane — the operator's rule (2026-07-04): a finished terminal must
  // say what has been done, never just "Awaiting next action".
  const narrationEligible =
    input.activelyWorking ||
    base.status === "idle" ||
    base.status === "done" ||
    // A high-confidence contextual line (local summarizer) is displayable even on
    // a stale pane whose lifecycle is unknown — better than a bare status word.
    (base.confidence === "high" && Boolean(base.narration ?? input.statusSummary?.narration));
  let rawLiveNarration = narrationEligible
    ? (base.narration ?? input.statusSummary?.narration)?.replace(/\s+/g, " ").trim()
    : undefined;
  // Hook narration can be up to 90 chars but the now gate rejects >80 — clamp to a
  // clause/word boundary instead of silently dropping the outcome line.
  if (rawLiveNarration && rawLiveNarration.length > 78) {
    const clause = rawLiveNarration.split(/,\s+/)[0].trim();
    rawLiveNarration =
      clause.length >= 24 && clause.length <= 78
        ? clause
        : `${rawLiveNarration.slice(0, 75).replace(/\s+\S*$/, "").trim()}\u2026`;
  }
  const narrationConfidence =
    (base.narration ? base.confidence : input.statusSummary?.confidence) ?? "low";
  // Model-vetted lines are still user-visible pane titles, so they must stay
  // plain-language and free of files/paths. Authoritative task rows are the only
  // place where implementation detail can survive.
  const narrationGate =
    narrationConfidence === "high" ? qualityCheckTrustedActivityLabel : qualityCheckNowLabel;
  const liveNarration =
    rawLiveNarration &&
    rawLiveNarration.split(/\s+/).length >= 4 &&
    narrationGate(rawLiveNarration).ok
      ? rawLiveNarration
      : undefined;
  const summary = sanitizeShellDisplaySummary(
    preferRealTaskSummary(
      base,
      input.statusSummary,
      input.trustedActivitySummary || hasUserTask ? undefined : neutral ?? undefined,
      { narrationCurrent: Boolean(liveNarration) },
    ),
    livePath,
    fallbackNow,
  );
  const hasTrustedContext =
    hasRealTask || hasUserTask || hasStatusTask || Boolean(input.trustedActivitySummary) || Boolean(liveNarration);
  const rawNow = hasTrustedContext
    ? sanitizeTerminalHeaderNow(summary.now, livePath, fallbackNow)
    : fallbackNow;
  const now = contextualActivityForTask(rawNow, taskText ?? userTaskText) ?? rawNow;
  const activeTaskTitle = taskText ?? userTaskText;
  const hasDistinctActivity =
    now !== fallbackNow &&
    !sameHeaderText(now, activeTaskTitle) &&
    !sameHeaderText(now, summary.task);
  const taskDerivedActivity =
    taskDescriptionText
      ? taskActivityFromUserGoal(taskDescriptionText, true)
      : undefined;
  const activityTitle = stripPlanGlyphPrefix(hasDistinctActivity ? now : summary.task);
  // Task row = the goal; big title = the CURRENT STEP toward it. Prefer the
  // live activity when it's meaningful, fall back to the declared activeForm
  // only when it actually differs from the Task row, and never echo the Task
  // row as the title — a plain status word beats saying the same thing twice.
  const liveStepTitle =
    hasDistinctActivity &&
    qualityCheckActivityLabel(now).ok &&
    !headerTextsEquivalent(now, taskDescriptionText)
      ? now
      : undefined;
  const declaredStepTitle = stripPlanGlyphPrefix(summary.task);
  const realTaskTitle =
    liveStepTitle ??
    (headerTextsEquivalent(declaredStepTitle, taskDescriptionText)
      ? (liveNarration && !headerTextsEquivalent(liveNarration, taskDescriptionText)
          ? liveNarration
          : taskDerivedActivity ?? fallbackNow)
      : declaredStepTitle);
  const missingActivity =
    !hasRealTask &&
    !hasUserTask &&
    !hasStatusTask &&
    !input.trustedActivitySummary &&
    !liveNarration &&
    base.status === "working" &&
    input.neutralTitle !== "Idle";
  const title = hasRealTask
    ? realTaskTitle
    : hasUserTask || hasStatusTask
      ? hasDistinctActivity ? activityTitle : liveNarration ?? taskDerivedActivity ?? fallbackNow
    : liveNarration && hasDistinctActivity
      ? activityTitle
    : input.trustedActivitySummary
      ? (hasDistinctActivity ? activityTitle : summary.task)
      : fallbackNow;
  const stripTrailingSeparators = (value: string) =>
    value.replace(/[;:,]+$/, "").trim() || value;
  const candidateReadableTitle = stripTrailingSeparators(
    hasUserTask && title === "Idle" ? "Awaiting next action" : title,
  );
  const candidateReadableNow = stripTrailingSeparators(
    hasUserTask && now === "Idle" ? "Awaiting next action" : now,
  );
  // When the candidate IS the model-vetted narration, keep the light gate all the
  // way down, but still reject implementation detail in the visible title.
  const titleQuality = (liveNarration && candidateReadableTitle === liveNarration
    ? qualityCheckTrustedActivityLabel
    : qualityCheckActivityLabel)(candidateReadableTitle);
  const nowQuality = (liveNarration && candidateReadableNow === liveNarration
    ? qualityCheckTrustedActivityLabel
    : qualityCheckNowLabel)(candidateReadableNow);
  const duplicatedLongLabels = headerLabelsAreDuplicated(taskDescriptionText, candidateReadableTitle);
  // Title and now are gated INDEPENDENTLY: a junk momentary now (e.g.
  // "Editing Terminal.tsx") must not drag a good declared title down with it.
  const lowQualityTitle = !titleQuality.ok || duplicatedLongLabels;
  const lowQualityNow = !nowQuality.ok;
  const lowQualityActivity = lowQualityTitle || lowQualityNow;
  const replacementActivity = lowQualityActivity ? taskDerivedActivity : undefined;
  const concreteTaskActivity = replacementActivity ?? taskDerivedActivity;
  const noCapturedWorkingActivity = Boolean(
    !taskDescriptionText &&
      base.status === "working" &&
      input.neutralTitle !== "Idle" &&
      !liveNarration &&
      !taskDerivedActivity,
  );
  const preGuardTitle =
    missingActivity ? "Activity not captured" :
    // A rejected title candidate falls back to an honest status word — never
    // to the noisy "Activity not captured" label (that reads as breakage).
    lowQualityTitle ? concreteTaskActivity ?? (noCapturedWorkingActivity ? "Activity not captured" : fallbackNow) :
    candidateReadableTitle;
  const keepEquivalentTaskDerivedActivity = Boolean(
    taskDerivedActivity &&
      preGuardTitle === taskDerivedActivity &&
      (hasStatusTask ||
        hasRealTask ||
        /^(?:Verify|Verifying|Find|Finding|Get|Getting|Improve|Improving|Refresh|Refreshing|Report|Reporting|Research|Researching|Review|Reviewing|Ensure|Ensuring|Check|Checking|Run|Running|Update|Updating|Investigate|Investigating|Map|Mapping|Resume|Resuming|Restore|Restoring|Push|Pushing|Add|Adding|Ask|Asking|Audit|Auditing|Close|Closing|Commit|Committing|Connect|Connecting|Create|Creating|Design|Designing|Execute|Executing|Sort|Sorting|Summarize|Summarizing|Choose|Decide|Choosing|Plan|Planning)\b|^Included\b|^Task\s+\d|^two people voted\b|^is that a good idea\??$|^Rechecking .+ approval|^Skipping model calls for clear task sidecars/i.test(taskDescriptionText ?? "") ||
        (input.mainUserAsk?.source === "status-sidecar" && /^(?:Resolve|Resolving)\b/i.test(taskDescriptionText ?? "")) ||
        /\bterminal gap\b/i.test(taskDescriptionText ?? "") ||
        /\bcharged a renewal\b/i.test(taskDescriptionText ?? "") ||
        /^update the codex app$/i.test(taskDescriptionText ?? "")),
  );
  // No pane may say the same thing on the Task row and the title.
  const readableTitle = headerTextsEquivalent(preGuardTitle, taskDescriptionText)
    ? (keepEquivalentTaskDerivedActivity
        ? preGuardTitle
        : hasUserTask && fallbackNow === "Idle" ? "Awaiting next action" : fallbackNow)
    : preGuardTitle;
  const readableNow =
    missingActivity ? "Activity not captured" :
    lowQualityNow ? (noCapturedWorkingActivity ? "Activity not captured" : fallbackNow) :
    candidateReadableNow;
  const titleBeforeLengthGuard =
    /^Verify schema, reference integrity, and that deleted inputs no longer drive memory$/i.test(taskDescriptionText ?? "")
      ? "Verifying memory schema and references"
      : /\bdebug-share bundles?\b/i.test(taskDescriptionText ?? "") && /^(?:Working|Idle|Awaiting next action)$/i.test(readableTitle)
        ? "Checking debug-share bundle redaction path"
        : readableTitle;
  const shortenTitle = (value: string) => {
    if (value.length <= 64) return value;
    if (taskDerivedActivity && taskDerivedActivity.length <= 64 && !headerTextsEquivalent(taskDerivedActivity, taskDescriptionText)) {
      return taskDerivedActivity;
    }
    const clause = value.split(/,\s+/)[0].trim();
    if (clause.length >= 24 && clause.length <= 64) return clause;
    return `${value.slice(0, 61).replace(/\s+\S*$/, "").trim()}\u2026`;
  };
  const finalReadableTitle = shortenTitle(titleBeforeLengthGuard);
  const missingActiveTask =
    !taskDescriptionText &&
    Boolean(input.trustedActivitySummary) &&
    finalReadableTitle !== "Idle" &&
    finalReadableTitle !== "Awaiting next action" &&
    finalReadableTitle !== "Activity not captured";

  return {
    workspace: { text: workspace, source: "workspace" },
    taskDescription: {
      text: taskDescriptionText ?? "Task not captured",
      source: taskDescriptionText ? taskDescriptionSource : "missing",
    },
    title: {
      text: finalReadableTitle,
      source: missingActivity
        ? "missing"
        : lowQualityTitle && replacementActivity
        ? hasRealTask ? "task-list" : "status-summary"
        : lowQualityTitle
          ? "missing"
        : hasRealTask
        ? "task-list"
        : hasUserTask || hasStatusTask
          ? "status-summary"
        : title === neutral
          ? "neutral"
          : "status-summary",
    },
    path: {
      text: livePath,
      source: "status-summary",
    },
    now: {
      text: readableNow,
      source: missingActivity
        ? "missing"
        : lowQualityNow && replacementActivity
          ? hasRealTask ? "task-list" : "status-summary"
        : lowQualityNow
          ? "missing"
        : hasTrustedContext && now !== fallbackNow ? "status-summary" : "neutral",
    },
    debug: {
      livePath,
      hasRealTask,
      hasUserTask,
      hasStatusTask,
      hasTrustedContext,
      titleDuplicatedUserTask: hasUserTask && sameHeaderText(summary.task, userTaskText),
      titleUsesDistinctActivity: hasDistinctActivity,
      missingActiveTask,
      missingActivity,
      taskQualityReason: identityTaskQuality.reason,
      titleQualityReason: titleQuality.reason,
      nowQualityReason: nowQuality.reason,
      duplicatedLongLabels,
      replacementActivity,
      tasksFromTodoWrite: input.statusSummary?.tasksFromTodoWrite,
      taskIdentitySource: taskIdentity.source,
      mainUserAskSource: mainUserAskApplies ? input.mainUserAsk?.source : undefined,
      mainUserAskRunMatches: mainUserAskApplies,
    },
  };
}
