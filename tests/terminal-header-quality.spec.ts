import { expect, test } from "@playwright/test";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckTaskLabel,
  qualityCheckUserAskLabel,
} from "../src/lib/terminalHeaderQuality";

test("accepts concise operator-readable task and activity labels", () => {
  expect(qualityCheckTaskLabel("Improve cockpit header descriptions").ok).toBe(true);
  expect(qualityCheckActivityLabel("Inspecting header quality rules").ok).toBe(true);
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
  for (const label of ["done", "go", "fix it", "so fix it"]) {
    expect(qualityCheckUserAskLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  }
  expect(qualityCheckUserAskLabel("go over everything and get it ready to merge").ok).toBe(true);
});

test("rejects generic build and test result wrappers", () => {
  for (const label of [
    "Raise quality across the current work",
    "Verify Build and tests result",
    "Build and tests completed successfully",
    "Test process completed successfully",
    "Task completed successfully",
  ]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "vague" });
  }
  expect(qualityCheckActivityLabel("Running build and visual checks").ok).toBe(true);
});

test("rejects duplicated long task and activity labels", () => {
  expect(headerLabelsAreDuplicated(
    "Fix terminal headers so Task shows the user ask and activity shows current work",
    "Fix terminal headers so Task shows the user ask and activity shows current work",
  )).toBe(true);
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
    "What I fixed now I deployed and pushed a prevention fix",
    "You can test now with either the desktop shortcut",
    "Use this as the E2E task goal",
    "Root cause: desktop launched but injected from the old app",
    "Strong evidence that the hot surface is not the map",
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
