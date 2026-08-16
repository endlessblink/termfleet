#!/usr/bin/env node
// Codex status hook: gives Codex (gpt-5.x) panes the SAME per-terminal Task row +
// activity line that Claude panes get, by writing the identical sidecar file the app
// already reads (`agentStatusSidecar.ts` + `agent_status_read_sidecar`). No frontend
// change; the sidecar shape is byte-compatible with the Claude hook's.
//
// WHY a separate hook: Codex delivers a Claude-shaped hook payload (hook_event_name /
// tool_name / tool_input / prompt / transcript_path / last_assistant_message), but
// (1) its tool names differ (`exec_command`, not `Bash`) and (2) in real usage Codex
// agents almost never call the `update_plan` todo tool — so unlike Claude there is
// usually no declared task list. This hook therefore leans on the two signals Codex
// DOES emit reliably: the user's prompt (→ a stable Task row) and the agent's own last
// message (→ the activity line). If Codex ever does emit `update_plan`, its steps are
// captured as a real todo list, best-effort.
//
// SAFE TO INSTALL GLOBALLY: it writes nothing and exits immediately unless
// TERMFLEET_PANE_ID is present in the environment — i.e. unless Codex is running inside
// a termfleet PTY. In every other Codex session it is a no-op.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { paneSidecarPath, sidecarPath, statusDir, normalizeCwd } from "./lib/agent-status-paths.mjs";
import { shouldWriteStatusCandidate } from "./lib/agent-status-lifecycle.mjs";
import { durableGoalForPrompt, isDurableGoalText, openingGoalFromPrompt } from "./lib/agent-status-goal.mjs";
import { lifecycleFromNotification, narrationToNow, readTranscriptTail } from "./termfleet-claude-status-hook.mjs";

function cleanField(value, max = 200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// A stable per-terminal id injected into the PTY env by termfleet. Absent → this is not
// a termfleet pane, so the hook does nothing (keeps it safe as a global Codex hook).
function statusPaneId() {
  return cleanField(process.env.TERMFLEET_PANE_ID, 128);
}

function sidecarKeyCwd(payload) {
  return normalizeCwd(payload?.cwd || process.cwd());
}

function statusFilePath(cwd) {
  const paneId = statusPaneId();
  return paneId ? paneSidecarPath(paneId) : sidecarPath(cwd);
}

function normTaskStatus(status) {
  // Codex plan statuses use "in_progress"/"completed"/"pending"; map close variants.
  if (status === "in_progress" || status === "completed" || status === "pending") return status;
  if (status === "done" || status === "complete") return "completed";
  if (status === "active" || status === "current" || status === "doing") return "in_progress";
  return "pending";
}

function promptFromPayload(payload) {
  return cleanField(
    payload?.prompt ?? payload?.user_prompt ?? payload?.userPrompt ?? payload?.text ?? payload?.message,
    220,
  );
}

// Codex's own last words for this turn: the Stop payload usually carries them directly;
// otherwise fall back to the last `agent_message` in the rollout transcript.
export function codexLastAgentMessage(payload) {
  const direct = cleanField(
    payload?.last_assistant_message ?? payload?.lastAssistantMessage ?? payload?.last_agent_message,
    4000,
  );
  if (direct) return direct;
  const transcriptPath = payload?.transcript_path ?? payload?.transcriptPath;
  if (!transcriptPath) return "";
  const raw = readTranscriptTail(transcriptPath);
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // Rollout records: {type:"agent_message", message:"..."} — possibly wrapped in
    // {payload:{...}}. Keep the last one with real text.
    const node = entry?.type === "agent_message" ? entry : entry?.payload?.type === "agent_message" ? entry.payload : null;
    const message = cleanField(node?.message, 4000);
    if (message) text = message;
  }
  return text;
}

