import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("terminal folders reconcile into project rows without moving the map viewport", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          workspaceUiState: Record<string, unknown>;
          reconcileProjectGroups: () => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const terminalTab = (id: string, title: string, paneId: string, initialCwd?: string) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "sessions",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
      groups: [{
        id: "group-termfleet",
        name: "TermFleet OSS",
        color: "#7aa2f7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      }],
      terminalGroups: [{
        id: "group-termfleet",
        name: "TermFleet OSS",
        color: "#7aa2f7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      }],
      tabs: [
        terminalTab("tab-termfleet", "TermFleet shell", "pane-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet"),
        terminalTab("tab-docs", "Docs shell", "pane-docs", "/media/endlessblink/data/my-projects/ai-development/docs-site"),
        terminalTab("tab-inner", "Inner Dialogue shell", "pane-inner"),
      ],
      activeTabId: "tab-termfleet",
      activeGroupFilter: null,
      activeGroupId: null,
      projectRoot: null,
      canvasState: {
        selectedNodeId: "node-termfleet",
        selectedNodeIds: ["node-termfleet"],
        viewport: { x: -321, y: 88, zoom: 0.62 },
        nodes: [
          { id: "node-termfleet", type: "terminal", title: "TermFleet shell", terminalTabId: "tab-termfleet", x: 0, y: 0, width: 620, height: 420 },
          { id: "node-docs", type: "terminal", title: "Docs shell", terminalTabId: "tab-docs", x: 660, y: 0, width: 620, height: 420 },
          { id: "node-inner", type: "terminal", title: "Inner Dialogue shell", terminalTabId: "tab-inner", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue", x: 1320, y: 0, width: 620, height: 420 },
        ],
      },
    });
    store.getState().reconcileProjectGroups();
  });

  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  await expect(sidebar.getByRole("button", { name: "Switch to TermFleet OSS" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Switch to docs-site" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Switch to inner-dialogue" })).toBeVisible();

  const reconciled = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          canvasState: { viewport: { x: number; y: number; zoom: number } };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      groups: state?.groups.map((group) => ({
        name: group.name,
        root: group.projectRoot,
        count: state.tabs.filter((tab) => tab.groupId === group.id).length,
      })),
      viewport: state?.canvasState.viewport,
    };
  });
  expect(reconciled.groups).toEqual([
    {
      name: "TermFleet OSS",
      root: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      count: 1,
    },
    {
      name: "docs-site",
      root: "/media/endlessblink/data/my-projects/ai-development/docs-site",
      count: 1,
    },
    {
      name: "inner-dialogue",
      root: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue",
      count: 1,
    },
  ]);
  expect(reconciled.viewport).toEqual({ x: -321, y: 88, zoom: 0.62 });

  await sidebar.getByRole("button", { name: "Switch to docs-site" }).click();
  await expect(sidebar.getByText("Docs shell")).toBeVisible();
  await expect(sidebar.getByText("TermFleet shell")).not.toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { viewport: { x: number; y: number; zoom: number } } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.viewport;
  })).toEqual({ x: -321, y: 88, zoom: 0.62 });
});

test("terminal opened in another project path is reassigned from stale active project", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          reconcileProjectGroups: () => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const group = {
      id: "group-termfleet",
      name: "termfleet",
      color: "#7aa2f7",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: "tab-paperbot",
    };

    store.setState({
      groups: [group],
      terminalGroups: [group],
      tabs: [{
        id: "tab-paperbot",
        title: "Terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: "group-termfleet",
        initialCwd: "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot",
        terminals: [{ id: "pty-paperbot", paneId: "pane-paperbot", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-paperbot", type: "terminal" },
        activePaneId: "pane-paperbot",
      }],
      activeTabId: "tab-paperbot",
      activeGroupFilter: null,
      activeGroupId: null,
      projectRoot: null,
      canvasState: {
        selectedNodeId: "node-paperbot",
        selectedNodeIds: ["node-paperbot"],
        viewport: { x: 40, y: 50, zoom: 0.8 },
        nodes: [{
          id: "node-paperbot",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-paperbot",
          terminalCwd: "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot",
          x: 0,
          y: 0,
          width: 620,
          height: 420,
        }],
      },
    });
    store.getState().reconcileProjectGroups();
  });

  const reconciled = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          canvasState: { viewport: { x: number; y: number; zoom: number } };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    const paperBot = state?.groups.find((group) => group.name === "paper-bot");
    return {
      tabGroupName: state?.groups.find((group) => group.id === state.tabs[0].groupId)?.name,
      paperBotRoot: paperBot?.projectRoot,
      viewport: state?.canvasState.viewport,
    };
  });

  expect(reconciled).toEqual({
    tabGroupName: "paper-bot",
    paperBotRoot: "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot",
    viewport: { x: 40, y: 50, zoom: 0.8 },
  });
});
