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
          setWorkspaceMode: (mode: string) => void;
          updateWorkspaceUiState: (updates: Record<string, unknown>) => void;
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
    store.getState().setWorkspaceMode("canvas");
    store.getState().updateWorkspaceUiState({
      primarySidebarPanel: "sessions",
      primarySidebarCollapsed: false,
      canvasSidebarCollapsed: false,
    });
  });

  const reconciled = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          groups: Array<{ id: string; name: string; emoji?: string; projectRoot?: string }>;
          canvasState: { viewport: { x: number; y: number; zoom: number } };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      groups: state?.groups.map((group) => ({
        name: group.name,
        emoji: group.emoji,
        root: group.projectRoot,
        count: state.tabs.filter((tab) => tab.groupId === group.id).length,
      })),
      viewport: state?.canvasState.viewport,
    };
  });
  expect(reconciled.groups).toEqual([
    {
      name: "TermFleet OSS",
      emoji: expect.any(String),
      root: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      count: 1,
    },
    {
      name: "docs-site",
      emoji: expect.any(String),
      root: "/media/endlessblink/data/my-projects/ai-development/docs-site",
      count: 1,
    },
    {
      name: "inner-dialogue",
      emoji: expect.any(String),
      root: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue",
      count: 1,
    },
  ]);
  expect(reconciled.viewport).toEqual({ x: -321, y: 88, zoom: 0.62 });

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          groups: Array<{ id: string; name: string }>;
          switchProject: (groupId: string | null) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    const docsGroup = store?.getState().groups.find((group) => group.name === "docs-site");
    if (!store || !docsGroup) throw new Error("docs-site group missing");
    store.getState().switchProject(docsGroup.id);
  });
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
          workspaceUiState: Record<string, unknown>;
          reconcileProjectGroups: () => void;
          setWorkspaceMode: (mode: string) => void;
          updateWorkspaceUiState: (updates: Record<string, unknown>) => void;
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
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
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
    store.getState().setWorkspaceMode("canvas");
    store.getState().updateWorkspaceUiState({
      primarySidebarPanel: "map",
      primarySidebarCollapsed: false,
      canvasSidebarCollapsed: false,
    });
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

// TC-034: terminals opened in the same path must collapse into ONE project, and
// re-opening a folder must not mint a duplicate project group for that path.
test("same-path terminals and duplicate project groups collapse into one project", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          reconcileProjectGroups: () => void;
          addGroup: (name: string, color?: string, projectRoot?: string) => string;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          tabs: Array<{ id: string; groupId: string | null }>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const TF = "/home/u/dev/termfleet";
    const PAPER = "/home/u/bots/paper-bot";
    const term = (id: string, paneId: string, initialCwd?: string, groupId: string | null = null) => ({
      id, title: id, emoji: "[]", color: "#7aa2f7", groupId, initialCwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: paneId, type: "terminal" }, activePaneId: paneId,
    });
    const node = (id: string, tabId: string, x: number) => ({
      id, type: "terminal", title: tabId, terminalTabId: tabId, x, y: 0, width: 620, height: 420,
    });

    store.setState({
      // Two DISTINCT groups for the SAME termfleet path (e.g. folder opened twice).
      groups: [
        { id: "g-tf-1", name: "termfleet", color: "#7aa2f7", projectRoot: TF },
        { id: "g-tf-2", name: "termfleet", color: "#7aa2f7", projectRoot: TF + "/" },
      ],
      terminalGroups: [],
      tabs: [
        term("tf-a", "p1", TF, "g-tf-1"),
        term("tf-b", "p2", TF, "g-tf-2"),
        term("tf-c", "p3", TF),            // ungrouped, same path
        term("tf-d", "p4", TF),            // ungrouped, same path
        term("paper", "p5", PAPER),        // different project
      ],
      activeTabId: "tf-a", activeGroupFilter: null, activeGroupId: null, projectRoot: null,
      canvasState: {
        selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [node("n-a","tf-a",0),node("n-b","tf-b",660),node("n-c","tf-c",1320),node("n-d","tf-d",1980),node("n-paper","paper",2640)],
      },
    });
    store.getState().reconcileProjectGroups();

    const s1 = store.getState();
    const tfGroups = s1.groups.filter((g) => (g.projectRoot ?? "").replace(/\/+$/, "") === TF);
    const summary = s1.groups.map((g) => ({
      name: g.name, root: (g.projectRoot ?? "").replace(/\/+$/, ""),
      count: s1.tabs.filter((t) => t.groupId === g.id).length,
    }));

    // addGroup dedup: re-opening the same path must reuse the existing group.
    const groupsBefore = store.getState().groups.length;
    const reusedId = store.getState().addGroup("termfleet", undefined, TF);
    const groupsAfter = store.getState().groups.length;

    return {
      termfleetGroupCount: tfGroups.length,
      termfleetTabCount: tfGroups.reduce((n, g) => n + s1.tabs.filter((t) => t.groupId === g.id).length, 0),
      summary,
      addGroupReusedExisting: groupsAfter === groupsBefore && tfGroups.some((g) => g.id === reusedId),
    };
  });

  // All four termfleet terminals collapse into a single termfleet project.
  expect(result.termfleetGroupCount).toBe(1);
  expect(result.termfleetTabCount).toBe(4);
  // paper-bot stays its own project.
  expect(result.summary).toContainEqual({ name: "paper-bot", root: "/home/u/bots/paper-bot", count: 1 });
  // Re-opening the same folder reuses the project instead of duplicating it.
  expect(result.addGroupReusedExisting).toBe(true);
});