// Map a Codex tool call to a short "what's happening now" line. Codex's shell tool is
// `exec_command` / `local_shell` (command in tool_input.command|cmd), not Claude's `Bash`.
export function codexActivityFromTool(toolName, toolInput) {
  const trim = (s, n) => cleanField(s, n);
  const name = String(toolName ?? "");
  if (name === "exec_command" || name === "local_shell" || name === "shell" || name === "Bash") {
    let command = String(toolInput?.command ?? toolInput?.cmd ?? "")
      .replace(/\s+/g, " ")
      .trim();
    command = command.replace(/^(?:cd|z|pushd)\s+[^&;|]+(?:&&|;|\|\|)\s*/i, "").trim();
    if (!command || /^(?:cd|z|pushd|popd|ls|ll|la|pwd|clear|cls|exit|echo)\b/i.test(command)) {
      return "";
    }
    const head = command.split(/\s*(?:<<|["'|<>])/)[0].trim();
    return `Running: ${head.slice(0, 50)}`;
  }
  if (name === "write_stdin") return "";
  if (name === "request_user_input") return "Waiting for your input";
  if (name === "update_plan") return "";
  if (name === "apply_patch" || name === "edit") return "Editing files";
  return name ? `Using ${name}` : "";
}

// Best-effort: turn a Codex `update_plan` tool_input into the sidecar todo shape. Codex
// carries steps under `plan` (or `steps`); each item is {step|content, status}.
export function todosFromUpdatePlan(toolInput) {
  const rawSteps = Array.isArray(toolInput?.plan)
    ? toolInput.plan
    : Array.isArray(toolInput?.steps)
      ? toolInput.steps
      : [];
  return rawSteps
    .map((item) => {
      const content = cleanField(item?.step ?? item?.content ?? item?.text ?? item?.title);
      return content ? { content, status: normTaskStatus(item?.status), activeForm: "" } : null;
    })
    .filter(Boolean);
}

function nowFromTodos(todos) {
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  return active ? active.activeForm || active.content : firstOpen?.content || "";
}

function continuationAfterAnswer(todos) {
  const completed = [...todos].reverse().find((todo) => todo.status === "completed");
  const text = cleanField(completed?.content, 120);
  const confirmed = text?.match(/^Confirming\s+(.+?)\s+is\s+safely\s+completed$/i)?.[1];
  if (confirmed) return `Applying your answer to ${confirmed}`;
  return text ? `Applying your answer to ${text.replace(/^(?:Confirming|Checking|Reviewing)\s+/i, "")}` : "Continuing after your answer";
}

function readExistingSidecar(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
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

const RECENT_LIMIT = 8;
function appendRecent(prevRecent, text, at) {
  const list = Array.isArray(prevRecent) ? prevRecent.slice(-RECENT_LIMIT) : [];
  const clean = cleanField(text, 90);
  if (!clean) return list;
  const last = list[list.length - 1];
  if (last && last.text === clean) {
    list[list.length - 1] = { text: clean, at };
    return list;
  }
  list.push({ text: clean, at });
  return list.slice(-RECENT_LIMIT);
}

// Pure: decide the next sidecar from an event payload + the previous sidecar. Exported
// for unit tests; returns null when the event carries nothing worth writing.
export function buildCodexSidecar(payload, prev, now = Date.now()) {
  const cwd = sidecarKeyCwd(payload);
  const event = payload?.hook_event_name ?? payload?.hookEventName ?? payload?.event;
  const storedUserTask = cleanField(prev?.userTask, 220) || undefined;
  const prevUserTask = storedUserTask;
  // Only an explicit opening request is a durable operator goal. `goal-task` was
  // historically also used for internal create_goal/update_plan events, so accepting
  // it here would resurrect stale orchestration text from an older sidecar.
  const prevMainTaskSource = prev?.mainTaskSource === "opening-request"
    ? prev.mainTaskSource
    : undefined;
  const rawPrevMainTask = cleanField(prev?.mainTask, 220) || undefined;
  const prevMainTask =
    rawPrevMainTask &&
    prevMainTaskSource &&
    isDurableGoalText(rawPrevMainTask)
      ? rawPrevMainTask
      : undefined;
  const effectivePrevMainTaskSource = prevMainTask ? prevMainTaskSource : undefined;
  const prevTodos = Array.isArray(prev?.todos) ? prev.todos : [];
  const base = {
    cwd,
    sessionId: String(payload?.session_id ?? payload?.sessionId ?? prev?.sessionId ?? ""),
    updatedAt: now,
    turnEventAt: now,
  };

  if (event === "UserPromptSubmit") {
    const submittedUserTask = promptFromPayload(payload);
    if (!submittedUserTask) return null;
    const submittedSessionId = String(payload?.session_id ?? payload?.sessionId ?? "");
    // Older panes may predate `mainTask` but still have a substantive opening
    // request in `userTask`; recover that durable identity before a command-like
    // continuation such as "resume goal" overwrites the visible prompt.
    const legacyPromptGoal = openingGoalFromPrompt(prevUserTask);
    const { startsNewSession, mainTask, mainTaskSource } =
      durableGoalForPrompt({
        prompt: submittedUserTask,
        previousGoal: prevMainTask || legacyPromptGoal,
        previousSource: effectivePrevMainTaskSource,
        previousSessionId: prev?.sessionId,
        sessionId: submittedSessionId,
      });
    const todos = startsNewSession ? [] : prevTodos;
    return {
      ...base,
      source: "codex-user-prompt",
      todos,
      mainTask,
      mainTaskSource,
      userTask: submittedUserTask,
      now: nowFromTodos(todos) || "Prompt submitted",
      turn: "working",
    };
  }

  // Notification is a family of events. Unknown/background notifications preserve the
  // current turn; only typed operator prompts become Waiting for you.
  if (event === "Notification") {
    const turn = lifecycleFromNotification(payload, prev?.turn);
    if (!turn) return null;
    return {
      ...base,
      source: prev?.source || "codex-narration",
      todos: prevTodos,
      now: cleanField(prev?.now) || undefined,
      narration: cleanField(prev?.narration, 90) || undefined,
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      turn,
      turnReason: cleanField(payload?.notification_type ?? payload?.notificationType, 80) || "notification",
    };
  }

  if (payload?.tool_name === "request_user_input") {
    const waiting = event === "PreToolUse";
    return {
      ...base,
      source: "codex-tool",
      todos: prevTodos,
      now: waiting ? "Waiting for your input" : nowFromTodos(prevTodos) || continuationAfterAnswer(prevTodos),
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      turn: waiting ? "waiting" : "working",
      turnReason: waiting ? "operator_question" : "operator_answered",
    };
  }

  // `create_goal` is Codex/TermFleet orchestration state, not an operator request. It
  // must never become the cockpit's durable Task/Goal: doing so makes the agent's internal
  // investigation objective look like the user's product work. Preserve only a goal
  // already captured from an explicit user-facing source.
  if (payload?.tool_name === "create_goal") {
    return {
      ...base,
      source: "codex-goal",
      todos: prevTodos,
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      now: nowFromTodos(prevTodos) || cleanField(prev?.now) || "Working",
      turn: "working",
    };
  }

  if (payload?.tool_name === "update_plan") {
    const todos = todosFromUpdatePlan(payload?.tool_input);
    if (todos.length === 0) return null;
    return {
      ...base,
      source: "codex-plan",
      todos,
      now: nowFromTodos(todos),
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      turn: "working",
    };
  }

  if (event === "Stop" || (!payload?.tool_name && (payload?.transcript_path || payload?.last_assistant_message))) {
    // ALWAYS mark idle at turn end — even with no fresh narration — so a Codex pane whose
    // plan step was never completed stops reading as Running the moment the turn finishes.
    const narration = narrationToNow(codexLastAgentMessage(payload));
    const taskNow = nowFromTodos(prevTodos);
    return {
      ...base,
      source: "codex-narration",
      todos: prevTodos,
      // The response is the freshest answer to the operator's latest prompt. An older
      // in-progress todo must not overwrite it and make the card look stuck on yesterday's
      // work after the agent has already answered.
      now: narration || taskNow || cleanField(prev?.now) || undefined,
      narration: narration || cleanField(prev?.narration, 90) || undefined,
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      turn: "idle",
    };
  }

  if (payload?.tool_name) {
    const activity = codexActivityFromTool(payload.tool_name, payload.tool_input);
    if (!activity) return null;
    return {
      ...base,
      source: "codex-tool",
      todos: prevTodos,
      now: nowFromTodos(prevTodos) || activity,
      mainTask: prevMainTask,
      mainTaskSource: effectivePrevMainTaskSource,
      userTask: prevUserTask,
      turn: "working",
    };
  }

  return null;
}

async function main() {
  // ALWAYS drain stdin first: exiting before Codex finishes writing the payload
  // surfaces "failed to write hook stdin: Broken pipe" inside the user's session.
  const eventAt = Date.now();
  const raw = await readStdin();
  // Hard guard: only act inside a termfleet pane. Everywhere else this hook is inert.
  const paneId = statusPaneId();
  if (!paneId) process.exit(0);
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }
  const cwd = sidecarKeyCwd(payload);
  const filePath = statusFilePath(cwd);
  const prev = readExistingSidecar(filePath);
  const sidecar = buildCodexSidecar(payload, prev, eventAt);
  if (!sidecar) process.exit(0);

  sidecar.recent = appendRecent(prev?.recent, sidecar.narration ?? sidecar.now, sidecar.updatedAt);
  if (paneId) sidecar.paneId = paneId;
  // TC-054: stamp the provider so the daemon can build the right resume command
  // (`codex resume <id>`) on cold-restore for hand-started agents, without guessing.
  sidecar.provider = "codex";

  // Concurrent-hook guard (mirrors the Claude hook): never let a no-todo write wipe a
  // task list a sibling hook just wrote.
  if (!Array.isArray(sidecar.todos) || sidecar.todos.length === 0) {
    const onDisk = readExistingSidecar(filePath);
    if (Array.isArray(onDisk?.todos) && onDisk.todos.length > 0) {
      sidecar.todos = onDisk.todos;
      if (!sidecar.now) sidecar.now = nowFromTodos(onDisk.todos);
    }
  }
  if (!shouldWriteStatusCandidate(sidecar, readExistingSidecar(filePath))) {
    process.exit(0);
  }

  try {
    mkdirSync(statusDir(), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(sidecar));
    renameSync(tmp, filePath);
  } catch {
    // Never break the agent over a status-file write.
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
