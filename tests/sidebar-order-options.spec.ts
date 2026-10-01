import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// The Manual list can be ordered by your own drag order, by latest use, or A-Z (TF-069).
test("the Manual list can sort by latest use and by name, and returns to your own order", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { setWorkspaceMode: (mode: string) => void; workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const root = "/media/endlessblink/data/my-projects/ai-development";
    // Own order: charlie, alpha, bravo (so it differs from A-Z).
    const names = ["charlie", "alpha", "bravo"];
    const groups = names.map((name) => ({ id: `g-${name}`, name, color: "#7aa2f7", emoji: name[0].toUpperCase(), projectRoot: `${root}/${name}` }));
    const tabs = names.map((name) => ({
      id: `t-${name}`,
      title: name,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: `g-${name}`,
      initialCwd: `${root}/${name}`,
      terminals: [{ id: `pty-${name}`, paneId: `pane-${name}`, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: `pane-${name}`, type: "terminal" },
      activePaneId: `pane-${name}`,
    }));
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
        primarySidebarCollapsed: false,
        canvasSidebarSortMode: "manual",
        canvasSidebarManualOrderBy: "custom",
        canvasSidebarManualOrder: names.map((name) => `node-${name}`),
      },
      groups,
      terminalGroups: groups,
      tabs,
      activeTabId: "t-charlie",
      liveCwds: {},
      canvasState: {
        selectedNodeId: "node-charlie",
        selectedNodeIds: ["node-charlie"],
        viewport: { x: 0, y: 0, zoom: 0.5 },
        nodes: names.map((name, index) => ({
          id: `node-${name}`,
          type: "terminal",
          title: name,
          terminalTabId: `t-${name}`,
          terminalCwd: `${root}/${name}`,
          x: index * 700,
          y: 0,
          width: 600,
          height: 400,
        })),
      },
    });
    store.getState().setWorkspaceMode("canvas");
  });

  const list = page.getByTestId("map-node-list");
  const rows = list.locator(".workspace-sidebar-row");
  const order = async () =>
    (await rows.allInnerTexts()).map(
      (text) => text.split("\n").map((line) => line.trim().toLowerCase()).find((line) => ["charlie", "alpha", "bravo"].includes(line)) ?? "?",
    );
  await expect(rows).toHaveCount(3);

  // The order buttons belong to Manual mode only.
  await expect(page.getByTestId("map-order-recent")).toBeVisible();
  await expect.poll(order).toEqual(["charlie", "alpha", "bravo"]);

  await page.getByTestId("map-order-name").click();
  await expect.poll(order).toEqual(["alpha", "bravo", "charlie"]);

  // Opening a card makes it the latest used, so it comes first.
  await page.getByTestId("map-order-recent").click();
  await rows.nth(1).click(); // bravo
  await page.waitForTimeout(300);
  await rows.nth(2).click(); // then charlie... whichever sits third
  await page.waitForTimeout(300);
  const afterClicks = await order();
  expect(afterClicks[0]).not.toBe("");
  const lastOpened = await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: { getState: () => { activeTabId: string | null } } }).__termfleetWorkspaceStore;
    return store?.getState().activeTabId;
  });
  expect(`t-${afterClicks[0]}`).toBe(lastOpened);

  // Back to your own order.
  await page.getByTestId("map-order-custom").click();
  await expect.poll(order).toEqual(["charlie", "alpha", "bravo"]);

  // By project has no manual order buttons.
  await page.getByTestId("map-sort-project").click();
  await expect(page.getByTestId("map-order-recent")).toHaveCount(0);
});
