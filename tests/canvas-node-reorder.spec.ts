import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// Regression coverage for the Map sidebar's manual drag-reorder: reorderCanvasNodes
// must move a node within canvasState.nodes (the array that drives sidebar order and
// persists), honor before/after placement, and never disturb a node's x/y map
// position. The sidebar renders nodes in array order, so this order IS the feature.
test("reorderCanvasNodes moves a node by id, honors before/after, and preserves x/y", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async () => null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");

    const node = (id: string, x: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: id,
      x,
      y: 7,
      width: 820,
      height: 460,
    });

    const seed = () =>
      useWorkspaceStore.setState({
        canvasState: {
          selectedNodeId: "a",
          selectedNodeIds: ["a"],
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [node("a", 10), node("b", 20), node("c", 30)],
        },
      });
    const order = () => useWorkspaceStore.getState().canvasState.nodes.map((n) => n.id);

    seed();
    // Move the first node to AFTER the last → a should land at the end.
    useWorkspaceStore.getState().reorderCanvasNodes("a", "c", "after");
    const movedToEnd = order();

    seed();
    // Move the last node BEFORE the first → c should land at the front.
    useWorkspaceStore.getState().reorderCanvasNodes("c", "a", "before");
    const movedToFront = order();
    const movedNodeXY = useWorkspaceStore
      .getState()
      .canvasState.nodes.find((n) => n.id === "c");

    seed();
    // Dropping onto itself is a no-op, not a corruption.
    useWorkspaceStore.getState().reorderCanvasNodes("b", "b", "before");
    const selfDrop = order();

    return {
      movedToEnd,
      movedToFront,
      movedNodeX: movedNodeXY?.x,
      movedNodeY: movedNodeXY?.y,
      selfDrop,
    };
  });

  expect(result.movedToEnd).toEqual(["b", "c", "a"]);
  expect(result.movedToFront).toEqual(["c", "a", "b"]);
  // x/y are independent spatial coordinates and must survive a list reorder.
  expect(result.movedNodeX).toBe(30);
  expect(result.movedNodeY).toBe(7);
  expect(result.selfDrop).toEqual(["a", "b", "c"]);
});
