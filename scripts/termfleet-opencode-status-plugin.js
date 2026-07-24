// OpenCode status plugin: gives OpenCode panes the SAME per-terminal Task row,
// TASKS list and Running/Waiting/Idle badge that Claude and Codex panes get, by
// writing the identical sidecar file the app already reads (`agentStatusSidecar.ts`
// + `agent_status_read_sidecar`). No frontend change; the sidecar shape is
// byte-compatible with the Claude/Codex hooks'.
//
// WHY a plugin instead of a hook script: OpenCode has no external hook process. It
// loads ESM modules from `{plugin,plugins}/*.{ts,js}` under its config dirs and
// calls them in-process, which is strictly better here — it exposes OpenCode's own
// event stream, so this file reports:
//   - `todo.updated`        → the agent's REAL task list (like Claude's TaskCreate)
//   - `session.updated`     → the session title, used as the plain-language task
//   - `session.status/idle` → authoritative working/idle turn state
//   - `permission.updated`  → "waiting" (the agent needs the operator)
//   - tool execute events   → the activity line ("Running: npm test")
//
// SAFE TO INSTALL GLOBALLY: it writes nothing and does nothing unless
// TERMFLEET_PANE_ID is present in the environment — i.e. unless OpenCode is running
// inside a termfleet PTY. In every other OpenCode session it is inert.
//
// Install: symlink (or copy) this file into ~/.config/opencode/plugin/ — see
// `node scripts/termfleet-install-opencode-plugin.mjs`.

