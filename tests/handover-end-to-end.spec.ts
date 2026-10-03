// TF-076 guard: the REAL spawn command, run as a handover, must carry Noam's newest words into
// the handoff file, and must refuse to start when it cannot. Unit tests of the pieces passed while
// the whole chain still lost his last message, so this exercises the command itself.
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper
import { fnv } from "../scripts/lib/agent-status-paths.mjs";

const CLI = join(process.cwd(), "scripts", "termfleet-child.mjs");
const PANE = "terminal-aaaaaaaa-1111-2222-3333-444444444444-bbbbbbbb-1111-2222-3333-444444444444";
const LIVE = "11111111-2222-3333-4444-555555555555";
const STALE = "99999999-2222-3333-4444-555555555555";
const LAST_WORDS = "include the thing I typed one second before dropoff";

const HANDOFF = `# Handoff
The original request and what Noam asked, said in his words. Done and verified with evidence and results.
Files touched: uncommitted changes and the commit state. Decisions and why; rejected approaches.
Open problems and next steps. First command: start with git status.
${"Filler line so the handoff is long enough to count as a real handoff.\n".repeat(30)}`;

function world() {
  const root = mkdtempSync(join(tmpdir(), "tf-handover-"));
  const home = join(root, "home");
  const data = join(root, "data");
  const requests = join(data, "terminal-workspace", "child-requests");
  mkdirSync(requests, { recursive: true });
  writeFileSync(join(requests, ".listener"), String(Date.now()));
  const status = join(data, "terminal-workspace", "agent-status");
  mkdirSync(status, { recursive: true });
  // The pane's own status record is STALE: it names an older chat than the live one.
  writeFileSync(join(status, `pane-${fnv(PANE)}.json`), JSON.stringify({ provider: "claude", sessionId: STALE, paneId: PANE }));
  const proc = join(root, "proc");
  const preload = join(root, "isolated-proc.cjs");
  writeFileSync(preload, `
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
  const handoff = join(root, "HANDOFF.md");
  writeFileSync(handoff, HANDOFF);
  return { home, data, requests, preload, handoff };
}

function writeChat(home: string, id: string, text: string) {
  mkdirSync(join(home, ".claude", "projects", "-proj"), { recursive: true });
  writeFileSync(join(home, ".claude", "projects", "-proj", `${id}.jsonl`), JSON.stringify({ type: "user", timestamp: "t", message: { content: text } }));
}

function handover(w: ReturnType<typeof world>) {
  const child = spawn(process.execPath, ["--require", w.preload, CLI, "spawn", "--provider", "claude", "--dropoff", w.handoff, "--cwd", "/work", "--timeout", "1"], {
    env: { ...process.env, HOME: w.home, XDG_DATA_HOME: w.data, TERMFLEET_PANE_ID: PANE, CLAUDE_CODE_SESSION_ID: LIVE, CODEX_THREAD_ID: "", CODEX_SESSION_ID: "" },
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  return new Promise<{ code: number; stderr: string }>((done) => child.on("close", (code) => done({ code: code ?? -1, stderr })));
}

test("the last thing Noam typed reaches the handoff even when the pane record names an older chat", async () => {
  const w = world();
  writeChat(w.home, STALE, "an older chat");
  writeChat(w.home, LIVE, LAST_WORDS);
  await handover(w);
  const text = readFileSync(w.handoff, "utf8");
  expect(text).toContain(LAST_WORDS);
  expect(text).not.toContain("an older chat");
});

test("a handover that cannot find Noam's words refuses to start instead of dropping them silently", async () => {
  const w = world();
  const { code, stderr } = await handover(w);
  expect(code).not.toBe(0);
  expect(stderr).toContain("recent messages cannot be added");
  expect(readdirSync(w.requests).filter((n) => n.endsWith(".request.json"))).toEqual([]);
  expect(existsSync(w.handoff)).toBe(true);
});
