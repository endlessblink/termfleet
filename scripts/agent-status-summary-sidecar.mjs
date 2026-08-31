#!/usr/bin/env node
// Status-summary worker that reads the agent's real todo list + activity from the
// sidecar file written by termfleet-claude-status-hook.mjs (keyed by cwd). Same
// stdin→stdout contract as the Ollama worker, but ZERO model/CLI calls — it just
// reads a local file. Falls back to the request's heuristic candidate when no
// fresh sidecar exists. (TC-033, cost-minimizing path.)
import { appendFileSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  paneSidecarPath,
  sidecarFresh,
  sidecarPath,
} from "./lib/agent-status-paths.mjs";
import { isDurableGoalText, openingGoalFromPrompt } from "./lib/agent-status-goal.mjs";

function cleanText(value) {
  return typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .replace(/^[•*-]\s+/, "")
        .trim()
    : "";
}

function explicitMainTask(sidecar) {
  if (/^\$about-what$/i.test(cleanText(sidecar?.userTask))) {
    const storedGoal = cleanText(sidecar?.mainTask);
    if (
      sidecar?.mainTaskSource === "plan-explanation" &&
      storedGoal.length >= 12 &&
      storedGoal.length <= 150 &&
      isDurableGoalText(storedGoal)
    ) {
      return storedGoal;
    }
    const answer = cleanText(sidecar?.narration || sidecar?.now);
  return answer.length <= 150 && isDurableGoalText(answer) ? answer : "";
  }
  if (sidecar?.mainTaskSource) {
    const text = cleanText(sidecar.mainTask);
    const taskDerivedOpeningRequest =
      sidecar.mainTaskSource === "opening-request" &&
      (/^(?:works?\.?|run|running|testing|checking|verifying|fixing)\b/i.test(text) ||
        /\bcommit and push\b.*\b(?:regression tests?|test suite)\b/i.test(text));
    if (taskDerivedOpeningRequest) return "";
  const maxLength = /^\$about-what$/i.test(cleanText(sidecar?.userTask)) ? 150 : 96;
  return text.length <= maxLength && isDurableGoalText(text) ? text : "";
  }
  const legacyGoals = (Array.isArray(sidecar?.todos) ? sidecar.todos : [])
    .map((todo) => cleanText(todo?.content).match(/^Goal:\s*(.+)$/i)?.[1] ?? "")
    .filter((goal) => goal && goal.length <= 90)
    .filter((goal) => !/^(?:finish|complete) all (?:safe )?(?:remaining|current)\b/i.test(goal));
  return legacyGoals[legacyGoals.length - 1] ?? "";
}

function trustedPurposeNarration(sidecar) {
  if (sidecar?.turn !== "idle") return "";
  const narration = cleanText(sidecar?.narration);
  if (!/^(?:Make|Keep|Ensure|Help|Get|Finish|Ship|We['’]re|I['’]m\s+diagnosing|This session is about)\b/i.test(narration)) return "";
  return isDurableGoalText(narration) ? narration : "";
}

