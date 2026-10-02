import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper shared with the status hooks
import { fnv } from "../scripts/lib/agent-status-paths.mjs";
// @ts-expect-error — plain ESM script that also exports its caller detection
import { resolveCaller } from "../scripts/termfleet-child.mjs";

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
  const env: Record<string, string | undefined> = { ...process.env, XDG_DATA_HOME: dataHome, ...extraEnv };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(process.execPath, [CLI, "spawn", "--provider", provider, "--timeout", "10", ...args], {
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
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir);
  expect(code).toBe(0);
  expect(request.replace).toBe(true);
  expect(request.task).toContain("handoff from the previous instance");
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
function recordCallerAgent(dataHome: string, provider: string) {
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(statusDir, `pane-${fnv(parentPaneId)}.json`), JSON.stringify({ paneId: parentPaneId, provider, updatedAt: Date.now() }));
}

test("a handover from a Codex session continues in Codex, even if Claude was typed", async () => {
  const { dataHome, dir, file } = setup();
  recordCallerAgent(dataHome, "codex");
  const { request, stderr, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude");
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.replace).toBe(true);
  expect(stderr).toContain("same agent as you (codex)");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a handover from a Claude session continues in Claude", async () => {
  const { dataHome, dir, file } = setup();
  recordCallerAgent(dataHome, "claude");
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "codex");
  expect(code).toBe(0);
  expect(request.provider).toBe("claude");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a handover keeps the typed agent when the app does not know what the caller runs", async () => {
  const { dataHome, dir, file } = setup();
  // no record at all
  const none = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "codex");
  expect(none.code).toBe(0);
  expect(none.request.provider).toBe("codex");
  // a record without an agent (shells and not-yet-identified panes look like this)
  const statusDir = join(dataHome, "terminal-workspace", "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(statusDir, `pane-${fnv(parentPaneId)}.json`), JSON.stringify({ paneId: parentPaneId, provider: null }));
  const unknown = await spawnAndReadRequest(["--dropoff", file("HANDOFF2.md", REAL_HANDOFF)], dataHome, dir, "claude");
  expect(unknown.code).toBe(0);
  expect(unknown.request.provider).toBe("claude");
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
  const { request, code } = await spawnAndReadRequest(["--dropoff", file("HANDOFF.md", REAL_HANDOFF)], dataHome, dir, "claude");
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
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
  bindChatToCard(dataHome, "thread-codex-1", parentPaneId);
  const { request, code, stderr } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF)],
    dataHome,
    dir,
    "claude", // what an old instruction would have typed
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: "thread-codex-1" },
  );
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.parentPaneId).toBe(parentPaneId);
  expect(request.replace).toBe(true);
  expect(stderr).toContain("same agent as you (codex)");
  rmSync(dataHome, { recursive: true, force: true });
});

test("a stale card id inherited from the shared Codex service never wins over the chat's own card", async () => {
  const { dataHome, dir, file } = setup();
  const staleClaudePane = "terminal-99999999-9999-4999-8999-999999999999-88888888-8888-4888-8888-888888888888";
  bindChatToCard(dataHome, "thread-codex-2", parentPaneId);
  const { request, code } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF)],
    dataHome,
    dir,
    "claude",
    { TERMFLEET_PANE_ID: staleClaudePane, CODEX_THREAD_ID: "thread-codex-2" },
  );
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.parentPaneId).toBe(parentPaneId);
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

test("an explicitly separate unbound Codex dropoff may open a new card", async () => {
  const { dataHome, dir, file } = setup();
  const { request, code } = await spawnAndReadRequest(
    ["--dropoff", file("HANDOFF.md", REAL_HANDOFF), "--separate"], dataHome, dir, "codex",
    { TERMFLEET_PANE_ID: undefined, CODEX_THREAD_ID: "thread-unbound" },
  );
  expect(code).toBe(0);
  expect(request.provider).toBe("codex");
  expect(request.replace).toBeUndefined();
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
