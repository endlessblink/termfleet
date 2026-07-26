import { expect, test, type Page } from "@playwright/test";

// The map toolbar's whole point after the redesign is that it stops shouting:
// four labelled creation buttons, a collapse control that sticks, and the
// align/distribute controls hidden until a selection actually makes them usable.

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function openMap(page: Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.removeItem("termfleet.mapToolbar.open");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const rail = page
    .getByRole("complementary", { name: "Workspace sidebar" })
    .getByRole("navigation", { name: "Operations rail" });
  await rail.getByRole("button", { name: "Map" }).click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();
}

async function seedNotes(page: Page, selectedIds: string[]) {
  await page.evaluate(async (ids) => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const note = (id: string, x: number, y: number) => ({
      id,
      type: "note" as const,
      title: id,
      x,
      y,
      width: 200,
      height: 120,
    });
    useWorkspaceStore.setState({
      canvasState: {
        selectedNodeId: ids[0] ?? null,
        selectedNodeIds: ids,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          note("n1", 320, 320),
          note("n2", 620, 380),
          note("n3", 900, 300),
        ],
      },
    });
  }, selectedIds);
  await page.waitForTimeout(250);
}

test("creation buttons are labelled, not bare glyphs", async ({ page }) => {
  await openMap(page);
  for (const label of ["Board", "Note", "Terminal", "File"]) {
    await expect(
      page.locator(".magic-canvas-button", { hasText: label }).first(),
    ).toBeVisible();
  }
});

test("the toolbar collapses to a Map chip and remembers it", async ({
  page,
}) => {
  await openMap(page);
  await expect(
    page.locator(".magic-canvas-button", { hasText: "Board" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Hide map tools" }).click();
  await expect(
    page.locator(".magic-canvas-button", { hasText: "Board" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show map tools" }),
  ).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: "Show map tools" }),
  ).toBeVisible();
  await expect(
    page.locator(".magic-canvas-button", { hasText: "Board" }),
  ).toHaveCount(0);
});

test("align controls stay hidden until 2+ nodes are selected", async ({
  page,
}) => {
  await openMap(page);
  const bar = page.getByRole("toolbar", { name: "Arrange selected items" });

  await seedNotes(page, ["n1"]);
  await expect(bar).toHaveCount(0);

  await seedNotes(page, ["n1", "n2"]);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("2 selected");
  // Distribute needs three nodes, so it is absent rather than greyed out.
  await expect(
    bar.getByRole("button", { name: "Even out the gaps left to right" }),
  ).toHaveCount(0);

  await seedNotes(page, ["n1", "n2", "n3"]);
  await expect(bar).toContainText("3 selected");
  await expect(
    bar.getByRole("button", { name: "Even out the gaps left to right" }),
  ).toBeVisible();
});

test("align from the selection bar actually moves the nodes", async ({
  page,
}) => {
  await openMap(page);
  await seedNotes(page, ["n1", "n2", "n3"]);

  await page
    .getByRole("toolbar", { name: "Arrange selected items" })
    .getByRole("button", { name: "Line their top edges up" })
    .click();
  await page.waitForTimeout(250);

  const tops = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    return useWorkspaceStore.getState().canvasState.nodes.map((node) => node.y);
  });
  expect(new Set(tops).size).toBe(1);
});
