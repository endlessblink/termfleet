import { test, expect } from "@playwright/test";
import { attentionStateFrom, badgeForAttention } from "../src/lib/terminalAttention";
import { terminalLooksActivelyWorking, terminalLooksAtRest } from "../src/lib/terminalHeaderDisplay";

test("a finished Codex/OMC turn is detected as at-rest, overriding a stale working hook", () => {
  // The exact false-positive: agent Cooked and returned to its prompt, but the hook
  // stayed on "working".
  expect(terminalLooksAtRest("* Cooked for 13s\n› \n[OMC] auto mode on (shift+tab to cycle)")).toBe(true);
  // But a pane that Cooked earlier and is now thinking again is NOT at rest.
  expect(terminalLooksAtRest("* Cooked for 13s\nWorking (4s · esc to interrupt)")).toBe(false);
  // A plain running pane with no done-marker is not at rest.
  expect(terminalLooksAtRest("Running 12 tests")).toBe(false);
});

test("OMC rotating done-verbs (Churned/Baked/…) are all detected as at-rest", () => {
  expect(terminalLooksAtRest("* Churned for 5m 41s\n› start the LLM classifier")).toBe(true);
  expect(terminalLooksAtRest("* Baked for 8s\n› ")).toBe(true);
  expect(terminalLooksAtRest("* Brewed for 1m 03s")).toBe(true);
  // Prose must NOT match (no duration after "for").
  expect(terminalLooksAtRest("I worked for the client all day")).toBe(false);
});

test("Claude's 'Worked for …' plus a persistent mode bar reads as at-rest, not running", () => {
  const finishedClaude =
    "- Worked for 46m 09s\n› Implement {feature}\nweekly 43% left · Context 53% used · Main [default]  Goal paused (/goal resume)";
  expect(terminalLooksActivelyWorking(finishedClaude)).toBe(false);
  expect(terminalLooksAtRest(finishedClaude)).toBe(true);
});

test("a live 'thinking' timer or 'esc to interrupt' reads as actively working", () => {
  // Codex/OMC live status line (the pane the operator flagged as active-but-Idle).
  expect(terminalLooksActivelyWorking("Getting the Telegram bot answering again… (4m 26s · thinking)")).toBe(true);
  expect(terminalLooksActivelyWorking("Working (32s · esc to interrupt)")).toBe(true);
  expect(terminalLooksActivelyWorking("Compacting…")).toBe(true);
});

test("a persistent 'thinking' mode label in the status bar is NOT active", () => {
  // OMC/Claude keep a mode word in the bottom bar even when idle — only a live
  // parenthesized timer counts as working.
  expect(terminalLooksActivelyWorking("[OMC] | thinking | session:66m | ctx:28% | Opus 4.8")).toBe(false);
  expect(terminalLooksActivelyWorking("weekly 43% left · Context 53% used · Main [default]")).toBe(false);
});

test("a finished turn or a rest prompt does NOT read as working", () => {
  // "Cooked for 13s" + a bare rest prompt (the pane flagged as Running-but-idle).
  expect(terminalLooksActivelyWorking("* Cooked for 13s\n› ")).toBe(false);
  expect(terminalLooksActivelyWorking("auto mode on (shift+tab to cycle) · ↵ for agents")).toBe(false);
  expect(terminalLooksActivelyWorking("user@host:~/proj$ ")).toBe(false);
});

test("waiting and blocked both mean the operator is the blocker", () => {
  expect(attentionStateFrom({ headerStatus: "waiting", activelyWorking: false }).valueOf()).toBe("waiting");
  expect(attentionStateFrom({ headerStatus: "blocked", activelyWorking: true })).toBe("waiting");
  expect(badgeForAttention("waiting").label).toBe("Waiting for you");
});

test("running requires positive activity evidence, not an attached PTY", () => {
  // "working" header status alone (a PTY is attached) is NOT enough — that was the
  // bug where every open shell showed "Running".
  expect(attentionStateFrom({ headerStatus: "working", activelyWorking: false })).toBe("idle");
  expect(attentionStateFrom({ headerStatus: "working", activelyWorking: true })).toBe("running");
  expect(badgeForAttention("running").label).toBe("Running");
});

test("idle and done default to Idle", () => {
  expect(attentionStateFrom({ headerStatus: "idle" })).toBe("idle");
  expect(attentionStateFrom({ headerStatus: "done", activelyWorking: false })).toBe("idle");
  expect(badgeForAttention("idle").label).toBe("Idle");
});

test("each state carries a distinct color token", () => {
  const colors = new Set(["waiting", "running", "idle"].map((s) => badgeForAttention(s as never).color));
  expect(colors.size).toBe(3);
});
