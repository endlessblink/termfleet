import { expect, test, type Page } from "@playwright/test";

// The drawing board is the one map node that owns a pointer-driven editor, so
// the thing worth proving is that ink lands under the cursor at more than one
// map zoom — the classic failure when a drawing tool is dropped onto a
// CSS-scaled canvas — plus the zoomed-out still-image fallback.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function openMapWithBoard(page: Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    Object.keys(localStorage)
      .filter((key) => key.startsWith("termfleet.board."))
      .forEach((key) => localStorage.removeItem(key));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const rail = page
    .getByRole("complementary", { name: "Workspace sidebar" })
    .getByRole("navigation", { name: "Operations rail" });
  await rail.getByRole("button", { name: "Map" }).click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();

  await page.getByRole("button", { name: "Add drawing board" }).click();
  await expect(page.getByTestId("canvas-board-live")).toBeVisible();
  // The editor bundle and its fonts load on demand.
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
}

async function mapZoom(page: Page) {
  return page.evaluate(() => {
    const raw =
      localStorage.getItem("terminal-workspace.v1") ??
      localStorage.getItem("terminal-workspace.test");
    if (!raw) return 1;
    try {
      const parsed = JSON.parse(raw) as {
        canvasState?: { viewport?: { zoom?: number } };
      };
      return parsed?.canvasState?.viewport?.zoom ?? 1;
    } catch {
      return 1;
    }
  });
}

// The zoom buttons step by a fixed ratio, so asking for an exact zoom is
// fragile; step until the map is past the level the test cares about.
async function zoomUntil(
  page: Page,
  done: (zoom: number) => boolean,
  direction: "in" | "out",
) {
  // Scoped to the map's own controls: the editor ships its own zoom buttons
  // with the same labels.
  const button = page.locator(
    `.magic-canvas-button[aria-label="${direction === "in" ? "Zoom in" : "Zoom out"}"]`,
  );
  for (let step = 0; step < 30; step += 1) {
    const zoom = await mapZoom(page);
    if (done(zoom)) return zoom;
    await button.click();
    await page.waitForTimeout(120);
  }
  throw new Error(`map zoom never satisfied the ${direction} condition`);
}

// Drags a rectangle on the board and reports whether the interactive canvas has
// ink along the dragged edge, sampled through the canvas's own on-screen box so
// the check is genuinely "screen position in, drawn pixel out".
async function drawRectAndSampleEdge(page: Page) {
  // Excalidraw stacks a static and an interactive canvas; the interactive one
  // owns pointer events, so drive the mouse directly rather than via a locator.
  const canvas = page.locator(".excalidraw__canvas.interactive").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no board canvas box");

  // Stay in the middle of the board: the editor's tool island sits along the
  // top and its properties panel down the left, both of which would swallow
  // the drag.
  const startX = box.x + box.width * 0.4;
  const startY = box.y + box.height * 0.4;
  const endX = startX + box.width * 0.2;
  const endY = startY + box.height * 0.2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("r");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Sample the midpoint of the rectangle's top edge and compare it against an
  // untouched corner of the same board. The board has an opaque background, so
  // "is there ink here" is a colour difference, not an alpha test. Screen
  // coordinates are converted into canvas pixels through the canvas's own
  // on-screen box, which is exactly the mapping a mis-scaled editor gets wrong.
  return page.evaluate(
    ({ edge, away }) => {
      const element = document.querySelector<HTMLCanvasElement>(
        ".excalidraw__canvas.static",
      );
      const ctx = element?.getContext("2d");
      if (!element || !ctx) return { inkDifference: -1, backgroundNoise: -1 };
      const rect = element.getBoundingClientRect();
      const scaleX = element.width / rect.width;
      const scaleY = element.height / rect.height;

      const window7 = (clientX: number, clientY: number) => {
        const px = Math.round((clientX - rect.left) * scaleX);
        const py = Math.round((clientY - rect.top) * scaleY);
        return ctx.getImageData(Math.max(0, px - 3), Math.max(0, py - 3), 7, 7)
          .data;
      };

      const reference = window7(away.x, away.y);
      const refR = reference[0] ?? 0;
      const refG = reference[1] ?? 0;
      const refB = reference[2] ?? 0;
      const spread = (data: Uint8ClampedArray) => {
        let worst = 0;
        for (let i = 0; i < data.length; i += 4) {
          worst = Math.max(
            worst,
            Math.abs((data[i] ?? 0) - refR) +
              Math.abs((data[i + 1] ?? 0) - refG) +
              Math.abs((data[i + 2] ?? 0) - refB),
          );
        }
        return worst;
      };

      return {
        inkDifference: spread(window7(edge.x, edge.y)),
        backgroundNoise: spread(reference),
      };
    },
    {
      edge: { x: (startX + endX) / 2, y: startY },
      away: { x: box.x + box.width - 10, y: box.y + box.height - 10 },
    },
  );
}

