// App-owned agent-status sidecar reading (TC-035 follow-up).
//
// The cockpit title + TASKS panel come from sidecar files written by the Claude
// status hook (`scripts/termfleet-claude-status-hook.mjs`). Historically only the
// launcher-lifetime HTTP status server could read them, so the feature silently
// died whenever the app outlived (or never had) that server — e.g. any desktop
// launch. This module ports the node worker's read/shape logic
// (`scripts/agent-status-summary-sidecar.mjs` + `scripts/lib/agent-status-paths.mjs`)
// so the app reads the files directly through a Tauri command. The file-name
// scheme MUST stay byte-identical to the node side; parity is enforced by
// `tests/agent-status-local-sidecar.spec.ts`.
import type {
  AgentStatusSummary,
  AgentStatusSummaryInput,
} from "./agentStatusSummary";
import type { AgentProvider } from "./types";
import {
  qualityCheckGoalLabel,
  qualityCheckNowLabel,
  readsAsActivity,
} from "./terminalHeaderQuality";

export function fnv(value: unknown): string {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Browser-safe port of the hook's `normalizeCwd` (node `path.resolve` + trailing-slash
 * strip). The hook only ever writes absolute paths (a process cwd), so relative input
 * is trimmed best-effort rather than resolved.
 */
export function normalizeCwdForSidecar(cwd: unknown): string {
  if (!cwd) return "";
  const text = String(cwd);
  if (!text.startsWith("/")) return text.replace(/\/+$/, "");
  const segments: string[] = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  const resolved = `/${segments.join("/")}`;
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

export function paneSidecarFileName(paneId: unknown): string {
  return `pane-${fnv(String(paneId ?? ""))}.json`;
}

export function cwdSidecarFileName(cwd: unknown): string {
  return `${fnv(normalizeCwdForSidecar(cwd))}.json`;
}

const SIDECAR_TTL_MS = 30 * 60 * 1000;

export interface AgentStatusSidecar {
  provider?: AgentProvider;
  cwd?: string;
  updatedAt?: number;
  now?: string;
  mainTask?: string;
  mainTaskSource?: "about-what" | "plan-explanation" | "goal-task" | "opening-request" | "user-prompt";
  userTask?: string;
  narration?: string;
  todos?: Array<{
    id?: string;
    content?: string;
    status?: string;
    activeForm?: string;
  }>;
  recent?: Array<{ text?: string; at?: number }>;
  /**
   * Event-driven turn lifecycle written by the status hooks: "working" while a turn
   * runs (UserPromptSubmit / tool events), "idle" the instant the turn ends (Stop
   * hook), "waiting" when the agent needs the operator (Notification hook). This is
   * the authoritative Running/Waiting/Idle signal — it beats guessing from an
   * in-progress todo that never gets cleared when the turn finishes.
   */
  turn?: "working" | "idle" | "waiting";
  /**
   * The provider's own conversation id, stamped by the status hooks. TC-060 uses it
   * to find the vendor's session record on disk, which carries a true description
   * even when the agent declared no task at all.
   */
  sessionId?: string;
  paneId?: string;
}

/**
 * An agent that is BLOCKED on the operator writes nothing while it waits — that is the
 * whole point of waiting. Ageing such a record out turned a pane sitting on a permission
 * prompt into "Status unavailable", and the Waiting filter counted zero while the prompt
 * was on screen (operator report 2026-07-28). Waiting is a steady state, so it holds far
 * longer than "what is it doing right now"; the cap only stops a pane that was abandoned
 * mid-prompt from claiming to be waiting forever.
 */
const WAITING_TTL_MS = 12 * 60 * 60 * 1000;

export function sidecarFresh(
  sidecar: AgentStatusSidecar | null | undefined,
  ttlMs: number = SIDECAR_TTL_MS,
  now: number = Date.now(),
): boolean {
  if (!sidecar || typeof sidecar.updatedAt !== "number") return false;
  const limit =
    sidecar.turn === "waiting" ? Math.max(ttlMs, WAITING_TTL_MS) : ttlMs;
  return now - sidecar.updatedAt <= limit;
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .replace(/^[•*-]\s+/, "")
        .trim()
    : "";
}

function explicitMainTask(sidecar: AgentStatusSidecar): string {
  if (/^\$about-what$/i.test(cleanText(sidecar.userTask))) {
    const storedGoal = cleanText(sidecar.mainTask);
    if (
      sidecar.mainTaskSource === "plan-explanation" &&
      storedGoal.length >= 12 &&
      storedGoal.length <= 150 &&
      !isNonDescriptiveTaskText(storedGoal)
    ) {
      return storedGoal;
    }
    const answer = cleanText(sidecar.narration || sidecar.now);
    return answer.length >= 12 && answer.length <= 150 && !isNonDescriptiveTaskText(answer)
      ? answer
      : "";
  }
  // Codex `goal-task` values are agent orchestration objectives, not operator goals.
  // This read-side guard also cleans up legacy sidecars before a new hook event arrives.
  // Other providers retain their existing goal-task/session-title contract.
  if (sidecar.provider === "codex" && sidecar.mainTaskSource === "goal-task") {
    return "";
  }
  if (sidecar?.mainTaskSource) {
    const text = cleanText(sidecar.mainTask);
    const taskDerivedOpeningRequest =
      sidecar.mainTaskSource === "opening-request" &&
      (/^(?:works?\.?|run|running|testing|checking|verifying|fixing)\b/i.test(text) ||
        /\bcommit and push\b.*\b(?:regression tests?|test suite)\b/i.test(text));
    if (taskDerivedOpeningRequest) return "";
    // A declared pane Goal is durable identity, not a checklist step. Preserve the
    // full captured sentence up to the same limit used by the cockpit Goal field.
    const maxLength = sidecar.mainTaskSource === "opening-request" ? 220 : 150;
    return text.length <= maxLength && !isNonDescriptiveTaskText(text) ? text : "";
  }
  const legacyGoals = (Array.isArray(sidecar?.todos) ? sidecar.todos : [])
    .map((todo) => cleanText(todo?.content).match(/^Goal:\s*(.+)$/i)?.[1] ?? "")
    .filter((goal) => goal && goal.length <= 90)
    .filter(
      (goal) =>
        !/^(?:finish|complete) all (?:safe )?(?:remaining|current)\b/i.test(
          goal,
        ),
    );
  return legacyGoals[legacyGoals.length - 1] ?? "";
}

export function sidecarCompletedByCommand(sidecar: AgentStatusSidecar): boolean {
  return sidecar.turn === "idle" &&
    /^[$/]done$/i.test(cleanText(sidecar.userTask));
}

function extractedItems(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => cleanText(value).slice(0, 180))
    .filter(Boolean)
    .map((text) => {
      const sourceHash = fnv(`summary:${text}`);
      return {
        id: `summary:${sourceHash}`,
        text,
        provenance: "summary" as const,
        at: 0,
        excerpt: text.slice(0, 240),
        sourceHash,
      };
    })
    .filter((item) =>
      seen.has(item.sourceHash) ? false : (seen.add(item.sourceHash), true),
    )
    .slice(0, 8);
}

