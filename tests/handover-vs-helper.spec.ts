import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper shared with the status hooks
import { fnv } from "../scripts/lib/agent-status-paths.mjs";
// @ts-expect-error — plain ESM script that also exports its caller detection
import { resolveCaller } from "../scripts/termfleet-child.mjs";
// @ts-expect-error — plain ESM helper written by the status hooks
import { publishSessionEvent } from "../scripts/lib/session-event-journal.mjs";

// Oct 7 capsule contract: a --dropoff handover fails closed unless the caller's own
// provider transcript is readable (found via CLAUDE_CODE_SESSION_ID / CODEX_THREAD_ID or
// the pane record's sessionId) AND the pane's status journal holds that chat. These
// fixtures are what the provider and the status hook leave on disk in real use.
const OWNER_WORDS = "fix the sidebar, and keep the old card's work";
function seedSource(dataHome: string, provider: "claude" | "codex", sessionId: string, pane = parentPaneId) {
  const home = join(dataHome, "home");
  if (provider === "claude") {
    mkdirSync(join(home, ".claude", "projects", "-work"), { recursive: true });
    writeFileSync(join(home, ".claude", "projects", "-work", `${sessionId}.jsonl`),
      JSON.stringify({ type: "user", timestamp: "2026-10-07T10:00:00Z", message: { content: OWNER_WORDS } }) + "\n");
  } else {
    const dir = join(home, ".codex", "sessions", "2026", "10", "07");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `rollout-2026-10-07T10-00-00-${sessionId}.jsonl`), [
      JSON.stringify({ timestamp: "2026-10-07T10:00:00Z", type: "session_meta", payload: { id: sessionId } }),
      JSON.stringify({ timestamp: "2026-10-07T10:00:01Z", type: "event_msg", payload: { type: "user_message", message: OWNER_WORDS } }),
    ].join("\n") + "\n");
  }
  return publishSessionEvent({ dir: join(dataHome, "terminal-workspace", "agent-status"), paneId: pane, provider, at: 1000,
    payload: { session_id: sessionId, hook_event_name: "UserPromptSubmit", prompt: OWNER_WORDS }, sidecar: { turn: "working" } });
}
const CLAUDE_CHAT = "c1a0de00-0000-4000-8000-000000000001";
const CODEX_CHAT = "01a10000-0000-7000-8000-0000000000c1";
function expectHandoffRequest(request: any, provider: string) {
  expect(request.version).toBe(3);
  expect(request.kind).toBe("handoff");
  expect(request.provider).toBe(provider);
  expect(request.task.startsWith(`TermFleet handoff v1 ${JSON.stringify(request.handoff)}\n`)).toBe(true);
  const manifest = JSON.parse(readFileSync(request.handoff.path, "utf8"));
  expect(manifest.provider).toBe(provider);
  expect(manifest.generation).toBe(request.handoff.generation);
  const owner = JSON.parse(readFileSync(join(request.handoff.path, "..", "owner-records.json"), "utf8"));
  expect(owner.map((m: { text: string }) => m.text)).toEqual([OWNER_WORDS]);
}

// A helper adds a card and the caller keeps running. Only a real handoff of the
// caller's own work replaces the caller's card (TF-069). A helper briefing that
// arrives through --dropoff must never end the instance that asked for it.
const tabId = "11111111-1111-4111-8111-111111111111";
const paneId = "22222222-2222-4222-8222-222222222222";
const parentPaneId = `terminal-${tabId}-${paneId}`;
const CLI = join(process.cwd(), "scripts", "termfleet-child.mjs");

const REAL_HANDOFF = `# HANDOFF
The original request, in the operator's words: fix the sidebar. Later corrections are listed below.
${"Everything done so far, with evidence and what was verified, is recorded here. ".repeat(25)}
Files touched and uncommitted state: see the commit list.
Decisions and why, plus rejected approaches, are written out.
Open problems and next steps follow. First command to run: git status.
`;

const BRIEFING = "Please examine the pricing page layout and summarise the layout of each column. ".repeat(25);

function setup() {
  const dataHome = mkdtempSync(join(tmpdir(), "tf-handover-"));
  const dir = join(dataHome, "terminal-workspace", "child-requests");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".listener"), String(Date.now()));
  // A synthetic Claude/unknown caller must not inherit this test runner's real Codex ancestry.
  const proc = join(dataHome, "proc");
  writeFileSync(join(dataHome, "isolated-proc.cjs"), `
    const fs = require("node:fs");
    const { syncBuiltinESMExports } = require("node:module");
    const root = ${JSON.stringify(proc)};
    fs.mkdirSync(root + "/" + process.pid, { recursive: true });
    fs.writeFileSync(root + "/" + process.pid + "/stat", process.pid + " (node) S 0 1 1");
    for (const name of ["readFileSync", "readlinkSync", "readdirSync"]) {
      const original = fs[name];
      fs[name] = (path, ...args) => original(typeof path === "string" && path.startsWith("/proc/") ? root + path.slice(5) : path, ...args);
    }
    syncBuiltinESMExports();
  `);
  const file = (name: string, text: string) => {
    const path = join(dataHome, name);
    writeFileSync(path, text);
    return path;
  };
  return { dataHome, dir, file };
}

