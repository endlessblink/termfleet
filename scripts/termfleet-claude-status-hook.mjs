#!/usr/bin/env node
// Claude Code PostToolUse hook: writes the agent's REAL task list + current activity
// to a sidecar file keyed by cwd, which termfleet's status worker reads. Free +
// accurate (no model), no terminal pollution (file, not /dev/tty). Safe to install
// globally: it only writes a small status file.
//
// Captures the MODERN task tools (TaskCreate/TaskUpdate, Claude Code v2.1.142+) as a
// stateful per-cwd task map — modern Claude Code no longer emits TodoWrite by default,
// so a TodoWrite-only hook records nothing. The legacy TodoWrite path is kept for
// CLAUDE_CODE_ENABLE_TASKS=0 sessions. The sidecar `todos[]` shape is unchanged, so the
// status worker/UI need no changes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { fnv, normalizeCwd, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

const TASK_EVENT_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);

function cleanField(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// In a git worktree, Claude's hook payload reports the MAIN checkout path in `cwd`
// but includes the real worktree path in `worktree` (Claude issue #64851). The
// terminal's live cwd (what the status worker looks up) is the worktree, so key the
// sidecar by the worktree when present.
function sidecarKeyCwd(payload) {
  return normalizeCwd(payload?.worktree || payload?.cwd || process.cwd());
}

function normTaskStatus(status) {
  return ["pending", "in_progress", "completed"].includes(status) ? status : "pending";
}

// Apply one TaskCreate/TaskUpdate event to the prior stateful todo list, returning the
// new list. TaskCreate's generated id is in tool_response.task.id (input lacks it);
// TaskUpdate carries taskId + status in tool_input. Defensive key reading throughout.
export function applyTaskEvent(prevTodos, payload) {
  const todos = (Array.isArray(prevTodos) ? prevTodos : []).map((todo) => ({ ...todo }));
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const response = payload?.tool_response ?? {};
  const keyFor = (content, rawId) => {
    const id = cleanField(rawId, 64);
    return id || `h:${fnv(content)}`;
  };

  if (tool === "TaskCreate") {
    const content = cleanField(input?.subject ?? input?.content);
    if (!content) return todos;
    const id = keyFor(content, response?.task?.id ?? response?.taskId ?? response?.id ?? input?.taskId ?? input?.id);
    if (todos.some((todo) => todo.id === id)) return todos;
    todos.push({ id, content, status: "pending", activeForm: cleanField(input?.activeForm) });
    return todos;
  }

  // TaskUpdate
  const status = input?.status;
  const rawId = input?.taskId ?? input?.task_id ?? input?.id ?? response?.taskId;
  const subject = cleanField(input?.subject);
  const id = cleanField(rawId, 64) || (subject ? `h:${fnv(subject)}` : "");
  const index = todos.findIndex((todo) => todo.id === id);
  if (index === -1) {
    // Update for a task created before the hook saw it: synthesize from the subject if
    // we have one (and it isn't a deletion).
    if (subject && status !== "deleted") {
      todos.push({ id: id || `h:${fnv(subject)}`, content: subject, status: normTaskStatus(status), activeForm: cleanField(input?.activeForm) });
    }
    return todos;
  }
  if (status === "deleted") {
    todos.splice(index, 1);
    return todos;
  }
  if (status) todos[index].status = normTaskStatus(status);
  if (subject) todos[index].content = subject;
  const activeForm = cleanField(input?.activeForm);
  if (activeForm) todos[index].activeForm = activeForm;
  return todos;
}

// Derive the "now" line from a task list: the in-progress task's active form, else the
// first open task's content.
function nowFromTodos(todos) {
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  return active ? active.activeForm || active.content : firstOpen?.content || "";
}

// Map a non-TodoWrite tool call to a short "what's happening now" line, so the
// description tracks every step (live-now), not just todo changes.
export function activityFromTool(toolName, toolInput) {
  const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() || String(p ?? "");
  const trim = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  switch (toolName) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing ${base(toolInput?.file_path ?? toolInput?.notebook_path)}`;
    case "Read":
      return `Reading ${base(toolInput?.file_path)}`;
    case "Bash":
      return `Running: ${trim(toolInput?.command, 60)}`;
    case "Grep":
      return `Searching ${trim(toolInput?.pattern, 40)}`;
    case "Glob":
      return `Listing ${trim(toolInput?.pattern, 40)}`;
    case "Task":
      return `Delegating: ${trim(toolInput?.description, 50)}`;
    case "WebFetch":
    case "WebSearch":
      return `Researching ${trim(toolInput?.url ?? toolInput?.query, 50)}`;
    // Task tools drive the task list / now line directly (handled in main); the
    // read-only ones carry no useful activity → keep the previous now line.
    case "TaskCreate":
    case "TaskUpdate":
    case "TaskList":
    case "TaskGet":
      return "";
    default:
      return toolName ? `Using ${toolName}` : "";
  }
}

function readExistingSidecar(cwd) {
  try {
    return JSON.parse(readFileSync(sidecarPath(cwd), "utf8"));
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

export function buildSidecar(payload) {
  const cwd = sidecarKeyCwd(payload);
  const rawTodos = Array.isArray(payload?.tool_input?.todos) ? payload.tool_input.todos : [];
  const todos = rawTodos
    .map((todo) => ({
      content: cleanField(todo?.content ?? todo?.activeForm),
      status: normTaskStatus(todo?.status),
      activeForm: cleanField(todo?.activeForm),
    }))
    .filter((todo) => todo.content);
  return {
    cwd,
    sessionId: String(payload?.session_id ?? ""),
    updatedAt: Date.now(),
    source: "claude-todowrite",
    todos,
    now: nowFromTodos(todos),
  };
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }
  const cwd = sidecarKeyCwd(payload);
  let sidecar;
  if (payload.tool_name === "TodoWrite") {
    // Legacy authoritative path (CLAUDE_CODE_ENABLE_TASKS=0): rewrite from the array.
    sidecar = buildSidecar(payload);
    if (sidecar.todos.length === 0) process.exit(0);
  } else if (TASK_EVENT_TOOLS.has(payload.tool_name)) {
    // Modern task tools: fold this TaskCreate/TaskUpdate into the stateful list.
    const prev = readExistingSidecar(cwd);
    const todos = applyTaskEvent(prev?.todos, payload);
    if (todos.length === 0) process.exit(0);
    sidecar = {
      cwd,
      sessionId: String(payload?.session_id ?? prev?.sessionId ?? ""),
      updatedAt: Date.now(),
      source: "claude-task",
      todos,
      now: nowFromTodos(todos),
      ...(payload?.agent_id ? { agentId: String(payload.agent_id), agentType: String(payload.agent_type ?? "") } : {}),
    };
  } else {
    // Live-now: update the activity line on every other tool call, preserving the last
    // known task list so the panel stays populated between task events.
    const now = activityFromTool(payload?.tool_name, payload?.tool_input);
    if (!now) process.exit(0);
    const prev = readExistingSidecar(cwd);
    sidecar = {
      cwd,
      sessionId: String(payload?.session_id ?? prev?.sessionId ?? ""),
      updatedAt: Date.now(),
      source: "claude-tool",
      todos: Array.isArray(prev?.todos) ? prev.todos : [],
      now,
    };
  }
  try {
    mkdirSync(statusDir(), { recursive: true });
    writeFileSync(sidecarPath(sidecar.cwd), JSON.stringify(sidecar));
  } catch {
    // Never break the agent over a status-file write.
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