test("drawing board puts ink under the cursor at 100% and 200% map zoom", async ({
  page,
}) => {
  await openMapWithBoard(page);

  const atOne = await drawRectAndSampleEdge(page);
  expect(atOne.backgroundNoise, "untouched board area is flat").toBeLessThan(
    12,
  );
  expect(
    atOne.inkDifference,
    "stroke drawn where the pointer dragged at 100%",
  ).toBeGreaterThan(40);

  const zoomedIn = await zoomUntil(page, (zoom) => zoom >= 1.8, "in");
  expect(zoomedIn).toBeGreaterThanOrEqual(1.8);
  await expect(page.getByTestId("canvas-board-live")).toBeVisible();
  await page.waitForTimeout(500);

  const atTwo = await drawRectAndSampleEdge(page);
  expect(
    atTwo.backgroundNoise,
    "untouched board area is flat zoomed in",
  ).toBeLessThan(12);
  expect(
    atTwo.inkDifference,
    "stroke drawn where the pointer dragged while zoomed in",
  ).toBeGreaterThan(40);
});

test("drawing board keeps ink under the cursor after the map is panned", async ({
  page,
}) => {
  await openMapWithBoard(page);

  // Pan the map with a middle-drag on empty canvas. This moves the board across
  // the screen without resizing it — the case where an embedded editor keeps
  // using stale screen offsets and puts every stroke in the wrong place.
  const shell = await page.locator("[data-magic-canvas-shell]").boundingBox();
  if (!shell) throw new Error("no map shell");
  await page.mouse.move(shell.x + 40, shell.y + shell.height - 60);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(shell.x + 200, shell.y + shell.height - 200, {
    steps: 10,
  });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(400);

  const afterPan = await drawRectAndSampleEdge(page);
  expect(
    afterPan.backgroundNoise,
    "untouched board area is flat after pan",
  ).toBeLessThan(12);
  expect(
    afterPan.inkDifference,
    "stroke drawn where the pointer dragged after panning the map",
  ).toBeGreaterThan(40);
});

test("drawing board keeps ink under the cursor after the node is dragged", async ({
  page,
}) => {
  await openMapWithBoard(page);

  // Dragging the card by its header moves the editor without resizing it — the
  // same stale-offset trap as panning, reached a different way.
  // The board's own header, not whichever card happens to be first on the map.
  const header = page.locator(
    'section:has([data-testid="canvas-board-live"]) [data-testid="canvas-node-header"]',
  );
  const handle = await header.boundingBox();
  if (!handle) throw new Error("no node header");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 120,
    handle.y + handle.height / 2 + 90,
    {
      steps: 10,
    },
  );
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterDrag = await drawRectAndSampleEdge(page);
  expect(
    afterDrag.backgroundNoise,
    "untouched board area is flat after drag",
  ).toBeLessThan(12);
  expect(
    afterDrag.inkDifference,
    "stroke drawn where the pointer dragged after moving the node",
  ).toBeGreaterThan(40);
});

