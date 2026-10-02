import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// TF-075 — a fresh Claude pane must be identified as Claude at SessionStart, before any
// prompt, without inventing task text; a resumed pane keeps what it already had.

const HOOK = path.join(process.cwd(), "scripts", "termfleet-claude-status-hook.mjs");
const PANE = "terminal-11111111-1111-1111-1111-111111111111-22222222-2222-2222-2222-222222222222";

function runStart(dataHome: string, source: string) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source, session_id: "sess-1", cwd: "/tmp/tf075-proj" }),
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome, TERMFLEET_PANE_ID: PANE },
  });
  expect(r.status).toBe(0);
  const dir = path.join(dataHome, "terminal-workspace", "agent-status");
  return { dir, files: readdirSync(dir).filter((f) => f.endsWith(".json")) };
}

test("fresh session records the provider with no task or goal text", () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf075-"));
  const { dir, files } = runStart(dataHome, "startup");
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const s = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    expect(s.provider).toBe("claude");
    expect(s.paneId).toBe(PANE);
    expect(s.sessionId).toBe("sess-1");
    expect(s.todos).toEqual([]);
    expect(s.mainTask).toBeUndefined();
    expect(s.userTask).toBeUndefined();
    expect(s.now).toBeUndefined();
    expect(s.turn).toBeUndefined();
  }
});

test("resumed session keeps the existing task data", () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf075-"));
  const { dir, files } = runStart(dataHome, "startup");
  const target = path.join(dir, files[0]);
  const prev = JSON.parse(readFileSync(target, "utf8"));
  writeFileSync(target, JSON.stringify({ ...prev, mainTask: "Fixing the login screen", mainTaskSource: "opening-request", turn: "idle" }));
  runStart(dataHome, "resume");
  const after = JSON.parse(readFileSync(target, "utf8"));
  expect(after.mainTask).toBe("Fixing the login screen");
  expect(after.turn).toBe("idle");
  expect(after.provider).toBe("claude");
});
