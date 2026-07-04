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

test("canvas layout actions align, distribute, and row project terminals without changing order or viewport", async ({ page }) => {
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

    const tab = (id: string, groupId: string) => ({
      id,
      title: id,
      emoji: "\u2B1B",
      color: "#7aa2f7",
      groupId,
      terminals: [],
      splitLayout: { id: `${id}-pane`, type: "terminal" as const },
      activePaneId: `${id}-pane`,
    });
    const terminalNode = (id: string, tabId: string, x: number, y: number, width = 100, height = 50) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
      x,
      y,
      width,
      height,
    });
    const noteNode = {
      id: "note",
      type: "note" as const,
      title: "note",
      x: 999,
      y: 888,
      width: 120,
      height: 80,
    };

    const seed = () =>
      useWorkspaceStore.setState({
        tabs: [tab("tab-a", "project-a"), tab("tab-b", "project-a"), tab("tab-c", "project-a"), tab("tab-d", "project-b")],
        groups: [
          { id: "project-a", name: "Project A", color: "#7aa2f7", projectRoot: "/tmp/project-a" },
          { id: "project-b", name: "Project B", color: "#9ece6a", projectRoot: "/tmp/project-b" },
        ],
        activeTabId: "tab-a",
        canvasState: {
          selectedNodeId: "a",
          selectedNodeIds: ["a", "b", "c"],
          viewport: { x: 12, y: 34, zoom: 0.75 },
          nodes: [
            terminalNode("a", "tab-a", 10, 100, 100, 50),
            terminalNode("b", "tab-b", 260, 200, 80, 50),
            terminalNode("c", "tab-c", 520, 300, 120, 50),
            terminalNode("d", "tab-d", 50, 900, 100, 50),
            noteNode,
          ],
        },
      });
    const snapshot = () => {
      const state = useWorkspaceStore.getState();
      return {
        order: state.canvasState.nodes.map((node) => node.id),
        viewport: state.canvasState.viewport,
        nodes: Object.fromEntries(
          state.canvasState.nodes.map((node) => [node.id, { x: node.x, y: node.y }])
        ),
      };
    };

    seed();
    useWorkspaceStore.getState().alignCanvasNodes(["a", "b", "c"], "left");
    const aligned = snapshot();

    seed();
    useWorkspaceStore.getState().distributeCanvasNodes(["a", "b", "c"], "horizontal");
    const distributed = snapshot();

    seed();
    useWorkspaceStore.getState().arrangeProjectTerminalRow("project-a");
    const projectRow = snapshot();

    return { aligned, distributed, projectRow };
  });

  expect(result.aligned.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.aligned.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.aligned.nodes.a.x).toBe(10);
  expect(result.aligned.nodes.b.x).toBe(10);
  expect(result.aligned.nodes.c.x).toBe(10);
  expect(result.aligned.nodes.d).toEqual({ x: 50, y: 900 });
  expect(result.aligned.nodes.note).toEqual({ x: 999, y: 888 });

  expect(result.distributed.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.distributed.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.distributed.nodes.a.x).toBe(10);
  expect(result.distributed.nodes.b.x).toBe(275);
  expect(result.distributed.nodes.c.x).toBe(520);
  expect(result.distributed.nodes.d).toEqual({ x: 50, y: 900 });

  expect(result.projectRow.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.projectRow.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.projectRow.nodes.a).toEqual({ x: 10, y: 100 });
  expect(result.projectRow.nodes.b).toEqual({ x: 142, y: 100 });
  expect(result.projectRow.nodes.c).toEqual({ x: 254, y: 100 });
  expect(result.projectRow.nodes.d).toEqual({ x: 50, y: 900 });
});
