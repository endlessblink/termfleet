import { expect, test } from "@playwright/test";

const PRIMARY_MISSION = "Investigate flaky checkout flow";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function createAgentWorkstream(
  page: import("@playwright/test").Page,
  mission = PRIMARY_MISSION,
  isolation = "shared",
  launchProfile = "terminal"
) {
  await page.getByRole("textbox", { name: "Workspace command" }).click();
  await page.getByRole("textbox", { name: "Workspace command" }).fill("new agent run");
  const dialogPromise = new Promise<void>((resolve, reject) => {
    const messages: string[] = [];
    const onDialog = async (dialog: import("@playwright/test").Dialog) => {
      try {
        messages.push(dialog.message());
        if (dialog.message().includes("Task for Codex agent")) {
          await dialog.accept(mission);
          return;
        }
        if (dialog.message().includes("Isolation for Codex agent")) {
          await dialog.accept(isolation);
          return;
        }
        if (dialog.message().includes("Launch mode for Codex agent")) {
          await dialog.accept(launchProfile);
          page.off("dialog", onDialog);
          expect(messages).toEqual([
            expect.stringContaining("Task for Codex agent"),
            expect.stringContaining("Isolation for Codex agent"),
            expect.stringContaining("Launch mode for Codex agent"),
          ]);
          resolve();
          return;
        }
        throw new Error(`Unexpected dialog: ${dialog.message()}`);
      } catch (error) {
        page.off("dialog", onDialog);
        reject(error);
      }
    };
    page.on("dialog", onDialog);
  });
  await page.getByRole("textbox", { name: "Workspace command" }).press("Enter");
  await dialogPromise;
}

async function sendFollowUp(page: import("@playwright/test").Page, text: string, mission?: string) {
  const queued = await page.evaluate(({ text, mission }) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          queueWorkstreamInput: (tabId: string, text: string) => string | null;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const candidates = state.tabs.filter((tab) => tab.workstream?.kind === "agent");
    const tab = mission
      ? candidates.find((candidate) => candidate.workstream?.mission === mission)
      : candidates.at(-1);
    if (!tab) throw new Error(`Agent workstream not found${mission ? `: ${mission}` : ""}`);
    return Boolean(state.queueWorkstreamInput(tab.id, text));
  }, { text, mission });
  expect(queued).toBe(true);
}

async function runWorkspaceCommand(page: import("@playwright/test").Page, command: string) {
  const commandBox = page.getByRole("textbox", { name: "Workspace command" });
  await commandBox.click();
  await commandBox.fill(command);
  await commandBox.press("Enter");
}

async function ageAgentWorkstream(page: import("@playwright/test").Page, mission: string, idleMinutes: number, activity: string) {
  await page.waitForTimeout(300);
  await page.evaluate(({ mission, idleMinutes, activity }) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const agent = state.tabs?.find((tab) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
    );
    if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
    const staleAt = Date.now() - idleMinutes * 60_000;
    state.updateTab(agent.id, {
      workstream: {
        ...agent.workstream,
        activityUpdatedAt: staleAt,
        lastActivityAt: staleAt,
        currentActivity: activity,
      },
    });
  }, { mission, idleMinutes, activity });
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 stale");
}

async function seedAgentTerminalOutputs(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const now = Date.now();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          terminalOutput: `Output glimpse ${index + 1}`,
          terminalOutputUpdatedAt: now + index,
        },
      });
    }
  }, missions);
}