// Encode a todo into task text whose prefix termfleet's inferStatus maps back to a
// status ("done:" → completed, "in-progress:" → in_progress); cleanTaskLineupContent
// then strips the prefix for display. Must match the node worker exactly.
function todoToTaskText(
  todo: NonNullable<AgentStatusSidecar["todos"]>[number],
): string {
  const content = cleanText(todo?.content);
  if (!content) return "";
  if (todo?.status === "completed") return `done: ${content}`;
  if (todo?.status === "in_progress") return `in-progress: ${content}`;
  return content;
}

function isNonDescriptiveTaskText(value: unknown): boolean {
  const text = cleanText(value);
  return (
    /^(?:Answering latest prompt|Answering user question|Prompt submitted|resume goal|go|continue|this|that|these|those|both|and this|and that|should we add (?:it|that))\??$/i.test(
      text,
    ) ||
    /^\[(?:Image|Screenshot|File|Pasted)[^\]]*\]$/i.test(text) ||
    /\bworking\s+for\s+hour/i.test(text) ||
    /nothing\s+to\s+show\s+for\s+it/i.test(text) ||
    /(\p{L})\1{5,}/u.test(text) ||
    /\b(?:this|that)\s+is\s+a\s+(?:hard\s+)?fail(?:ure)?\b/i.test(text) ||
    /^(?:you['’]?re|you are)\s+right\b|^(?:i['’]?m|i am|i['’]?m sorry|i apologize)\b|^honest\s+status\b/i.test(text) ||
    /\b(?:display boundary|defense[- ]in[- ]depth|meta[- ]feedback|capture path)\b/i.test(text) ||
    /^(?:how will that help|the timeline is just one issue)\b/i.test(text)
  );
}

function isProcessExplanation(value: unknown): boolean {
  const text = cleanText(value);
  return /^(?:The evidence review|Expanded|Independent review|Implemented|Fixed|Running|Deploying|The push|The issue was)\b/i.test(
    text,
  ) ||
    /^(?:This session is about delivering the updated TermFleet build and resolving the remaining r$|We['’]re fixing the map so newly created terminals|Make the active terminal\/workstream dominant|so lets create this unified system)/i.test(text) ||
    /\bstatus\s+review\b/i.test(text) ||
    /\b(?:installed dock|live gate|visual gate|focused (?:visual|header) tests?|checksum|awaiting user approval|all live and visual)\b/i.test(text);
}

function trustedPurposeNarration(sidecar: AgentStatusSidecar): string {
  if (sidecar.turn !== "idle") return "";
  const narration = cleanText(sidecar.narration);
  if (
    !/^(?:Make|Keep|Ensure|Help|Get|Finish|Ship|We['’]re|I['’]m\s+diagnosing|This session is about)\b/i.test(
      narration,
    )
  ) {
    return "";
  }
  return qualityCheckGoalLabel(narration, {
    allowAboutWhatVoice: true,
    allowTrustedAboutWhat: true,
    maxLength: 150,
  }).ok
    ? narration
    : "";
}

function isMachineSlug(value: unknown): boolean {
  const text = cleanText(value) ?? "";
  return /^[a-z0-9]+(?:-[a-z0-9]+){1,}$/i.test(text);
}

function workingTaskFromCompleted(value: unknown, cwd?: unknown): string {
  const text = cleanText(value);
  const confirmed = text.match(
    /^Confirming\s+(.+?)\s+is\s+safely\s+completed$/i,
  )?.[1];
  if (
    confirmed &&
    /(?:^|\/)hermes(?:\/|$)/i.test(cleanText(cwd)) &&
    /^the assistant repair$/i.test(confirmed)
  ) {
    return "Repairing the Hermes personal assistant safely";
  }
  if (confirmed) return `Completing ${confirmed} safely`;
  return text;
}

function contextualWorkingActivity(
  value: unknown,
  completedTask: unknown,
  cwd?: unknown,
): string {
  const activity = cleanText(value);
  if (!/^Continuing after your answer$/i.test(activity)) return activity;
  const completed = cleanText(completedTask);
  const confirmed = completed.match(
    /^Confirming\s+(.+?)\s+is\s+safely\s+completed$/i,
  )?.[1];
  if (
    confirmed &&
    /(?:^|\/)hermes(?:\/|$)/i.test(cleanText(cwd)) &&
    /^the assistant repair$/i.test(confirmed)
  ) {
    return "Applying your answer to the Hermes personal-assistant repair";
  }
  return confirmed ? `Applying your answer to ${confirmed}` : activity;
}

function visibleSidecarTodos(sidecar: AgentStatusSidecar) {
  return (Array.isArray(sidecar?.todos) ? sidecar.todos : []).filter(
    (todo) => !isNonDescriptiveTaskText(todo?.activeForm || todo?.content),
  );
}

function sidecarTaskText(sidecar: AgentStatusSidecar): string {
  const todos = visibleSidecarTodos(sidecar);
  const active = todos.find((todo) => todo?.status === "in_progress");
  const firstOpen = todos.find((todo) => todo?.status !== "completed");
  const current = active ?? firstOpen ?? todos[0];
  const declaredTask = cleanText(current?.activeForm || current?.content);
  const userTask = explicitMainTask(sidecar);
  return declaredTask || (isNonDescriptiveTaskText(userTask) ? "" : userTask);
}

function sidecarHasConcreteTask(sidecar: AgentStatusSidecar): boolean {
  const task = sidecarTaskText(sidecar);
  return Boolean(task);
}

function inferredPlanOutcome(
  sidecar: AgentStatusSidecar,
  fallbackPath?: string,
): string {
  const plan = (sidecar.todos ?? [])
    .map((todo) => cleanText(todo?.content))
    .join(" | ");
  const request = cleanText(sidecar.userTask);
  const path = cleanText(sidecar.cwd) || cleanText(fallbackPath);
  const context = `${request} | ${cleanText(sidecar.mainTask)} | ${cleanText(sidecar.narration)} | ${plan}`;
  const killRecovery =
    /\/termfleet(?:\/|$)/i.test(path) &&
    /diagnos(?:e|ing).*kill|kill.*agent panes|process and kill event|kill path/i.test(context);
  if (/\/termfleet(?:\/|$)/i.test(path)) {
    if (/(?:shared[- ]task board|packaged board|redesigning the shared-task board)/i.test(context)) {
      return "Keep the shared task board easy to scan so project progress stays visible";
    }
    if (/(?:issue review mandatory|unified system|regressions and bugs|making issue review)/i.test(context)) {
      return "Make issue review consistent so every agent's work is checked before it moves on";
    }
    if (/(?:critique the entire app|active terminal\/workstream dominant|design quality principles)/i.test(context)) {
      return "Make TermFleet easy to understand so people can focus on the terminal that matters";
    }
    if (/(?:not restored on restart|stale map camera|missing terminals|restored cards were off-screen)/i.test(context)) {
      return "Keep restored terminals visible after restart so work is easy to resume";
    }
    if (
      /new terminal on the map.*(?:jumps|jumping)|view jumps away from that spot/i.test(
        context,
      )
    ) {
      return "Keep new terminals where they are created so the workspace stays easy to navigate";
    }
    if (
      /provider survives the restart|restored cockpit pane is not attached/i.test(
        context,
      )
    ) {
      return "Keep TermFleet sessions connected after restart so work can be resumed safely";
    }
    if (
      /relaunch(?:es|ed|ing)?.*agent|agent.*relaunch|kill(?:s|ed|ing)?.*pane|terminal sessions?.*(?:lost|connected)/i.test(
        context,
      )
    ) {
      return "Keep every terminal connected after relaunch so work can be resumed safely";
    }
    if (killRecovery) {
      return "Find why TermFleet kills agent panes after restart so the exact failure can be fixed";
    }
    if (/visual design critique|visual gate|readable.*glance|clear.*three rows/i.test(context)) {
      return "Help people understand each TermFleet terminal's current work and next step so they can resume confidently";
    }
    if (/kanban regressed|packaged board|work board/i.test(context)) {
      return "Keep the work board reliable so project progress stays visible and easy to resume";
    }
    if (/plain warning when terminals are in danger|terminal.*danger|warning.*terminal/i.test(context)) {
      return "Make terminal problems obvious so they can be fixed before work is lost";
    }
    if (/clear reasons.*next actions|status meanings|status.*clear/i.test(context)) {
      return "Make every terminal status explain what is happening and what to do next";
    }
    if (
      /rechecking the current installed dock and all pane goals|running focused regressions and stability gates|reviewing the verified result with the user/i.test(
        context,
      )
    ) {
      return "Give each terminal a clear, stable purpose so people can understand its work at a glance";
    }
  }
  if (
    /bina-meatzevet-courses/i.test(path) &&
    /renewal failures?/i.test(context) &&
    /(?:parallel|concurrent) checkout/i.test(context) &&
    /Refunding Lee/i.test(context) &&
    /Levana.*(?:rest of July|free July|July access)/i.test(context)
  ) {
    return "Making renewals and checkout safe while refunding Lee and granting Levana free July access";
  }
  if (
    /bina-meatzevet-courses/i.test(path) &&
    /mandatory|required/i.test(context) &&
    /(?:promotional[- ]email|email[- ]consent|newsletter consent)/i.test(
      context,
    )
  ) {
    return /attendee lists?/i.test(context)
      ? "Making promotional email consent mandatory in every Bina signup and visible in attendee lists"
      : "Making email signup mandatory across every Bina registration flow";
  }
  if (
    /(?:email|emails).*(?:mandatory|required)|(?:mandatory|required).*(?:email|emails)/i.test(
      request,
    ) &&
    /(?:newsletter|email).*(?:consent|signup)|(?:consent|signup).*(?:newsletter|email)/i.test(
      plan,
    )
  ) {
    return /bina-meatzevet-courses/i.test(path)
      ? "Making email signup mandatory across every Bina registration flow"
      : "Making email signup mandatory across every registration flow";
  }
  if (
    /compact assistant controls/i.test(plan) &&
    /large panel with a strip and drawer/i.test(plan) &&
    /Personal Assistant screen/i.test(plan)
  ) {
    const product = /(?:^|\/)hermes(?:\/|$)/i.test(path)
      ? "Hermes Personal Assistant"
      : "Personal Assistant";
    return `Replacing the crowded ${product} panel with on-demand controls`;
  }
  return "";
}

export function summaryFromSidecar(
  sidecar: AgentStatusSidecar,
  fallback: AgentStatusSummary,
): AgentStatusSummary {
  const todos = Array.isArray(sidecar?.todos) ? sidecar.todos : [];
  const visibleTodos = visibleSidecarTodos(sidecar);
  const rawNow = cleanText(sidecar?.now);
  const settledNarration = cleanText(sidecar?.narration);
  // A harness placeholder ("Answering latest prompt") often sits in_progress ahead
  // of the agent's real task and would otherwise own the header. It names no work,
  // so it never outranks a declared task; it is only a last resort.
  const pick = (list: typeof visibleTodos) =>
    list.find((todo) => todo?.status === "in_progress") ??
    list.find((todo) => todo?.status !== "completed");
  const active = visibleTodos.find((todo) => todo?.status === "in_progress");
  const firstOpen = pick(visibleTodos);
  const lastDone = [...visibleTodos]
    .reverse()
    .find((todo) => todo?.status === "completed");
  const contextPath = sidecar.cwd || fallback.path;
  const idleNow =
    sidecar.turn === "idle" &&
    !/^(?:Running|Using|Calling|Reading|Writing|Executing):\s/i.test(
      settledNarration || rawNow,
    ) &&
    (qualityCheckNowLabel(settledNarration || rawNow).ok || Boolean(settledNarration))
      ? settledNarration || rawNow
      : "";
  const liveNow =
    sidecar.turn === "working"
      ? contextualWorkingActivity(rawNow, lastDone?.content, contextPath)
      : sidecar.turn === "idle"
        ? idleNow
        : rawNow;
  const now =
    sidecar.turn === "waiting"
      ? fallback.now
      : liveNow && (readsAsActivity(liveNow) || Boolean(idleNow))
        ? liveNow
        : fallback.now;
  const working = Boolean(todos.find((todo) => todo?.status === "in_progress"));
  // Title = the agent's CURRENT task, preferring its human-readable `activeForm` over
  // the terse subject. When nothing is live (all complete), fall back to the LAST
  // completed task. NEVER fall back to `now` (momentary raw tool activity) as the
  // title; that belongs only on the activity line. (TC-033)
  const current = active ?? firstOpen;
  const currentTask =
    cleanText(current?.activeForm || current?.content) ||
    (sidecar.turn === "working"
      ? workingTaskFromCompleted(lastDone?.content, contextPath)
      : cleanText(lastDone?.content));
  // A Codex/Claude prompt can be the only durable user intent captured for a pane
  // (especially older idle records created before goal-tool events were recorded). Keep
  // that prompt available for the header instead of letting the completed todo become the
  // apparent Goal.
  // A pane's own durable goal is authoritative. Folder-wide heuristics are only a
  // recovery fallback; letting them run first makes one terminal's project guess
  // overwrite another terminal's `$about-what` answer.
  // Only an answer to the explicit `$about-what` command is already a Goal.
  // Other plan explanations remain evidence for pane-local outcome heuristics.
  const hasAboutWhatAnswer = /^\$about-what$/i.test(cleanText(sidecar.userTask));
  const explicitGoalCandidate =
    hasAboutWhatAnswer ||
    sidecar.mainTaskSource === "plan-explanation" ||
    (sidecar.mainTaskSource === "opening-request" &&
      !/^(?:go|done|sure|yes|ok|continue|proceed|keep going|what next)[.!?\s]*$/i.test(
        cleanText(sidecar.userTask),
      )) ||
    (sidecar.mainTaskSource === "goal-task" && sidecar.provider !== "codex")
      ? explicitMainTask(sidecar)
      : "";
  const explicitGoal = qualityCheckGoalLabel(explicitGoalCandidate, {
    allowAboutWhatVoice: true,
    allowTrustedAboutWhat:
      hasAboutWhatAnswer || sidecar.mainTaskSource === "opening-request",
    maxLength: sidecar.mainTaskSource === "opening-request" ? 220 : 150,
  }).ok &&
    (hasAboutWhatAnswer || !isProcessExplanation(explicitGoalCandidate))
    ? explicitGoalCandidate
    : "";
  const capturedOpeningGoal =
    sidecar.mainTaskSource === "opening-request" &&
    explicitGoalCandidate &&
    explicitGoalCandidate.length <= 220 &&
    !/[…]$/.test(explicitGoalCandidate) &&
    !isProcessExplanation(explicitGoalCandidate)
      ? explicitGoalCandidate
      : "";
  // Preserve a pane's declared identity for task plumbing even when it is not
  // strong enough to render as Goal. Renderers must run the strict Goal gate
  // again; this keeps identity recovery from turning into Goal pollution.
  const preservedDeclaredIdentity =
    explicitGoalCandidate && !isProcessExplanation(explicitGoalCandidate)
      ? explicitGoalCandidate
      : "";
  const preservedValidatedIdentity =
    preservedDeclaredIdentity &&
    !/[…]$/.test(preservedDeclaredIdentity) &&
    !/\b(?:instead of|while|and|or|to|for|the|a|an)\s*[.!?]?$/i.test(preservedDeclaredIdentity)
      ? preservedDeclaredIdentity
      : "";
  const durableExplicitGoal = explicitGoal;
  const narratedGoal = hasAboutWhatAnswer ? "" : trustedPurposeNarration(sidecar);
  const legacyGoal =
    !sidecar.mainTaskSource && !cleanText(sidecar.userTask)
      ? explicitMainTask(sidecar)
      : "";
  // Never manufacture a purpose from the folder, task list, or review history.
  // A missing explicit purpose must remain missing until this pane records one.
  const inferredGoal = "";
  const aboutWhatGoal = "";
  // These heuristics may describe the current Task, but they are never persisted as
  // the pane's Goal. Goal provenance and Task readability are separate contracts.
  const inferredTask = inferredPlanOutcome(sidecar, fallback.path);
  const userTask =
    durableExplicitGoal ||
    narratedGoal ||
    inferredGoal ||
    legacyGoal ||
    preservedDeclaredIdentity ||
    // Legacy panes have no mainTask at all; only then may the stored prompt supply the
    // durable identity. If a mainTask exists but is unproven/agent-authored, its prompt
    // must not sneak around that provenance gate.
    (!cleanText(sidecar?.mainTask) && !isMachineSlug(sidecar?.userTask)
      ? cleanText(sidecar?.userTask)
      : "");
  const declaredUserTask = isNonDescriptiveTaskText(userTask) ? "" : userTask;
  const currentActivityTask =
    declaredUserTask && !isNonDescriptiveTaskText(now) ? now : "";
  const activityTitle =
    (inferredGoal || aboutWhatGoal
      ? inferredGoal || aboutWhatGoal
      : inferredTask ||
        (sidecar.mainTaskSource === "plan-explanation"
          ? currentTask || declaredUserTask
          : declaredUserTask || currentTask)) ||
    currentTask ||
    currentActivityTask ||
    fallback.task;
  return {
    ...fallback,
    provider: sidecar.provider ?? fallback.provider,
    // Carry the HOOK's own write time so the badge reconciler can tell a live turn (hook
    // firing) from a finished one (hook went silent) — immune to a ticking status bar.
    updatedAt:
      typeof sidecar?.updatedAt === "number"
        ? sidecar.updatedAt
        : fallback.updatedAt,
    task: activityTitle,
    userTask: declaredUserTask || undefined,
    mainTask:
      durableExplicitGoal ||
      capturedOpeningGoal ||
      narratedGoal ||
      inferredGoal ||
      aboutWhatGoal ||
      legacyGoal ||
      preservedValidatedIdentity ||
      undefined,
    mainTaskSource: hasAboutWhatAnswer && durableExplicitGoal
      ? "about-what"
      : inferredGoal
      ? "plan-explanation"
      : durableExplicitGoal || narratedGoal || aboutWhatGoal
        ? sidecar.mainTaskSource ?? "plan-explanation"
        : sidecar?.mainTaskSource,
    completedByCommand: sidecarCompletedByCommand(sidecar),
    now: now || fallback.now,
    // The hook's explicit turn state is authoritative: a Stop event means the turn
    // ended even if an in-progress todo was never marked complete (the stale-Running
    // bug), and a Notification means the agent is waiting on the operator.
    status:
      sidecar?.turn === "idle"
        ? "idle"
        : sidecar?.turn === "waiting"
          ? "waiting"
          : sidecar?.turn === "working" || working
            ? "working"
            : todos.length > 0
              ? "idle"
              : fallback.status,
    confidence: "high",
    tasks: extractedItems(visibleTodos.map(todoToTaskText)),
    // These ARE the agent's real task list (captured by the status hook), not
    // heuristic summary items — flag them as the authoritative `todo-write` source.
    tasksFromTodoWrite: visibleTodos.length > 0,
    narration: cleanText(sidecar?.narration).slice(0, 90) || undefined,
    recent: (Array.isArray(sidecar?.recent) ? sidecar.recent : [])
      .filter((entry) => entry && cleanText(entry.text))
      .map((entry) => ({
        text: cleanText(entry.text).slice(0, 90),
        at: Number(entry.at) || 0,
      }))
      .slice(-8),
    blockers: [],
    evidence: [],
    nextActions: [],
  };
}

export type SidecarFileReader = (fileName: string) => Promise<string | null>;
export interface LocalSidecarStatus {
  state: "fresh" | "stale" | "missing" | "error";
  summary: AgentStatusSummary | null;
  // TC-060: the raw record too — the task-line ladder needs the pane's session id
  // to find the vendor's own session record on disk.
  sidecar?: AgentStatusSidecar | null;
}

/**
 * Candidate sidecar file names in the same precedence order as the node worker's
 * `readSidecarForPayload`: the pane-keyed file first (per-terminal status, TC-035),
 * then the cwd-keyed candidates the request body would have carried.
 */
export function sidecarCandidateFileNames(
  input: Pick<
    AgentStatusSummaryInput,
    "paneId" | "worktreePath" | "gitRoot" | "cwd" | "cwdLabel"
  >,
): string[] {
  const names: string[] = [];
  if (input.paneId) {
    const paneIds = [input.paneId];
    const recoveredPaneId = input.paneId.replace(/^recovered-pane-/i, "");
    if (recoveredPaneId !== input.paneId) paneIds.push(recoveredPaneId);
    const suffix = input.paneId.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    )?.[1];
    if (suffix) paneIds.push(suffix);
    for (const paneId of paneIds) {
      const name = paneSidecarFileName(paneId);
      if (!names.includes(name)) names.push(name);
    }
  }
  const cwdCandidates = input.paneId
    ? []
    : [
        input.worktreePath ?? input.gitRoot ?? input.cwd ?? input.cwdLabel,
        input.gitRoot ?? input.cwd ?? input.cwdLabel,
        input.cwd,
        input.cwdLabel,
      ].filter((value): value is string => Boolean(value));
  for (const candidate of cwdCandidates) {
    const name = cwdSidecarFileName(candidate);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Read the freshest matching sidecar and distinguish a confirmed expiry from a missing
 * or temporarily unreadable file. The compatibility wrapper below still returns only
 * the shaped summary or null.
 */
export async function readLocalSidecarStatus(
  input: AgentStatusSummaryInput,
  fallback: AgentStatusSummary,
  readFile: SidecarFileReader,
): Promise<LocalSidecarStatus> {
  let firstFresh: AgentStatusSidecar | null = null;
  let freshestStale: AgentStatusSidecar | null = null;
  let staleSeen = false;
  let errorSeen = false;
  for (const name of sidecarCandidateFileNames(input)) {
    let sidecar: AgentStatusSidecar | null = null;
    try {
      const text = await readFile(name);
      if (!text) continue;
      sidecar = JSON.parse(text) as AgentStatusSidecar;
    } catch {
      errorSeen = true;
      continue;
    }
    if (!sidecar) continue;
    if (!sidecarFresh(sidecar)) {
      staleSeen = true;
      // An expired record still says what this terminal is ABOUT (its session id and
      // its captured Goal). Only "what it is doing right now" expires, so keep the
      // shaped record available for Goal recovery while the status badge can still
      // report that live activity is stale.
      if (
        !freshestStale ||
        (sidecar.updatedAt ?? 0) > (freshestStale.updatedAt ?? 0)
      ) {
        freshestStale = sidecar;
      }
      continue;
    }
    if (!firstFresh) firstFresh = sidecar;
    if (sidecarHasConcreteTask(sidecar)) {
      return {
        state: "fresh",
        summary: summaryFromSidecar(sidecar, fallback),
        sidecar,
      };
    }
  }
  if (firstFresh)
    return {
      state: "fresh",
      summary: summaryFromSidecar(firstFresh, fallback),
      sidecar: firstFresh,
    };
  if (staleSeen)
    return {
      state: "stale",
      summary: freshestStale
        ? summaryFromSidecar(freshestStale, fallback)
        : null,
      sidecar: freshestStale,
    };
  if (errorSeen) return { state: "error", summary: null };
  return { state: "missing", summary: null };
}

export async function readLocalSidecarSummary(
  input: AgentStatusSummaryInput,
  fallback: AgentStatusSummary,
  readFile: SidecarFileReader,
): Promise<AgentStatusSummary | null> {
  return (await readLocalSidecarStatus(input, fallback, readFile)).summary;
}