import { homedir } from "node:os";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Sidecar paths. Kept byte-identical to scripts/lib/agent-status-paths.mjs (and
// its TS port); parity is enforced by tests/opencode-status-plugin.spec.ts.
// ---------------------------------------------------------------------------

function fnv(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function statusDir() {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "terminal-workspace", "agent-status");
}

function paneSidecarPath(paneId) {
  return join(statusDir(), `pane-${fnv(String(paneId ?? ""))}.json`);
}

// ---------------------------------------------------------------------------
// Text shaping. The cockpit is read by non-developers, so activity lines stay
// short and plain — no flags, no paths longer than a file name.
// ---------------------------------------------------------------------------

function clean(value, max = 200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function baseName(value) {
  const text = clean(value, 200);
  const parts = text.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

/** OpenCode's tool names → a plain-language activity line. */
export function opencodeActivityFromTool(tool, args) {
  const name = String(tool ?? "");
  const input = args ?? {};
  if (name === "bash") {
    let command = clean(input.command, 200).replace(
      /^(?:cd|z|pushd)\s+[^&;|]+(?:&&|;|\|\|)\s*/i,
      "",
    );
    if (
      !command ||
      /^(?:cd|z|pushd|popd|ls|ll|la|pwd|clear|exit|echo)\b/i.test(command)
    ) {
      return "";
    }
    return `Running: ${command
      .split(/\s*(?:<<|["'|<>])/)[0]
      .trim()
      .slice(0, 50)}`;
  }
  if (name === "edit" || name === "patch")
    return `Editing ${baseName(input.filePath) || "files"}`;
  if (name === "write")
    return `Writing ${baseName(input.filePath) || "a file"}`;
  if (name === "read") return `Reading ${baseName(input.filePath) || "a file"}`;
  if (name === "grep")
    return `Searching for ${clean(input.pattern, 40) || "a match"}`;
  if (name === "glob")
    return `Looking for ${clean(input.pattern, 40) || "files"}`;
  if (name === "list") return "";
  if (name === "webfetch")
    return `Fetching ${clean(input.url, 60) || "a page"}`;
  if (name === "task")
    return `Delegating: ${clean(input.description, 50) || "a subtask"}`;
  if (name === "todowrite" || name === "todoread") return "";
  return name ? `Using ${name}` : "";
}

/** OpenCode todo statuses → the sidecar's Claude-shaped statuses. */
export function normalizeTodoStatus(status) {
  const text = String(status ?? "").toLowerCase();
  if (text === "in_progress" || text === "completed" || text === "pending")
    return text;
  if (text === "cancelled" || text === "canceled") return "completed";
  if (text === "done" || text === "complete") return "completed";
  if (text === "active" || text === "current" || text === "doing")
    return "in_progress";
  return "pending";
}

export function todosFromEvent(todos) {
  return (Array.isArray(todos) ? todos : [])
    .map((todo) => {
      const content = clean(todo?.content, 180);
      return content
        ? {
            id: clean(todo?.id, 64),
            content,
            status: normalizeTodoStatus(todo?.status),
            activeForm: "",
          }
        : null;
    })
    .filter(Boolean);
}

function nowFromTodos(todos) {
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  const current = active ?? firstOpen;
  return current ? current.activeForm || current.content : "";
}

/**
 * OpenCode auto-titles a session from its first prompt ("Fix the login redirect
 * loop"). That is exactly the plain-language line the cockpit's Task row wants, so
 * it becomes the main task — but only when it is a real title, not a placeholder.
 */
export function mainTaskFromSessionTitle(title) {
  const text = clean(title, 120);
  if (!text) return "";
  if (/^(?:new session|untitled|session \w+)$/i.test(text)) return "";
  return text.length <= 90 ? text : "";
}

// ---------------------------------------------------------------------------
// Sidecar writing
// ---------------------------------------------------------------------------

function paneId() {
  return clean(process.env.TERMFLEET_PANE_ID, 128);
}

function readSidecar(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function appendRecent(previous, text, at) {
  const entry = clean(text, 90);
  if (!entry) return Array.isArray(previous) ? previous.slice(-8) : [];
  const list = Array.isArray(previous) ? [...previous] : [];
  if (list[list.length - 1]?.text === entry) return list.slice(-8);
  list.push({ text: entry, at });
  return list.slice(-8);
}

export function createStatusWriter(options = {}) {
  const pane = options.paneId ?? paneId();
  const filePath = options.filePath ?? (pane ? paneSidecarPath(pane) : "");
  const cwd = options.cwd ?? process.cwd();
  // In-memory turn state. The plugin is long-lived (unlike the per-event hook
  // processes), so the last known task list/title survives between events even
  // when a single event carries none of them.
  const state = {
    todos: [],
    now: "",
    mainTask: "",
    userTask: "",
    narration: "",
    turn: "idle",
    sessionId: "",
  };

  const write = (at = Date.now(), { fresh = false } = {}) => {
    if (!pane || !filePath) return null;
    const previous = fresh ? null : readSidecar(filePath);
    const sidecar = {
      source: "opencode-plugin",
      provider: "opencode",
      paneId: pane,
      cwd,
      updatedAt: at,
      turnEventAt: at,
      turn: state.turn,
      todos: state.todos,
      now: state.now || nowFromTodos(state.todos) || undefined,
      narration: state.narration || undefined,
      mainTask: state.mainTask || undefined,
      mainTaskSource: state.mainTask ? "goal-task" : undefined,
      userTask: state.userTask || undefined,
      sessionId: state.sessionId || undefined,
      recent: appendRecent(previous?.recent, state.now || state.narration, at),
    };
    // Never let a no-todo write wipe a task list a previous event captured. A
    // `fresh` write skips this on purpose: a newly started OpenCode process must not
    // inherit the finished task list of whatever ran in this pane before it.
    if (
      sidecar.todos.length === 0 &&
      Array.isArray(previous?.todos) &&
      previous.todos.length > 0
    ) {
      sidecar.todos = previous.todos;
      if (!sidecar.now) sidecar.now = nowFromTodos(previous.todos);
    }
    try {
      mkdirSync(statusDir(), { recursive: true });
      const tmp = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(sidecar));
      renameSync(tmp, filePath);
      trace(`write pid=${process.pid} todos=${sidecar.todos.length} turn=${sidecar.turn}`);
    } catch (error) {
      // Never break the agent over a status-file write.
      trace(`write-failed ${String(error)}`);
    }
    return sidecar;
  };

  return { state, write, filePath, paneId: pane };
}

/**
 * Translate one OpenCode event into the writer's state. Exported (and pure apart
 * from the writer it is handed) so the whole mapping is unit-testable without
 * running OpenCode.
 */
export function applyEvent(writer, event) {
  const { state } = writer;
  const type = String(event?.type ?? "");
  const properties = event?.properties ?? {};
  switch (type) {
    case "todo.updated": {
      state.todos = todosFromEvent(properties.todos);
      state.now = nowFromTodos(state.todos) || state.now;
      if (properties.sessionID)
        state.sessionId = clean(properties.sessionID, 128);
      return true;
    }
    case "session.created":
    case "session.updated": {
      const info = properties.info ?? {};
      if (info.id) state.sessionId = clean(info.id, 128);
      const title = mainTaskFromSessionTitle(info.title);
      if (title) state.mainTask = title;
      return Boolean(title);
    }
    case "session.status": {
      const status = String(properties.status?.type ?? "");
      if (status === "busy") state.turn = "working";
      else if (status === "idle") state.turn = "idle";
      else if (status === "retry") {
        state.turn = "working";
        state.narration =
          clean(properties.status?.message, 90) || state.narration;
      }
      if (properties.sessionID)
        state.sessionId = clean(properties.sessionID, 128);
      return true;
    }
    case "session.idle": {
      state.turn = "idle";
      return true;
    }
    case "permission.updated": {
      // The agent is blocked on the operator — that is "waiting", the state the
      // cockpit badge exists for.
      state.turn = "waiting";
      state.now = clean(properties.title, 90) || "Waiting for your approval";
      return true;
    }
    case "session.error": {
      state.turn = "idle";
      state.narration =
        clean(properties.error?.name ?? properties.error?.data?.message, 90) ||
        state.narration;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Startup claim. OpenCode instantiates a plugin more than once per process (once per
 * server instance), so a blind startup write would let a late second instance wipe
 * the task list the first one is actively reporting. So: only claim the pane when no
 * LIVE OpenCode record is already there, and start from a clean slate rather than
 * inheriting whatever finished in this pane before.
 */
export const LIVE_CLAIM_WINDOW_MS = 2 * 60 * 1000;

export function shouldClaimPane(previous, now = Date.now()) {
  if (!previous || previous.provider !== "opencode") return true;
  const at = Number(previous.updatedAt);
  if (!Number.isFinite(at)) return true;
  return now - at > LIVE_CLAIM_WINDOW_MS;
}

function claimPane(writer) {
  if (!shouldClaimPane(readSidecar(writer.filePath))) return false;
  writer.state.now = "Waiting for your first instruction";
  writer.write(Date.now(), { fresh: true });
  return true;
}

/**
 * Diagnostic tap: set TERMFLEET_OPENCODE_STATUS_DEBUG=<file> to append every event
 * type OpenCode delivers. This is how you tell "the plugin never loaded" apart from
 * "the event names changed" without reading the app's source.
 */
function trace(entry) {
  const target = process.env.TERMFLEET_OPENCODE_STATUS_DEBUG;
  if (!target || !type) return;
  try {
    appendFileSync(target, `${type}\n`);
  } catch {
    // Diagnostics must never break the agent.
  }
}

export const TermfleetStatus = async ({ directory, worktree }) => {
  // "/" means OpenCode could not resolve a project root; the pane's own cwd is
  // more useful to the reader than the filesystem root.
  const resolved = [worktree, directory].find((value) => value && value !== "/");
  const writer = createStatusWriter({ cwd: resolved || process.cwd() });
  // Not a termfleet pane → stay completely inert.
  if (!writer.paneId) return {};

  // Claim the pane the moment OpenCode starts, before any turn has run. This is
  // what turns "Task not captured" into an honest "waiting for you", and it stamps
  // provider=opencode so the rest of the app (badge, resume, TUI reflow) knows what
  // this pane is even when the operator started OpenCode by hand.
  claimPane(writer);

  return {
    event: async ({ event }) => {
      trace(event?.type);
      if (applyEvent(writer, event)) writer.write();
    },
    "chat.message": async (_input, output) => {
      const text = (output?.parts ?? [])
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join(" ");
      const prompt = clean(text, 220).replace(/^"(.*)"$/s, "$1").trim();
      if (prompt) writer.state.userTask = prompt;
      writer.state.turn = "working";
      writer.write();
    },
    "tool.execute.before": async (input, output) => {
      const activity = opencodeActivityFromTool(input?.tool, output?.args);
      writer.state.turn = "working";
      if (input?.sessionID)
        writer.state.sessionId = clean(input.sessionID, 128);
      if (activity) {
        writer.state.now = activity;
        writer.state.narration = activity;
      }
      writer.write();
    },
    "tool.execute.after": async (input) => {
      // Keep the task list's own line as the resting activity between tools.
      const fromTodos = nowFromTodos(writer.state.todos);
      if (fromTodos) writer.state.now = fromTodos;
      if (input?.sessionID)
        writer.state.sessionId = clean(input.sessionID, 128);
      writer.write();
    },
  };
};

// OpenCode's loader requires a DEFAULT export object carrying `server()`, and a
// plugin loaded from a path must also carry an `id` — a bare function export is
// skipped in silence. Keep this shape.
export default { id: "termfleet-status", server: TermfleetStatus };
