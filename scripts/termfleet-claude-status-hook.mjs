#!/usr/bin/env node
// Claude Code PostToolUse(TodoWrite) hook: writes the agent's REAL todo list +
// current activity to a sidecar file keyed by cwd, which termfleet's sidecar
// status worker reads. Free + accurate (no model), no terminal pollution (file,
// not /dev/tty). Safe to install globally: it only writes a small status file.
import { mkdirSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { normalizeCwd, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

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
  // Only act on TodoWrite (the hook may be registered narrowly, but guard anyway).
  if (payload.tool_name && payload.tool_name !== "TodoWrite") process.exit(0);
  const sidecar = buildSidecar(payload);
  if (sidecar.todos.length === 0) process.exit(0);
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
