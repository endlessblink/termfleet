import { expect, test } from "@playwright/test";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckTaskLabel,
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
    "Editing ModelScene.tsx",
    "terminal-workspace-tauri@0.1.0 cockpit:snapshot",
  ]) {
    expect(qualityCheckTaskLabel(label).ok).toBe(false);
    expect(qualityCheckActivityLabel(label).ok).toBe(false);
  }
});

test("rejects vague activity labels", () => {
  for (const label of ["Working", "Thinking", "Awaiting terminal output", "Running terminal command"]) {
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false });
  }
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
});