// TC-034 regression: the LIVE store actions (addTab / updateTab) must auto-group
// terminals by path, not just the explicit reconcileProjectGroups() call.
test("addTab and cwd changes auto-group terminals by path (live wiring)", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const out = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          addTab: (overrides?: Record<string, unknown>) => void;
          updateTab: (id: string, updates: Record<string, unknown>) => void;
          tabs: Array<{ id: string; groupId: string | null; initialCwd?: string }>;
          groups: Array<{ id: string; projectRoot?: string }>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const A = "/home/u/dev/alpha";
    const B = "/home/u/dev/beta";
    store.setState({ tabs: [], groups: [], terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] } });

    // Three terminals opened in the same path (one with a trailing slash) + one elsewhere.
    store.getState().addTab({ initialCwd: A });
    store.getState().addTab({ initialCwd: A + "/" });
    store.getState().addTab({ initialCwd: A });
    store.getState().addTab({ initialCwd: B });

    const s = store.getState();
    const groupOf = (cwd: string) => {
      const tab = s.tabs.find((t) => (t.initialCwd ?? "").replace(/\/+$/, "") === cwd);
      return tab?.groupId ?? null;
    };
    const aGroupIds = new Set(
      s.tabs.filter((t) => (t.initialCwd ?? "").replace(/\/+$/, "") === A).map((t) => t.groupId)
    );

    // Now move one terminal's cwd from A to B; it must re-home to B's project.
    const movable = s.tabs.find((t) => (t.initialCwd ?? "").replace(/\/+$/, "") === A);
    store.getState().updateTab(movable!.id, { initialCwd: B });
    const s2 = store.getState();
    const movedGroup = s2.tabs.find((t) => t.id === movable!.id)?.groupId ?? null;

    return {
      aDistinctGroups: aGroupIds.size,          // all three A terminals share one group
      aProjectCount: s.groups.filter((g) => (g.projectRoot ?? "").replace(/\/+$/, "") === A).length,
      aAndBDiffer: groupOf(A) !== groupOf(B),
      movedToBGroup: movedGroup === s2.tabs.find((t) => (t.initialCwd ?? "").replace(/\/+$/, "") === B && t.id !== movable!.id)?.groupId,
    };
  });

  expect(out.aDistinctGroups).toBe(1);   // same-path terminals collapse into one project
  expect(out.aProjectCount).toBe(1);     // exactly one project group for that path
  expect(out.aAndBDiffer).toBe(true);    // different paths are different projects
  expect(out.movedToBGroup).toBe(true);  // cwd change re-homes the terminal
});

test("live cwd rehomes a stale Bina-scoped terminal to the TermFleet project", async ({ page }) => {
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
          setWorkspaceMode: (mode: string) => void;
          setLiveCwd: (id: string, cwd: string) => void;
          updateWorkspaceUiState: (updates: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const BINA = "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze";
    const TERMFLEET = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";
    const staleBinaGroup = {
      id: "group-bina",
      name: "bina-ve-ze",
      color: "#7aa2f7",
      emoji: "BZ",
      projectRoot: BINA,
      lastActiveTabId: "tab-termfleet",
    };

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
      groups: [staleBinaGroup],
      terminalGroups: [staleBinaGroup],
      tabs: [{
        id: "tab-termfleet",
        title: "Terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: "group-bina",
        initialCwd: BINA,
        terminals: [{ id: "pty-termfleet", paneId: "pane-termfleet", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-termfleet", type: "terminal" },
        activePaneId: "pane-termfleet",
      }],
      activeTabId: "tab-termfleet",
      activeGroupFilter: "group-bina",
      activeGroupId: "group-bina",
      projectRoot: BINA,
      liveCwds: {},
      canvasState: {
        selectedNodeId: "node-termfleet",
        selectedNodeIds: ["node-termfleet"],
        viewport: { x: -220, y: 140, zoom: 0.7 },
        nodes: [{
          id: "node-termfleet",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-termfleet",
          terminalCwd: BINA,
          x: 0,
          y: 0,
          width: 620,
          height: 420,
        }],
      },
    });
    store.getState().setLiveCwd("pty-termfleet", TERMFLEET);
    store.getState().setWorkspaceMode("canvas");
    store.getState().updateWorkspaceUiState({
      primarySidebarPanel: "map",
      primarySidebarCollapsed: false,
      canvasSidebarCollapsed: false,
    });
  });

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeGroupFilter: string | null;
          projectRoot: string | null;
          tabs: Array<{ id: string; groupId: string | null }>;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          canvasState: { viewport: { x: number; y: number; zoom: number } };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    if (!state) return null;
    const tab = state.tabs.find((candidate) => candidate.id === "tab-termfleet");
    const group = state.groups.find((candidate) => candidate.id === tab?.groupId);
    const activeGroup = state.groups.find((candidate) => candidate.id === state.activeGroupFilter);
    return {
      tabGroupName: group?.name,
      tabGroupRoot: group?.projectRoot,
      activeProjectName: activeGroup?.name,
      projectRoot: state.projectRoot,
      viewport: state.canvasState.viewport,
    };
  })).toEqual({
    tabGroupName: "termfleet",
    tabGroupRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    activeProjectName: "termfleet",
    projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    viewport: { x: -220, y: 140, zoom: 0.7 },
  });

  const nodeList = page.getByTestId("map-node-list");
  await expect(nodeList).toContainText("termfleet");
  await expect(nodeList).not.toContainText("bina-ve-ze");
  await expect(page.getByTestId("map-node-project-emoji")).toHaveAttribute("title", /termfleet/);
});