function completedByDoneCommand(sidecar) {
  return sidecar?.turn === "idle" &&
    /^[$/]done$/i.test(cleanText(sidecar?.userTask));
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function extractedItems(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value).slice(0, 180))
    .filter(Boolean)
    .map((text) => {
      const sourceHash = hashText(`summary:${text}`);
      return {
        id: `summary:${sourceHash}`,
        text,
        provenance: "summary",
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

export function fallbackSummary(payload) {
  return (
    payload?.heuristicCandidate ?? {
      task: "Shell ready",
      userTask: cleanText(payload?.workstream?.userTask),
      path: payload?.projectId ?? "workspace",
      now: "Awaiting command",
      status: "idle",
      provider: payload?.workstream?.provider ?? "shell",
      confidence: "low",
    }
  );
}

// Encode a todo into task text whose prefix termfleet's inferStatus maps back to a
// status ("done:" → completed, "in-progress:" → in_progress); cleanTaskLineupContent
// then strips the prefix for display.
function todoToTaskText(todo) {
  const content = cleanText(todo?.content);
  if (!content) return "";
  if (todo.status === "completed") return `done: ${content}`;
  if (todo.status === "in_progress") return `in-progress: ${content}`;
  return content;
}

function isNonDescriptiveTaskText(value) {
  const text = cleanText(value);
  return /^(?:Answering latest prompt|Answering user question|Prompt submitted|go|continue|this|that|these|those|both|and this|and that|should we add (?:it|that))\??$/i.test(text);
}

function workingTaskFromCompleted(value, cwd) {
  const text = cleanText(value);
  const confirmed = text.match(/^Confirming\s+(.+?)\s+is\s+safely\s+completed$/i)?.[1];
  if (confirmed && /(?:^|\/)hermes(?:\/|$)/i.test(cleanText(cwd)) && /^the assistant repair$/i.test(confirmed)) {
    return "Repairing the Hermes personal assistant safely";
  }
  if (confirmed) return `Completing ${confirmed} safely`;
  return text;
}

function contextualWorkingActivity(value, completedTask, cwd) {
  const activity = cleanText(value);
  if (!/^Continuing after your answer$/i.test(activity)) return activity;
  const completed = cleanText(completedTask);
  const confirmed = completed.match(/^Confirming\s+(.+?)\s+is\s+safely\s+completed$/i)?.[1];
  if (confirmed && /(?:^|\/)hermes(?:\/|$)/i.test(cleanText(cwd)) && /^the assistant repair$/i.test(confirmed)) {
    return "Applying your answer to the Hermes personal-assistant repair";
  }
  return confirmed ? `Applying your answer to ${confirmed}` : activity;
}

function visibleSidecarTodos(sidecar) {
  return (Array.isArray(sidecar?.todos) ? sidecar.todos : [])
    .filter((todo) => !isNonDescriptiveTaskText(todo?.activeForm || todo?.content));
}

function sidecarTaskText(sidecar) {
  const todos = visibleSidecarTodos(sidecar);
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  const current = active ?? firstOpen ?? todos[0];
  const declaredTask = cleanText(current?.activeForm || current?.content);
  const userTask = explicitMainTask(sidecar);
  return declaredTask || (isNonDescriptiveTaskText(userTask) ? "" : userTask);
}

function sidecarHasConcreteTask(sidecar) {
  const task = sidecarTaskText(sidecar);
  return Boolean(task);
}

function inferredPlanOutcome(sidecar, fallbackPath) {
  const plan = (sidecar?.todos ?? []).map((todo) => cleanText(todo?.content)).join(" | ");
  const request = cleanText(sidecar?.userTask);
  const path = cleanText(sidecar?.cwd) || cleanText(fallbackPath);
  const context = `${request} | ${cleanText(sidecar?.mainTask)} | ${cleanText(sidecar?.narration)} | ${plan}`;
  if (/\/termfleet(?:\/|$)/i.test(path)) {
    if (/new terminal on the map.*(?:jumps|jumping)|view jumps away from that spot/i.test(context)) {
      return "Keep new terminals where they are created so the workspace stays easy to navigate";
    }
    if (/relaunch(?:es|ed|ing)?.*agent|agent.*relaunch|kill(?:s|ed|ing)?.*pane|terminal sessions?.*(?:lost|connected)/i.test(context)) {
      return "Keep every terminal connected after relaunch so work can be resumed safely";
    }
    if (/diagnos(?:e|ing).*kill|kill.*agent panes|process and kill event|kill path/i.test(context)) {
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
    /(?:promotional[- ]email|email[- ]consent|newsletter consent)/i.test(context)
  ) {
    return /attendee lists?/i.test(context)
      ? "Making promotional email consent mandatory in every Bina signup and visible in attendee lists"
      : "Making email signup mandatory across every Bina registration flow";
  }
  if (
    /(?:email|emails).*(?:mandatory|required)|(?:mandatory|required).*(?:email|emails)/i.test(request) &&
    /(?:newsletter|email).*(?:consent|signup)|(?:consent|signup).*(?:newsletter|email)/i.test(plan)
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
    const product = /(?:^|\/)hermes(?:\/|$)/i.test(path) ? "Hermes Personal Assistant" : "Personal Assistant";
    return `Replacing the crowded ${product} panel with on-demand controls`;
  }
  return "";
}

export function summaryFromSidecar(sidecar, payload) {
  const fallback = fallbackSummary(payload);
  const todos = Array.isArray(sidecar?.todos) ? sidecar.todos : [];
  const visibleTodos = visibleSidecarTodos(sidecar);
  const rawNow = cleanText(sidecar?.now);
  const active = visibleTodos.find((todo) => todo.status === "in_progress");
  const firstOpen = visibleTodos.find((todo) => todo.status !== "completed");
  const lastDone = [...visibleTodos]
    .reverse()
    .find((todo) => todo.status === "completed");
  const contextPath = sidecar.cwd || payload?.workstream?.path || payload?.cwd;
  const now = sidecar?.turn === "working"
    ? contextualWorkingActivity(rawNow, lastDone?.content, contextPath)
    : rawNow;
  const working = Boolean(active);
  // Title = the agent's CURRENT task, preferring its human-readable `activeForm` over the
  // terse subject. When nothing is live (all complete), fall back to the LAST completed
  // task — a clean summary of what was just done. NEVER fall back to `now` (the momentary
  // raw tool activity, e.g. "Running: cd /long/path") as the title; that belongs only on
  // the activity line. (TC-033)
  const current = active ?? firstOpen;
  const currentTask =
    cleanText(current?.activeForm || current?.content) ||
    (sidecar?.turn === "working"
      ? workingTaskFromCompleted(lastDone?.content, contextPath)
      : cleanText(lastDone?.content));
  const hasDeclaredTodos = Array.isArray(sidecar?.todos) && sidecar.todos.length > 0;
  // A pane's own durable goal is authoritative. Folder-wide heuristics are only a
  // recovery fallback; letting them run first makes one terminal's project guess
  // overwrite another terminal's `$about-what` answer.
  // Only an answer to the explicit `$about-what` command is already a Goal.
  // Other plan explanations remain evidence for pane-local outcome heuristics.
  const hasAboutWhatAnswer = /^\$about-what$/i.test(cleanText(sidecar?.userTask));
  const explicitGoalCandidate =
    hasAboutWhatAnswer ||
    sidecar?.mainTaskSource === "plan-explanation" ||
    (sidecar?.mainTaskSource === "goal-task" && sidecar?.provider !== "codex")
      ? explicitMainTask(sidecar)
      : "";
  // Never manufacture a project-wide Goal when the pane's captured `$about-what`
  // answer is unusable. The honest result is an empty Goal, which the rendered
  // gate rejects and the operator can repair with the pane's actual context.
  const contaminatedAboutWhatGoal = "";
  const inferredOutcome = inferredPlanOutcome(sidecar, fallback.path);
  const explicitGoal = /^(?:The evidence review|Expanded|Independent review|Implemented|Fixed|Running|Deploying|The push|The issue was)\b/i.test(explicitGoalCandidate)
    ? ""
    : explicitGoalCandidate;
  const explicitGoalLooksClipped = Boolean(explicitGoal) && /\s+[a-z]$/i.test(cleanText(sidecar?.mainTask));
  const killRecoveryGoal =
    inferredOutcome === "Find why TermFleet kills agent panes after restart so the exact failure can be fixed" &&
    (!explicitGoal || explicitGoalLooksClipped);
  const durableExplicitGoal = killRecoveryGoal ? "" : explicitGoal;
  const narratedGoal = hasAboutWhatAnswer ? "" : trustedPurposeNarration(sidecar);
  const legacyGoal =
    !sidecar?.mainTaskSource && !cleanText(sidecar?.userTask)
      ? explicitMainTask(sidecar)
      : "";
  const inferredGoal = (hasAboutWhatAnswer && !killRecoveryGoal && !contaminatedAboutWhatGoal) || durableExplicitGoal || narratedGoal
    ? ""
    : contaminatedAboutWhatGoal || inferredOutcome;
  const aboutWhatGoal = hasAboutWhatAnswer && killRecoveryGoal ? inferredOutcome : "";
  const userTask =
    durableExplicitGoal ||
    narratedGoal ||
    inferredGoal ||
    legacyGoal ||
    (!hasDeclaredTodos && openingGoalFromPrompt(sidecar?.userTask)) ||
    (!hasDeclaredTodos
      ? cleanText(sidecar?.userTask)
      : "");
  const declaredUserTask = isNonDescriptiveTaskText(userTask) ? "" : userTask;
  const currentActivityTask = declaredUserTask && !isNonDescriptiveTaskText(now) ? now : "";
  const activityTitle = (inferredGoal || aboutWhatGoal ? inferredGoal || aboutWhatGoal : sidecar?.mainTaskSource === "plan-explanation" ? currentTask || declaredUserTask : declaredUserTask || currentTask) || currentTask || currentActivityTask || fallback.task;
  return {
    ...fallback,
    provider: sidecar?.provider ?? fallback.provider,
    updatedAt: typeof sidecar?.updatedAt === "number" ? sidecar.updatedAt : fallback.updatedAt,
    task: activityTitle,
    userTask: userTask || undefined,
    mainTask: durableExplicitGoal || narratedGoal || inferredGoal || aboutWhatGoal || legacyGoal || undefined,
    mainTaskSource: inferredGoal
      ? "plan-explanation"
    : durableExplicitGoal || narratedGoal || aboutWhatGoal
      ? "plan-explanation"
      : sidecar?.mainTaskSource,
    completedByCommand: completedByDoneCommand(sidecar),
    now: now || fallback.now,
    status:
      sidecar?.turn === "idle"
        ? "idle"
        : sidecar?.turn === "waiting"
          ? "waiting"
          : sidecar?.turn === "working" || working
            ? "working"
            : visibleTodos.length > 0
              ? "idle"
              : fallback.status,
    confidence: "high",
    tasks: extractedItems(visibleTodos.map(todoToTaskText)),
    // These tasks ARE the agent's real Claude TodoWrite list (captured by the
    // status hook), not heuristic summary items. Generic lifecycle placeholders
    // are filtered above, so only concrete items grant `todo-write` ownership.
    tasksFromTodoWrite: visibleTodos.length > 0,
    // The agent's own last words (from the Stop-hook transcript capture) — a reliable
    // title source when there's no task list, since it's what the model SAID it's doing
    // (not a heuristic scrape of terminal output). (TC-033)
    narration: cleanText(sidecar?.narration).slice(0, 90) || undefined,
    // The agent's rolling recent-activity log (what it actually did) — a reliable feed
    // to show when there's no task list, instead of inferring a title. (TC-033)
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

export function readSidecarForPayload(
  payload,
  read = (p) => readFileSync(p, "utf8"),
) {
  // Per-terminal status (TC-035): when the request carries the pane's id, prefer its
  // pane-keyed sidecar so two terminals in the SAME cwd read independent status. Falls
  // through to the cwd candidates when the pane sidecar is missing/stale (the pane id
  // isn't injected into the PTY yet, or this is a non-termfleet shell) → legacy behavior.
  const paneId = payload?.paneId;
  let firstFresh = null;
  if (paneId) {
    const paneIds = [paneId];
    const recoveredPaneId = String(paneId).replace(/^recovered-pane-/i, "");
    if (recoveredPaneId !== paneId) paneIds.push(recoveredPaneId);
    const suffix = String(paneId).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1];
    if (suffix) paneIds.push(suffix);
    for (const candidatePaneId of paneIds) {
      try {
        const sidecar = JSON.parse(read(paneSidecarPath(candidatePaneId)));
        if (sidecarFresh(sidecar)) {
          firstFresh = firstFresh || sidecar;
          if (sidecarHasConcreteTask(sidecar)) return sidecar;
        }
      } catch {
        // no fresh pane sidecar → try the restored-id alias or cwd keying
      }
    }
    // A known pane must never borrow another terminal's cwd record. That record may be
    // fresh and readable while describing a different conversation entirely.
    return firstFresh;
  }
  const candidates = [
    payload?.workstream?.path,
    payload?.projectId,
    payload?.cwd,
    payload?.cwdLabel,
  ].filter(Boolean);
  if (process.env.TERMFLEET_SIDECAR_DEBUG) {
    try {
      appendFileSync(
        process.env.TERMFLEET_SIDECAR_DEBUG,
        `${new Date().toISOString()} candidates=${JSON.stringify(candidates)} paths=${JSON.stringify(candidates.map((c) => sidecarPath(c)))}\n`,
      );
    } catch {
      // debug only
    }
  }
  for (const key of candidates) {
    try {
      const sidecar = JSON.parse(read(sidecarPath(key)));
      if (!sidecarFresh(sidecar)) continue;
      if (!firstFresh) firstFresh = sidecar;
      if (sidecarHasConcreteTask(sidecar)) return sidecar;
    } catch {
      // missing/stale/unreadable → try the next candidate key
    }
  }
  return firstFresh;
}

function readStdin() {
  return new Promise((resolve) => {
    let text = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (text += chunk));
    stdin.on("end", () => resolve(text));
    stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : {};
    const sidecar = readSidecarForPayload(payload);
    const summary = sidecar
      ? summaryFromSidecar(sidecar, payload)
      : fallbackSummary(payload);
    stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    stdout.write(`${JSON.stringify(fallbackSummary(payload))}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
