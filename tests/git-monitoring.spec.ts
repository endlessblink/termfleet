import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readyToCombine, summarizeGitMonitoring } from "../src/lib/gitMonitoring";
import type { Tab, WorkstreamMetadata } from "../src/lib/types";

const source = readFileSync(new URL("../src/components/GitMonitoringView.tsx", import.meta.url), "utf8");
const model = readFileSync(new URL("../src/lib/gitMonitoring.ts", import.meta.url), "utf8");

test.describe("Git work monitor contract", () => {
  test("explains the situation and the next action in plain language", () => {
    expect(source).toContain("No action needed");
    expect(source).toContain("Ready to save");
    expect(source).toContain("Needs your decision");
    expect(source).toContain("Changes waiting to be saved");
    expect(source).toContain("Review this work");
    expect(source).toContain("Combine this work");
    expect(source).not.toContain('label: "Under control"');
    expect(source).not.toContain('>Needs attention<');
    expect(source).toContain("This view keeps the technical work in the background");
    expect(source).toContain("Recently completed");
    expect(readFileSync(new URL("../src/components/WorkbenchHeader.tsx", import.meta.url), "utf8")).toContain("ctrlKey && event.altKey && key === \"g\"");
  });

  test("opens from a non-technical command label", () => {
    const header = readFileSync(new URL("../src/components/WorkbenchHeader.tsx", import.meta.url), "utf8");
    expect(header).toContain('label: "Monitor Git work"');
    expect(header).toContain('setCommandStatus("git monitor")');
    expect(header).not.toContain('setCommandStatus("links")');
    const sidebar = readFileSync(new URL("../src/components/WorkbenchSidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain('aria-label="Git work monitor"');
    expect(sidebar).toContain('setWorkspaceMode("graph")');
    expect(sidebar).toContain('updateUi({ primarySidebarCollapsed: false });');
    expect(sidebar).toContain('workspaceMode !== "graph"');
    expect(source).toContain('aria-label="Back to cockpit"');
    expect(source).not.toContain('position: "fixed"');
  });

  test("opens from the sidebar Git work monitor button", async ({ page }) => {
    await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Git work monitor" }).click();
    await expect(page.getByTestId("git-monitor-view")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Operations rail" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to cockpit" })).toBeVisible();
    await page.getByRole("button", { name: "Back to cockpit" }).click();
    await expect(page.getByTestId("git-monitor-view")).toHaveCount(0);
  });

  test("groups projects and reports work-area counts", () => {
    expect(model).toContain("summarizeGitMonitoring");
    expect(model).toContain("branches");
    expect(model).toContain("worktrees");
    expect(model).toContain("gitBranchExists");
    expect(model).toContain("gitHasConflicts");
    expect(model).toContain("inferAgentWorkstream");
    expect(model).toContain("agentProvider");
    expect(source).toContain("data-testid=\"git-monitor-project\"");
    expect(source).toContain("data-testid=\"git-monitor-agent\"");
    expect(source).toContain("max-width: 760px");
  });

  test("requires clean work and passed checks before offering combination", () => {
    expect(model).toContain("workstream.gitDirty === false");
    expect(model).toContain("checksPassed(workstream)");
    expect(source).toContain("Please combine this work into the project");
  });

  test("turns real project work into safe operator decisions", () => {
    const workstream = (overrides: Partial<WorkstreamMetadata> = {}): WorkstreamMetadata => ({
      kind: "agent",
      status: "done",
      createdAt: 1,
      gitRoot: "/workspace/demo",
      gitBranch: "agent/one",
      gitDirty: false,
      worktreePath: "/workspace/demo-agent-one",
      evidence: "Checks passed and tests green",
      ...overrides,
    });
    const tab = (id: string, stream: WorkstreamMetadata): Tab => ({
      id,
      title: `Agent ${id}`,
      emoji: "",
      color: "",
      groupId: null,
      terminals: [],
      splitLayout: { type: "pane", paneId: `${id}-pane` },
      activePaneId: `${id}-pane`,
      workstream: stream,
    } as unknown as Tab);

    const summary = summarizeGitMonitoring([
      tab("one", workstream()),
      tab("two", workstream({ gitBranch: "agent/two", worktreePath: "/workspace/demo-agent-two", status: "running" })),
      tab("three", workstream({ status: "failed", gitBranch: "agent/three", worktreePath: "/workspace/demo-agent-three", extractedBlockers: [{ id: "blocker-1", text: "Needs a decision", provenance: "test", at: 1, excerpt: "Needs a decision", sourceHash: "test" }] })),
    ], [], {});

    expect(summary.projects).toHaveLength(1);
    expect(summary.branches).toBe(3);
    expect(summary.worktrees).toBe(3);
    expect(summary.health).toBe("agent-help");
    expect(summary.needsAttention).toBe(1);
    expect(readyToCombine(workstream())).toBe(false);
    expect(readyToCombine(workstream(), {
      gitRoot: "/workspace/demo",
      gitBranch: "agent/one",
      gitDirty: false,
      worktreePath: "/workspace/demo-agent-one",
      gitBranchExists: true,
      gitHasCommits: true,
      gitHasConflicts: false,
    })).toBe(true);
    expect(readyToCombine(workstream(), null)).toBe(false);
    expect(readyToCombine(workstream(), {
      gitRoot: "/workspace/demo",
      gitBranch: "agent/one",
      gitDirty: false,
      gitBranchExists: true,
      gitHasCommits: true,
      gitHasConflicts: true,
    })).toBe(false);
    expect(readyToCombine(workstream({ gitDirty: true }))).toBe(false);
    expect(readyToCombine(workstream({ evidence: "Implementation is complete" }))).toBe(false);
  });

  test("reconstructs a restored agent pane before its workstream is persisted", () => {
    const restored = {
      id: "restored-tab",
      title: "Restored agent",
      emoji: "",
      color: "",
      groupId: null,
      terminals: [{ id: "restored-pane", paneId: "restored-pane", agentProvider: "codex", status: "running" }],
      splitLayout: { type: "pane", paneId: "restored-pane" },
      activePaneId: "restored-pane",
    } as unknown as Tab;
    const summary = summarizeGitMonitoring([restored], [], { "restored-pane": "/workspace/restored" });
    expect(summary.agents).toHaveLength(1);
    expect(summary.agents[0]?.goal).toContain("codex work in restored");
    expect(summary.gitFactsPending).toBe(1);
    expect(summary.agents[0]?.readyToCombine).toBe(false);
    expect(summary.health).toBe("checking");
    expect(summary.projects[0]?.health).toBe("checking");
  });

  test("turns combine receipts into visible success, progress, or help states", () => {
    expect(source).toContain("Agent reported a problem; open the agent for details.");
    expect(source).toContain("The agent reported that the work was combined successfully.");
    expect(source).toContain("Agent is working on the combination.");
    expect(source).toContain("export function combineOutcome");
  });

  test("renders the monitor without horizontal overflow at narrow width", async ({ page }) => {
    await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
    const command = page.locator('input[placeholder*="Command"]');
    await command.fill("Monitor Git work");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("git-monitor-view")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/termfleet-git-monitor-narrow.png", fullPage: true });
  });
});
