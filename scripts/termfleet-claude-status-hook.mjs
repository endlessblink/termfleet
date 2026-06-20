#!/usr/bin/env node
// Claude Code PostToolUse(TodoWrite) hook: writes the agent's REAL todo list +
// current activity to a sidecar file keyed by cwd, which termfleet's sidecar
// status worker reads. Free + accurate (no model), no terminal pollution (file,
// not /dev/tty). Safe to install globally: it only writes a small status file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { normalizeCwd, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

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
  const cwd = normalizeCwd(payload?.cwd || process.cwd());
  const rawTodos = Array.isArray(payload?.tool_input?.todos) ? payload.tool_input.todos : [];
  const todos = rawTodos
    .map((todo) => ({
      content: String(todo?.content ?? todo?.activeForm ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      status: ["pending", "in_progress", "completed"].includes(todo?.status) ? todo.status : "pending",
      activeForm: String(todo?.activeForm ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    }))
    .filter((todo) => todo.content);
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  const now = active ? active.activeForm || active.content : firstOpen?.content || "";
  return {
    cwd,
    sessionId: String(payload?.session_id ?? ""),
    updatedAt: Date.now(),
    source: "claude-todowrite",
    todos,
    now,
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
  const cwd = normalizeCwd(payload?.cwd || process.cwd());
  let sidecar;
  if (payload.tool_name === "TodoWrite") {
    // Authoritative: rewrite todos + now from the real todo list.
    sidecar = buildSidecar(payload);
    if (sidecar.todos.length === 0) process.exit(0);
  } else {
    // Live-now: update the activity line on every tool call, preserving the last
    // known todo list so the task panel stays populated between TodoWrite calls.
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
