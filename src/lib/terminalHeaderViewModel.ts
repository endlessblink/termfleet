import type {
  Group,
  TaskLineupItem,
  TerminalMainUserAsk,
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
  qualityCheckNowLabel,
  qualityCheckUserAskLabel,
} from "./terminalHeaderQuality";
import { visibleTaskLineup } from "./taskLineup";

export type HeaderFieldSource =
  | "workspace"
  | "user-task"
  | "task-list"
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
  if (/\braise quality\b/i.test(text)) return "Improving quality";
  if (/^(?:Adding|Answering|Auditing|Building|Checking|Cleaning|Creating|Debugging|Editing|Explaining|Fixing|Improving|Investigating|Making|Planning|Polishing|Reviewing|Running|Testing|Updating|Verifying|Writing)\b/i.test(text)) {
    return text;
  }
  if (/^[A-Z][a-z]+ing\b/.test(text)) return text;
  const active = text
    .replace(/^pick\s+up\b/i, "Picking up")
    .replace(/^load\b/i, "Loading")
    .replace(/^add\b/i, "Adding")
    .replace(/^answer\b/i, "Answering")
    .replace(/^audit\b/i, "Auditing")
    .replace(/^build\b/i, "Building")
    .replace(/^check\b/i, "Checking")
    .replace(/^clean\b/i, "Cleaning")
    .replace(/^create\b/i, "Creating")
    .replace(/^debug\b/i, "Debugging")
    .replace(/^edit\b/i, "Editing")
    .replace(/^explain\b/i, "Explaining")
    .replace(/^fix\b/i, "Fixing")
    .replace(/^improve\b/i, "Improving")
    .replace(/^investigate\b/i, "Investigating")
    .replace(/^make\b/i, "Making")
    .replace(/^plan\b/i, "Planning")
    .replace(/^polish\b/i, "Polishing")
    .replace(/^review\b/i, "Reviewing")
    .replace(/^run\b/i, "Running")
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
    return `Improving ${text.replace(/\s*\+\s*/g, " and ")}`;
  }
  return contextualActivityForTask(active, text) ?? active;
}

// Leading conversational filler ("ok so ", "hey ", "please ") adds nothing on a
// cockpit Task row — strip it so the ask starts at the verb/subject.
function stripConversationalOpeners(value: string) {
  return value.replace(/^(?:(?:ok(?:ay)?|so|hey|please|also|and|now|then)[,\s]+)+/i, "").trim() || value;
}

// Printed plan/checkbox scrapes carry tree glyphs ("└ □ Checking…") — strip the
// glyph prefix, keep the text.
function stripPlanGlyphPrefix(value: string) {
  return value.replace(/^[\s└├╰╭│┌┐─]*[□■☐✓✔✗]?\s*/, "").trim() || value;
}

