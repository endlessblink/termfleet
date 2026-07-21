import { expect, test } from "@playwright/test";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckNowLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckTaskLabel,
  qualityCheckUserAskLabel,
} from "../src/lib/terminalHeaderQuality";

test("accepts concise operator-readable task and activity labels", () => {
  expect(qualityCheckTaskLabel("Improve cockpit header descriptions").ok).toBe(true);
  expect(qualityCheckActivityLabel("Inspecting header quality rules").ok).toBe(true);
});

test("rejects saved final-answer steps as current activity", () => {
  for (const label of [
    "Steps - Open the landing page and confirm the route.",
    "Next steps: hard-refresh production.",
  ]) {
    expect(qualityCheckNowLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  }
});

test("rejects raw prompt echoes and typo-heavy prompt fragments", () => {
  expect(qualityCheckTaskLabel("what now? we still dont ahve high quality descriptions")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("Thinking about what now? we still dont ahve high quality descriptions")).toMatchObject({
    ok: false,
    reason: "raw-thinking-prompt",
  });
  expect(qualityCheckActivityLabel("Reviewing its not logical that we cant find any its just not")).toMatchObject({
    ok: false,
    reason: "raw-thinking-prompt",
  });
  expect(qualityCheckActivityLabel("Still in Plan Mode, so I can’t mutate files yet.")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("You’re now testing the updated packaged app.")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
});

test("rejects command-like and implementation-detail labels", () => {
  for (const label of [
    "npm run verify:terminal-headers-live-all",
    "npx playwright test tests/terminal-header-view-model.spec.ts",
    "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    "Md](/home/endlessblink/.",
    "Screenshot](/media/endlessblink/data/my-projects/example.png)",
    "Editing ModelScene.tsx",
    "terminal-workspace-tauri@0.1.0 cockpit:snapshot",
    "Running: sleep 2",
    "Using mcp__node_repl__js",
  ]) {
    expect(qualityCheckTaskLabel(label).ok).toBe(false);
    expect(qualityCheckActivityLabel(label).ok).toBe(false);
  }
});

test("rejects agent footer metrics from every visible header field", () => {
  for (const label of [
    "Weekly 57% left • Context 76% used • Main [default]",
    "wk:26%(5d2h) | ctx:8% | session:5m | Fable 5",
  ]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckAuthoritativeTaskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckUserAskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckNowLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
  }
});

test("rejects vague activity labels", () => {
  for (const label of ["Working", "Thinking", "Awaiting terminal output", "Running terminal command", "Waiting for operator's response to low-quality image #1"]) {
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false });
  }
  expect(qualityCheckActivityLabel("Waiting for operator selection")).toMatchObject({ ok: true });
});

test("approval and verdict labels must say what is being judged", () => {
  for (const label of ["Waiting for operator verdict", "Waiting for approval", "Awaiting reviewer decision"]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckAuthoritativeTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
  }
  expect(qualityCheckTaskLabel("Waiting for operator verdict on pane header wording").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("Rechecking pane header wording approval").ok).toBe(true);
});

test("rejects stale one-word prompt fragments as task goals", () => {
  for (const label of ["done", "go", "fix it", "so fix it", "and this", "this", "both"]) {
    expect(qualityCheckUserAskLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  }
  expect(qualityCheckUserAskLabel("go over everything and get it ready to merge").ok).toBe(true);
});

test("rejects long conversational requirement dumps as visible labels", () => {
  const raw =
    "I just need ready high quality calls. that are verifiable e2e. anything else is just adding more";
  expect(qualityCheckUserAskLabel(raw)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckTaskLabel(raw)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckActivityLabel("The production inbox says and explains the real gate: a call is required")).toMatchObject({
    ok: false,
  });
});

test("rejects generic build and test result wrappers", () => {
  for (const label of [
    "Raise quality across the current work",
    "Task Complete: Files shipped: - - - profile invoice access",
    "Files shipped: profile invoice access",
    "Frontend build failed",
    "Confidence is HIGH after verifying the local surface",
    "Verify Build and tests result",
    "Build and tests completed successfully",
    "Test process completed successfully",
    "Task completed successfully",
  ]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "vague" });
  }
  expect(qualityCheckTaskLabel("Task 7 — mark IZ-009 in the plan and finalize")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("Running build and visual checks").ok).toBe(true);
});