test("drawing board keeps ink under the cursor after the card is resized", async ({
  page,
}) => {
  await openMapWithBoard(page);

  // Resizing is its own path: the board re-measures its box and re-lays out the
  // editor, which must stay in step with the pointer.
  const section = page.locator(
    'section:has([data-testid="canvas-board-live"])',
  );
  // Pull the card left first so its bottom-right corner — and the room to grow
  // into — stay inside the window.
  const header = section.locator('[data-testid="canvas-node-header"]');
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("no node header");
  await page.mouse.move(headerBox.x + 40, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox.x + 40 - 320,
    headerBox.y + headerBox.height / 2 - 40,
    {
      steps: 10,
    },
  );
  await page.mouse.up();
  await page.waitForTimeout(500);

  const canvasBefore = await page
    .locator(".excalidraw__canvas.interactive")
    .first()
    .boundingBox();
  if (!canvasBefore) throw new Error("no board canvas");
  await header.click();
  const handle = section.locator('[title="Resize SE"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no resize handle — is the board selected?");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 80,
    handleBox.y + handleBox.height / 2 + 60,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForTimeout(600);

  // The editor has to actually grow into the bigger card, not sit at its
  // original size inside it.
  const canvasAfter = await page
    .locator(".excalidraw__canvas.interactive")
    .first()
    .boundingBox();
  if (!canvasAfter) throw new Error("no board canvas after resize");
  expect(
    canvasAfter.width - canvasBefore.width,
    "editor widened with the card",
  ).toBeGreaterThan(50);

  const afterResize = await drawRectAndSampleEdge(page);
  expect(
    afterResize.backgroundNoise,
    "untouched board area is flat after resize",
  ).toBeLessThan(12);
  expect(
    afterResize.inkDifference,
    "stroke drawn where the pointer dragged after resizing the card",
  ).toBeGreaterThan(40);
});

test("a drawing survives a reload and shows in the zoomed-out preview", async ({
  page,
}) => {
  await openMapWithBoard(page);
  await drawRectAndSampleEdge(page);
  // Let the debounced save land before throwing the page away.
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  if (!(await page.locator("[data-magic-canvas-shell]").isVisible())) {
    await page
      .getByRole("complementary", { name: "Workspace sidebar" })
      .getByRole("navigation", { name: "Operations rail" })
      .getByRole("button", { name: "Map" })
      .click();
  }
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();

  // Zoomed out, the board must show the saved drawing as a picture rather than
  // the empty-board placeholder — which proves the drawing round-tripped
  // through storage and back into the UI, not just that a file was written.
  await zoomUntil(page, (zoom) => zoom < 0.9, "out");
  const preview = page.getByTestId("canvas-board-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toBeVisible();
});

test("dock opens a drawing board, and opens it ready to draw on", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const rail = page
    .getByRole("complementary", { name: "Workspace sidebar" })
    .getByRole("navigation", { name: "Operations rail" });
  const board = rail.getByRole("button", { name: "Drawing board" });
  await expect(board).toBeVisible();

  // From anywhere in the app, one click gets you a live board — no hunting for
  // the map first, and not the dead-looking still preview you get below 100%.
  await board.click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();
  await expect(page.getByTestId("canvas-board-live")).toBeVisible();
  await expect(
    page.locator(".excalidraw__canvas.interactive").first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  expect(
    await mapZoom(page),
    "opens at a zoom you can actually draw at",
  ).toBeGreaterThanOrEqual(1);

  // Clicking again must find the board it already made, not pile up new ones.
  await zoomUntil(page, (zoom) => zoom < 0.9, "out");
  await expect(page.getByTestId("canvas-board-preview")).toBeVisible();
  await board.click();
  await expect(page.getByTestId("canvas-board-live")).toBeVisible();
  const boardCount = await page.evaluate(() => {
    const raw =
      localStorage.getItem("terminal-workspace.v1") ??
      localStorage.getItem("terminal-workspace.test");
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed?.canvasState?.nodes ?? []).filter(
      (node: { type: string }) => node.type === "board",
    ).length;
  });
  expect(boardCount, "one board, not one per click").toBe(1);
});

test("drawing board wears the workbench skin, not the stock editor look", async ({
  page,
}) => {
  await openMapWithBoard(page);

  const skin = await page.evaluate(() => {
    const root = document.querySelector(".termfleet-board .excalidraw");
    if (!root) return null;
    const style = getComputedStyle(root);
    const value = (name: string) => style.getPropertyValue(name).trim();
    return {
      // The variable that paints every selected tool and swatch. Unskinned it
      // is the editor's indigo, the loudest thing on the map.
      selected: value("--color-surface-primary-container"),
      island: value("--island-bg-color"),
      // Full desktop layout, not the cramped phone one a narrow card triggers.
      mobile: root.classList.contains("excalidraw--mobile"),
      libraryTriggers: document.querySelectorAll(
        ".termfleet-board .excalidraw .sidebar-trigger",
      ).length,
    };
  });

  expect(skin, "board editor is mounted").not.toBeNull();
  // The workbench surfaces are dark; the stock indigo and white are not.
  expect(skin?.selected.toLowerCase()).toBe("#313841");
  expect(skin?.island.toLowerCase()).toBe("#20252a");
  expect(skin?.mobile, "board opens wide enough for the desktop layout").toBe(
    false,
  );

  // Cloud/onboarding chrome that does not apply to a local board.
  await expect(
    page.locator(".termfleet-board .excalidraw .help-icon"),
  ).toBeHidden();
  if (skin && skin.libraryTriggers > 0) {
    await expect(
      page.locator(".termfleet-board .excalidraw .sidebar-trigger").first(),
    ).toBeHidden();
  }
});

test("drawing board falls back to a still preview when the map zooms out", async ({
  page,
}) => {
  await openMapWithBoard(page);
  await drawRectAndSampleEdge(page);

  await zoomUntil(page, (zoom) => zoom < 0.9, "out");
  await expect(page.getByTestId("canvas-board-preview")).toBeVisible();
  await expect(page.getByTestId("canvas-board-live")).toHaveCount(0);

  // The drawing survives the round trip and comes back live on zoom in.
  await zoomUntil(page, (zoom) => zoom >= 1, "in");
  await expect(page.getByTestId("canvas-board-live")).toBeVisible();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const key = Object.keys(localStorage).find((entry) =>
            entry.startsWith("termfleet.board."),
          );
          if (!key) return "no-board-key";
          const doc = JSON.parse(localStorage.getItem(key) ?? "null") as {
            elements?: unknown[];
          } | null;
          return doc?.elements?.length ?? 0;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
});