async function spawnAndReadRequest(
  args: string[],
  dataHome: string,
  dir: string,
  provider = "claude",
  extraEnv: Record<string, string | undefined> = { TERMFLEET_PANE_ID: parentPaneId },
) {
  const env: Record<string, string | undefined> = { ...process.env, XDG_DATA_HOME: dataHome, HOME: join(dataHome, "home"),
    CODEX_THREAD_ID: "", CODEX_SESSION_ID: "", CLAUDE_CODE_SESSION_ID: "", ...extraEnv };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  // --allow-no-words is gone from the contract: a handover without readable owner source is refused.
  const child = spawn(process.execPath, ["--require", join(dataHome, "isolated-proc.cjs"), CLI, "spawn", "--provider", provider, "--timeout", "10", ...args], {
    env: env as NodeJS.ProcessEnv,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const closed = new Promise<number>((done) => child.on("close", (code) => done(code ?? -1)));
  let requestFile: string | undefined;
  for (let i = 0; i < 100 && !requestFile; i += 1) {
    requestFile = readdirSync(dir).find((name) => name.endsWith(".request.json"));
    if (!requestFile) await new Promise((wait) => setTimeout(wait, 50));
    if (!requestFile && child.exitCode !== null) break;
  }
  if (!requestFile) return { request: null, stderr, code: await closed };
  const request = JSON.parse(readFileSync(join(dir, requestFile), "utf8"));
  writeFileSync(join(dir, `${request.requestId}.result.json`), JSON.stringify({ requestId: request.requestId, ok: true }));
  const code = await closed;
  // clear this run's files so a second run in the same sandbox reads its own request
  for (const name of readdirSync(dir)) if (name !== ".listener") rmSync(join(dir, name), { force: true });
  return { request, stderr, code };
}

test("a helper (--task) never replaces the card that asked for it", async () => {
  const { dataHome, dir } = setup();
  const { request, code } = await spawnAndReadRequest(["--task", "Check the pricing page"], dataHome, dir);
  expect(code).toBe(0);
  expect(request.replace).toBeUndefined();
  rmSync(dataHome, { recursive: true, force: true });
});

test("a helper briefing in a file (--task-file) never replaces the card that asked for it", async () => {
  const { dataHome, dir, file } = setup();
  const { request, code } = await spawnAndReadRequest(["--task-file", file("brief.md", BRIEFING)], dataHome, dir);
  expect(code).toBe(0);
  expect(request.replace).toBeUndefined();
  rmSync(dataHome, { recursive: true, force: true });
});

test("a real handoff (--dropoff) replaces the caller's own card", async () => {
  const { dataHome, dir, file } = setup();
  // Without any readable owner record the handover fails closed: no request, card untouched.
  const refused = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude",
    { TERMFLEET_PANE_ID: parentPaneId, CLAUDE_CODE_SESSION_ID: CLAUDE_CHAT });
  expect(refused.code).toBe(2);
  expect(refused.request).toBeNull();
  expect(refused.stderr).toContain("no readable owner record; handover was not started");
  await seedSource(dataHome, "claude", CLAUDE_CHAT);
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude",
    { TERMFLEET_PANE_ID: parentPaneId, CLAUDE_CODE_SESSION_ID: CLAUDE_CHAT });
  expect(code).toBe(0);
  expect(request.replace).toBe(true);
  expect(request.parentPaneId).toBe(parentPaneId);
  expectHandoffRequest(request, "claude");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a briefing sent through --dropoff starts a helper and leaves the caller's card alone", async () => {
  const { dataHome, dir, file } = setup();
  const { request, stderr, code } = await spawnAndReadRequest(["--dropoff", file("brief.md", BRIEFING)], dataHome, dir);
  expect(code).toBe(0);
  expect(request.replace).toBeUndefined();
  expect(request.task).not.toContain("handoff from the previous instance");
  expect(stderr).toContain("starts a HELPER and your own card stays");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a nearly empty handoff is refused, because a successor would start with nothing", async () => {
  const { dataHome, dir, file } = setup();
  const { request, stderr, code } = await spawnAndReadRequest(["--dropoff", file("tiny.md", "continue please")], dataHome, dir);
  expect(request).toBeNull();
  expect(code).toBe(2);
  expect(stderr).toContain("successor starts with nothing");
  expect(existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".request.json")) : []).toEqual([]);
  rmSync(dataHome, { recursive: true, force: true });
});

