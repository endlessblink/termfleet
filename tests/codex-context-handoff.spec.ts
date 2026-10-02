import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper shared with the hooks
import { codexContext, decide, handoffAdvice } from "../scripts/lib/context-handoff.mjs";

// A Codex session near the end of its context must hand over to a fresh Codex session,
// not just compact on its own (TF-069). Before this only Claude sessions were told to.
const WINDOW = 258_400;

function rollout(totalTokens: number) {
  const event = (tokens: number) =>
    JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { total_tokens: tokens }, model_context_window: WINDOW } },
    });
  return `${event(10_000)}\n${event(totalTokens)}\n`;
}

test("the context size and window are read from the last Codex token_count event", () => {
  expect(codexContext(rollout(120_000))).toEqual({ tokens: 120_000, windowTokens: WINDOW });
  expect(codexContext("not a rollout")).toEqual({ tokens: 0, windowTokens: 0 });
});

test("a Codex session under 50% stays silent and over 50% is told to hand over in Codex", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-codex-ctx-"));
  const file = join(dir, "rollout.jsonl");
  const env = { XDG_STATE_HOME: dir } as NodeJS.ProcessEnv;
  const payload = { session_id: "codex-sess-1", transcript_path: file };

  writeFileSync(file, rollout(100_000)); // ~39%
  expect(handoffAdvice({ payload, provider: "codex", env })).toBeNull();

  writeFileSync(file, rollout(140_000)); // ~54%
  const advice = handoffAdvice({ payload, provider: "codex", env }) as string;
  expect(advice).toContain("54% full");
  expect(advice).toContain("--provider codex");
  expect(advice).toContain("Do NOT wait for Codex to compact");

  // once per session
  expect(handoffAdvice({ payload, provider: "codex", env })).toBeNull();
  rmSync(dir, { recursive: true, force: true });
});

test("the Claude advice still says claude and has no Codex wording", () => {
  const message = decide({ tokens: 100_000, windowTokens: 200_000, percent: 40, mode: "auto", alreadyFired: false });
  expect(message).toContain("--provider claude");
  expect(message).not.toContain("compact");
});

test("the real Codex status hook tells a Codex session to hand over, once", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-codex-hook-"));
  const file = join(dir, "rollout.jsonl");
  writeFileSync(file, rollout(130_000));
  // Do not let the real shared Codex server's ancestry override this synthetic
  // hook's pane: its own process tree contains only the fixture Node process.
  const preload = join(dir, "isolated-proc.cjs");
  writeFileSync(preload, `
    const fs = require("node:fs");
    const { syncBuiltinESMExports } = require("node:module");
    const root = ${JSON.stringify(join(dir, "proc"))};
    fs.mkdirSync(root + "/" + process.pid, { recursive: true });
    fs.writeFileSync(root + "/" + process.pid + "/stat", process.pid + " (node) S 0 1 1");
    for (const name of ["readFileSync", "readlinkSync", "readdirSync"]) {
      const original = fs[name];
      fs[name] = (path, ...args) => original(typeof path === "string" && path.startsWith("/proc/") ? root + path.slice(5) : path, ...args);
    }
    syncBuiltinESMExports();
  `);
  const run = () =>
    spawnSync(process.execPath, ["--require", preload, join(process.cwd(), "scripts", "termfleet-codex-status-hook.mjs")], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "codex-sess-2", transcript_path: file, cwd: dir, prompt: "continue" }),
      env: {
        ...process.env,
        XDG_STATE_HOME: dir,
        XDG_DATA_HOME: dir,
        TERMFLEET_PANE_ID: "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222",
      },
      encoding: "utf8",
    }).stdout;
  const first = run();
  const parsed = JSON.parse(first.trim().split("\n")[0]);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("--provider codex");
  expect(run()).not.toContain("hand over to a fresh instance");
  rmSync(dir, { recursive: true, force: true });
});
