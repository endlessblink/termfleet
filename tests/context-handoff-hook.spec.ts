import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(process.cwd(), "scripts", "context-handoff-hook.mjs");

function transcript(tokens: number) {
  return JSON.stringify({ message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens, output_tokens: 5 } } }) + "\n";
}

function run(dir: string, tokens: number, env: Record<string, string> = {}) {
  const file = join(dir, "t.jsonl");
  writeFileSync(file, transcript(tokens));
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "sess-1", transcript_path: file }),
    env: { ...process.env, XDG_STATE_HOME: dir, ...env },
    encoding: "utf8",
  }).stdout;
}

test("under the threshold stays silent; at 40% it asks once, never twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-ctx-"));
  expect(run(dir, 50_000)).toBe("");
  const first = run(dir, 90_000, { TERMFLEET_CONTEXT_HANDOFF: "ask" });
  expect(JSON.parse(first).hookSpecificOutput.additionalContext).toMatch(/45% full[\s\S]*only do it if he agrees/);
  expect(run(dir, 150_000)).toBe("");
  rmSync(dir, { recursive: true, force: true });
});

test("can be switched off, and auto mode tells the agent to proceed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-ctx-"));
  expect(run(dir, 150_000, { TERMFLEET_CONTEXT_HANDOFF: "off" })).toBe("");
  expect(run(dir, 150_000, { TERMFLEET_CONTEXT_HANDOFF: "auto" })).toContain("without asking");
  rmSync(dir, { recursive: true, force: true });
});