// A Codex session that reaches its limit continues in Codex, not in Claude.
function recordCallerAgent(dataHome: string, provider: string, sessionId?: string) {
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(statusDir, `pane-${fnv(parentPaneId)}.json`), JSON.stringify({ paneId: parentPaneId, provider, sessionId, updatedAt: Date.now() }));
}

test("a handover from a Codex session continues in Codex, even if Claude was typed", async () => {
  const { dataHome, dir, file } = setup();
  recordCallerAgent(dataHome, "codex", CODEX_CHAT);
  await seedSource(dataHome, "codex", CODEX_CHAT);
  const { request, stderr, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude");
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.replace).toBe(true);
  expect(stderr).toContain("same agent as you (codex)");
  expectHandoffRequest(request, "codex");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a handover from a Claude session continues in Claude", async () => {
  const { dataHome, dir, file } = setup();
  recordCallerAgent(dataHome, "claude", CLAUDE_CHAT);
  await seedSource(dataHome, "claude", CLAUDE_CHAT);
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "codex");
  expect(code).toBe(0);
  expect(request.provider).toBe("claude");
  expectHandoffRequest(request, "claude");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a handover keeps the typed agent when the app does not know what the caller runs", async () => {
  const { dataHome, dir, file } = setup();
  // no pane record at all: the typed agent (claude) is kept; its own chat id comes from its env
  await seedSource(dataHome, "claude", CLAUDE_CHAT);
  const none = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude",
    { TERMFLEET_PANE_ID: parentPaneId, CLAUDE_CODE_SESSION_ID: CLAUDE_CHAT });
  expect(none.code).toBe(0);
  expect(none.request.provider).toBe("claude");
  expectHandoffRequest(none.request, "claude");
  // a record without an agent (shells and not-yet-identified panes look like this): typed codex is kept
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  await seedSource(dataHome, "codex", CODEX_CHAT);
  writeFileSync(join(statusDir, `pane-${fnv(parentPaneId)}.json`), JSON.stringify({ paneId: parentPaneId, provider: null, sessionId: CODEX_CHAT }));
  const unknown = await spawnAndReadRequest(["--dropoff", file("HANDOFF2.md", REAL_HANDOFF)], dataHome, dir, "codex");
  expect(unknown.code).toBe(0);
  expect(unknown.request.provider).toBe("codex");
  expectHandoffRequest(unknown.request, "codex");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a handover from a Codex card that only carries its real record fields still continues in Codex", async () => {
  const { dataHome, dir, file } = setup();
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  mkdirSync(statusDir, { recursive: true });
  // the shape the status hook really writes for a Codex pane
  writeFileSync(
    join(statusDir, `pane-${fnv(parentPaneId)}.json`),
    JSON.stringify({
      cwd: "/work",
      mainTask: "Fixing the sidebar",
      mainTaskSource: "opening-request",
      narration: "",
      now: "Idle",
      paneId: parentPaneId,
      provider: "codex",
      recent: [],
      sessionId: "00000000-0000-4000-8000-000000000001",
      source: "hook",
      todos: [],
      turn: "idle",
      updatedAt: 1,
    }),
  );
  await seedSource(dataHome, "codex", "00000000-0000-4000-8000-000000000001");
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude");
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expectHandoffRequest(request, "codex");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a helper may still be a different agent than the one that asked for it", async () => {
  const { dataHome, dir } = setup();
  recordCallerAgent(dataHome, "codex");
  const { request, code } = await spawnAndReadRequest(["--task", "Check the pricing page"], dataHome, dir, "claude");
  expect(code).toBe(0);
  expect(request.provider).toBe("claude");
  expect(request.replace).toBeUndefined();
  rmSync(dataHome, { recursive: true, force: true });
});

// Codex runs commands from one shared background service: its command shell carries the
// chat's id (CODEX_THREAD_ID) but NOT the card's id. A Codex handover must still find its
// card and continue in Codex (live 2026-10-01: it continued in Claude).
function bindChatToCard(dataHome: string, threadId: string, paneId: string) {
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(statusDir, "codex-chat-panes.json"), JSON.stringify({ [threadId]: { paneId, at: Date.now() } }));
}

