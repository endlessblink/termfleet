import { expect, test, type Page } from "@playwright/test";

// The top-left of the map holds one label per project on the map; the map
// tools sit on the right. Clicking a label moves the map onto that project's
// cards and tells the side list to jump to the same project.

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function openSeededMap(page: Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("complementary", { name: "Workspace sidebar" })
    .getByRole("navigation", { name: "Operations rail" })
    .getByRole("button", { name: "Map" })
    .click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const note = (id: string, tabId: string, x: number, y: number) => ({
      id,
      type: "note" as const,
      title: id,
      x,
      y,
      width: 300,
      height: 180,
      terminalTabId: tabId,
    });
    useWorkspaceStore.setState({
      groups: [
        { id: "alpha", name: "Alpha", color: "#fff", projectRoot: "/a" },
        { id: "beta", name: "Beta", color: "#fff", projectRoot: "/b" },
      ],
      canvasState: {
        selectedNodeId: null,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          note("a1", "tab-a", 100, 200),
          note("a2", "tab-a", 500, 200),
          note("b1", "tab-b", 4000, 3000),
        ],
      },
    });
    const state = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      tabs: [
        ...state.tabs,
        { ...state.tabs[0], id: "tab-a", groupId: "alpha", terminals: [] },
        { ...state.tabs[0], id: "tab-b", groupId: "beta", terminals: [] },
      ],
    });
  });
  await page.waitForTimeout(250);
}

test("project labels sit left, map tools sit right", async ({ page }) => {
  await openSeededMap(page);
  const strip = page.getByTestId("map-project-strip");
  await expect(strip).toBeVisible();
  const chips = page.getByTestId("map-project-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("Alpha");
  await expect(chips.nth(1)).toContainText("Beta");

  const stripBox = await strip.boundingBox();
  const toolbarBox = await page.locator(".magic-canvas-toolbar").boundingBox();
  expect(stripBox && toolbarBox).toBeTruthy();
  expect(stripBox!.x + stripBox!.width).toBeLessThan(toolbarBox!.x);
  await page.screenshot({ path: "test-results/map-project-strip.png" });
});

test("clicking a label moves the map to that project", async ({ page }) => {
  await openSeededMap(page);
  await page.getByTestId("map-project-chip").filter({ hasText: "Beta" }).click();
  const view = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const state = useWorkspaceStore.getState();
    return {
      viewport: state.canvasState.viewport,
      sortMode: state.workspaceUiState.canvasSidebarSortMode,
    };
  });
  const shell = await page.locator("[data-magic-canvas-shell]").boundingBox();
  // Beta's card centre (4150, 3090) lands inside the visible map.
  const cx = 4150 * view.viewport.zoom + view.viewport.x;
  const cy = 3090 * view.viewport.zoom + view.viewport.y;
  expect(cx).toBeGreaterThan(0);
  expect(cx).toBeLessThan(shell!.width);
  expect(cy).toBeGreaterThan(0);
  expect(cy).toBeLessThan(shell!.height);
  expect(view.sortMode).toBe("project");
});

test("many projects: each has its own emoji and the strip side-scrolls", async ({
  page,
}) => {
  await openSeededMap(page);
  // Let the app's own startup settle before replacing the map contents.
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const state = useWorkspaceStore.getState();
    const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
    useWorkspaceStore.setState({
      groups: names.map((name) => ({ id: name, name, color: "#fff", projectRoot: `/${name}` })),
      tabs: [
        ...state.tabs,
        ...names.map((name) => ({ ...state.tabs[0], id: `tab-${name}`, groupId: name, terminals: [] })),
      ],
      canvasState: {
        ...state.canvasState,
        nodes: names.map((name, index) => ({
          id: `n-${name}`,
          type: "note" as const,
          title: name,
          x: index * 400,
          y: 200,
          width: 300,
          height: 180,
          terminalTabId: `tab-${name}`,
        })),
      },
    });
  });
  const strip = page.getByTestId("map-project-strip");
  await expect
    .poll(() =>
      strip.evaluate((el) => {
        const emojis = [...el.querySelectorAll("[data-testid=map-project-chip] span[aria-hidden]")].map(
          (span) => span.textContent ?? "",
        );
        return {
          chips: emojis.length,
          distinct: new Set(emojis.filter(Boolean)).size,
          narrow: el.clientWidth <= 640,
          overflows: el.scrollWidth > el.clientWidth,
        };
      }),
    )
    .toEqual({ chips: 10, distinct: 10, narrow: true, overflows: true });

  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/map-project-strip-many.png", clip: { x: 300, y: 50, width: 1140, height: 60 } });
});
