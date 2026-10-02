import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper
import { handoffInjection } from "../scripts/lib/handoff-inject.mjs";

const prompt = (f: string) => `Read ${f}. It is a handoff from the previous instance: continue exactly where it left off.`;

test("a handover prompt injects the whole handoff; anything else injects nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-inj-"));
  const file = join(dir, "HANDOFF.md");
  writeFileSync(file, "# handoff\nbuild the test\n");
  const out = handoffInjection(prompt(file)) as string;
  expect(out).toContain("build the test");
  expect(out).toContain("quote Noam's newest messages");
  expect(handoffInjection("Read /etc/passwd and carry out the instructions in it.")).toBeNull();
  expect(handoffInjection(prompt(join(dir, "missing.md")))).toBeNull();
  expect(handoffInjection("hello")).toBeNull();
});

test("the real hook prints the handoff as additional context", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-inj-"));
  const file = join(dir, "HANDOFF.md");
  writeFileSync(file, "# handoff\nthe main step\n");
  const run = spawnSync("node", ["scripts/context-handoff-hook.mjs"], {
    input: JSON.stringify({ prompt: prompt(file), session_id: "x" }),
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: dir },
  });
  expect(JSON.parse(run.stdout).hookSpecificOutput.additionalContext).toContain("the main step");
});
