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
import { narrationToNow, readTranscriptTail } from "./termfleet-claude-status-hook.mjs";

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

function taskTitleFromPrompt(prompt) {
  const text = cleanField(prompt, 160)
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .replace(/^(?:no|ok|wait|but|so|and)[,\s.]+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (/^\$sure$/i.test(text)) {
    return "Running requested safety check";
  }
  if (
    /\b(?:all|every)\s+terminals?\b/i.test(text) &&
    /\b(?:task|tasks|title|titles|description|descriptions|active|now active|logs?|monitor|capture)\b/i.test(text)
  ) {
    return "Capturing all terminal task and active labels";
  }
  if (
    lower.includes("you must see what i am seeing") ||
    lower.includes("must see what i am seeing") ||
    lower.includes("what i am seeing") ||
    lower.includes("what i'm seeing") ||
    (/\b(?:see|seeing|monitor|minitor|capture)\b/i.test(text) && /\b(?:this|screenshot|visible|window|screen)\b/i.test(text))
  ) {
    return "Monitoring the visible TermFleet header";
  }
  if (/\bfailed again\b/i.test(text) && /\b(?:monitor|minitor)\b/i.test(text)) {
    return "Monitoring the visible TermFleet header";
  }
  if (/\bimplement this\b/i.test(text) && /\bstop before\b/i.test(text) && /\brepayment step\b/i.test(text)) {
    return "Guarding the second repayment step";
  }
  if (/\bwatchdog\b/i.test(text) && /\bregressions?\b/i.test(text)) {
    return "Reviewing bot regression watchdog";
  }
  if (/\bstill looks? the same\b/i.test(text) && /\bproduction\b/i.test(text)) {
    return "Checking production deployment status";
  }
  if (/\bupgrade\b/i.test(text) && /\bcatch\b/i.test(text) && /\bfalse positive\b/i.test(text)) {
    return "Improving false-positive detection";
  }
  if (/\bca(?:p|o)ture\b/i.test(text) && /\btermfleet\s+terminal\b/i.test(text)) {
    return "Capturing the TermFleet terminal header";
  }
  if (/\b(?:broken|breaks?|failing|fails?|wrong)\b/i.test(text) && /\b(?:again|right now|currently|still)\b/i.test(text)) {
    return "Fixing broken cockpit header capture";
  }
  if (/\bpick\s+up\b/i.test(text) && /\b(?:active|working|task|tasks|lane)\b/i.test(text)) {
    return "Resuming active TermFleet work";
  }
  if (/\b(?:low quality|fails?|bad)\b/i.test(text) && /\b(?:task|title|description|header|cockpit|now active|capture)\b/i.test(text)) {
    return "Improving cockpit header quality";
  }
  if (/^(?:these|this|that)\s+(?:are|is)\s+fails?$/i.test(text)) {
    return "Fixing cockpit task labels";
  }
  if (/\bfails?\b/i.test(text) && /\b(?:task|title|description|header|cockpit|terminal)\b/i.test(text)) {
    return "Fixing cockpit task labels";
  }
  if (/\b(?:reliable|reliability|relable)\b/i.test(text) && /\b(?:how|make|answer)\b/i.test(text)) {
    return "Answering reliability question";
  }
  if (/\?$/.test(text) || /^(?:how|why|what|when|where|can|could|should|do|does|did|is|are)\b/i.test(text)) {
    return "Answering user question";
  }
  if (/^(?:fix|make|add|update|verify|check|review|explain|implement|debug|repair|write|run|test)\b/i.test(text)) {
    return text;
  }
  return "Answering latest prompt";
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

function genericTaskText(value) {
  return /^(?:Answering latest prompt|Answering user question|Working|Task not captured|Activity not captured)$/i.test(cleanField(value, 120));
}

function repairGenericTodosFromUserTask(todos, userTask) {
  const taskTitle = taskTitleFromPrompt(userTask);
  if (!taskTitle || genericTaskText(taskTitle)) return todos;
  if (!Array.isArray(todos) || todos.length === 0) {
    return [{ content: taskTitle, status: "in_progress", activeForm: taskTitle }];
  }
  const active = todos.find((todo) => todo.status === "in_progress") ?? todos[0];
  if (!genericTaskText(active?.activeForm || active?.content)) return todos;
  return todos.map((todo, index) =>
    todo === active || index === 0
      ? { ...todo, content: taskTitle, status: "in_progress", activeForm: taskTitle }
      : todo,
  );
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
  const prevUserTask = cleanField(prev?.userTask, 220) || undefined;
  const prevTodos = repairGenericTodosFromUserTask(
    Array.isArray(prev?.todos) ? prev.todos : [],
    prevUserTask,
  );
  const base = { cwd, sessionId: String(payload?.session_id ?? payload?.sessionId ?? prev?.sessionId ?? ""), updatedAt: now };

  if (event === "UserPromptSubmit") {
    const userTask = promptFromPayload(payload);
    if (!userTask) return null;
    // Never manufacture a placeholder task. If the classifier can only produce a
    // generic filler ("Answering latest prompt"), inject NOTHing: the raw prompt is
    // kept as `userTask` (the header shows the operator's real ask), and live tool
    // activity fills the Now line. A fake todo would hide both.
    const taskTitle = taskTitleFromPrompt(userTask);
    const realTask = taskTitle && !genericTaskText(taskTitle) ? taskTitle : "";
    return {
      ...base,
      source: "codex-user-prompt",
      todos: realTask ? [{ content: realTask, status: "in_progress", activeForm: realTask }] : [],
      userTask,
      now: realTask || "Prompt submitted",
      turn: "working",
    };
  }

  // The agent is asking the operator for input/permission → Waiting for you. Checked
  // before Stop because a Notification can also carry transcript_path/last message.
  if (event === "Notification") {
    return {
      ...base,
      source: prev?.source || "codex-narration",
      todos: prevTodos,
      now: cleanField(prev?.now) || undefined,
      narration: cleanField(prev?.narration, 90) || undefined,
      userTask: prevUserTask,
      turn: "waiting",
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
      now: taskNow || narration || cleanField(prev?.now) || undefined,
      narration: narration || cleanField(prev?.narration, 90) || undefined,
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
      userTask: prevUserTask,
      turn: "working",
    };
  }

  return null;
}

async function main() {
  // ALWAYS drain stdin first: exiting before Codex finishes writing the payload
  // surfaces "failed to write hook stdin: Broken pipe" inside the user's session.
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
  const sidecar = buildCodexSidecar(payload, prev);
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