test("rejects duplicated long task and activity labels", () => {
  expect(headerLabelsAreDuplicated(
    "Fix terminal headers so Task shows the user ask and activity shows current work",
    "Fix terminal headers so Task shows the user ask and activity shows current work",
  )).toBe(true);
  expect(headerLabelsAreDuplicated("Updating old link locations", "Checking old link replacements")).toBe(true);
  expect(headerLabelsAreDuplicated("Improve header descriptions", "Inspecting quality rules")).toBe(false);
});

test("accepts correctly spelled task labels that mention broken things", () => {
  expect(qualityCheckTaskLabel("Fix the broken login flow").ok).toBe(true);
  expect(qualityCheckActivityLabel("Checking why titles and tasks are still broken").ok).toBe(true);
});

test("authoritative task labels only reject empty or overlong text", () => {
  expect(qualityCheckAuthoritativeTaskLabel("Run cargo test for the daemon restore path").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("Update docs/regression-matrix.md with the new failure mode").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("")).toMatchObject({ ok: false, reason: "empty" });
  expect(qualityCheckAuthoritativeTaskLabel("x".repeat(200))).toMatchObject({ ok: false, reason: "too-long" });
  expect(qualityCheckAuthoritativeTaskLabel("[hermes] [diagnostics] backend.exit: Primary backend exited")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
});

test("trusted pane titles still reject implementation details", () => {
  expect(qualityCheckTrustedActivityLabel("Cleaning up this pane title").ok).toBe(true);
  expect(qualityCheckTrustedActivityLabel("Implemented the upgraded pipeline in scripts/agent-status-summary-server.mjs")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
  expect(qualityCheckTrustedActivityLabel("Updating scripts/agent-status-summary-server.mjs")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
  expect(qualityCheckTrustedActivityLabel("Your hardware and setup is comfortable for the models")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("You may need to do deeper research to fill knowledge gaps")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("This failure is clear: Task row is too vague because it says nothing about the work")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("Stanford credibility guidelines say credibility improves when a site shows trust proof")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  for (const label of [
    "I fixed it so live clarify prompts opt out of that compact shape",
    "What I fixed now I deployed and pushed a prevention fix",
    "You can test now with either the desktop shortcut",
    "Use this as the E2E task goal",
    "Root cause: desktop launched but injected from the old app",
    "Strong evidence that the hot surface is not the map",
    "Treat it as a probation window.",
    "What is now covered: - - / - answer prose like",
    "What shipped: - Commit on main",
    "The correct transition is: 1.",
    "The failure path was: 1.",
    "Update the highest-impact places first: - profile - homepage",
    "I left the updated continuous watchdog running",
    ": I can handle the app/code/audit side.",
    "I’ll ground this in what already exists",
    "There’s an existing preview pattern to copy: supports plus",
    "Cleaned and landed safely.",
    "Confidence Rating HIGH for the draft-preview 404 fix.",
    "Right - the Too Much / Live Ink are art exhibitions",
    "I re-read the relevant store",
    "I updated the actual launched checkout to current plus all",
    "VNoneoofhtheiabove to separatOptionally",
  ]) {
    expect(qualityCheckTrustedActivityLabel(label)).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
    expect(qualityCheckActivityLabel(label)).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
  }
});

import { sanitizeScrapedAsk } from "../src/lib/terminalHeaderViewModel";

test("sanitizeScrapedAsk strips prompt markers and the duplicated wrapped fragment", () => {
  expect(
    sanitizeScrapedAsk("› I want to do two main changes right now - I › I want to do two main changes right now - II"),
  ).toBe("I want to do two main changes right now");
  expect(sanitizeScrapedAsk("❯ fix the login flow")).toBe("fix the login flow");
  expect(sanitizeScrapedAsk("plain ask with no markers")).toBe("plain ask with no markers");
  expect(sanitizeScrapedAsk("")).toBe("");
});
