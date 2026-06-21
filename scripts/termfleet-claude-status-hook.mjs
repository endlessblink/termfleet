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
import {
  fnv,
  normalizeCwd,
  sidecarPath,
  statusDir,
} from "./lib/agent-status-paths.mjs";

const TASK_EVENT_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);

function cleanField(value, max = 200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// In a git worktree, Claude's hook payload reports the MAIN checkout path in `cwd`
// but includes the real worktree path in `worktree` (Claude issue #64851). The
// terminal's live cwd (what the status worker looks up) is the worktree, so key the
// sidecar by the worktree when present.
function sidecarKeyCwd(payload) {
  return normalizeCwd(payload?.worktree || payload?.cwd || process.cwd());
}

function normTaskStatus(status) {
  return ["pending", "in_progress", "completed"].includes(status)
    ? status
    : "pending";
}

// Apply one TaskCreate/TaskUpdate event to the prior stateful todo list, returning the
// new list. TaskCreate's generated id is in tool_response.task.id (input lacks it);
// TaskUpdate carries taskId + status in tool_input. Defensive key reading throughout.
export function applyTaskEvent(prevTodos, payload) {
  const todos = (Array.isArray(prevTodos) ? prevTodos : []).map((todo) => ({
    ...todo,
  }));
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
    const id = keyFor(
      content,
      response?.task?.id ??
        response?.taskId ??
        response?.id ??
        input?.taskId ??
        input?.id,
    );
    if (todos.some((todo) => todo.id === id)) return todos;
    todos.push({
      id,
      content,
      status: "pending",
      activeForm: cleanField(input?.activeForm),
    });
    return todos;
  }

  // TaskUpdate
  const status = input?.status;
  const rawId =
    input?.taskId ?? input?.task_id ?? input?.id ?? response?.taskId;
  const subject = cleanField(input?.subject);
  const id = cleanField(rawId, 64) || (subject ? `h:${fnv(subject)}` : "");
  const index = todos.findIndex((todo) => todo.id === id);
  if (index === -1) {
    // Update for a task created before the hook saw it: synthesize from the subject if
    // we have one (and it isn't a deletion).
    if (subject && status !== "deleted") {
      todos.push({
        id: id || `h:${fnv(subject)}`,
        content: subject,
        status: normTaskStatus(status),
        activeForm: cleanField(input?.activeForm),
      });
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
  return active
    ? active.activeForm || active.content
    : firstOpen?.content || "";
}

// Map a non-TodoWrite tool call to a short "what's happening now" line, so the
// description tracks every step (live-now), not just todo changes.
export function activityFromTool(toolName, toolInput) {
  const base = (p) =>
    String(p ?? "")
      .split("/")
      .filter(Boolean)
      .pop() || String(p ?? "");
  const trim = (s, n) =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  switch (toolName) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing ${base(toolInput?.file_path ?? toolInput?.notebook_path)}`;
    case "Read":
      return `Reading ${base(toolInput?.file_path)}`;
    case "Bash": {
      let command = String(toolInput?.command ?? "")
        .replace(/\s+/g, " ")
        .trim();
      // Strip a leading navigation prefix so "cd x && npm test" → "npm test".
      command = command
        .replace(/^(?:cd|z|pushd)\s+[^&;|]+(?:&&|;|\|\|)\s*/i, "")
        .trim();
      // Pure navigation / screen / inspection commands aren't meaningful "activity" —
      // returning "" keeps the previous (more useful) now line instead of showing
      // "Running: cd /long/path". (TC-033)
      if (
        !command ||
        /^(?:cd|z|pushd|popd|ls|ll|la|pwd|clear|cls|exit|echo)\b/i.test(command)
      ) {
        return "";
      }
      return `Running: ${command.slice(0, 60)}`;
    }
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

// Stop event: read the agent's OWN last words (the final assistant text block) from the
// turn transcript, so the status line is what the model literally said it's doing — not an
// inference from tool calls. The model writes the log; the summary picks it up. (TC-033)
export function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return "";
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }
  let text = "";
  // Scan forward, keep the last assistant entry that carries a real text block. (Tool-only
  // assistant turns have no text — those are skipped so we land on actual narration.)
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    const blockText = content
      .filter(
        (block) =>
          block && block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join(" ")
      .trim();
    if (blockText) text = blockText;
  }
  return text;
}

// Condense the agent's narration into one short plain-language "now" line: drop markdown
// noise, take the first sentence, cap the length. Keeps the cockpit readable for
// non-developers without a model call.
export function narrationToNow(text) {
  let clean = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ") // strip fenced code blocks
    .replace(/`[^`]*`/g, " ") // strip inline code
    .replace(/[*_#>]+/g, " ") // strip markdown emphasis/headers
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  // First sentence (up to . ! ? followed by space/end), else the whole thing.
  const match = clean.match(/^.*?[.!?](?=\s|$)/);
  if (match) clean = match[0];
  // Drop conversational lead-ins ("Now let me…", "I'll…", "Let's…", "First, …") so the
  // line reads as a plain activity phrase for the cockpit. Strip repeatedly to peel a
  // chain ("Now let me …" → "let me …" → "…"), then re-capitalize.
  const LEAD_IN =
    /^(?:ok(?:ay)?|now|next|so|alright|first|then|finally|let me|let's|i'?ll|i am going to|i'?m going to|i'?m going|i will|i need to|i'?m|i have|i've)\b[\s,]*/i;
  for (let i = 0; i < 4 && LEAD_IN.test(clean); i += 1) {
    clean = clean.replace(LEAD_IN, "").trim();
  }
  if (clean) clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return cleanField(clean, 90);
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
  const rawTodos = Array.isArray(payload?.tool_input?.todos)
    ? payload.tool_input.todos
    : [];
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

const RECENT_LIMIT = 8;

// A rolling log of the agent's recent actions (what it actually DID) — reliable, unlike
// inferring a title. Dedupes consecutive repeats (just refreshes the timestamp). (TC-033)
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
  if (
    payload.hook_event_name === "Stop" ||
    (!payload.tool_name && payload.transcript_path)
  ) {
    // End-of-turn: capture the agent's own last words as the live "now" line. Only the
    // task list (a real plan) outranks it, so don't clobber an in-progress task summary.
    const now = narrationToNow(lastAssistantText(payload.transcript_path));
    if (!now) process.exit(0);
    const prev = readExistingSidecar(cwd);
    const todos = Array.isArray(prev?.todos) ? prev.todos : [];
    const taskNow = nowFromTodos(todos);
    sidecar = {
      cwd,
      sessionId: String(payload?.session_id ?? prev?.sessionId ?? ""),
      updatedAt: Date.now(),
      source: "claude-narration",
      todos,
      now: taskNow || now,
      narration: now,
    };
  } else if (payload.tool_name === "TodoWrite") {
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
      ...(payload?.agent_id
        ? {
            agentId: String(payload.agent_id),
            agentType: String(payload.agent_type ?? ""),
          }
        : {}),
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
  // Roll the agent's actual action into the recent-activity log (what it DID). On a Stop
  // event prefer the agent's own narration over a task summary, so the feed reads in the
  // model's voice.
  const prevForRecent = readExistingSidecar(cwd);
  sidecar.recent = appendRecent(
    prevForRecent?.recent,
    sidecar.narration ?? sidecar.now,
    sidecar.updatedAt,
  );
  // Carry the agent's last narration forward across tool-call rewrites: only the Stop
  // branch refreshes it, but it must survive the live-now/task rewrites in between so the
  // header title keeps reading the agent's own words instead of falling back to "Working".
  if (sidecar.narration === undefined && prevForRecent?.narration) {
    sidecar.narration = cleanField(prevForRecent.narration, 90);
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
