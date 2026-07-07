import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// Regression coverage for the Map sidebar's manual drag-reorder: reorderCanvasNodes
// must move a node within canvasState.nodes, honor before/after placement, and
// never disturb a node's x/y map position. Manual mode still uses this stored
// order; by-project mode derives display order from map coordinates.
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

test("by-project sidebar order follows canvas left-to-right then top-to-bottom without changing project membership", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { projectBucketsByCanvasPosition } = await import("/src/lib/mapNodeOrdering.ts");

    const groups = [
      { id: "termfleet", name: "TermFleet", color: "#7aa2f7", projectRoot: "/work/termfleet" },
      { id: "bots", name: "Bots", color: "#9ece6a", projectRoot: "/work/bots" },
      { id: "hermes", name: "Hermes", color: "#bb9af7", projectRoot: "/work/hermes" },
    ];
    const tabs = [
      { id: "tab-termfleet-top", title: "termfleet top", emoji: "x", color: "#fff", groupId: "termfleet", terminals: [], splitLayout: { id: "p1", type: "terminal" as const }, activePaneId: "p1" },
      { id: "tab-termfleet-low", title: "termfleet low", emoji: "x", color: "#fff", groupId: "termfleet", terminals: [], splitLayout: { id: "p2", type: "terminal" as const }, activePaneId: "p2" },
      { id: "tab-bots", title: "bots", emoji: "x", color: "#fff", groupId: "bots", terminals: [], splitLayout: { id: "p3", type: "terminal" as const }, activePaneId: "p3" },
      { id: "tab-hermes", title: "hermes", emoji: "x", color: "#fff", groupId: "hermes", terminals: [], splitLayout: { id: "p4", type: "terminal" as const }, activePaneId: "p4" },
    ];
    const node = (id: string, tabId: string, x: number, y: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
      x,
      y,
      width: 820,
      height: 460,
    });
    const nodes = [
      node("termfleet-low", "tab-termfleet-low", 420, 260),
      node("bots", "tab-bots", 40, 180),
      node("hermes", "tab-hermes", 260, 160),
      node("termfleet-top", "tab-termfleet-top", 420, 80),
    ];

    const firstPass = projectBucketsByCanvasPosition(nodes, tabs, groups).map((bucket) => ({
      label: bucket.label,
      nodeIds: bucket.nodes.map((n) => n.id),
    }));

    const movedNodes = nodes.map((n) => n.id === "termfleet-low" ? { ...n, x: 10, y: 320 } : n);
    const afterMove = projectBucketsByCanvasPosition(movedNodes, tabs, groups).map((bucket) => ({
      label: bucket.label,
      nodeIds: bucket.nodes.map((n) => n.id),
    }));

    return { firstPass, afterMove };
  });

  expect(result.firstPass).toEqual([
    { label: "Bots", nodeIds: ["bots"] },
    { label: "Hermes", nodeIds: ["hermes"] },
    { label: "TermFleet", nodeIds: ["termfleet-top", "termfleet-low"] },
  ]);
  expect(result.afterMove).toEqual([
    { label: "TermFleet", nodeIds: ["termfleet-low", "termfleet-top"] },
    { label: "Bots", nodeIds: ["bots"] },
    { label: "Hermes", nodeIds: ["hermes"] },
  ]);
});

test("canvas layout actions align, distribute, and arrange project terminals without changing order or viewport", async ({ page }) => {
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
            terminalNode("d", "tab-d", 900, 900, 100, 50),
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

    seed();
    useWorkspaceStore.getState().arrangeTerminalProjectLanes();
    const projectLanes = snapshot();

    return { aligned, distributed, projectRow, projectLanes };
  });

  expect(result.aligned.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.aligned.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.aligned.nodes.a.x).toBe(10);
  expect(result.aligned.nodes.b.x).toBe(10);
  expect(result.aligned.nodes.c.x).toBe(10);
  expect(result.aligned.nodes.d).toEqual({ x: 900, y: 900 });
  expect(result.aligned.nodes.note).toEqual({ x: 999, y: 888 });

  expect(result.distributed.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.distributed.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.distributed.nodes.a.x).toBe(10);
  expect(result.distributed.nodes.b.x).toBe(275);
  expect(result.distributed.nodes.c.x).toBe(520);
  expect(result.distributed.nodes.d).toEqual({ x: 900, y: 900 });

  expect(result.projectRow.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.projectRow.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.projectRow.nodes.a).toEqual({ x: 10, y: 100 });
  expect(result.projectRow.nodes.b).toEqual({ x: 142, y: 100 });
  expect(result.projectRow.nodes.c).toEqual({ x: 254, y: 100 });
  expect(result.projectRow.nodes.d).toEqual({ x: 900, y: 900 });

  expect(result.projectLanes.order).toEqual(["a", "b", "c", "d", "note"]);
  expect(result.projectLanes.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 });
  expect(result.projectLanes.nodes.a).toEqual({ x: 10, y: 100 });
  expect(result.projectLanes.nodes.b).toEqual({ x: 10, y: 190 });
  expect(result.projectLanes.nodes.c).toEqual({ x: 10, y: 280 });
  expect(result.projectLanes.nodes.d).toEqual({ x: 178, y: 100 });
  expect(result.projectLanes.nodes.note).toEqual({ x: 999, y: 888 });
});

test("visible compact lanes button closes horizontal gaps by current lane order", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  await page.evaluate(async () => {
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
    const terminalNode = (id: string, tabId: string, x: number, y: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
      x,
      y,
      width: 100,
      height: 50,
    });
    useWorkspaceStore.setState({
      tabs: [tab("tab-a", "project-a"), tab("tab-b", "project-a"), tab("tab-c", "project-b")],
      groups: [
        { id: "project-a", name: "Project A", color: "#7aa2f7", projectRoot: "/tmp/project-a" },
        { id: "project-b", name: "Project B", color: "#9ece6a", projectRoot: "/tmp/project-b" },
      ],
      activeTabId: "tab-a",
      workspaceUiState: {
        ...useWorkspaceStore.getState().workspaceUiState,
        workspaceMode: "canvas",
      },
      canvasState: {
        selectedNodeId: "a",
        selectedNodeIds: ["a"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          terminalNode("a", "tab-a", 1200, 260),
          terminalNode("b", "tab-b", 1220, 80),
          terminalNode("c", "tab-c", 10, 400),
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Compact terminal lanes" }).last().click();

  const nodes = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    return Object.fromEntries(
      useWorkspaceStore.getState().canvasState.nodes.map((node) => [node.id, { x: node.x, y: node.y }])
    );
  });

  expect(nodes).toEqual({
    a: { x: 158, y: 170 },
    b: { x: 158, y: 80 },
    c: { x: 10, y: 80 },
  });
});
