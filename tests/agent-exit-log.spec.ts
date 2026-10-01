import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper
import { explain } from "../scripts/why-did-it-die.mjs";

// TF-069: when an agent dies, the timelines must say why. A clean end names Claude's
// own reason, a closure names the card that took over, and a vanished process with
// neither is reported as killed from outside.

const HOOK = join(process.cwd(), "scripts", "termfleet-claude-status-hook.mjs");

async function fireHook(payload: object, env: Record<string, string>) {
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
  child.stdin.end(JSON.stringify(payload));
  await new Promise((done) => child.on("close", done));
}

test("the status hook records how each session started and the reason it ended", async () => {
  const home = mkdtempSync(join(tmpdir(), "tf-exit-"));
  const env = { XDG_STATE_HOME: home, XDG_DATA_HOME: home, TERMFLEET_PANE_ID: "terminal-aaaa-bbbb" };
  await fireHook({ hook_event_name: "SessionStart", session_id: "chat-1", cwd: "/work/freelance-desk", source: "resume" }, env);
  await fireHook({ hook_event_name: "SessionEnd", session_id: "chat-1", cwd: "/work/freelance-desk", reason: "prompt_input_exit" }, env);
  const lines = readFileSync(join(home, "termfleet", "agent-exits.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => l.event)).toEqual(["session-start", "session-end"]);
  expect(lines[0]).toMatchObject({ provider: "claude", source: "resume", sessionId: "chat-1", paneId: "terminal-aaaa-bbbb" });
  expect(lines[1]).toMatchObject({ reason: "prompt_input_exit", sessionId: "chat-1" });
  rmSync(home, { recursive: true, force: true });
});

const start = { event: "session-start", at: "2026-10-01T10:00:00Z", sessionId: "s1", paneId: "terminal-p1", cwd: "/work/freelance-desk", source: "resume", agentPid: 4242 };

test("an agent that ended by itself is reported with its own reason", () => {
  const out = explain({ exits: [start, { event: "session-end", at: "2026-10-01T11:00:00Z", sessionId: "s1", paneId: "terminal-p1", reason: "logout" }], closures: [], isAlive: () => false });
  expect(out[0].verdict).toContain('ended by itself');
  expect(out[0].verdict).toContain('"logout"');
});

test("an older copy closed by TermFleet names the card that took over", () => {
  const out = explain({
    exits: [start],
    closures: [{ at: "2026-10-01T11:00:00Z", event: "closed-older-copy", conversationId: "s1", closedPane: "terminal-p1", closedPid: 4242, openedByPane: "terminal-new-card" }],
    isAlive: () => false,
  });
  expect(out[0].verdict).toContain("closed by TermFleet");
  expect(out[0].verdict).toContain("terminal-new-card");
});

test("a vanished agent with no end and no closure is reported as killed from outside", () => {
  const out = explain({ exits: [start], closures: [], isAlive: () => false });
  expect(out[0].verdict).toContain("killed from outside");
});

test("a running agent is reported as still running, and the search text filters sessions", () => {
  const other = { ...start, sessionId: "s2", paneId: "terminal-p2", cwd: "/work/other" };
  const out = explain({ exits: [start, other], closures: [], text: "freelance-desk", isAlive: () => true });
  expect(out).toHaveLength(1);
  expect(out[0].verdict).toBe("still running");
});
