import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// Clicking a terminal in the sidebar selects exactly that card and shows it: no card
// moves on the map, no card changes group, and the list keeps its order (TF-069).
test("clicking a sidebar terminal selects the clicked card without moving cards, groups, or list order", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => {
        setWorkspaceMode: (mode: string) => void;
        updateWorkspaceUiState: (updates: Record<string, unknown>) => void;
        workspaceUiState: Record<string, unknown>;
      };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const root = "/media/endlessblink/data/my-projects/ai-development";
    const projects = [
      { id: "group-a", name: "alpha", root: `${root}/alpha` },
      { id: "group-b", name: "bravo", root: `${root}/bravo` },
    ];
    const cards = [
      { tab: "tab-a1", group: "group-a", cwd: `${root}/alpha`, x: 0, y: 0 },
      { tab: "tab-b1", group: "group-b", cwd: `${root}/bravo`, x: 700, y: 0 },
      { tab: "tab-a2", group: "group-a", cwd: `${root}/alpha`, x: 0, y: 500 },
    ];
    const groups = projects.map((project) => ({
      id: project.id,
      name: project.name,
      color: "#7aa2f7",
      emoji: project.name === "alpha" ? "A" : "B",
      projectRoot: project.root,
    }));
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
        primarySidebarCollapsed: false,
        canvasSidebarSortMode: "project",
      },
      groups,
      terminalGroups: groups,
      tabs: cards.map((card) => ({
        id: card.tab,
        title: card.tab,
        emoji: "[]",
        color: "#7aa2f7",
        groupId: card.group,
        initialCwd: card.cwd,
        terminals: [{ id: `pty-${card.tab}`, paneId: `pane-${card.tab}`, cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: `pane-${card.tab}`, type: "terminal" },
        activePaneId: `pane-${card.tab}`,
        // tab-a2 is a helper started by tab-a1, in the same folder (the freelance-desk case).
        ...(card.tab === "tab-a2"
          ? {
              childOf: { parentPaneId: "terminal-p-pane-tab-a1", parentTabId: "tab-a1", requestId: "request-12345678" },
              earlierSessions: [{ ptyIds: [], title: "old", endedAt: 1 }],
            }
          : {}),
      })),
      activeTabId: "tab-a1",
      liveCwds: {},
      canvasState: {
        selectedNodeId: "node-tab-a1",
        selectedNodeIds: ["node-tab-a1"],
        viewport: { x: 40, y: 40, zoom: 0.5 },
        nodes: cards.map((card) => ({
          id: `node-${card.tab}`,
          type: "terminal",
          title: card.tab,
          terminalTabId: card.tab,
          terminalCwd: card.cwd,
          x: card.x,
          y: card.y,
          width: 600,
          height: 420,
        })),
      },
    });
    store.getState().setWorkspaceMode("canvas");
  });

  const list = page.getByTestId("map-node-list");
  await expect(list).toContainText("bravo");
  const rows = list.getByText(/Idle · SHELL/);
  await expect(rows).toHaveCount(3);

  const snapshot = () =>
    page.evaluate(() => {
      const store = (window as typeof window & {
        __termfleetWorkspaceStore?: {
          getState: () => {
            tabs: Array<{ id: string; groupId: string | null }>;
            canvasState: { viewport: unknown; nodes: Array<{ id: string; x: number; y: number }> };
          };
        };
      }).__termfleetWorkspaceStore;
      const state = store?.getState();
      return {
        nodes: state?.canvasState.nodes.map(({ id, x, y }) => ({ id, x, y })),
        viewport: state?.canvasState.viewport,
        groups: state?.tabs.map(({ id, groupId }) => ({ id, groupId })),
      };
    });

  const before = await snapshot();
  const listBefore = await list.innerText();

  await rows.nth(2).click();
  await page.waitForTimeout(600);
  await rows.nth(1).click();
  await page.waitForTimeout(600);

  const active = () =>
    page.evaluate(() => {
      const state = (window as typeof window & {
        __termfleetWorkspaceStore?: {
          getState: () => { activeTabId: string | null; canvasState: { selectedNodeId: string | null } };
        };
      }).__termfleetWorkspaceStore?.getState();
      return { activeTabId: state?.activeTabId, selectedNodeId: state?.canvasState.selectedNodeId };
    });
  // The last click was on the helper (tab-a2): it, not its sibling, must be shown.
  expect(await active()).toEqual({ activeTabId: "tab-a2", selectedNodeId: "node-tab-a2" });
  await rows.nth(0).click();
  await page.waitForTimeout(600);
  expect(await active()).toEqual({ activeTabId: "tab-a1", selectedNodeId: "node-tab-a1" });
  await rows.nth(1).click();
  await page.waitForTimeout(600);
  expect(await active()).toEqual({ activeTabId: "tab-a2", selectedNodeId: "node-tab-a2" });
  // Cards and groups stay exactly where they were. The camera is allowed to move: a
  // click must bring the clicked terminal into view.
  const after = await snapshot();
  expect(after.nodes).toEqual(before.nodes);
  expect(after.groups).toEqual(before.groups);
  expect((await list.innerText()).replace(/\s+/g, " ")).toBe(listBefore.replace(/\s+/g, " "));
});