function readableUserTaskLabel(value?: string) {
  const text = value
    ?.replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;

  const subParSubject = text.match(/^(.{4,48}?)\s+(?:is|are|feels?|seems?)\s+(?:sub[-\s]?par|bad|weak|poor|not\s+good)\b/i)?.[1];
  if (subParSubject) {
    return `Improve ${subParSubject.replace(/^the\s+/i, "the ").trim()}`;
  }

  const beforeQuestionRequest = text
    .replace(/\s+(?:ask\s+me\s+questions?|question\s+me)\b.*$/i, "")
    .replace(/\s+(?:so|to)\s+(?:you\s+can\s+)?understand\b.*$/i, "")
    .trim();
  if (beforeQuestionRequest && beforeQuestionRequest.length >= 8 && beforeQuestionRequest !== text) {
    return beforeQuestionRequest;
  }

  return undefined;
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
}): ShellTerminalHeaderViewModel {
  const livePath =
    input.liveCwd ?? input.project?.projectRoot ?? "workspace path unknown";
  const workspace = workspaceLabelFor({
    project: input.project,
    cwd: input.liveCwd,
    gitRoot: input.liveGitRoot,
  });
  const visibleTasks = visibleTaskLineup(input.taskLineup, input.activeRunId);
  const todoTasks = visibleTasks.filter((task) => task.source === "todo-write");
  const activeTask =
    todoTasks.find((task) => task.status === "in_progress") ?? todoTasks[0];
  const taskText =
    activeTask?.content ??
    (input.statusSummary?.tasksFromTodoWrite
      ? input.statusSummary.task
      : undefined);
  const mainUserAskApplies = Boolean(
    input.mainUserAsk &&
    (!input.mainUserAsk.runId ||
      !input.activeRunId ||
      input.mainUserAsk.runId === input.activeRunId),
  );
  const rawUserTaskText = mainUserAskApplies ? input.mainUserAsk?.text.trim() || undefined : undefined;
  const userTaskText = rawUserTaskText ? stripConversationalOpeners(rawUserTaskText) : undefined;
  const readableUserTaskText = taskText ? undefined : readableUserTaskLabel(userTaskText);
  const authoritativeTaskText = compactHeaderGoal(taskText);
  const scrapedTaskText =
    compactHeaderGoal(readableUserTaskText) ?? compactHeaderGoal(userTaskText);
  const rawTaskDescriptionText = authoritativeTaskText ?? scrapedTaskText;
  // The declared todo-write task is authoritative: it skips the scrape-only
  // command/path heuristics but still rejects raw-prompt junk.
  const taskQuality = authoritativeTaskText
    ? qualityCheckAuthoritativeTaskLabel(authoritativeTaskText)
    : qualityCheckUserAskLabel(scrapedTaskText);
  const taskDescriptionText = taskQuality.ok ? rawTaskDescriptionText : undefined;
  const hasRealTask = Boolean(taskText && taskDescriptionText);
  const hasUserTask = Boolean(userTaskText && taskDescriptionText);

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
  const fallbackNow = neutral ?? computedNeutral;
  const summary = sanitizeShellDisplaySummary(
    preferRealTaskSummary(
      base,
      input.statusSummary,
      input.trustedActivitySummary || hasUserTask ? undefined : neutral ?? undefined,
    ),
    livePath,
    fallbackNow,
  );
  const hasTrustedContext = hasRealTask || hasUserTask || Boolean(input.trustedActivitySummary);
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
      ? taskActivityFromUserGoal(taskDescriptionText, Boolean(authoritativeTaskText))
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
    (headerTextsEquivalent(declaredStepTitle, taskDescriptionText) ? fallbackNow : declaredStepTitle);
  const missingActivity =
    !hasRealTask &&
    !hasUserTask &&
    !input.trustedActivitySummary &&
    base.status === "working" &&
    input.neutralTitle !== "Idle";
  const title = hasRealTask
    ? realTaskTitle
    : hasUserTask
      ? hasDistinctActivity ? activityTitle : taskDerivedActivity ?? fallbackNow
    : input.trustedActivitySummary
      ? summary.task
      : fallbackNow;
  const candidateReadableTitle =
    hasUserTask && title === "Idle" ? "Awaiting next action" : title;
  const candidateReadableNow =
    hasUserTask && now === "Idle" ? "Awaiting next action" : now;
  const titleQuality = qualityCheckActivityLabel(candidateReadableTitle);
  const nowQuality = qualityCheckNowLabel(candidateReadableNow);
  const duplicatedLongLabels = headerLabelsAreDuplicated(taskDescriptionText, candidateReadableTitle);
  // Title and now are gated INDEPENDENTLY: a junk momentary now (e.g.
  // "Editing Terminal.tsx") must not drag a good declared title down with it.
  const lowQualityTitle = !titleQuality.ok || duplicatedLongLabels;
  const lowQualityNow = !nowQuality.ok;
  const lowQualityActivity = lowQualityTitle || lowQualityNow;
  const replacementActivity = lowQualityActivity ? taskDerivedActivity : undefined;
  const preGuardTitle =
    missingActivity ? "Activity not captured" :
    // A rejected title candidate falls back to an honest status word — never
    // to the noisy "Activity not captured" label (that reads as breakage).
    lowQualityTitle ? replacementActivity ?? fallbackNow :
    candidateReadableTitle;
  // No pane may say the same thing on the Task row and the title.
  const readableTitle = headerTextsEquivalent(preGuardTitle, taskDescriptionText)
    ? (hasUserTask && fallbackNow === "Idle" ? "Awaiting next action" : fallbackNow)
    : preGuardTitle;
  const readableNow =
    missingActivity ? "Activity not captured" :
    lowQualityNow ? fallbackNow :
    candidateReadableNow;
  const missingActiveTask =
    !taskDescriptionText &&
    Boolean(input.trustedActivitySummary) &&
    readableTitle !== "Idle" &&
    readableTitle !== "Awaiting next action" &&
    readableTitle !== "Activity not captured";

  return {
    workspace: { text: workspace, source: "workspace" },
    taskDescription: {
      text: taskDescriptionText ?? "Task not captured",
      source: taskDescriptionText ? taskText ? "task-list" : userTaskText ? "user-task" : "missing" : "missing",
    },
    title: {
      text: readableTitle,
      source: missingActivity
        ? "missing"
        : lowQualityTitle && replacementActivity
          ? hasRealTask ? "task-list" : "status-summary"
        : lowQualityTitle
          ? "missing"
        : hasRealTask
        ? "task-list"
        : hasUserTask
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
      hasTrustedContext,
      titleDuplicatedUserTask: hasUserTask && sameHeaderText(summary.task, userTaskText),
      titleUsesDistinctActivity: hasDistinctActivity,
      missingActiveTask,
      missingActivity,
      taskQualityReason: taskQuality.reason,
      titleQualityReason: titleQuality.reason,
      nowQualityReason: nowQuality.reason,
      duplicatedLongLabels,
      replacementActivity,
      tasksFromTodoWrite: input.statusSummary?.tasksFromTodoWrite,
      mainUserAskSource: mainUserAskApplies ? input.mainUserAsk?.source : undefined,
      mainUserAskRunMatches: mainUserAskApplies,
    },
  };
}
