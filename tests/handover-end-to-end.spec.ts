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
// @ts-expect-error plain .mjs helper
import { publishSessionEvent } from "../scripts/lib/session-event-journal.mjs";

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
  // Oct 7 capsule contract: the authored HANDOFF.md is no longer rewritten; the owner's
  // words go into an immutable hash-bound capsule that the successor prompt names, and
  // the pane's status journal must hold the live chat (as the status hook records it).
  const w = world();
  writeChat(w.home, STALE, "an older chat");
  writeChat(w.home, LIVE, LAST_WORDS);
  await publishSessionEvent({ dir: join(w.data, "terminal-workspace", "agent-status"), paneId: PANE, provider: "claude", at: 1000,
    payload: { session_id: LIVE, hook_event_name: "UserPromptSubmit", prompt: LAST_WORDS }, sidecar: { turn: "working" } });
  const before = readFileSync(w.handoff, "utf8");
  const { stderr } = await handover(w);
  expect(stderr).toContain("retained 1 owner records");
  expect(readFileSync(w.handoff, "utf8")).toBe(before);
  const capsules = join(w.data, "terminal-workspace", "handoff-capsules");
  const generations = readdirSync(capsules);
  expect(generations).toHaveLength(1);
  const capsule = join(capsules, generations[0]);
  const manifest = JSON.parse(readFileSync(join(capsule, "manifest.json"), "utf8"));
  expect(manifest.provider).toBe("claude");
  expect(manifest.parentPaneId).toBe(PANE);
  expect(manifest.source.sessionId).toBe(LIVE);
  const owner = JSON.parse(readFileSync(join(capsule, "owner-records.json"), "utf8"));
  expect(owner.map((m: { text: string }) => m.text)).toEqual([LAST_WORDS]);
  const continuation = readdirSync(capsule).filter((n) => n.startsWith("continuation-")).sort().map((n) => readFileSync(join(capsule, n), "utf8")).join("");
  expect(continuation).toContain(LAST_WORDS);
  expect(continuation).not.toContain("an older chat");
});

test("a handover that cannot find Noam's words refuses to start instead of dropping them silently", async () => {
  const w = world();
  const { code, stderr } = await handover(w);
  expect(code).not.toBe(0);
  expect(stderr).toContain("recent messages cannot be added");
  expect(readdirSync(w.requests).filter((n) => n.endsWith(".request.json"))).toEqual([]);
  expect(existsSync(w.handoff)).toBe(true);
});

// TF-074: a paper-bot handover replaced the showtime-bot card because the command inherited the
// terminal id of whichever terminal started the shared Codex service. A card bound to ANOTHER chat
// must never be taken as this chat's card.
test("a Codex handover never takes a card that belongs to a different chat", async () => {
  const { resolveCaller } = await import("../scripts/termfleet-child.mjs" as string);
  const root = mkdtempSync(join(tmpdir(), "tf-caller-"));
  const status = join(root, "terminal-workspace", "agent-status");
  mkdirSync(status, { recursive: true });
  const other = "terminal-5f33e232-8443-4a86-911e-987088991a33-d0289857-842c-4b14-bbf5-aa578dc28031";
  const mine = "terminal-1c28cded-8443-4a86-911e-987088991a33-d0289857-842c-4b14-bbf5-aa578dc28031";
  const A = "01a0ecbf-1b15-7943-872a-49c9ee96643c";
  const B = "01a1032a-4b83-7ae1-ba6e-964c53e937bf";
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  try {
    writeFileSync(join(status, "codex-chat-panes.json"), JSON.stringify({ [A]: { paneId: other, at: 1 } }));
    const proc = join(root, "proc");
    mkdirSync(join(proc, "900"), { recursive: true });
    writeFileSync(join(proc, "900", "stat"), "900 (node) S 0 1 1");
    // B has no card of its own and inherited A's card id: refuse.
    expect(resolveCaller({ CODEX_THREAD_ID: B, TERMFLEET_PANE_ID: other }, proc, 900).paneId).toBeUndefined();
    // B bound to its own card: use that one even though the inherited id is A's.
    writeFileSync(join(status, "codex-chat-panes.json"), JSON.stringify({ [A]: { paneId: other, at: 1 }, [B]: { paneId: mine, at: 2 } }));
    expect(resolveCaller({ CODEX_THREAD_ID: B, TERMFLEET_PANE_ID: other }, proc, 900).paneId).toBe(mine);
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
  }
});