async function seedAgentMemories(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          memory: `Handoff memory ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedAgentEvidence(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          evidence: `Verification evidence ${index + 1}`,
          artifact: `reports/overflow-proof-${index + 1}.md`,
          nextAction: `Review evidence ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedAgentAuthRequired(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          status: "waiting",
          phase: "needs-input",
          readiness: "auth-required",
          readinessCheck: `Auth check ${index + 1}`,
          authCheck: `Login required ${index + 1}`,
          providerAvailabilityMessage: `Provider auth blocker ${index + 1}`,
          lastSummary: `Provider requires authentication ${index + 1}`,
          nextAction: `Authenticate the CLI ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedAgentRisk(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          status: "running",
          phase: "active",
          readiness: "provider-ready",
          confidence: "low",
          risk: `Residual risk ${index + 1}`,
          lastSummary: `Risk review required ${index + 1}`,
          nextAction: `Mitigate residual risk ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedAgentRecovery(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          status: "failed",
          phase: "blocked",
          readiness: "provider-ready",
          lastSummary: `Provider failure ${index + 1}`,
          currentActivity: `Recovery needed ${index + 1}`,
          activityKind: "blocked",
          activitySource: "structured",
          nextAction: `Recover provider ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedAgentStale(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const now = Date.now();
    for (const [index, mission] of missions.entries()) {
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      const staleAt = now - (18 + index) * 60_000;
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          status: "running",
          phase: "active",
          readiness: "provider-ready",
          currentActivity: `Idle child ${index + 1}`,
          activityKind: "running",
          activitySource: "terminal",
          activityUpdatedAt: staleAt,
          lastActivityAt: staleAt,
          nextAction: `Check idle child ${index + 1}`,
        },
      });
    }
  }, missions);
}

async function seedTwoProviderScanRows(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const now = Date.now();
    const audit = state.tabs?.find((tab) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === "Audit deployment scripts"
    );
    const release = state.tabs?.find((tab) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === "Prepare release notes"
    );
    if (!audit?.workstream) throw new Error("Audit deployment scripts workstream not found");
    if (!release?.workstream) throw new Error("Prepare release notes workstream not found");

    store.getState().updateTab(audit.id, {
      workstream: {
        ...audit.workstream,
        provider: "codex",
        status: "running",
        phase: "active",
        readiness: "provider-ready",
        currentActivity: "Auditing deployment scripts",
        activityKind: "running",
        activitySource: "structured",
        structuredStatus: true,
        activityUpdatedAt: now,
        lastActivityAt: now,
        lastSummary: "Auditing deployment scripts",
        nextAction: "Attach proof",
      },
    });
    store.getState().updateTab(release.id, {
      workstream: {
        ...release.workstream,
        provider: "claude",
        role: "Claude",
        status: "stopped",
        phase: "interrupted",
        readiness: "provider-ready",
        currentActivity: "Waiting for operator follow-up",
        activityKind: "idle",
        activitySource: "structured",
        structuredStatus: true,
        activityUpdatedAt: now + 1,
        lastActivityAt: now + 1,
        lastSummary: "Waiting for operator follow-up",
        nextAction: "Ready for next prompt",
        outcome: "Paused for operator",
      },
    });
  });
}

async function seedAgentWorkspaceGroups(page: import("@playwright/test").Page, missions: string[]) {
  await page.evaluate((missions) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const now = Date.now();
    for (const [index, mission] of missions.entries()) {
      const groupNumber = index + 1;
      const agent = state.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          status: "running",
          phase: "active",
          readiness: "provider-ready",
          confidence: undefined,
          risk: undefined,
          isolationMode: "shared-worktree",
          isolationStatus: "shared",
          cwd: `/workspace/overflow-group-${groupNumber}`,
          cwdLabel: `Workspace group ${groupNumber}`,
          gitRoot: `/workspace/overflow-group-${groupNumber}`,
          gitBranch: `branch-overflow-${groupNumber}`,
          gitDirty: false,
          worktreePath: `/workspace/overflow-group-${groupNumber}`,
          currentActivity: `Working in workspace group ${groupNumber}`,
          activityKind: "running",
          activitySource: "terminal",
          activityUpdatedAt: now + index,
          lastActivityAt: now + index,
          lastSummary: `Working in workspace group ${groupNumber}`,
          nextAction: `Continue workspace group ${groupNumber}`,
        },
      });
    }
  }, missions);
}

async function seedAgentCleanupOwnership(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const now = Date.now();
    const updates = [
      {
        mission: "Finished isolated cleanup",
        status: "done",
        phase: "reviewed",
        isolationMode: "dedicated-worktree",
        isolationStatus: "ready",
        worktreeCleanupStatus: "available",
        worktreeCleanupNote: "Dedicated worktree can be removed after closeout.",
        worktreePath: "/tmp/termfleet-finished-cleanup",
      },
      {
        mission: "Active isolated cleanup",
        status: "running",
        phase: "active",
        isolationMode: "dedicated-worktree",
        isolationStatus: "ready",
        worktreeCleanupStatus: "available",
        worktreeCleanupNote: "Active run still owns its worktree.",
        worktreePath: "/tmp/termfleet-active-cleanup",
      },
      {
        mission: "Shared cleanup not owned",
        status: "done",
        phase: "reviewed",
        isolationMode: "shared-worktree",
        isolationStatus: "shared",
        worktreeCleanupStatus: "not-needed",
        worktreeCleanupNote: "Shared workspace runs do not own a cleanup target.",
        worktreePath: undefined,
      },
    ];
    for (const [index, update] of updates.entries()) {
      const agent = state.tabs?.find((tab) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === update.mission
      );
      if (!agent?.workstream) throw new Error(`Agent workstream not found: ${update.mission}`);
      store.getState().updateTab(agent.id, {
        workstream: {
          ...agent.workstream,
          ...update,
          readiness: "provider-ready",
          currentActivity: `${update.mission} cleanup state`,
          activityKind: update.status === "running" ? "running" : "complete",
          activitySource: "structured",
          activityUpdatedAt: now + index,
          lastActivityAt: now + index,
          lastSummary: `${update.mission} summary`,
          nextAction: update.status === "running" ? "Continue the active run" : "Cleanup can be requested",
        },
      });
    }
  });
}

test("command palette creates a supervised Codex agent on the map", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  await createAgentWorkstream(page);

  await expect(page.getByText("agent", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-working-on")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("working");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-total")).toHaveText("1 agents");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("1 active agent");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 agents");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 active");
  await expect(page.getByTestId("canvas-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("canvas-agent-lane-isolation-breakdown")).toContainText("shared workspace: 1");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 prompts");
  await expect(page.getByTestId("canvas-agent-input-item")).toContainText("Copy prompt");
  await expect(page.getByTestId("canvas-agent-input-item")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("map-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-total")).toHaveText("1 agents");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("Running");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 agents");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 active");
  await expect(page.getByTestId("map-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("map-agent-lane-isolation-breakdown")).toContainText("shared workspace: 1");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 prompts");
  await expect(page.getByTestId("map-agent-input-item")).toContainText(PRIMARY_MISSION);
  await page.getByTestId("canvas-agent-input-item").click();
  const copiedInitialPrompt = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedInitialPrompt.toBe(`${PRIMARY_MISSION}: sent - ${PRIMARY_MISSION}`);
  await expect(page.getByTestId("agent-cockpit-panel")).toBeVisible();
  await expect(page.getByText("Task")).toBeVisible();
  await expect(page.getByText(PRIMARY_MISSION).first()).toBeVisible();
  await expect(page.getByTestId("canvas-agent-working-on")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("canvas-agent-status-path")).toContainText("Path");
  await expect(page.getByTestId("canvas-agent-status-now")).toContainText("Watch provider response");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("working");
  await runWorkspaceCommand(page, "show terminal");
  await expect(page.getByTestId("split-agent-working-on")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("split-agent-status-path")).toContainText("workspace root unknown");
  await expect(page.getByTestId("split-agent-pane-now")).toContainText("Watch provider response");
  await runWorkspaceCommand(page, "show map");
  await expect(page.getByLabel("Agent current activity")).toContainText("command is not available in browser preview");
  await expect(page.getByLabel("Agent operator guidance").getByText("Watch provider response")).toBeVisible();
  await expect(page.getByText("Details")).toBeVisible();
  await page.getByText("Details").click();
  await expect(page.getByLabel("Agent provider control surface").getByText("interactive CLI", { exact: true })).toBeVisible();
  await expect(page.getByText("path-checked")).toBeVisible();
  await expect(page.getByText("watching")).toBeVisible();
  await expect(page.getByText("terminal inferred")).toBeVisible();
  await expect(page.getByText("pty fallback")).toBeVisible();
  await expect(page.getByLabel("Agent local context").getByText("workspace root unknown", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent local context").getByText("branch unknown · state unknown", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent workspace isolation").getByText("shared workspace", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent worktree cleanup").getByText("not-needed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Prompts")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Outcome")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Run", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Done")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Reviewed")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Provider is running")).toBeVisible();

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      title: agent?.title,
      provider: agent?.workstream?.provider,
      providerAvailable: agent?.workstream?.providerAvailable,
      providerAvailabilityMessage: agent?.workstream?.providerAvailabilityMessage,
      startupCommand: agent?.workstream?.startupCommand,
      runId: agent?.workstream?.runId,
      createdAt: agent?.workstream?.createdAt,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      exitCode: agent?.workstream?.exitCode,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      memory: agent?.workstream?.memory,
      generation: agent?.workstream?.generation,
      mission: agent?.workstream?.mission,
      prompt: agent?.workstream?.prompt,
      cwd: agent?.workstream?.cwd,
      cwdLabel: agent?.workstream?.cwdLabel,
      gitRoot: agent?.workstream?.gitRoot,
      gitBranch: agent?.workstream?.gitBranch,
      gitDirty: agent?.workstream?.gitDirty,
      worktreePath: agent?.workstream?.worktreePath,
      isolationMode: agent?.workstream?.isolationMode,
      isolationStatus: agent?.workstream?.isolationStatus,
      isolationNote: agent?.workstream?.isolationNote,
      worktreeCleanupStatus: agent?.workstream?.worktreeCleanupStatus,
      worktreeCleanupNote: agent?.workstream?.worktreeCleanupNote,
      phase: agent?.workstream?.phase,
      launchProfile: agent?.workstream?.launchProfile,
      launchMode: agent?.workstream?.launchMode,
      readinessCheck: agent?.workstream?.readinessCheck,
      authCheck: agent?.workstream?.authCheck,
      readiness: agent?.workstream?.readiness,
      stopBehavior: agent?.workstream?.stopBehavior,
      controlProtocol: agent?.workstream?.controlProtocol,
      structuredStatus: agent?.workstream?.structuredStatus,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      activityUpdatedAt: agent?.workstream?.activityUpdatedAt,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      status: agent?.workstream?.status,
      events: agent?.workstream?.events?.map((event: { kind?: string; label?: string; detail?: string; status?: string }) => ({
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        status: event.status,
      })),
      initialInput: agent?.workstream?.inputQueue?.find((input: { text?: string }) =>
        input.text === "Investigate flaky checkout flow"
      ),
    };
  })).toMatchObject({
    title: PRIMARY_MISSION,
    provider: "codex",
    providerAvailable: true,
    providerAvailabilityMessage: "Browser preview simulates provider startup; desktop checks PATH before launch.",
    startupCommand: "codex",
    runId: expect.stringMatching(/^codex-[a-z0-9]+-[a-z0-9]{6}$/),
    createdAt: expect.any(Number),
    completedAt: undefined,
    reviewedAt: undefined,
    exitCode: undefined,
    stage: undefined,
    artifact: undefined,
    confidence: undefined,
    risk: undefined,
    memory: "No agent memory reported yet.",
    generation: 0,
    mission: PRIMARY_MISSION,
    prompt: PRIMARY_MISSION,
    cwd: undefined,
    cwdLabel: "workspace root unknown",
    gitRoot: undefined,
    gitBranch: undefined,
    gitDirty: undefined,
    worktreePath: undefined,
    isolationMode: "shared-worktree",
    isolationStatus: "shared",
    isolationNote: "Agent shares the selected workspace checkout.",
    worktreeCleanupStatus: "not-needed",
    worktreeCleanupNote: "Shared workspace runs do not own a cleanup target.",
    phase: "active",
    launchProfile: "terminal",
    launchMode: "interactive CLI",
    readinessCheck: "PATH check only; auth/session readiness is confirmed by CLI output.",
    authCheck: "CLI output scan for login, API key, OAuth, or sign-in prompts.",
    readiness: "path-checked",
    stopBehavior: "PTY interrupt/kill until provider-native cancel is available.",
    controlProtocol: "TermFleet prompt queue plus PTY Ctrl-C/kill fallback.",
    structuredStatus: false,
    currentActivity: expect.stringMatching(/^(Prompt sent to provider|Provider is running|Investigate flaky checkout flow: command is not available in browser preview\. Use the Tauri app for real shell commands\.|codex: command is not available in browser preview\. Use the Tauri app for real shell commands\.)$/),
    activityKind: expect.stringMatching(/^(thinking|running|blocked)$/),
    activitySource: expect.stringMatching(/^(operator|terminal)$/),
    activityUpdatedAt: expect.any(Number),
    lastSummary: expect.stringMatching(/^(Prompt sent to provider|Provider is running)$/),
    nextAction: "Watch provider response",
    promptCount: 1,
    sentCount: 1,
    signalCount: 0,
    controlCount: 0,
    outcome: expect.stringMatching(/^(Prompt sent|Provider is running)$/),
    status: "running",
    events: expect.arrayContaining([
      expect.objectContaining({ kind: "created", label: "Mission created", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "provider", label: "Codex ready" }),
      expect.objectContaining({ kind: "prompt", label: "Launch prompt queued", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "status", label: "Status changed to running", status: "running" }),
    ]),
    initialInput: {
      text: PRIMARY_MISSION,
    },
  });

  await expect(page.getByRole("form", { name: "Agent operator composer" })).toBeVisible();
  await expect(page.getByLabel("Agent current activity")).toContainText(/Prompt sent to provider|Provider is running|command is not available in browser preview/);
  await expect(page.getByLabel("Agent current activity")).toContainText(/thinking · operator|running · terminal|blocked · terminal/);
  await expect(page.getByTestId("canvas-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("canvas-agent-lane-readiness-breakdown")).toContainText("Path checked: 1");
  await expect(page.getByTestId("map-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("map-agent-lane-readiness-breakdown")).toContainText("Path checked: 1");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 memories");
  await expect(page.getByTestId("canvas-agent-lane-memory")).toHaveCount(0);
  await sendFollowUp(page, "echo waiting for input");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    const launchInput = agent?.workstream?.inputQueue?.find((item: { text?: string }) =>
      item.text === "Investigate flaky checkout flow"
    );
    const input = agent?.workstream?.inputQueue?.find((item: { text?: string }) =>
      item.text === "echo waiting for input"
    );
    const ptys = (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { input: string; output: string }>;
    }).__terminalWorkspaceBrowserPtys ?? {};
    return {
      prompt: agent?.workstream?.prompt,
      mission: agent?.workstream?.mission,
      launchPromptSent: typeof launchInput?.sentAt === "number",
      queuedText: input?.text,
      sent: typeof input?.sentAt === "number",
      phase: agent?.workstream?.phase,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      terminalOutput: agent?.workstream?.terminalOutput,
      terminalOutputUpdatedAt: agent?.workstream?.terminalOutputUpdatedAt,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      status: agent?.workstream?.status,
      events: agent?.workstream?.events?.map((event: { kind?: string; label?: string; detail?: string; status?: string }) => ({
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        status: event.status,
      })),
      outputHasPrompt: Object.values(ptys).some((session) =>
        session.output.includes("waiting for input")
      ),
    };
  })).toEqual({
    prompt: "echo waiting for input",
    mission: PRIMARY_MISSION,
    launchPromptSent: true,
    queuedText: "echo waiting for input",
    sent: true,
    phase: "needs-input",
    currentActivity: expect.stringMatching(/^(Provider is waiting for operator input|waiting for input)$/),
    activityKind: "waiting",
    activitySource: "terminal",
    terminalOutput: expect.stringContaining("waiting for input"),
    terminalOutputUpdatedAt: expect.any(Number),
    lastSummary: "Provider is waiting for operator input",
    nextAction: "Send a follow-up prompt",
    promptCount: 2,
    sentCount: 2,
    status: "waiting",
    events: expect.arrayContaining([
      expect.objectContaining({ kind: "sent", label: "Prompt sent", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "prompt", label: "Follow-up queued", detail: "echo waiting for input" }),
      expect.objectContaining({ kind: "sent", label: "Prompt sent", detail: "echo waiting for input" }),
      expect.objectContaining({ kind: "status", label: "Status changed to waiting", status: "waiting" }),
    ]),
    outputHasPrompt: true,
  });
  await expect(page.getByTestId("canvas-agent-working-on")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("waiting");
  await expect(page.getByTestId("canvas-agent-status-now")).toContainText(/Provider is waiting for operator input|waiting for input/);
  await expect(page.getByTestId("agent-cockpit-panel").getByText("Follow-up queued")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider is waiting for operator input")).toBeVisible();
  await expect(page.getByLabel("Agent current activity")).toContainText(/Provider is waiting for operator input|waiting for input/);
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 outputs");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 next");
  await expect(page.getByTestId("canvas-agent-output-item")).toContainText("Copy output");
  await expect(page.getByTestId("canvas-agent-output-item")).toContainText("waiting for input");
  await expect(page.getByTestId("map-agent-output-item")).toContainText("waiting for input");
  await page.getByTestId("canvas-agent-output-item").click();
  const copiedOutput = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedOutput.toContain(`${PRIMARY_MISSION}:`);
  await copiedOutput.toContain("waiting for input");
  await expect(page.getByTestId("canvas-agent-next-item")).toContainText("Copy next");
  await expect(page.getByTestId("canvas-agent-next-item")).toContainText("Send a follow-up prompt");
  await expect(page.getByTestId("map-agent-next-item")).toContainText("Send a follow-up prompt");
  await page.getByTestId("canvas-agent-next-item").click();
  const copiedNextAction = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedNextAction.toBe(`${PRIMARY_MISSION}: next - Send a follow-up prompt`);
  await expect(page.getByLabel("Agent operator guidance").getByText("Send a follow-up prompt")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("Latest input")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("echo waiting for input")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("sent", { exact: true })).toBeVisible();
  await runWorkspaceCommand(page, "show terminal");
  await expect(page.getByTestId("split-agent-pane-output")).toContainText("Output:");
  await expect(page.getByTestId("split-agent-pane-output")).toContainText("waiting for input");
  await runWorkspaceCommand(page, "show map");

  await sendFollowUp(page, "authentication required: sign in with an API key");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      outcome: agent?.workstream?.outcome,
      hasAuthEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider auth required"
      ),
    };
  })).toEqual({
    status: "waiting",
    phase: "needs-input",
    readiness: "auth-required",
    currentActivity: "Provider requires authentication",
    activityKind: "waiting",
    activitySource: "terminal",
    lastSummary: "Provider requires authentication",
    nextAction: "Authenticate the CLI, then restart or send a recovery prompt",
    promptCount: 3,
    sentCount: 3,
    outcome: "Provider requires authentication",
    hasAuthEvent: true,
  });
  await page.getByTestId("agent-cockpit-panel").locator("details").first().evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  await expect(page.getByText("required", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider requires authentication")).toBeVisible();
  await expect(page.getByLabel("Agent current activity").getByText("Provider requires authentication")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Auth required");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Authenticate the CLI");
  await expect(page.getByTestId("canvas-agent-lane-attention-breakdown")).toContainText("Auth required: 1");
  await expect(page.getByTestId("canvas-agent-lane-readiness-breakdown")).toContainText("Auth required: 1");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 queue");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 auth");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 auth");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 auth");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Auth required");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Authenticate the CLI");
  await expect(page.getByTestId("map-agent-lane-attention")).toContainText("Auth required");
  await expect(page.getByTestId("map-agent-lane-attention-breakdown")).toContainText("Auth required: 1");
  await expect(page.getByTestId("map-agent-lane-readiness-breakdown")).toContainText("Auth required: 1");
  await expect(page.getByTestId("map-agent-attention-item")).toContainText("Auth required");
  await expect(page.getByTestId("canvas-agent-auth-item")).toContainText("Copy auth");
  await expect(page.getByTestId("canvas-agent-auth-item")).toContainText("Provider requires authentication");
  await expect(page.getByTestId("canvas-agent-auth-item")).toContainText("Authenticate the CLI");
  await expect(page.getByTestId("map-agent-auth-item")).toContainText("Provider requires authentication");
  await page.getByTestId("canvas-agent-auth-item").click();
  const copiedAuthItem = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedAuthItem.toContain(`${PRIMARY_MISSION}: Provider requires authentication`);
  await copiedAuthItem.toContain("next=Authenticate the CLI, then restart or send a recovery prompt");
  await copiedAuthItem.toContain("readiness=PATH check only; auth/session readiness is confirmed by CLI output.");
  await copiedAuthItem.toContain("auth=CLI output scan for login, API key, OAuth, or sign-in prompts.");
  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedAuthBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedAuthBrief.toContain("Readiness mix: Auth required: 1");
  await copiedAuthBrief.toContain("Auth queue:");
  await copiedAuthBrief.toContain(`${PRIMARY_MISSION}: Provider requires authentication`);
  await copiedAuthBrief.toContain("Next: Authenticate the CLI, then restart or send a recovery prompt");
  await copiedAuthBrief.toContain("Readiness: PATH check only; auth/session readiness is confirmed by CLI output.");
  await copiedAuthBrief.toContain("Auth: CLI output scan for login, API key, OAuth, or sign-in prompts.");

  const agentTabId = await page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { id?: string; workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return agent?.id;
  });
  await page.getByRole("button", { name: "Add terminal" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    return state?.activeTabId;
  })).not.toBe(agentTabId);
  await page.getByTestId("canvas-agent-lane-attention").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    return state?.activeTabId;
  })).toBe(agentTabId);

  const failureSignal =
    '[[TERMFLEET_AGENT_EVENT {"status":"failed","phase":"blocked","readiness":"provider-ready","exitCode":2,"stage":"failure analysis","confidence":"low","risk":"provider crashed before saving state","activity":"Inspecting provider crash","activityKind":"blocked","summary":"Provider crashed","nextAction":"Inspect output and send recovery prompt","evidence":"stderr: provider exited 2","artifact":"logs/provider-crash.txt","label":"Structured failure","detail":"Provider exited with a non-zero status."}]]';
  await sendFollowUp(page, failureSignal);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      activityUpdatedAt: agent?.workstream?.activityUpdatedAt,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      evidence: agent?.workstream?.evidence,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      exitCode: agent?.workstream?.exitCode,
      outcome: agent?.workstream?.outcome,
      hasFailureSignal: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "signal" && event.label === "Structured failure"
      ),
    };
  })).toEqual({
    status: "failed",
    phase: "blocked",
    readiness: "provider-ready",
    currentActivity: "Inspecting provider crash",
    activityKind: "blocked",
    activitySource: "structured",
    activityUpdatedAt: expect.any(Number),
    lastSummary: "Provider crashed",
    nextAction: "Inspect output and send recovery prompt",
    evidence: "stderr: provider exited 2",
    stage: "failure analysis",
    artifact: "logs/provider-crash.txt",
    confidence: "low",
    risk: "provider crashed before saving state",
    promptCount: 4,
    sentCount: 4,
    signalCount: 1,
    exitCode: 2,
    outcome: "Structured failure",
    hasFailureSignal: true,
  });
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Blocked");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Inspecting provider crash");
  await expect(page.getByTestId("canvas-agent-lane-attention-breakdown")).toContainText("Blocked: 1");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Blocked");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Inspecting provider crash");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 evidence");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 risk");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 recovery");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 recovery");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 risk");
  await expect(page.getByTestId("canvas-agent-lane-risk-breakdown")).toContainText("low confidence: 1");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("stderr: provider exited 2");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("logs/provider-crash.txt");
  await expect(page.getByTestId("canvas-agent-risk-item")).toContainText("confidence=low");
  await expect(page.getByTestId("canvas-agent-risk-item")).toContainText("risk=provider crashed before saving state");
  await expect(page.getByTestId("map-agent-lane-risk-breakdown")).toContainText("low confidence: 1");
  await expect(page.getByTestId("map-agent-risk-item")).toContainText("provider crashed before saving state");
  await expect(page.getByTestId("canvas-agent-recovery-item")).toContainText(PRIMARY_MISSION);
  await expect(page.getByTestId("canvas-agent-recovery-item")).toContainText("Provider crashed");
  await expect(page.getByTestId("canvas-agent-recovery-item")).toContainText("Recover Codex agent");
  await expect(page.getByTestId("map-agent-recovery-item")).toContainText("Recover Codex agent");
  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedRecoveryBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedRecoveryBrief.toContain("Risk queue:");
  await copiedRecoveryBrief.toContain("Risk mix: low confidence: 1");
  await copiedRecoveryBrief.toContain("confidence=low · risk=provider crashed before saving state");
  await copiedRecoveryBrief.toContain("Attention mix: Blocked: 1");
  await copiedRecoveryBrief.toContain("Recovery queue:");
  await copiedRecoveryBrief.toContain("Prompt: Recover Codex agent: inspect the failure output, summarize the root cause, and propose the next command.");
  await expect(page.getByLabel("Agent current activity").getByText("Inspecting provider crash", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent current activity").getByText("blocked · structured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider crashed")).toBeVisible();
  await expect(page.getByLabel("Agent output details").getByText("stderr: provider exited 2")).toBeVisible();
  await expect(page.getByLabel("Agent output details").getByText("logs/provider-crash.txt")).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("failure analysis", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("low", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("provider crashed before saving state", { exact: true })).toBeVisible();
  await page.getByTestId("canvas-agent-risk-item").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      phase: agent?.workstream?.phase,
      latestInput: agent?.workstream?.inputQueue?.at(-1)?.text,
      latestInputSent: Boolean(agent?.workstream?.inputQueue?.at(-1)?.sentAt),
      latestInputSource: agent?.workstream?.inputQueue?.at(-1)?.source,
      latestInputLabel: agent?.workstream?.inputQueue?.at(-1)?.label,
      currentActivity: agent?.workstream?.currentActivity,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasMissionControlQueuedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control queued Mitigate risk"
      ),
      hasMissionControlSentEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control: Mitigate risk sent"
      ),
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
    };
  })).toEqual({
    phase: expect.stringMatching(/^(launching|needs-input)$/),
    latestInput: expect.stringContaining("Resolve risk for Codex agent"),
    latestInputSent: true,
    latestInputSource: "mission-control",
    latestInputLabel: "Mitigate risk",
    currentActivity: expect.stringMatching(/^(Resolve risk for Codex agent|Provider requires authentication)/),
    lastEvent: expect.stringMatching(/^(Mission control: Mitigate risk sent|Status changed to waiting)$/),
    hasMissionControlQueuedEvent: true,
    hasMissionControlSentEvent: true,
    promptCount: 5,
    sentCount: 5,
  });
  await expect(page.getByTestId("canvas-agent-cockpit-ask")).toContainText("Cockpit ask");
  await expect(page.getByTestId("canvas-agent-cockpit-ask")).toContainText("Resolve risk for Codex agent");
  await expect(page.getByTestId("canvas-agent-cockpit-ask")).toContainText("Mitigate risk · sent");
  await runWorkspaceCommand(page, "show terminal");
  await expect(page.getByTestId("split-agent-pane-ask")).toContainText("Ask · Mitigate risk · sent");
  await expect(page.getByTestId("split-agent-pane-ask")).toContainText("Resolve risk for Codex agent");
  await runWorkspaceCommand(page, "show map");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 risk");

  await seedAgentRecovery(page, [PRIMARY_MISSION]);
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 recovery");
  await page.getByTestId("canvas-agent-recovery-item").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      phase: agent?.workstream?.phase,
      latestInput: agent?.workstream?.inputQueue?.at(-1)?.text,
      latestInputSent: Boolean(agent?.workstream?.inputQueue?.at(-1)?.sentAt),
      latestInputSource: agent?.workstream?.inputQueue?.at(-1)?.source,
      latestInputLabel: agent?.workstream?.inputQueue?.at(-1)?.label,
      currentActivity: agent?.workstream?.currentActivity,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasMissionControlQueuedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control queued Recover"
      ),
      hasMissionControlSentEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control: Recover sent"
      ),
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
    };
  })).toEqual({
    phase: expect.stringMatching(/^(launching|needs-input)$/),
    latestInput: "Recover Codex agent: inspect the failure output, summarize the root cause, and propose the next command.",
    latestInputSent: true,
    latestInputSource: "mission-control",
    latestInputLabel: "Recover",
    currentActivity: expect.stringMatching(/^(Recover Codex agent|Provider requires authentication)/),
    lastEvent: expect.stringMatching(/^(Mission control: Recover sent|Status changed to waiting|Provider auth required)$/),
    hasMissionControlQueuedEvent: true,
    hasMissionControlSentEvent: true,
    promptCount: 6,
    sentCount: 6,
  });
  await expect(page.getByTestId("canvas-agent-cockpit-ask")).toContainText("Recover Codex agent");
  await expect(page.getByTestId("canvas-agent-cockpit-ask")).toContainText("Recover · sent");
  await runWorkspaceCommand(page, "show terminal");
  await expect(page.getByTestId("split-agent-pane-ask")).toContainText("Ask · Recover · sent");
  await expect(page.getByTestId("split-agent-pane-ask")).toContainText("Recover Codex agent");
  await runWorkspaceCommand(page, "show map");

  await sendFollowUp(page, "welcome authenticated session ready");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      outcome: agent?.workstream?.outcome,
      hasReadyEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider session ready"
      ),
    };
  })).toEqual({
    status: "running",
    phase: "active",
    readiness: "provider-ready",
    currentActivity: "Provider session is ready",
    activityKind: "running",
    activitySource: "terminal",
    lastSummary: "Provider session is ready",
    nextAction: "Send a task or watch provider response",
    promptCount: 7,
    sentCount: 7,
    outcome: "Provider session is ready",
    hasReadyEvent: true,
  });
  await expect(page.getByLabel("Agent current activity")).toContainText("Provider session is ready");
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider session is ready")).toBeVisible();

  await page.getByRole("button", { name: "Interrupt agent run" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      outputHasInterrupt: Object.values((window as typeof window & {
        __terminalWorkspaceBrowserPtys?: Record<string, { input: string; output: string }>;
      }).__terminalWorkspaceBrowserPtys ?? {}).some((session) =>
        session.output.includes("^C")
      ),
    };
  })).toEqual({
    status: "running",
    phase: expect.stringMatching(/^(active|cancelling)$/),
    currentActivity: expect.stringMatching(/^(Cancellation requested|Provider session is ready)$/),
    activityKind: expect.stringMatching(/^(waiting|running)$/),
    activitySource: expect.stringMatching(/^(operator|terminal)$/),
    lastSummary: expect.stringMatching(/^(Cancellation requested|Provider session is ready)$/),
    nextAction: expect.stringMatching(/^(Wait for provider acknowledgement or hard-stop|Send a task or watch provider response)$/),
    promptCount: 7,
    sentCount: 7,
    controlCount: 1,
    outcome: expect.stringMatching(/^(Cancellation requested|Provider session is ready)$/),
    lastEvent: "Cancellation requested",
    outputHasInterrupt: true,
  });
  await expect(page.getByLabel("Agent current activity")).toContainText(/Cancellation requested|Provider session is ready/);
  await expect(page.getByLabel("Agent operator guidance")).toContainText(/Cancellation requested|Provider session is ready/);

  await sendFollowUp(page, "provider cancelled the run");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      hasInterruptedEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider interrupted"
      ),
    };
  })).toEqual({
    status: "stopped",
    phase: "interrupted",
    readiness: "provider-ready",
    currentActivity: "Provider acknowledged cancellation",
    activityKind: "idle",
    activitySource: "terminal",
    lastSummary: "Provider acknowledged cancellation",
    nextAction: "Restart or close the workstream",
    promptCount: 8,
    sentCount: 8,
    controlCount: 1,
    outcome: "Provider acknowledged cancellation",
    hasInterruptedEvent: true,
  });
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider acknowledged cancellation")).toBeVisible();

  await page.getByRole("button", { name: "Stop agent run" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      terminalCount: agent?.terminals?.length,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    status: "stopped",
    phase: "interrupted",
    currentActivity: "Workstream stopped",
    activityKind: "idle",
    activitySource: "operator",
    lastSummary: "Workstream stopped",
    nextAction: "Restart or close the workstream",
    terminalCount: 0,
    controlCount: 2,
    outcome: "Stopped by operator",
    lastEvent: "Stopped by operator",
  });
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("stopped");

  await page.getByRole("button", { name: "Restart agent run" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      generation: agent?.workstream?.generation,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    status: "running",
    phase: "active",
    currentActivity: expect.stringMatching(/^(Provider is running|codex: command is not available in browser preview\. Use the Tauri app for real shell commands\.)$/),
    activityKind: expect.stringMatching(/^(running|blocked)$/),
    activitySource: "terminal",
    lastSummary: "Provider is running",
    nextAction: "Watch provider response",
    generation: 1,
    controlCount: 3,
    outcome: "Provider is running",
    lastEvent: "Status changed to running",
  });
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("working");

  const structuredSignal =
    '[[TERMFLEET_AGENT_EVENT {"status":"done","phase":"complete","readiness":"provider-ready","exitCode":0,"stage":"review","confidence":"high","risk":"low residual risk","activity":"Reviewing checkout report","activityKind":"complete","summary":"Structured task completed","nextAction":"Review structured result","memory":"Checkout flake isolated to retry timing; preserve auth fixture logs.","evidence":"tests: checkout-flow.spec passed","artifact":"reports/checkout-flow.md","label":"Structured completion","detail":"Provider emitted a machine-readable completion signal."}]]';
  await sendFollowUp(page, structuredSignal);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      structuredStatus: agent?.workstream?.structuredStatus,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      activityUpdatedAt: agent?.workstream?.activityUpdatedAt,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      evidence: agent?.workstream?.evidence,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      memory: agent?.workstream?.memory,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      exitCode: agent?.workstream?.exitCode,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasStructuredSignal: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "signal" && event.label === "Structured completion"
      ),
    };
  })).toEqual({
    status: "done",
    phase: "complete",
    readiness: "provider-ready",
    structuredStatus: true,
    currentActivity: "Reviewing checkout report",
    activityKind: "complete",
    activitySource: "structured",
    activityUpdatedAt: expect.any(Number),
    lastSummary: "Structured task completed",
    nextAction: "Review structured result",
    evidence: "tests: checkout-flow.spec passed",
    stage: "review",
    artifact: "reports/checkout-flow.md",
    confidence: "high",
    risk: "low residual risk",
    memory: "Checkout flake isolated to retry timing; preserve auth fixture logs.",
    promptCount: 9,
    sentCount: 9,
    signalCount: 2,
    controlCount: 3,
    outcome: "Structured completion",
    exitCode: 0,
    completedAt: expect.any(Number),
    reviewedAt: undefined,
    lastEvent: "Structured completion",
    hasStructuredSignal: true,
  });
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("done");
  await expect(page.getByLabel("Agent operator guidance").getByText("Structured task completed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Review structured result", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent current activity").getByText("Reviewing checkout report", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent current activity").getByText("complete · structured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent memory").getByText("Checkout flake isolated to retry timing; preserve auth fixture logs.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-readiness-breakdown")).toContainText("Provider ready: 1");
  await expect(page.getByTestId("map-agent-lane-readiness-breakdown")).toContainText("Provider ready: 1");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 memories");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("5 events");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 evidence");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 proof");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 risk");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 review");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 closeout ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 closeout blocked");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 proven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 unproven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 handoff ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 handoff missing");
  await expect(page.getByTestId("canvas-agent-lane-closeout-plan")).toHaveText("Review 1 ready");
  await expect(page.getByTestId("map-agent-lane-closeout-plan")).toHaveText("Review 1 ready");
  await expect(page.getByTestId("canvas-agent-lane-review-ready")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-review-ready")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-lane-risk-breakdown")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-risk-item")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Ready with proof");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Memory ready");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Structured task completed");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("reports/checkout-flow.md");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Review" })).toContainText("Ready with proof");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Review" })).toContainText("Memory ready");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Review" })).toContainText("Structured task completed");
  await expect(page.getByTestId("map-agent-review-item")).toContainText("Ready with proof");
  await expect(page.getByTestId("map-agent-review-item")).toContainText("Memory ready");
  await expect(page.getByTestId("map-agent-review-item")).toContainText("Structured task completed");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("tests: checkout-flow.spec passed");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("reports/checkout-flow.md");
  await expect(page.getByTestId("map-agent-evidence-item")).toContainText("tests: checkout-flow.spec passed");
  const structuredCompletionEvent = page
    .getByTestId("canvas-agent-recent-event")
    .filter({ hasText: "Structured completion", hasNotText: "Prompt sent" });
  await expect(structuredCompletionEvent).toContainText("Copy event");
  await expect(structuredCompletionEvent).toContainText("Structured completion");
  await expect(page.getByTestId("map-agent-recent-event").filter({ hasText: "Structured completion", hasNotText: "Prompt sent" })).toContainText("Structured completion");
  await structuredCompletionEvent.click();
  const copiedEvent = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedEvent.toBe(`${PRIMARY_MISSION}: signal · Structured completion - Provider emitted a machine-readable completion signal.`);
  await expect(page.getByTestId("canvas-agent-lane-memory")).toContainText("Copy memory");
  await expect(page.getByTestId("canvas-agent-lane-memory")).toContainText("Checkout flake isolated to retry timing");
  await expect(page.getByTestId("map-agent-lane-memory")).toContainText("Checkout flake isolated to retry timing");
  await page.getByTestId("canvas-agent-lane-memory").click();
  const copiedMemory = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedMemory.toBe(`${PRIMARY_MISSION}: Checkout flake isolated to retry timing; preserve auth fixture logs.`);
  if (!(await page.getByLabel("Agent output details").isVisible())) {
    await page.getByText("Details").click();
  }
  await expect(page.getByLabel("Agent output details").getByText("tests: checkout-flow.spec passed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent output details").getByText("reports/checkout-flow.md", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("review", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("high", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("low residual risk", { exact: true })).toBeVisible();
  await expect(page.getByText("structured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Exit", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Complete");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Reviewing checkout report");
  await expect(page.getByTestId("canvas-agent-lane-attention-breakdown")).toContainText("Complete: 1");
  await expect(page.getByTestId("canvas-agent-lane-closeout-breakdown")).toContainText("Ready: 1");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 queue");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Complete");
  await expect(page.getByTestId("canvas-agent-attention-item")).toContainText("Reviewing checkout report");

  await page.getByRole("button", { name: "Copy agent run brief" }).click();
  const copiedBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedBrief.toContain(`Agent run: ${PRIMARY_MISSION}`);
  await copiedBrief.toMatch(/Run: codex-[a-z0-9]+-[a-z0-9]{6} \(generation 1\)/);
  await copiedBrief.toContain(`Task: ${PRIMARY_MISSION}`);
  await copiedBrief.toContain("Provider: Codex");
  await copiedBrief.toContain("Cwd: unknown");
  await copiedBrief.toContain("Git: branch unknown · state unknown");
  await copiedBrief.toContain("Isolation: shared workspace");
  await copiedBrief.toContain("Isolation note: Agent shares the selected workspace checkout.");
  await copiedBrief.toContain("Worktree: unknown");
  await copiedBrief.toContain("Worktree cleanup: not-needed");
  await copiedBrief.toContain("Worktree cleanup note: Shared workspace runs do not own a cleanup target.");
  await copiedBrief.toContain("Status: done / complete");
  await copiedBrief.toContain("Readiness: provider-ready");
  await copiedBrief.toContain("Stage: review");
  await copiedBrief.toContain("Confidence: high");
  await copiedBrief.toContain("Risk: low residual risk");
  await copiedBrief.toContain("Exit: 0");
  await copiedBrief.toMatch(/Timing: started=.*completed=.*reviewed=pending/);
  await copiedBrief.toContain("Now: Reviewing checkout report");
  await copiedBrief.toContain("Activity: complete · structured");
  await copiedBrief.toContain("Summary: Structured task completed");
  await copiedBrief.toContain("Next: Review structured result");
  await copiedBrief.toContain("Memory: Checkout flake isolated to retry timing; preserve auth fixture logs.");
  await copiedBrief.toContain("Evidence: tests: checkout-flow.spec passed");
  await copiedBrief.toContain("Artifact: reports/checkout-flow.md");
  await copiedBrief.toContain("Outcome: Structured completion");
  await copiedBrief.toContain("Latest input: sent - [[TERMFLEET_AGENT_EVENT");
  await copiedBrief.toContain("Run record: prompts=9, sent=9, signals=2, controls=3");
  await copiedBrief.toContain("Latest event: signal - Structured completion");
  await page.getByTestId("canvas-agent-run-item").filter({ hasText: "Reviewing checkout report" }).click();
  const copiedRunFromLane = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedRunFromLane.toContain(`Agent run: ${PRIMARY_MISSION}`);
  await copiedRunFromLane.toContain(`Task: ${PRIMARY_MISSION}`);
  await copiedRunFromLane.toContain("Now: Reviewing checkout report");
  await copiedRunFromLane.toContain("Evidence: tests: checkout-flow.spec passed");
  await copiedRunFromLane.toContain("Run record: prompts=9, sent=9, signals=2, controls=3");
  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedLaneBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedLaneBrief.toContain("Readiness mix: Provider ready: 1");
  await copiedLaneBrief.toContain("Operator prompts:");
  await copiedLaneBrief.toContain("Closeout mix: Ready: 1");
  await copiedLaneBrief.toContain(`${PRIMARY_MISSION}: sent - [[TERMFLEET_AGENT_EVENT`);
  await copiedLaneBrief.toContain("Terminal output:");
  await copiedLaneBrief.toContain("browser preview");
  await copiedLaneBrief.toContain("Next actions:");
  await copiedLaneBrief.toContain(`${PRIMARY_MISSION}: Review structured result`);
  await copiedLaneBrief.toContain("Mission control:");
  await copiedLaneBrief.toContain("- Investigate flaky checkout flow: Review (Ready with proof · Memory ready · Structured task completed)");
  await copiedLaneBrief.toContain("Recent events:");
  await copiedLaneBrief.toContain("Investigate flaky checkout flow: signal · Structured completion - Provider emitted a machine-readable completion signal.");
  await copiedLaneBrief.toContain("Evidence queue:");
  await copiedLaneBrief.toContain("tests: checkout-flow.spec passed (reports/checkout-flow.md)");
  await copiedLaneBrief.toContain("Proof needed:");
  await copiedLaneBrief.toContain("- none");
  await copiedLaneBrief.toContain("Risk queue:");
  await copiedLaneBrief.toContain("- none");
  await copiedLaneBrief.toContain("Attention queue:");
  await copiedLaneBrief.toContain("Complete (Reviewing checkout report)");
  await copiedLaneBrief.toContain("Review queue:");
  await copiedLaneBrief.toContain("Ready with proof · Memory ready · Structured task completed (reports/checkout-flow.md)");
  await copiedLaneBrief.toContain("1 closeout ready · 0 closeout blocked");
  await copiedLaneBrief.toContain("1 handoff ready · 0 handoff missing");
  await copiedLaneBrief.toContain("Memory: Checkout flake isolated to retry timing; preserve auth fixture logs.");

  await page.getByTestId("canvas-agent-lane-review-ready").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      exitCode: agent?.workstream?.exitCode,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      lastEventDetail: agent?.workstream?.events?.at(-1)?.detail,
    };
  })).toEqual({
    status: "done",
    phase: "reviewed",
    currentActivity: "Workstream reviewed",
    activityKind: "complete",
    activitySource: "operator",
    lastSummary: "Workstream reviewed",
    nextAction: "Close or restart the workstream",
    controlCount: 4,
    outcome: "Mission control reviewed run",
    exitCode: 0,
    completedAt: expect.any(Number),
    reviewedAt: expect.any(Number),
    lastEvent: "Mission control reviewed run",
    lastEventDetail: "Review: acknowledged the completed run record",
  });
  await expect(page.getByLabel("Agent operator guidance").getByText("Workstream reviewed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 complete");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 attention");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 queue");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 review");
  await expect(page.getByTestId("canvas-agent-lane-closeout-plan")).toHaveText("Review 0 ready · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-attention-item")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-review-item")).toHaveCount(0);

  await page.screenshot({
    path: test.info().outputPath("agent-workstream-map.png"),
    fullPage: true,
  });
});

test("command palette can launch a headless Codex agent profile", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  const mission = "Summarize release blockers";
  await createAgentWorkstream(page, mission, "shared", "headless");

  await expect(page.getByText(mission).first()).toBeVisible();
  await expect(page.getByTestId("map-agent-run-item").filter({ hasText: mission })).toBeVisible();
  await expect(page.getByTestId("map-agent-run-status").filter({ hasText: "codex" })).toContainText("command is not available in browser preview");

  await page.getByText("Details").click();
  await expect(page.getByLabel("Agent provider control surface").getByText("Launch")).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface")).toContainText("Codex headless status stream");

  await page.getByRole("button", { name: "Open full terminal" }).last().click();
  await expect(page.getByTestId("split-agent-working-on")).toContainText(mission);
  await expect(page.getByTestId("split-agent-pane-now")).toContainText("Watch provider response");

  await expect.poll(async () => page.evaluate((mission) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
    );
    return {
      launchProfile: agent?.workstream?.launchProfile,
      launchMode: agent?.workstream?.launchMode,
      startupCommand: agent?.workstream?.startupCommand,
      controlProtocol: agent?.workstream?.controlProtocol,
      providerEvent: agent?.workstream?.events?.find((event: { kind?: string }) => event.kind === "provider")?.detail,
    };
  }, mission)).toMatchObject({
    launchProfile: "headless",
    launchMode: "Codex headless status stream",
    startupCommand: "codex exec --json 'Summarize release blockers'",
    controlProtocol: "TermFleet adapter runs a non-interactive provider process and streams lifecycle/output into the cockpit.",
    providerEvent: expect.stringContaining("Codex headless status stream"),
  });
});

test("agent cockpit saves operator memory without sending a prompt", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  await createAgentWorkstream(page, "Document deploy handoff");

  const memoryNote = "Operator note: production deploy waits for DB owner approval.";
  const composer = page.getByRole("textbox", { name: "Agent follow-up prompt" });
  await composer.fill(memoryNote);
  await expect(composer).toHaveValue(memoryNote);
  await page.getByRole("button", { name: "Save operator memory" }).click();
  await expect(composer).toHaveValue("");

  await expect.poll(async () => page.evaluate((memoryNote) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === "Document deploy handoff"
    );
    return {
      memory: agent?.workstream?.memory,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      latestInput: agent?.workstream?.inputQueue?.at(-1)?.text,
      hasMemoryEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string; detail?: string }) =>
        event.kind === "control" &&
        event.label === "Operator memory updated" &&
        event.detail === memoryNote
      ),
    };
  }, memoryNote)).toEqual({
    memory: memoryNote,
    promptCount: 1,
    sentCount: 1,
    controlCount: 1,
    outcome: "Operator memory updated",
    latestInput: "Document deploy handoff",
    hasMemoryEvent: true,
  });

  await expect(page.getByLabel("Agent memory")).toContainText(memoryNote);
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 memories");
  await expect(page.getByTestId("canvas-agent-lane-memory")).toContainText("Copy memory");
  await expect(page.getByTestId("canvas-agent-lane-memory")).toContainText(memoryNote);
  await expect(page.getByTestId("map-agent-lane-memory")).toContainText(memoryNote);
  await page.getByTestId("canvas-agent-lane-memory").click();
  const copiedMemory = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedMemory.toBe(`Document deploy handoff: ${memoryNote}`);
});

test("agent cockpit surfaces raw provider process exit", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  const exitMission = "Verify raw exit handling";
  await createAgentWorkstream(page, exitMission);
  await sendFollowUp(page, "exit 7", exitMission);

  await expect.poll(async () => page.evaluate((exitMission) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === exitMission
    );
    const terminal = agent?.terminals?.[0];
    const hasExitEvent = agent?.workstream?.events?.some((event: { kind?: string; label?: string; detail?: string; status?: string }) =>
      event.kind === "provider" &&
      event.label === "Provider process exited" &&
      event.detail === "exit code 7" &&
      event.status === "failed"
    );
    if (!hasExitEvent) return null;
    return {
      terminalStatus: terminal?.status,
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      exitCode: agent?.workstream?.exitCode,
      currentActivity: agent?.workstream?.currentActivity,
      activityKind: agent?.workstream?.activityKind,
      activitySource: agent?.workstream?.activitySource,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      outcome: agent?.workstream?.outcome,
      completedAt: agent?.workstream?.completedAt,
      hasExitEvent,
    };
  }, exitMission)).toEqual({
    terminalStatus: expect.stringMatching(/^(exited|stale)$/),
    status: "failed",
    phase: "blocked",
    exitCode: 7,
    currentActivity: "Provider process exited with code 7",
    activityKind: "blocked",
    activitySource: "system",
    lastSummary: "Provider process exited with code 7",
    nextAction: "Inspect output and send recovery prompt",
    outcome: expect.stringMatching(/^Provider process exited(?: with code 7)?$/),
    completedAt: undefined,
    hasExitEvent: true,
  });

  await expect(page.getByTestId("canvas-agent-working-on")).toContainText("Verify raw exit handling");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips")).toContainText("blocked");
  await expect(page.getByTestId("canvas-agent-status-now")).toContainText("Inspect output and send recovery prompt");
  await expect(page.getByLabel("Agent current activity")).toContainText("Provider process exited with code 7");
  await expect(page.getByLabel("Agent current activity")).toContainText("blocked · system");
  await page.getByTestId("agent-cockpit-panel").getByText("Details").click();
  await expect(page.getByLabel("Agent run record").getByText("Exit", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("7", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 recovery");
  await expect(page.getByTestId("canvas-agent-recovery-item")).toContainText(exitMission);
  await expect(page.getByTestId("canvas-agent-recovery-item")).toContainText("Provider process exited with code 7");
  await expect(page.getByTestId("map-agent-recovery-item")).toContainText("Provider process exited with code 7");
});

test("agent lane sweeps active child agents for status", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  const activeMissions = ["Sweep checkout worker", "Sweep release worker"];
  const heldMission = "Sweep completed worker";
  const recoveryMission = "Sweep failed worker";
  await createAgentWorkstream(page, activeMissions[0], "shared");
  await createAgentWorkstream(page, activeMissions[1], "shared");
  await createAgentWorkstream(page, heldMission, "shared");
  await createAgentWorkstream(page, recoveryMission, "shared");
  await page.evaluate(({ heldMission, recoveryMission }) => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          updateTab: (id: string, updates: { workstream?: Record<string, unknown> }) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const held = state.tabs.find((tab) => tab.workstream?.kind === "agent" && tab.workstream?.mission === heldMission);
    const recovery = state.tabs.find((tab) => tab.workstream?.kind === "agent" && tab.workstream?.mission === recoveryMission);
    if (!held?.workstream) throw new Error(`Held workstream not found: ${heldMission}`);
    if (!recovery?.workstream) throw new Error(`Recovery workstream not found: ${recoveryMission}`);
    const now = Date.now();
    store.getState().updateTab(held.id, {
      workstream: {
        ...held.workstream,
        status: "done",
        phase: "complete",
        readiness: "provider-ready",
        exitCode: 0,
        stage: "review",
        confidence: "high",
        risk: "none",
        currentActivity: "Completed sweep fixture",
        activityKind: "complete",
        activitySource: "structured",
        activityUpdatedAt: now,
        lastActivityAt: now,
        lastSummary: "Completed sweep fixture",
        nextAction: "Review completed fixture",
      },
    });
    store.getState().updateTab(recovery.id, {
      workstream: {
        ...recovery.workstream,
        status: "failed",
        phase: "blocked",
        readiness: "provider-ready",
        currentActivity: "Provider failed fixture",
        activityKind: "blocked",
        activitySource: "structured",
        activityUpdatedAt: now,
        lastActivityAt: now,
        lastSummary: "Provider failed fixture",
        nextAction: "Restart failed fixture",
      },
    });
  }, { heldMission, recoveryMission });

  await expect(page.getByTestId("canvas-agent-lane-status-sweep")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-status-sweep")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-status-sweep-plan")).toHaveText("Sweep 2 active · 2 held");
  await expect(page.getByTestId("map-agent-lane-status-sweep-plan")).toHaveText("Sweep 2 active · 2 held");
  await expect(page.getByTestId("canvas-agent-lane-interrupt-active")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-interrupt-active")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-interrupt-plan")).toHaveText("Interrupt 2 active · 2 held");
  await expect(page.getByTestId("map-agent-lane-interrupt-plan")).toHaveText("Interrupt 2 active · 2 held");
  await expect(page.getByTestId("canvas-agent-lane-restart-recovery")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-restart-recovery")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-restart-plan")).toHaveText("Restart 1 recovery · 3 held");
  await expect(page.getByTestId("map-agent-lane-restart-plan")).toHaveText("Restart 1 recovery · 3 held");
  await page.getByTestId("canvas-agent-lane-status-sweep").click();

  await expect.poll(async () => page.evaluate(({ activeMissions, heldMission, recoveryMission }) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const activeAgents = activeMissions.map((mission) => {
      const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      const latest = agent?.workstream?.inputQueue?.at(-1);
      return {
        mission,
        promptCount: agent?.workstream?.promptCount,
        latestHasStatusCheck: latest?.text?.includes("Status check for Codex agent"),
        latestHasMission: latest?.text?.includes(`Mission: ${mission}`),
        latestSource: latest?.source,
        latestLabel: latest?.label,
        hasQueuedEvent: agent?.workstream?.events?.some((event: { label?: string; detail?: string }) =>
          event.label === "Mission control queued Status sweep" &&
          event.detail?.includes("Status check for Codex agent")
        ),
      };
    });
    const held = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === heldMission
    );
    const recovery = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === recoveryMission
    );
    return {
      activeAgents,
      held: {
        mission: heldMission,
        promptCount: held?.workstream?.promptCount,
        latestInput: held?.workstream?.inputQueue?.at(-1)?.text,
        hasStatusSweepEvent: held?.workstream?.events?.some((event: { label?: string }) =>
          event.label === "Mission control queued Status sweep"
        ),
      },
      recovery: {
        mission: recoveryMission,
        promptCount: recovery?.workstream?.promptCount,
        status: recovery?.workstream?.status,
        phase: recovery?.workstream?.phase,
        latestInput: recovery?.workstream?.inputQueue?.at(-1)?.text,
        hasStatusSweepEvent: recovery?.workstream?.events?.some((event: { label?: string }) =>
          event.label === "Mission control queued Status sweep"
        ),
      },
    };
  }, { activeMissions, heldMission, recoveryMission })).toEqual({
    activeAgents: [
    {
      mission: activeMissions[0],
      promptCount: 2,
      latestHasStatusCheck: true,
      latestHasMission: true,
      latestSource: "mission-control",
      latestLabel: "Status sweep",
      hasQueuedEvent: true,
    },
    {
      mission: activeMissions[1],
      promptCount: 2,
      latestHasStatusCheck: true,
      latestHasMission: true,
      latestSource: "mission-control",
      latestLabel: "Status sweep",
      hasQueuedEvent: true,
    },
    ],
    held: {
      mission: heldMission,
      promptCount: 1,
      latestInput: heldMission,
      hasStatusSweepEvent: false,
    },
    recovery: {
      mission: recoveryMission,
      promptCount: 1,
      status: "failed",
      phase: "blocked",
      latestInput: recoveryMission,
      hasStatusSweepEvent: false,
    },
  });

  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("6 prompts");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("6 prompts");

  await page.getByTestId("canvas-agent-lane-interrupt-active").click();

  await expect.poll(async () => page.evaluate(({ activeMissions, heldMission, recoveryMission }) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const activeAgents = activeMissions.map((mission) => {
      const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      return {
        mission,
        status: agent?.workstream?.status,
        phase: agent?.workstream?.phase,
        currentActivity: agent?.workstream?.currentActivity,
        activityKind: agent?.workstream?.activityKind,
        activitySource: agent?.workstream?.activitySource,
        nextAction: agent?.workstream?.nextAction,
        controlCount: agent?.workstream?.controlCount,
        hasCancellationEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
          event.label === "Cancellation requested"
        ),
      };
    });
    const held = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === heldMission
    );
    const recovery = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === recoveryMission
    );
    return {
      activeAgents,
      held: {
        mission: heldMission,
        status: held?.workstream?.status,
        phase: held?.workstream?.phase,
        currentActivity: held?.workstream?.currentActivity,
        hasCancellationEvent: held?.workstream?.events?.some((event: { label?: string }) =>
          event.label === "Cancellation requested"
        ),
      },
      recovery: {
        mission: recoveryMission,
        status: recovery?.workstream?.status,
        phase: recovery?.workstream?.phase,
        currentActivity: recovery?.workstream?.currentActivity,
        hasCancellationEvent: recovery?.workstream?.events?.some((event: { label?: string }) =>
          event.label === "Cancellation requested"
        ),
      },
    };
  }, { activeMissions, heldMission, recoveryMission })).toEqual({
    activeAgents: [
      {
        mission: activeMissions[0],
        status: "running",
        phase: "cancelling",
        currentActivity: expect.stringMatching(/^(Cancellation requested|web\$ \^C)$/),
        activityKind: expect.stringMatching(/^(waiting|running)$/),
        activitySource: expect.stringMatching(/^(operator|terminal)$/),
        nextAction: "Wait for provider acknowledgement or hard-stop",
        controlCount: 1,
        hasCancellationEvent: true,
      },
      {
        mission: activeMissions[1],
        status: "running",
        phase: "cancelling",
        currentActivity: expect.stringMatching(/^(Cancellation requested|web\$ \^C)$/),
        activityKind: expect.stringMatching(/^(waiting|running)$/),
        activitySource: expect.stringMatching(/^(operator|terminal)$/),
        nextAction: "Wait for provider acknowledgement or hard-stop",
        controlCount: 1,
        hasCancellationEvent: true,
      },
    ],
    held: {
      mission: heldMission,
      status: "done",
      phase: "complete",
      currentActivity: "Completed sweep fixture",
      hasCancellationEvent: false,
    },
    recovery: {
      mission: recoveryMission,
      status: "failed",
      phase: "blocked",
      currentActivity: expect.any(String),
      hasCancellationEvent: false,
    },
  });

  await expect(page.getByTestId("canvas-agent-lane-interrupt-plan")).toHaveText("Interrupt 0 active · 4 held");
  await expect(page.getByTestId("map-agent-lane-interrupt-plan")).toHaveText("Interrupt 0 active · 4 held");
  await expect(page.getByTestId("canvas-agent-lane-restart-plan")).toHaveText("Restart 1 recovery · 3 held");
  await expect(page.getByTestId("map-agent-lane-restart-plan")).toHaveText("Restart 1 recovery · 3 held");

  await page.getByTestId("canvas-agent-lane-restart-recovery").click();

  await expect.poll(async () => page.evaluate(({ activeMissions, heldMission, recoveryMission }) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const activeAgents = activeMissions.map((mission) => {
      const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      return {
        mission,
        status: agent?.workstream?.status,
        phase: agent?.workstream?.phase,
        currentActivity: agent?.workstream?.currentActivity,
      };
    });
    const held = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === heldMission
    );
    const recovery = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === recoveryMission
    );
    return {
      activeAgents,
      held: {
        mission: heldMission,
        status: held?.workstream?.status,
        phase: held?.workstream?.phase,
        currentActivity: held?.workstream?.currentActivity,
      },
      recovery: {
        mission: recoveryMission,
        status: recovery?.workstream?.status,
        phase: recovery?.workstream?.phase,
        currentActivity: recovery?.workstream?.currentActivity,
        nextAction: recovery?.workstream?.nextAction,
        generation: recovery?.workstream?.generation,
        controlCount: recovery?.workstream?.controlCount,
        lastEvent: recovery?.workstream?.events?.at(-1)?.label,
      },
    };
  }, { activeMissions, heldMission, recoveryMission })).toEqual({
    activeAgents: [
      {
        mission: activeMissions[0],
        status: "running",
        phase: "cancelling",
        currentActivity: expect.stringMatching(/^(Cancellation requested|web\$ \^C)$/),
      },
      {
        mission: activeMissions[1],
        status: "running",
        phase: "cancelling",
        currentActivity: expect.stringMatching(/^(Cancellation requested|web\$ \^C)$/),
      },
    ],
    held: {
      mission: heldMission,
      status: "done",
      phase: "complete",
      currentActivity: "Completed sweep fixture",
    },
    recovery: {
      mission: recoveryMission,
      status: expect.stringMatching(/^(ready|running)$/),
      phase: expect.stringMatching(/^(queued|launching|active)$/),
      currentActivity: "Restart requested",
      nextAction: expect.stringMatching(/^(Watch provider startup|Watch provider response)$/),
      generation: 1,
      controlCount: 1,
      lastEvent: expect.stringMatching(/^(Mission control requested restart|Status changed to running|Provider session ready)$/),
    },
  });

  await expect(page.getByTestId("canvas-agent-lane-restart-plan")).toHaveText("Restart 0 recovery · 4 held");
  await expect(page.getByTestId("map-agent-lane-restart-plan")).toHaveText("Restart 0 recovery · 4 held");
});

test("agent lane flags completed work without proof", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  const proofMission = "Summarize flaky test failures";
  await createAgentWorkstream(page, proofMission);

  const unprovenCompletion =
    '[[TERMFLEET_AGENT_EVENT {"status":"done","phase":"complete","readiness":"provider-ready","exitCode":0,"stage":"review","confidence":"medium","risk":"missing verification evidence","activity":"Ready for review","activityKind":"complete","summary":"Summary finished","nextAction":"Ask for exact tests and artifact paths","label":"Completion without proof","detail":"Provider completed without evidence."}]]';
  await sendFollowUp(page, unprovenCompletion);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      evidence: agent?.workstream?.evidence,
      artifact: agent?.workstream?.artifact,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
    };
  })).toEqual({
    status: "done",
    phase: "complete",
    lastSummary: "Summary finished",
    nextAction: "Ask for exact tests and artifact paths",
  });

  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 evidence");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 proof");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 review");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 closeout ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 closeout blocked");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 proven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 unproven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 handoff ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 handoff missing");
  await expect(page.getByTestId("canvas-agent-lane-closeout-plan")).toHaveText("Review 0 ready · 1 held");
  await expect(page.getByTestId("map-agent-lane-closeout-plan")).toHaveText("Review 0 ready · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-proof-plan")).toHaveText("Proof 1 needed");
  await expect(page.getByTestId("map-agent-lane-proof-plan")).toHaveText("Proof 1 needed");
  await expect(page.getByTestId("canvas-agent-lane-memory-plan")).toHaveText("Memory 0 needed · 1 held");
  await expect(page.getByTestId("map-agent-lane-memory-plan")).toHaveText("Memory 0 needed · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-review-ready")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-review-ready")).toBeDisabled();
  await expect(page.getByTestId("canvas-agent-lane-request-proof")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-request-proof")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-lane-request-memory")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-request-memory")).toBeDisabled();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 mission");
  await expect(page.getByTestId("canvas-agent-working-on")).toContainText("Summarize flaky test failures");
  await expect(page.getByTestId("canvas-agent-status-now")).toContainText("Ready for review");
  await runWorkspaceCommand(page, "show terminal");
  await expect(page.getByTestId("split-agent-pane-now")).toContainText("Ready for review");
  await runWorkspaceCommand(page, "show map");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Next: Request proof");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Summary finished");
  await expect(page.getByTestId("canvas-agent-proof-item")).toContainText("Request proof");
  await expect(page.getByTestId("canvas-agent-proof-item")).toContainText("Summarize flaky test failures");
  await expect(page.getByTestId("canvas-agent-proof-item")).toContainText("Summary finished");
  await expect(page.getByTestId("canvas-agent-proof-item")).toContainText("Ask for exact tests and artifact paths");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Needs proof");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Needs memory");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Summary finished");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Blocked review");
  await expect(page.getByTestId("canvas-agent-lane-closeout-breakdown")).toContainText("Needs proof + memory: 1");
  await expect(page.getByRole("button", { name: "Mark run reviewed", exact: true })).toBeDisabled();
  await page.getByTestId("canvas-agent-review-item").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      phase: agent?.workstream?.phase,
      reviewedAt: agent?.workstream?.reviewedAt,
      hasReviewedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control reviewed run" || event.label === "Reviewed"
      ),
    };
  })).toEqual({
    phase: "complete",
    reviewedAt: undefined,
    hasReviewedEvent: false,
  });
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Request proof" })).toContainText("Summarize flaky test failures");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("Next: Request proof");
  await expect(page.getByTestId("map-agent-supervisor-item").filter({ hasText: "Request proof" })).toContainText("Summary finished");
  await expect(page.getByTestId("map-agent-proof-item")).toContainText("Request proof");
  await expect(page.getByTestId("map-agent-proof-item")).toContainText("Summary finished");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 proven");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 closeout ready");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 closeout blocked");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 unproven");
  await expect(page.getByTestId("map-agent-review-item")).toContainText("Needs proof");
  await expect(page.getByTestId("map-agent-review-item")).toContainText("Needs memory");
  await expect(page.getByTestId("map-agent-lane-closeout-breakdown")).toContainText("Needs proof + memory: 1");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toHaveCount(0);

  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedProofBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedProofBrief.toContain("Cockpit headline: Next: Request proof - Summarize flaky test failures · Summary finished");
  await copiedProofBrief.toContain("Mission control:");
  await copiedProofBrief.toContain("- Summarize flaky test failures: Request proof (Summary finished)");
  await copiedProofBrief.toContain("Proof needed:");
  await copiedProofBrief.toContain("- Summarize flaky test failures: Summary finished");
  await copiedProofBrief.toContain("Request: Ask for exact tests and artifact paths");
  await copiedProofBrief.toContain("Closeout mix: Needs proof + memory: 1");
  await copiedProofBrief.toContain("0 closeout ready · 1 closeout blocked");
  await copiedProofBrief.toContain("Evidence queue:");
  await copiedProofBrief.toContain("- none");

  await page.getByTestId("canvas-agent-lane-request-proof").click();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 proof");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    const latestInput = agent?.workstream?.inputQueue?.at(-1);
    return {
      promptCount: agent?.workstream?.promptCount,
      latestInput: latestInput?.text,
      latestInputSent: Boolean(latestInput?.sentAt),
      latestInputSource: latestInput?.source,
      latestInputLabel: latestInput?.label,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasMissionControlQueuedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control queued Request proof"
      ),
    };
  })).toEqual({
    promptCount: 3,
    latestInput: expect.stringContaining("Provide proof for Codex agent completion"),
    latestInputSent: true,
    latestInputSource: "mission-control",
    latestInputLabel: "Request proof",
    lastEvent: "Mission control: Request proof sent",
    hasMissionControlQueuedEvent: true,
  });
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return agent?.workstream?.inputQueue?.at(-1)?.text ?? "";
  })).toContain("Current summary: Summary finished. Operator request: Ask for exact tests and artifact paths");

  const proofResponse =
    '[[TERMFLEET_AGENT_EVENT {"status":"done","phase":"complete","readiness":"provider-ready","exitCode":0,"stage":"verified","confidence":"high","risk":"no known residual risk","activity":"Evidence attached","activityKind":"complete","summary":"Summary finished with proof","nextAction":"Review evidence and mark run reviewed","evidence":"npm test -- flaky-checkout passed","artifact":"reports/flaky-checkout-summary.md","label":"Proof attached","detail":"Provider supplied requested verification evidence."}]]';
  await sendFollowUp(page, proofResponse);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      evidence: agent?.workstream?.evidence,
      artifact: agent?.workstream?.artifact,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      signalCount: agent?.workstream?.signalCount,
      hasProofEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "signal" && event.label === "Proof attached"
      ),
    };
  })).toEqual({
    evidence: "npm test -- flaky-checkout passed",
    artifact: "reports/flaky-checkout-summary.md",
    lastSummary: "Summary finished with proof",
    nextAction: "Review evidence and mark run reviewed",
    signalCount: 2,
    hasProofEvent: true,
  });

  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 evidence");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 proof");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 closeout ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 closeout blocked");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 proven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 unproven");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 handoff ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 handoff missing");
  await expect(page.getByTestId("canvas-agent-lane-closeout-plan")).toHaveText("Review 0 ready · 1 held");
  await expect(page.getByTestId("map-agent-lane-closeout-plan")).toHaveText("Review 0 ready · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-proof-plan")).toHaveText("Proof 0 needed · 1 held");
  await expect(page.getByTestId("map-agent-lane-proof-plan")).toHaveText("Proof 0 needed · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-memory-plan")).toHaveText("Memory 1 needed");
  await expect(page.getByTestId("map-agent-lane-memory-plan")).toHaveText("Memory 1 needed");
  await expect(page.getByTestId("canvas-agent-lane-review-ready")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-review-ready")).toBeDisabled();
  await expect(page.getByTestId("canvas-agent-lane-request-proof")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-request-proof")).toBeDisabled();
  await expect(page.getByTestId("canvas-agent-lane-request-memory")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-request-memory")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Ready with proof");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Needs memory");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Summary finished with proof");
  await expect(page.getByTestId("canvas-agent-review-item")).toContainText("Blocked review");
  await expect(page.getByTestId("canvas-agent-lane-closeout-breakdown")).toContainText("Needs memory: 1");
  await expect(page.getByRole("button", { name: "Mark run reviewed", exact: true })).toBeDisabled();
  await page.getByTestId("canvas-agent-review-item").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      phase: agent?.workstream?.phase,
      reviewedAt: agent?.workstream?.reviewedAt,
      hasReviewedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control reviewed run" || event.label === "Reviewed"
      ),
    };
  })).toEqual({
    phase: "complete",
    reviewedAt: undefined,
    hasReviewedEvent: false,
  });
  await expect(page.getByTestId("canvas-agent-proof-item")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Request proof" })).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Next: Request memory");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Request memory" })).toContainText("Summary finished with proof");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Request memory" })).toContainText("Ready with proof");
  await expect(page.getByTestId("map-agent-proof-item")).toHaveCount(0);
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("Next: Request memory");
  await expect(page.getByTestId("map-agent-supervisor-item").filter({ hasText: "Request memory" })).toContainText("Needs memory");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("Open proof");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("Summarize flaky test failures");
  await expect(page.getByTestId("canvas-agent-evidence-item")).toContainText("npm test -- flaky-checkout passed");
  await expect(page.getByTestId("map-agent-evidence-item")).toContainText("reports/flaky-checkout-summary.md");
  await expect(page.getByRole("button", { name: "Draft proof request" })).toHaveCount(0);
  await page.getByTestId("canvas-agent-evidence-item").click();
  const copiedEvidence = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedEvidence.toBe("Summarize flaky test failures: npm test -- flaky-checkout passed (reports/flaky-checkout-summary.md)");
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const openFile = state?.openFiles?.[0];
    return {
      path: openFile?.path,
      name: openFile?.name,
      dirty: openFile?.dirty,
    };
  })).toEqual({
    path: "reports/flaky-checkout-summary.md",
    name: "flaky-checkout-summary.md",
    dirty: false,
  });

  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedResolvedProofBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedResolvedProofBrief.toContain("Proof needed:");
  await copiedResolvedProofBrief.toContain("- none");
  await copiedResolvedProofBrief.toContain("Evidence queue:");
  await copiedResolvedProofBrief.toContain("npm test -- flaky-checkout passed (reports/flaky-checkout-summary.md)");
  await copiedResolvedProofBrief.toContain("Handoff memory needed:");
  await copiedResolvedProofBrief.toContain("Request: Provide durable handoff memory");
  await copiedResolvedProofBrief.toContain("Ready with proof · Needs memory · Summary finished with proof (reports/flaky-checkout-summary.md)");
  await copiedResolvedProofBrief.toContain("Closeout mix: Needs memory: 1");
  await copiedResolvedProofBrief.toContain("0 closeout ready · 1 closeout blocked");
  await copiedResolvedProofBrief.toContain("0 handoff ready · 1 handoff missing");

  await page.getByTestId("canvas-agent-lane-copy-mission").click();
  const copiedMemoryMissionBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedMemoryMissionBrief.toContain("Provider mix: Codex: 1");
  await copiedMemoryMissionBrief.toContain("Readiness mix: Provider ready: 1");
  await copiedMemoryMissionBrief.toContain("Closeout mix: Needs memory: 1");
  await copiedMemoryMissionBrief.toContain("Breakdown: Request memory: 1");
  await copiedMemoryMissionBrief.toContain("- Summarize flaky test failures: Request memory (Ready with proof · Needs memory · Summary finished with proof)");
  await copiedMemoryMissionBrief.toContain("Signal: just now");
  await copiedMemoryMissionBrief.toContain("Source: complete · structured");
  await copiedMemoryMissionBrief.toContain("Action: send prompt");
  await copiedMemoryMissionBrief.toContain("Prompt: Provide durable handoff memory");

  await page.getByTestId("canvas-agent-lane-request-memory").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    const latestInput = agent?.workstream?.inputQueue?.at(-1);
    return {
      promptCount: agent?.workstream?.promptCount,
      latestInput: latestInput?.text,
      latestInputSent: Boolean(latestInput?.sentAt),
      latestInputSource: latestInput?.source,
      latestInputLabel: latestInput?.label,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasMissionControlQueuedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control queued Request memory"
      ),
    };
  })).toEqual({
    promptCount: 5,
    latestInput: expect.stringContaining("Provide durable handoff memory"),
    latestInputSent: true,
    latestInputSource: "mission-control",
    latestInputLabel: "Request memory",
    lastEvent: "Mission control: Request memory sent",
    hasMissionControlQueuedEvent: true,
  });

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; workstream?: { kind?: string; mission?: string } }>;
          recordWorkstreamMemory: (tabId: string, memory: string) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const agent = state.tabs.find((tab) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === "Summarize flaky test failures"
    );
    if (!agent) throw new Error("Agent workstream not found");
    state.recordWorkstreamMemory(agent.id, "Proof lives in reports/flaky-checkout-summary.md; retry timing is the remaining context.");
  });
  await expect(page.getByTestId("canvas-agent-lane-memory-plan")).toHaveText("Memory 0 needed · 1 held");
  await expect(page.getByTestId("map-agent-lane-memory-plan")).toHaveText("Memory 0 needed · 1 held");
  await expect(page.getByTestId("canvas-agent-lane-request-memory")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-request-memory")).toBeDisabled();
});

test("agent lane exposes hidden mission-control queue pressure", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  for (let index = 1; index <= 6; index += 1) {
    const mission = `Overflow proof ${index}`;
    await createAgentWorkstream(page, mission);
    await sendFollowUp(
      page,
      `[[TERMFLEET_AGENT_EVENT {"status":"done","phase":"complete","readiness":"provider-ready","exitCode":0,"stage":"review","confidence":"high","risk":"no known residual risk","activity":"Ready for proof","activityKind":"complete","summary":"Needs proof ${index}","nextAction":"Attach proof ${index}","label":"Needs proof","detail":"No proof yet."}]]`,
      mission
    );
    await expect.poll(async () => page.evaluate((mission) => {
      const raw = localStorage.getItem("terminal-workspace.v1");
      const state = raw ? JSON.parse(raw) : null;
      const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
        tab.workstream?.kind === "agent" && tab.workstream?.mission === mission
      );
      return {
        phase: agent?.workstream?.phase,
        lastSummary: agent?.workstream?.lastSummary,
        nextAction: agent?.workstream?.nextAction,
      };
    }, mission)).toEqual({
      phase: "complete",
      lastSummary: `Needs proof ${index}`,
      nextAction: `Attach proof ${index}`,
    });
  }
  const overflowMissions = Array.from({ length: 6 }, (_, index) => `Overflow proof ${index + 1}`);
  await seedAgentTerminalOutputs(page, overflowMissions);
  await seedAgentMemories(page, overflowMissions);

  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("6 mission");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 hidden");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("18 actions");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("3 hidden actions");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Next: Request proof");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("+1 more");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 agents");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 complete");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 proof");
  await expect(page.getByTestId("canvas-agent-lane-mission-breakdown")).toContainText("Request proof: 6");
  await expect(page.getByTestId("canvas-agent-lane-mission-breakdown")).toContainText("Review: 6");
  await expect(page.getByTestId("canvas-agent-supervisor-item")).toHaveCount(5);
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Codex · done/complete");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("shared workspace");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Now: Ready for proof");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Signal: just now");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Source: complete · structured");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Also: Review");
  await expect(page.getByTestId("canvas-agent-supervisor-item").first()).toContainText("Needs proof · Memory ready");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("+1 rows · 3 actions");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("Overflow proof 6");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("Request proof");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("Needs proof 6");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("Also: Review");
  await expect(page.getByTestId("canvas-agent-supervisor-overflow")).toContainText("Complete: Ready for proof");
  await expect(page.getByTestId("canvas-agent-run-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-run-overflow")).toContainText("+3 more agents");
  await expect(page.getByTestId("canvas-agent-run-overflow")).toContainText("Ready for proof");
  await expect(page.getByTestId("canvas-agent-run-overflow")).toContainText("shared workspace");
  await expect(page.getByTestId("canvas-agent-input-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-input-overflow")).toContainText("more prompts");
  await expect(page.getByTestId("canvas-agent-input-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-input-overflow")).toContainText("sent");
  await expect(page.getByTestId("canvas-agent-recent-event")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-recent-event-overflow")).toContainText("more events");
  await expect(page.getByTestId("canvas-agent-recent-event-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-recent-event-overflow")).toContainText(/Provider session ready|Status changed to running/);
  await expect(page.getByTestId("canvas-agent-output-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-output-overflow")).toContainText("more output");
  await expect(page.getByTestId("canvas-agent-output-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-output-overflow")).toContainText("Output glimpse");
  await expect(page.getByTestId("canvas-agent-next-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-next-overflow")).toContainText("more next");
  await expect(page.getByTestId("canvas-agent-next-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-next-overflow")).toContainText("Attach proof");
  await expect(page.getByTestId("canvas-agent-proof-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-proof-overflow")).toContainText("more proof");
  await expect(page.getByTestId("canvas-agent-proof-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-proof-overflow")).toContainText("Needs proof");
  await expect(page.getByTestId("canvas-agent-proof-overflow")).toContainText("Attach proof");
  await expect(page.getByTestId("canvas-agent-review-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-review-overflow")).toContainText("more review");
  await expect(page.getByTestId("canvas-agent-review-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-review-overflow")).toContainText("Needs proof");
  await expect(page.getByTestId("canvas-agent-review-overflow")).toContainText("Memory ready");
  await expect(page.getByTestId("canvas-agent-lane-memory")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-memory-overflow")).toContainText("more memory");
  await expect(page.getByTestId("canvas-agent-memory-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-memory-overflow")).toContainText("Handoff memory");

  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("6 mission");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 hidden");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("18 actions");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("3 hidden actions");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("+1 more");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("6 agents");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("6 proof");
  await expect(page.getByTestId("map-agent-lane-mission-breakdown")).toContainText("Request proof: 6");
  await expect(page.getByTestId("map-agent-lane-mission-breakdown")).toContainText("Review: 6");
  await expect(page.getByTestId("map-agent-supervisor-item")).toHaveCount(5);
  await expect(page.getByTestId("map-agent-supervisor-item").first()).toContainText("Now: Ready for proof");
  await expect(page.getByTestId("map-agent-supervisor-item").first()).toContainText("Signal: just now");
  await expect(page.getByTestId("map-agent-supervisor-item").first()).toContainText("Source: complete · structured");
  await expect(page.getByTestId("map-agent-supervisor-item").first()).toContainText("Also: Review");
  await expect(page.getByTestId("map-agent-supervisor-item").first()).toContainText("Needs proof · Memory ready");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("Overflow proof 6");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("Request proof");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("Needs proof 6");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("+1 rows · 3 actions");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("Also: Review");
  await expect(page.getByTestId("map-agent-supervisor-overflow")).toContainText("Complete: Ready for proof");
  await expect(page.getByTestId("map-agent-run-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-run-overflow")).toContainText("+3 more agents");
  await expect(page.getByTestId("map-agent-run-overflow")).toContainText("Ready for proof");
  await expect(page.getByTestId("map-agent-run-overflow")).toContainText("shared workspace");
  await expect(page.getByTestId("map-agent-input-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-input-overflow")).toContainText("more prompts");
  await expect(page.getByTestId("map-agent-input-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-input-overflow")).toContainText("sent");
  await expect(page.getByTestId("map-agent-recent-event")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-recent-event-overflow")).toContainText("more events");
  await expect(page.getByTestId("map-agent-recent-event-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-recent-event-overflow")).toContainText(/Provider session ready|Status changed to running/);
  await expect(page.getByTestId("map-agent-output-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-output-overflow")).toContainText("more output");
  await expect(page.getByTestId("map-agent-output-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-output-overflow")).toContainText("Output glimpse");
  await expect(page.getByTestId("map-agent-next-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-next-overflow")).toContainText("more next");
  await expect(page.getByTestId("map-agent-next-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-next-overflow")).toContainText("Attach proof");
  await expect(page.getByTestId("map-agent-proof-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-proof-overflow")).toContainText("more proof");
  await expect(page.getByTestId("map-agent-proof-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-proof-overflow")).toContainText("Needs proof");
  await expect(page.getByTestId("map-agent-proof-overflow")).toContainText("Attach proof");
  await expect(page.getByTestId("map-agent-review-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-review-overflow")).toContainText("more review");
  await expect(page.getByTestId("map-agent-review-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-review-overflow")).toContainText("Needs proof");
  await expect(page.getByTestId("map-agent-review-overflow")).toContainText("Memory ready");
  await expect(page.getByTestId("map-agent-lane-memory")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-memory-overflow")).toContainText("more memory");
  await expect(page.getByTestId("map-agent-memory-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-memory-overflow")).toContainText("Handoff memory");

  await page.getByTestId("canvas-agent-lane-copy-mission").click();
  const copiedMissionBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedMissionBrief.toContain("Agent mission control brief");
  await copiedMissionBrief.toContain("Queue: 6 mission rows · 1 hidden rows · 18 actions · 3 hidden actions · 6 agents");
  await copiedMissionBrief.toContain("Provider mix: Codex: 6");
  await copiedMissionBrief.toContain("Isolation mix: shared workspace: 6");
  await copiedMissionBrief.toContain("Cleanup mix: not-needed: 6");
  await copiedMissionBrief.toContain("Readiness mix: Provider ready: 6");
  await copiedMissionBrief.toContain("Closeout mix: Needs proof: 6");
  await copiedMissionBrief.toContain("Dispatch: 0 mission-control prompts · 0 sent · 0 queued");
  await copiedMissionBrief.toContain("Breakdown: Request proof: 6 · Review: 6 · Complete: 6");
  await copiedMissionBrief.toContain("Headline: Next: Request proof - Overflow proof");
  await copiedMissionBrief.toContain("Run: Codex · done/complete");
  await copiedMissionBrief.toContain("Workspace: workspace root unknown · branch unknown · state unknown · shared workspace");
  await copiedMissionBrief.toContain("Now: Ready for proof");
  await copiedMissionBrief.toContain("Signal: just now");
  await copiedMissionBrief.toContain("Source: complete · structured");
  await copiedMissionBrief.toContain("Action: send prompt");
  await copiedMissionBrief.toContain("Also: Review: Needs proof · Memory ready");
  await copiedMissionBrief.toContain("Prompt: Attach proof");
  await copiedMissionBrief.toContain("- +1 more mission rows hidden (3 actions)");
  await copiedMissionBrief.toContain("Hidden mission control:");
  await copiedMissionBrief.toContain("- Overflow proof 6: Request proof (Needs proof 6)");
  await copiedMissionBrief.toContain("Also: Review: Needs proof · Memory ready");
  await copiedMissionBrief.toContain("Complete: Ready for proof");
  await copiedMissionBrief.toContain("Prompt: Attach proof 6");
  await copiedMissionBrief.toContain("Source: complete · structured");

  await page.getByTestId("map-agent-lane-copy-mission").click();
  const copiedMapMissionBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedMapMissionBrief.toContain("Agent mission control brief");
  await copiedMapMissionBrief.toContain("Queue: 6 mission rows · 1 hidden rows · 18 actions · 3 hidden actions · 6 agents");
  await copiedMapMissionBrief.toContain("Provider mix: Codex: 6");
  await copiedMapMissionBrief.toContain("Readiness mix: Provider ready: 6");
  await copiedMapMissionBrief.toContain("Dispatch: 0 mission-control prompts · 0 sent · 0 queued");
  await copiedMapMissionBrief.toContain("Breakdown: Request proof: 6 · Review: 6 · Complete: 6");
  await copiedMapMissionBrief.toContain("Signal: just now");
  await copiedMapMissionBrief.toContain("Source: complete · structured");
  await copiedMapMissionBrief.toContain("Also: Review: Needs proof · Memory ready");
  await copiedMapMissionBrief.toContain("Hidden mission control:");
  await copiedMapMissionBrief.toContain("- Overflow proof 6: Request proof (Needs proof 6)");

  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedOverflowBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedOverflowBrief.toContain("6 mission rows · 1 hidden mission rows · 18 mission actions · 3 hidden mission actions");
  await copiedOverflowBrief.toContain("+1 more");
  await copiedOverflowBrief.toContain("- +1 more mission rows hidden (3 actions)");
  await copiedOverflowBrief.toContain("Hidden mission control:");
  await copiedOverflowBrief.toContain("- Overflow proof 6: Request proof (Needs proof 6)");

  await seedAgentEvidence(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-evidence-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-evidence-overflow")).toContainText("more evidence");
  await expect(page.getByTestId("canvas-agent-evidence-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-evidence-overflow")).toContainText("Verification evidence");
  await expect(page.getByTestId("canvas-agent-evidence-overflow")).toContainText("reports/overflow-proof");
  await expect(page.getByTestId("map-agent-evidence-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-evidence-overflow")).toContainText("more evidence");
  await expect(page.getByTestId("map-agent-evidence-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-evidence-overflow")).toContainText("Verification evidence");
  await expect(page.getByTestId("map-agent-evidence-overflow")).toContainText("reports/overflow-proof");

  await seedAgentAuthRequired(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 auth");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("6 auth");
  await expect(page.getByTestId("canvas-agent-lane-auth-retry-plan")).toHaveText("Retry 6 auth");
  await expect(page.getByTestId("map-agent-lane-auth-retry-plan")).toHaveText("Retry 6 auth");
  await expect(page.getByTestId("canvas-agent-lane-retry-auth")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-retry-auth")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-auth-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-auth-overflow")).toContainText("more auth");
  await expect(page.getByTestId("canvas-agent-auth-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-auth-overflow")).toContainText("Provider requires authentication");
  await expect(page.getByTestId("canvas-agent-auth-overflow")).toContainText("Authenticate the CLI");
  await expect(page.getByTestId("map-agent-auth-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-auth-overflow")).toContainText("more auth");
  await expect(page.getByTestId("map-agent-auth-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-auth-overflow")).toContainText("Provider requires authentication");
  await expect(page.getByTestId("map-agent-auth-overflow")).toContainText("Authenticate the CLI");
  await seedAgentRisk(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-lane-risk-plan")).toHaveText("Risk 6 open");
  await expect(page.getByTestId("map-agent-lane-risk-plan")).toHaveText("Risk 6 open");
  await expect(page.getByTestId("canvas-agent-lane-mitigate-risk")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-mitigate-risk")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-risk-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-risk-overflow")).toContainText("more risk");
  await expect(page.getByTestId("canvas-agent-risk-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-risk-overflow")).toContainText("confidence=low");
  await expect(page.getByTestId("canvas-agent-risk-overflow")).toContainText("Residual risk");
  await expect(page.getByTestId("map-agent-risk-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-risk-overflow")).toContainText("more risk");
  await expect(page.getByTestId("map-agent-risk-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-risk-overflow")).toContainText("confidence=low");
  await expect(page.getByTestId("map-agent-risk-overflow")).toContainText("Residual risk");
  await page.getByTestId("canvas-agent-lane-mitigate-risk").click();
  await expect.poll(async () => page.evaluate((missions) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agents = state?.tabs?.filter((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && missions.includes(tab.workstream.mission ?? "")
    ) ?? [];
    return agents.map((tab: {
      workstream?: {
        mission?: string;
        inputQueue?: Array<{ text?: string; source?: string; label?: string; sentAt?: number }>;
        events?: Array<{ label?: string }>;
      };
    }) => {
      const latestInput = tab.workstream?.inputQueue?.at(-1);
      return {
        mission: tab.workstream?.mission,
        latestInput: latestInput?.text,
        latestInputSource: latestInput?.source,
        latestInputLabel: latestInput?.label,
        latestInputSent: typeof latestInput?.sentAt === "number",
        hasQueuedEvent: tab.workstream?.events?.some((event) => event.label === "Mission control queued Mitigate risk"),
      };
    }).sort((a: { mission?: string }, b: { mission?: string }) => (a.mission ?? "").localeCompare(b.mission ?? ""));
  }, overflowMissions)).toEqual(overflowMissions.map((mission) => ({
    mission,
    latestInput: expect.stringContaining("Resolve risk for Codex agent"),
    latestInputSource: "mission-control",
    latestInputLabel: "Mitigate risk",
    latestInputSent: true,
    hasQueuedEvent: true,
  })));
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("6 mission prompts");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("6 mission sent");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("6 mission prompts");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("6 mission sent");
  await expect(page.getByTestId("canvas-agent-lane-dispatch-breakdown")).toContainText("Mitigate risk: 6 sent");
  await expect(page.getByTestId("canvas-agent-run-item").first()).toContainText("Ask: Mitigate risk · sent");
  await expect(page.getByTestId("canvas-agent-run-item").first()).toContainText("Resolve risk for Codex agent");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByTestId("sidebar-agent-lane-dispatch-breakdown")).toContainText("Mitigate risk: 6 sent");
  await expect(page.getByTestId("sidebar-agent-run-item").first()).toContainText("Ask: Mitigate risk · sent");
  await expect(page.getByTestId("sidebar-agent-run-item").first()).toContainText("Resolve risk for Codex agent");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByTestId("map-agent-lane-dispatch-breakdown")).toContainText("Mitigate risk: 6 sent");
  await expect(page.getByTestId("map-agent-run-item").first()).toContainText("Ask: Mitigate risk · sent");
  await expect(page.getByTestId("map-agent-run-item").first()).toContainText("Resolve risk for Codex agent");
  await page.getByTestId("map-agent-run-item").first().click();
  const copiedRiskRunBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedRiskRunBrief.toContain("Cockpit ask: Ask: Mitigate risk · sent · Resolve risk for Codex agent");
  await copiedRiskRunBrief.toContain("Latest input: sent via mission-control Mitigate risk - Resolve risk for Codex agent");
  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedRiskLaneBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedRiskLaneBrief.toContain("Agent runs:");
  await copiedRiskLaneBrief.toContain("Cockpit ask: Ask: Mitigate risk · sent · Resolve risk for Codex agent");
  await page.getByTestId("canvas-agent-lane-copy-mission").click();
  const copiedRiskMissionBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedRiskMissionBrief.toContain("Dispatch: 6 mission-control prompts · 6 sent · 0 queued");
  await copiedRiskMissionBrief.toContain("Dispatch mix: Mitigate risk: 6 sent");

  await seedAgentRecovery(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 recovery");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("6 recovery");
  await expect(page.getByTestId("canvas-agent-recovery-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-recovery-overflow")).toContainText("more recovery");
  await expect(page.getByTestId("canvas-agent-recovery-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-recovery-overflow")).toContainText("Provider failure");
  await expect(page.getByTestId("canvas-agent-recovery-overflow")).toContainText("Recover Codex agent");
  await expect(page.getByTestId("map-agent-recovery-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-recovery-overflow")).toContainText("more recovery");
  await expect(page.getByTestId("map-agent-recovery-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-recovery-overflow")).toContainText("Provider failure");
  await expect(page.getByTestId("map-agent-recovery-overflow")).toContainText("Recover Codex agent");
  await expect(page.getByTestId("canvas-agent-attention-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-attention-overflow")).toContainText("more attention");
  await expect(page.getByTestId("canvas-agent-attention-overflow")).toContainText("Blocked");
  await expect(page.getByTestId("canvas-agent-attention-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-attention-overflow")).toContainText("Recovery needed");
  await expect(page.getByTestId("map-agent-attention-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-attention-overflow")).toContainText("more attention");
  await expect(page.getByTestId("map-agent-attention-overflow")).toContainText("Blocked");
  await expect(page.getByTestId("map-agent-attention-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-attention-overflow")).toContainText("Recovery needed");

  await seedAgentStale(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("stale");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("stale");
  await expect(page.getByTestId("canvas-agent-stale-item")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-stale-overflow")).toContainText("more stale");
  await expect(page.getByTestId("canvas-agent-stale-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("canvas-agent-stale-overflow")).toContainText("idle");
  await expect(page.getByTestId("canvas-agent-stale-overflow")).toContainText("Idle child");
  await expect(page.getByTestId("map-agent-stale-item")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-stale-overflow")).toContainText("more stale");
  await expect(page.getByTestId("map-agent-stale-overflow")).toContainText("Overflow proof");
  await expect(page.getByTestId("map-agent-stale-overflow")).toContainText("idle");
  await expect(page.getByTestId("map-agent-stale-overflow")).toContainText("Idle child");

  await seedAgentWorkspaceGroups(page, overflowMissions);
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 agents");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 active");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("6 groups");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("6 groups");
  await expect(page.getByTestId("canvas-agent-workspace-group")).toHaveCount(3);
  await expect(page.getByTestId("canvas-agent-workspace-group-overflow")).toContainText("more groups");
  await expect(page.getByTestId("canvas-agent-workspace-group-overflow")).toContainText("Workspace group");
  await expect(page.getByTestId("canvas-agent-workspace-group-overflow")).toContainText("1 agents");
  await expect(page.getByTestId("canvas-agent-workspace-group-overflow")).toContainText("1 active");
  await expect(page.getByTestId("canvas-agent-workspace-group-overflow")).toContainText("branch-overflow");
  await expect(page.getByTestId("map-agent-workspace-group")).toHaveCount(3);
  await expect(page.getByTestId("map-agent-workspace-group-overflow")).toContainText("more groups");
  await expect(page.getByTestId("map-agent-workspace-group-overflow")).toContainText("Workspace group");
  await expect(page.getByTestId("map-agent-workspace-group-overflow")).toContainText("1 agents");
  await expect(page.getByTestId("map-agent-workspace-group-overflow")).toContainText("1 active");
  await expect(page.getByTestId("map-agent-workspace-group-overflow")).toContainText("branch-overflow");

  await seedAgentAuthRequired(page, overflowMissions);
  await page.getByTestId("canvas-agent-lane-retry-auth").click();
  await expect.poll(async () => page.evaluate((missions) => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agents = state?.tabs?.filter((tab: {
      workstream?: {
        kind?: string;
        mission?: string;
      };
    }) => tab.workstream?.kind === "agent" && missions.includes(tab.workstream.mission ?? "")) ?? [];
    return agents.map((tab: {
      workstream?: {
        mission?: string;
        status?: string;
        phase?: string;
        readiness?: string;
        readinessCheck?: string;
        currentActivity?: string;
        events?: Array<{ label?: string }>;
      };
    }) => {
      const latestEvent = tab.workstream?.events?.at(-1);
      return {
        mission: tab.workstream?.mission,
        status: tab.workstream?.status,
        phase: tab.workstream?.phase,
        readiness: tab.workstream?.readiness,
        readinessCheck: tab.workstream?.readinessCheck,
        currentActivity: tab.workstream?.currentActivity,
        latestEvent: latestEvent?.label,
      };
    }).sort((a: { mission?: string }, b: { mission?: string }) => (a.mission ?? "").localeCompare(b.mission ?? ""));
  }, overflowMissions)).toEqual(overflowMissions.map((mission) => ({
    mission,
    status: expect.stringMatching(/^(ready|running)$/),
    phase: expect.stringMatching(/^(queued|active)$/),
    readiness: "unknown",
    readinessCheck: "Restart requested; waiting for provider startup output",
    currentActivity: expect.any(String),
    latestEvent: expect.stringMatching(/^(Mission control requested restart|Status changed to running)$/),
  })));
  await expect(page.getByTestId("canvas-agent-lane-auth-retry-plan")).toHaveText("Retry 0 auth · 6 held");
  await expect(page.getByTestId("map-agent-lane-auth-retry-plan")).toHaveText("Retry 0 auth · 6 held");
  await expect(page.getByTestId("canvas-agent-lane-retry-auth")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-retry-auth")).toBeDisabled();
});

test("agent lane requests cleanup only for closeout-ready dedicated worktrees", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  await createAgentWorkstream(page, "Finished isolated cleanup", "dedicated");
  await createAgentWorkstream(page, "Active isolated cleanup", "dedicated");
  await createAgentWorkstream(page, "Shared cleanup not owned", "shared");
  await seedAgentCleanupOwnership(page);

  await expect(page.getByTestId("canvas-agent-lane-cleanup-plan")).toHaveText("Cleanup 1 ready · 2 held");
  await expect(page.getByTestId("map-agent-lane-cleanup-plan")).toHaveText("Cleanup 1 ready · 2 held");
  await expect(page.getByTestId("canvas-agent-lane-request-cleanup")).toBeEnabled();
  await expect(page.getByTestId("map-agent-lane-request-cleanup")).toBeEnabled();
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 cleanup ready");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 cleanup ready");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 cleanup ready");

  await page.getByTestId("canvas-agent-lane-request-cleanup").click();

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agents = state?.tabs?.filter((tab: {
      workstream?: {
        kind?: string;
        mission?: string;
      };
    }) => tab.workstream?.kind === "agent") ?? [];
    return agents.map((tab: {
      workstream?: {
        mission?: string;
        worktreeCleanupStatus?: string;
        worktreeCleanupNote?: string;
        events?: Array<{ label?: string; detail?: string }>;
      };
    }) => ({
      mission: tab.workstream?.mission,
      cleanupStatus: tab.workstream?.worktreeCleanupStatus,
      cleanupNote: tab.workstream?.worktreeCleanupNote,
      hasCleanupRequestedEvent: tab.workstream?.events?.some((event) =>
        event.label === "Mission control requested worktree cleanup" &&
          event.detail?.startsWith("Request cleanup:")
      ) ?? false,
    })).sort((a: { mission?: string }, b: { mission?: string }) => (a.mission ?? "").localeCompare(b.mission ?? ""));
  })).toEqual([
    {
      mission: "Active isolated cleanup",
      cleanupStatus: "available",
      cleanupNote: "Active run still owns its worktree.",
      hasCleanupRequestedEvent: false,
    },
    {
      mission: "Finished isolated cleanup",
      cleanupStatus: "requested",
      cleanupNote: "Cleanup requested for /tmp/termfleet-finished-cleanup",
      hasCleanupRequestedEvent: true,
    },
    {
      mission: "Shared cleanup not owned",
      cleanupStatus: "not-needed",
      cleanupNote: "Shared workspace runs do not own a cleanup target.",
      hasCleanupRequestedEvent: false,
    },
  ]);
  await expect(page.getByTestId("canvas-agent-lane-cleanup-plan")).toHaveText("Cleanup 0 ready · 3 held");
  await expect(page.getByTestId("map-agent-lane-cleanup-plan")).toHaveText("Cleanup 0 ready · 3 held");
  await expect(page.getByTestId("canvas-agent-lane-request-cleanup")).toBeDisabled();
  await expect(page.getByTestId("map-agent-lane-request-cleanup")).toBeDisabled();
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("requested: 1");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 cleanup");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 cleanup");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 mission");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 mission");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Cleanup pending" })).toContainText("Finished isolated cleanup");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Cleanup pending" })).toContainText("Cleanup requested for /tmp/termfleet-finished-cleanup");
  await expect(page.getByTestId("map-agent-supervisor-item").filter({ hasText: "Cleanup pending" })).toContainText("Finished isolated cleanup");

  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedCleanupMissionBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedCleanupMissionBrief.toContain("Mission control:");
  await copiedCleanupMissionBrief.toContain("- Finished isolated cleanup: Cleanup pending (Cleanup requested for /tmp/termfleet-finished-cleanup)");
  await copiedCleanupMissionBrief.toContain("Action: focus run and execute guarded cleanup");
});

test("agent lane summarizes multiple supervised workstreams", async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  await createAgentWorkstream(page, "Audit deployment scripts", "shared");
  await createAgentWorkstream(page, "Prepare release notes", "dedicated");
  await expect(page.getByTestId("map-agent-run-item").filter({ hasText: "Prepare release notes" })).toContainText("command is not available in browser preview");
  await seedTwoProviderScanRows(page);

  await expect(page.getByTestId("canvas-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-total")).toHaveText("2 agents");
  await expect(page.getByTestId("map-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-total")).toHaveText("2 agents");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 active");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("2 agents");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 active");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("2 groups");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("1 active agent");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("2 groups");
  await expect(page.getByTestId("canvas-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("canvas-agent-lane-provider-breakdown")).toContainText("Claude: 1");
  await expect(page.getByTestId("map-agent-lane-provider-breakdown")).toContainText("Codex: 1");
  await expect(page.getByTestId("map-agent-lane-provider-breakdown")).toContainText("Claude: 1");
  const mapCodexRun = page.getByTestId("map-agent-run-item").filter({ hasText: "Audit deployment scripts" });
  const mapClaudeRun = page.getByTestId("map-agent-run-item").filter({ hasText: "Prepare release notes" });
  await expect(mapCodexRun.getByTestId("map-agent-run-status")).toContainText("working · codex · Auditing deployment scripts");
  await expect(mapCodexRun.getByTestId("map-agent-run-status")).toContainText("Attach proof");
  await expect(mapClaudeRun.getByTestId("map-agent-run-status")).toContainText("idle · claude · Waiting for operator follow-up");
  await expect(mapClaudeRun.getByTestId("map-agent-run-status")).toContainText("Ready for next prompt");
  await expect(page.getByTestId("canvas-agent-working-on").filter({ hasText: "Audit deployment scripts" })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-status-path").first()).toContainText("Path");
  await expect(page.getByTestId("canvas-agent-status-now").filter({ hasText: "Auditing deployment scripts" })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-status-chips").first()).toContainText("codex");
  await expect(page.getByTestId("canvas-agent-status-chips").first()).toContainText("working");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const sidebarCodexRun = page.getByTestId("sidebar-agent-run-item").filter({ hasText: "Audit deployment scripts" });
  const sidebarClaudeRun = page.getByTestId("sidebar-agent-run-item").filter({ hasText: "Prepare release notes" });
  await expect(sidebarCodexRun.getByTestId("sidebar-agent-run-status")).toContainText("working · codex · Auditing deployment scripts");
  await expect(sidebarClaudeRun.getByTestId("sidebar-agent-run-status")).toContainText("idle · claude · Waiting for operator follow-up");
  await sidebarClaudeRun.click();
  await expect(page.getByTestId("split-agent-pane-now")).toContainText("Waiting for operator follow-up");
  await sidebarCodexRun.click();
  await expect(page.getByTestId("split-agent-pane-now")).toContainText("Watch provider response");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByTestId("canvas-agent-lane-isolation-breakdown")).toContainText("shared workspace: 1");
  await expect(page.getByTestId("canvas-agent-lane-isolation-breakdown")).toContainText("dedicated worktree requested: 1");
  await expect(page.getByTestId("map-agent-lane-isolation-breakdown")).toContainText("shared workspace: 1");
  await expect(page.getByTestId("map-agent-lane-isolation-breakdown")).toContainText("dedicated worktree requested: 1");
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("not-needed: 1");
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("manual: 1");
  await expect(page.getByTestId("map-agent-lane-cleanup-breakdown")).toContainText("not-needed: 1");
  await expect(page.getByTestId("map-agent-lane-cleanup-breakdown")).toContainText("manual: 1");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("2 groups");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("2 prompts");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 dedicated");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 shared");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 stale");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 mission");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 cleanup");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("dedicated worktree requested");
  await expect(page.getByTestId("canvas-agent-workspace-group")).toHaveCount(2);
  await expect(page.getByTestId("map-agent-workspace-group")).toHaveCount(2);
  await expect(page.getByTestId("map-agent-workspace-group").filter({ hasText: "shared workspace" })).toContainText("1 agents");
  await expect(page.getByTestId("map-agent-workspace-group").filter({ hasText: "dedicated worktree requested" })).toContainText("1 agents");
  await expect(page.getByTestId("canvas-agent-input-item").filter({ hasText: "Prepare release notes" })).toContainText("Copy prompt");
  await expect(page.getByTestId("map-agent-input-item").filter({ hasText: "Audit deployment scripts" })).toContainText(/queued|sent/);
  await page.getByTestId("canvas-agent-input-item").filter({ hasText: "Prepare release notes" }).click();
  const copiedPrompt = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedPrompt.toMatch(/^Prepare release notes: (queued|sent) - Prepare release notes$/);

  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedLaneBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedLaneBrief.toContain("Agent supervision brief");
  await copiedLaneBrief.toContain("Totals: 2 agents · 2 workspace groups · 0 mission rows · 0 hidden mission rows · 0 mission actions · 0 hidden mission actions · 2 prompts · 0 mission-control prompts · 0 mission-control sent · 2 outputs · 2 next actions · 0 memories · 5 events · 0 stale · 0 evidence · 0 proof needed · 0 auth · 0 risk · 0 recovery · 0 review ready · 0 closeout ready · 0 closeout blocked · 0 proven review · 0 unproven review · 0 handoff ready · 0 handoff missing · 0 attention queue · 1 active");
  await copiedLaneBrief.toContain("Mission-control dispatch: 0 mission-control prompts · 0 sent · 0 queued");
  await copiedLaneBrief.toContain("Mission-control dispatch mix: none");
  await copiedLaneBrief.toContain("Provider mix: Codex: 1 · Claude: 1");
  await copiedLaneBrief.toContain("Isolation mix: shared workspace: 1 · dedicated worktree requested: 1");
  await copiedLaneBrief.toContain("Cleanup mix: not-needed: 1 · manual: 1");
  await copiedLaneBrief.toContain("Cockpit headline: Running - 1 active agent · 2 next actions");
  await copiedLaneBrief.toContain("Recent events:");
  await copiedLaneBrief.toContain("Prepare release notes: sent · Prompt sent");
  await copiedLaneBrief.toContain("Operator prompts:");
  await copiedLaneBrief.toContain("Mission-control prompts:");
  await copiedLaneBrief.toContain("- none");
  await copiedLaneBrief.toContain("- Prepare release notes:");
  await copiedLaneBrief.toContain("- Audit deployment scripts: sent - Audit deployment scripts");
  await copiedLaneBrief.toContain("Next actions:");
  await copiedLaneBrief.toContain("- Prepare release notes: Ready for next prompt");
  await copiedLaneBrief.toContain("- Audit deployment scripts: Watch provider response");
  await copiedLaneBrief.toContain("Stale agents:");
  await copiedLaneBrief.toContain("- none");
  await copiedLaneBrief.toContain("Workspace groups:");
  await copiedLaneBrief.toContain("- workspace root unknown: 1 agents, 1 active (shared workspace · branch unknown)");
  await copiedLaneBrief.toContain("- workspace root unknown: 1 agents, 0 active (dedicated worktree requested · branch unknown)");
  await copiedLaneBrief.toContain("Mission control:");
  await copiedLaneBrief.toContain("- none");
  await copiedLaneBrief.toContain("Agent runs:");
  await copiedLaneBrief.toContain("Task: Audit deployment scripts");
  await copiedLaneBrief.toContain("Task: Prepare release notes");
  await copiedLaneBrief.toContain("Worktree cleanup: manual");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agents = state?.tabs?.filter((tab: { workstream?: { kind?: string; status?: string; phase?: string } }) =>
      tab.workstream?.kind === "agent"
    ) ?? [];
    return {
      count: agents.length,
      isolationModes: agents.map((tab: { workstream?: { isolationMode?: string } }) => tab.workstream?.isolationMode).sort(),
      isolationStatuses: agents.map((tab: { workstream?: { isolationStatus?: string } }) => tab.workstream?.isolationStatus).sort(),
      cleanupStatuses: agents.map((tab: { workstream?: { worktreeCleanupStatus?: string } }) => tab.workstream?.worktreeCleanupStatus).sort(),
      dedicatedNote: agents.find((tab: { workstream?: { isolationMode?: string; isolationNote?: string } }) =>
        tab.workstream?.isolationMode === "dedicated-worktree"
      )?.workstream?.isolationNote,
      dedicatedCleanupNote: agents.find((tab: { workstream?: { isolationMode?: string; worktreeCleanupNote?: string } }) =>
        tab.workstream?.isolationMode === "dedicated-worktree"
      )?.workstream?.worktreeCleanupNote,
      activeLike: agents.filter((tab: { workstream?: { status?: string; phase?: string } }) =>
        tab.workstream?.phase === "queued" ||
        tab.workstream?.phase === "launching" ||
        tab.workstream?.phase === "active" ||
        tab.workstream?.status === "ready" ||
        tab.workstream?.status === "running"
      ).length,
    };
  })).toEqual({
    count: 2,
    isolationModes: ["dedicated-worktree", "shared-worktree"],
    isolationStatuses: ["requested", "shared"],
    cleanupStatuses: ["manual", "not-needed"],
    dedicatedNote: "Dedicated worktree requested; desktop will prepare a Git worktree when possible.",
    dedicatedCleanupNote: "No provisioned worktree is owned by this run.",
    activeLike: 1,
  });

  await ageAgentWorkstream(page, "Audit deployment scripts", 16, "Waiting on deployment audit");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 stale");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 mission");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Next: Check in");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("16m idle");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Needs attention");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("1 stale");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 stale");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 mission");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("Next: Check in");
  await expect(page.getByTestId("map-agent-lane-health")).toContainText("1 stale");
  await expect(page.getByTestId("canvas-agent-stale-item")).toContainText("Audit deployment scripts");
  await expect(page.getByTestId("canvas-agent-stale-item")).toContainText("16m idle");
  await expect(page.getByTestId("canvas-agent-stale-item")).toContainText("Waiting on deployment audit");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Check in" })).toContainText("Audit deployment scripts");
  await expect(page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Check in" })).toContainText("Signal: 16m ago");
  await expect(page.getByTestId("map-agent-supervisor-item").filter({ hasText: "Check in" })).toContainText("16m idle");
  await expect(page.getByTestId("map-agent-supervisor-item").filter({ hasText: "Check in" })).toContainText("Signal: 16m ago");
  await expect(page.getByTestId("map-agent-stale-item")).toContainText("Audit deployment scripts");
  await expect(page.getByTestId("map-agent-stale-item")).toContainText("16m idle");
  await page.getByTestId("canvas-agent-lane-copy-brief").click();
  const copiedStaleBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedStaleBrief.toContain("Totals: 2 agents · 2 workspace groups · 1 mission rows · 0 hidden mission rows · 1 mission actions · 0 hidden mission actions · 2 prompts · 0 mission-control prompts · 0 mission-control sent · 2 outputs · 2 next actions · 0 memories · 5 events · 1 stale");
  await copiedStaleBrief.toContain("Mission-control dispatch: 0 mission-control prompts · 0 sent · 0 queued");
  await copiedStaleBrief.toContain("Mission-control dispatch mix: none");
  await copiedStaleBrief.toContain("Cockpit headline: Next: Check in - Audit deployment scripts · 16m idle · Waiting on deployment audit");
  await copiedStaleBrief.toContain("Mission control:");
  await copiedStaleBrief.toContain("- Audit deployment scripts: Check in (16m idle · Waiting on deployment audit)");
  await copiedStaleBrief.toContain("Signal: 16m ago");
  await copiedStaleBrief.toContain("Stale agents:");
  await copiedStaleBrief.toContain("- Audit deployment scripts: 16m idle · Waiting on deployment audit");
  await page.getByTestId("canvas-agent-supervisor-item").filter({ hasText: "Check in" }).click();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 stale");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 mission");
  await expect(page.getByTestId("canvas-agent-lane-headline")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-lane-health")).toContainText("Running");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 stale");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("0 mission");
  await expect(page.getByTestId("map-agent-lane-headline")).toContainText("Running");
  await expect(page.getByTestId("canvas-agent-stale-item")).toHaveCount(0);
  await expect(page.getByTestId("canvas-agent-supervisor-item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Draft status check" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string; mission?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.mission === "Audit deployment scripts"
    );
    return {
      currentActivity: agent?.workstream?.currentActivity,
      lastSummary: agent?.workstream?.lastSummary,
      latestInput: agent?.workstream?.inputQueue?.at(-1)?.text,
      latestInputSource: agent?.workstream?.inputQueue?.at(-1)?.source,
      latestInputLabel: agent?.workstream?.inputQueue?.at(-1)?.label,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasMissionControlQueuedEvent: agent?.workstream?.events?.some((event: { label?: string }) =>
        event.label === "Mission control queued Check in"
      ),
      staleAfterCheckIn: agent?.workstream?.lastActivityAt
        ? Date.now() - agent.workstream.lastActivityAt >= 10 * 60_000
        : true,
    };
  })).toEqual({
    currentActivity: expect.stringMatching(/Status check for Codex agent|command is not available in browser preview/),
    lastSummary: expect.stringMatching(/^(Mission control: Check in sent to provider|Provider is running)$/),
    latestInput: expect.stringContaining("Mission: Audit deployment scripts"),
    latestInputSource: "mission-control",
    latestInputLabel: "Check in",
    lastEvent: "Mission control: Check in sent",
    hasMissionControlQueuedEvent: true,
    staleAfterCheckIn: false,
  });
  await page.getByTestId("map-agent-workspace-group").filter({ hasText: "shared workspace" }).click();
  const copiedWorkspaceGroup = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedWorkspaceGroup.toBe("workspace root unknown: 1 agents, 1 active (shared workspace · branch unknown)");

  await expect(page.getByRole("button", { name: "Request worktree cleanup" })).toBeVisible();
  await page.getByTestId("agent-cockpit-panel").getByText("Details").last().click();
  await page.getByRole("button", { name: "Request worktree cleanup" }).click();
  await expect(page.getByLabel("Agent worktree cleanup").getByText("requested", { exact: true })).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("1 cleanup");
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("not-needed: 1");
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("requested: 1");
  await expect(page.getByTestId("map-agent-lane-cleanup-breakdown")).toContainText("not-needed: 1");
  await expect(page.getByTestId("map-agent-lane-cleanup-breakdown")).toContainText("requested: 1");
  await expect(page.getByTestId("map-agent-workspace-group").filter({ hasText: "dedicated worktree requested" })).toContainText("1 cleanup");
  await page.getByTestId("map-agent-lane-copy-brief").click();
  const copiedCleanupBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedCleanupBrief.toContain("Cleanup mix: not-needed: 1 · requested: 1");
  await copiedCleanupBrief.toContain("cleanup requested=1");
  await copiedCleanupBrief.toContain("Worktree cleanup: requested");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const dedicated = state?.tabs?.find((tab: { workstream?: { kind?: string; isolationMode?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.isolationMode === "dedicated-worktree"
    );
    return {
      cleanupStatus: dedicated?.workstream?.worktreeCleanupStatus,
      cleanupNote: dedicated?.workstream?.worktreeCleanupNote,
      controlCount: dedicated?.workstream?.controlCount,
      lastEvent: dedicated?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    cleanupStatus: "requested",
    cleanupNote: "Cleanup requested; no worktree path is recorded.",
    controlCount: 1,
    lastEvent: "Worktree cleanup requested",
  });

  await expect(page.getByRole("button", { name: "Execute worktree cleanup" })).toBeVisible();
  await page.getByRole("button", { name: "Execute worktree cleanup" }).click();
  await expect(page.getByLabel("Agent worktree cleanup").getByText("manual", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("not-needed: 1");
  await expect(page.getByTestId("canvas-agent-lane-cleanup-breakdown")).toContainText("manual: 1");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const dedicated = state?.tabs?.find((tab: { workstream?: { kind?: string; isolationMode?: string } }) =>
      tab.workstream?.kind === "agent" && tab.workstream?.isolationMode === "dedicated-worktree"
    );
    return {
      cleanupStatus: dedicated?.workstream?.worktreeCleanupStatus,
      cleanupNote: dedicated?.workstream?.worktreeCleanupNote,
      controlCount: dedicated?.workstream?.controlCount,
      lastEvent: dedicated?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    cleanupStatus: "manual",
    cleanupNote: "Cleanup cannot run because no worktree path is recorded.",
    controlCount: 2,
    lastEvent: "Worktree cleanup blocked",
  });
});