test("new terminal follows the active tab project instead of a stale project filter", async ({ page }) => {
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
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const BINA = "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze";
    const TERMFLEET = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";
    const groups = [
      { id: "group-bina", name: "bina-ve-ze", color: "#7aa2f7", emoji: "BZ", projectRoot: BINA },
      { id: "group-termfleet", name: "termfleet", color: "#9ece6a", emoji: "TF", projectRoot: TERMFLEET },
    ];

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "split",
      },
      groups,
      terminalGroups: groups,
      tabs: [{
        id: "tab-termfleet",
        title: "Terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: "group-termfleet",
        initialCwd: TERMFLEET,
        terminals: [{ id: "pty-termfleet", paneId: "pane-termfleet", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-termfleet", type: "terminal" },
        activePaneId: "pane-termfleet",
      }],
      activeTabId: "tab-termfleet",
      activeGroupFilter: "group-bina",
      activeGroupId: "group-bina",
      projectRoot: BINA,
      liveCwds: {},
      canvasState: {
        selectedNodeId: "node-termfleet",
        selectedNodeIds: ["node-termfleet"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: "node-termfleet",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-termfleet",
          terminalCwd: TERMFLEET,
          x: 0,
          y: 0,
          width: 620,
          height: 420,
        }],
      },
    });
  });

  await page.keyboard.press("Control+Shift+T");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null; initialCwd?: string }>;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          activeTabId: string | null;
          activeGroupFilter: string | null;
          projectRoot: string | null;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) return null;
    const state = store.getState();
    const newTab = state.tabs.find((tab) => tab.id !== "tab-termfleet");
    const newGroup = state.groups.find((group) => group.id === newTab?.groupId);
    return {
      newTabRoot: newTab?.initialCwd,
      newTabGroup: newGroup?.name,
      activeTabId: state.activeTabId,
      activeFilter: state.activeGroupFilter,
      projectRoot: state.projectRoot,
    };
  })).toEqual({
    newTabRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    newTabGroup: "termfleet",
    activeTabId: expect.any(String),
    activeFilter: "group-termfleet",
    projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
  });
});

test("project emoji is stable for generated icons and user emoji wins", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          addGroup: (name: string, color?: string, projectRoot?: string) => string;
          updateGroup: (id: string, updates: Record<string, unknown>) => void;
          reconcileProjectGroups: () => void;
          groups: Array<{ id: string; name: string; emoji?: string; emojiSource?: string; projectRoot?: string }>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const root = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";
    store.setState({
      groups: [],
      terminalGroups: [],
      tabs: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });

    const firstId = store.getState().addGroup("termfleet", undefined, root);
    const first = store.getState().groups.find((group) => group.id === firstId);
    const duplicateId = store.getState().addGroup("TermFleet custom label", undefined, `${root}/`);
    const duplicate = store.getState().groups.find((group) => group.id === duplicateId);

    store.getState().updateGroup(firstId, { emoji: "USER", emojiSource: "user" });
    store.getState().reconcileProjectGroups();
    const userOwned = store.getState().groups.find((group) => group.id === firstId);

    return {
      reusedSameGroup: duplicateId === firstId,
      generatedEmoji: first?.emoji,
      duplicateEmoji: duplicate?.emoji,
      generatedSource: first?.emojiSource,
      userEmoji: userOwned?.emoji,
      userSource: userOwned?.emojiSource,
      root: userOwned?.projectRoot,
    };
  });

  expect(result).toEqual({
    reusedSameGroup: true,
    generatedEmoji: expect.any(String),
    duplicateEmoji: result.generatedEmoji,
    generatedSource: "generated",
    userEmoji: "USER",
    userSource: "user",
    root: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
  });
});
