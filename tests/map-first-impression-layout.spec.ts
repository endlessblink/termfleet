import { expect, test, type Page } from "@playwright/test";

// Two things a first-time user saw on the map (private first-run capture, 2026-09-24):
// the card list drawn twice side by side (TF-052) and a plain terminal card's
// action icons drawn on top of its Goal line (TF-053).

async function openMapWithOneTerminal(page: Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const store = (
      window as typeof window & {
        __termfleetWorkspaceStore?: {
          getState: () => { workspaceUiState: Record<string, unknown> };
          setState: (state: Record<string, unknown>) => void;
        };
      }
    ).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
        primarySidebarCollapsed: false,
      },
      tabs: [
        {
          id: "tab-home",
          title: "home",
          emoji: "🌻",
          color: "#7aa2f7",
          groupId: null,
          initialCwd: "/tmp/termfleet-home",
          terminals: [{ id: "pty-home", paneId: "pane-home", cols: 80, rows: 24, status: "running" }],
          splitLayout: { id: "pane-home", type: "terminal" },
          activePaneId: "pane-home",
        },
      ],
      activeTabId: "tab-home",
      canvasState: {
        nodes: [
          {
            id: "node-home",
            type: "terminal",
            title: "home",
            terminalTabId: "tab-home",
            x: 80,
            y: 80,
            width: 820,
            height: 460,
          },
        ],
        selectedNodeId: null,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });
  await expect(page.getByTestId("canvas-terminal-status-block")).toBeVisible();
}

test("the map shows its card list once, not twice side by side", async ({ page }) => {
  await openMapWithOneTerminal(page);
  // The left Map panel owns the list while it is open ...
  await expect(page.getByLabel("Operations panel")).toBeVisible();
  await expect(page.getByTestId("map-sort-project")).toHaveCount(1);
  await expect(page.getByTestId("canvas-sidebar-node-row")).toHaveCount(0);

  // ... and the map's own list returns when that panel is folded away.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByTestId("canvas-sidebar-node-row")).toHaveCount(1);
  await expect(page.getByTestId("map-sort-project")).toHaveCount(1);
});

test("a plain terminal card keeps its action icons off the Goal and Task lines", async ({ page }) => {
  await openMapWithOneTerminal(page);
  const actions = await page.getByTestId("canvas-terminal-card-actions").boundingBox();
  const block = await page.getByTestId("canvas-terminal-status-block").boundingBox();
  expect(actions).not.toBeNull();
  expect(block).not.toBeNull();
  // The icons sit in the header's top row, above the status block that holds Task and Goal.
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(block!.y + 1);
});