test("a Codex command shell with no card id still hands over in Codex, replacing its own card", async () => {
  const { dataHome, dir, file } = setup();
  // Codex thread ids are UUIDs; the capsule only looks up well-formed ids.
  bindChatToCard(dataHome, CODEX_CHAT, parentPaneId);
  await seedSource(dataHome, "codex", CODEX_CHAT);
  const { request, code, stderr } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF)],
    dataHome,
    dir,
    "claude", // what an old instruction would have typed
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: CODEX_CHAT },
  );
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.parentPaneId).toBe(parentPaneId);
  expect(request.replace).toBe(true);
  expect(stderr).toContain("same agent as you (codex)");
  expectHandoffRequest(request, "codex");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a stale card id inherited from the shared Codex service never wins over the chat's own card", async () => {
  const { dataHome, dir, file } = setup();
  const staleClaudePane = "terminal-99999999-9999-4999-8999-999999999999-88888888-8888-4888-8888-888888888888";
  bindChatToCard(dataHome, CODEX_CHAT, parentPaneId);
  await seedSource(dataHome, "codex", CODEX_CHAT);
  const { request, code } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF)],
    dataHome,
    dir,
    "claude",
    { TERMFLEET_PANE_ID: staleClaudePane, CODEX_THREAD_ID: CODEX_CHAT },
  );
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.parentPaneId).toBe(parentPaneId);
  expectHandoffRequest(request, "codex");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a Codex handover without its card binding refuses before adding another card", async () => {
  const { dataHome, dir, file } = setup();
  const { request, code, stderr } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF)],
    dataHome,
    dir,
    "claude",
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: "thread-unbound" },
  );
  expect(code).toBe(2);
  expect(request).toBeNull();
  expect(stderr).toContain("cannot identify your TermFleet card");
  expect(readdirSync(dir).filter((name) => name.endsWith(".request.json"))).toEqual([]);
  rmSync(dataHome, { recursive: true, force: true });
});

test("an explicitly separate unbound Codex dropoff is refused before adding a card", async () => {
  // Oct 7 capsule contract: a handoff (v3) must be bound to the caller's own card and
  // replace it; without a card there is no pane-scoped source journal to bind, so even a
  // readable Codex transcript cannot make an unbound --separate dropoff a handover.
  // (Previously this opened a new card with the legacy "Read HANDOFF.md" prompt.)
  const { dataHome, dir, file } = setup();
  const UNBOUND = "01a10000-0000-7000-8000-00000000000b";
  await seedSource(dataHome, "codex", UNBOUND);
  const { request, code, stderr } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF), "--separate"], dataHome, dir, "codex",
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: UNBOUND },
  );
  expect(code).toBe(2);
  expect(request).toBeNull();
  expect(stderr).toContain("incomplete-observed-source");
  expect(readdirSync(dir).filter((name) => name.endsWith(".request.json"))).toEqual([]);
  rmSync(dataHome, { recursive: true, force: true });
});

test("an explicit replacement without its card binding also refuses before launch", async () => {
  const { dataHome, dir } = setup();
  const { request, code, stderr } = await spawnAndReadRequest(
    ["--task", "Continue the current work", "--replace"], dataHome, dir, "codex",
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: "thread-unbound" },
  );
  expect(code).toBe(2);
  expect(request).toBeNull();
  expect(stderr).toContain("cannot identify your TermFleet card");
  rmSync(dataHome, { recursive: true, force: true });
});

function fakeProc(procs: Array<{ pid: number; ppid: number; args: string[] }>) {
  const root = mkdtempSync(join(tmpdir(), "tf-proc-"));
  for (const proc of procs) {
    const dir = join(root, String(proc.pid));
    mkdirSync(join(dir, "fd"), { recursive: true });
    writeFileSync(join(dir, "cmdline"), proc.args.join("\0") + "\0");
    writeFileSync(join(dir, "environ"), "HOME=/x\0");
    writeFileSync(join(dir, "stat"), `${proc.pid} (${proc.args[0].split("/").pop()}) S ${proc.ppid} 1 1`);
  }
  return root;
}

test("a command running under the shared Codex service is recognised as a Codex caller", () => {
  // the shape found on the real machine: bash <- codex app-server --managed-daemon (no terminal)
  const root = fakeProc([
    { pid: 800, ppid: 1, args: ["/home/u/.codex/packages/app-server-daemon/releases/0.159.3/bin/codex", "app-server", "--listen", "unix://", "--managed-daemon"] },
    { pid: 900, ppid: 800, args: ["/bin/bash", "-c", "termfleet-child spawn --dropoff HANDOFF.md"] },
  ]);
  expect(resolveCaller({}, root, 900)).toEqual({ provider: "codex", paneId: undefined });
  rmSync(root, { recursive: true, force: true });
});

test("a command that is neither under Codex nor in a card has no caller", () => {
  const root = fakeProc([{ pid: 900, ppid: 1, args: ["/bin/bash"] }]);
  expect(resolveCaller({}, root, 900)).toEqual({ provider: undefined, paneId: undefined });
  rmSync(root, { recursive: true, force: true });
});
