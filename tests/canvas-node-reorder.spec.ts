import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// Regression coverage for the Map sidebar's drag-reorder: it must change the
// persisted project order and rotate those terminals through their existing map slots.
test("sidebar reordering rotates terminal map slots inside one project", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const { orderCanvasNodesByManualOrder } = await import("/src/lib/mapNodeOrdering.ts");

    const node = (id: string, tabId: string, x: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
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
          nodes: [
            node("a", "tab-a", 10),
            node("b", "tab-b", 20),
            node("c", "tab-c", 30),
            node("other", "tab-other", 90),
          ],
        },
        tabs: [
          { id: "tab-a", groupId: "project-one", terminals: [] },
          { id: "tab-b", groupId: "project-one", terminals: [] },
          { id: "tab-c", groupId: "project-one", terminals: [] },
          { id: "tab-other", groupId: "project-two", terminals: [] },
        ],
        workspaceUiState: {
          ...useWorkspaceStore.getState().workspaceUiState,
          canvasSidebarManualOrder: [],
        },
      });
    const canvasOrder = () =>
      useWorkspaceStore.getState().canvasState.nodes.map((n) => n.id);
    const sidebarOrder = () => {
      const state = useWorkspaceStore.getState();
      return orderCanvasNodesByManualOrder(
        state.canvasState.nodes,
        state.workspaceUiState.canvasSidebarManualOrder,
      ).map((node) => node.id);
    };

    seed();
    // Move the first row after the last. B, C, A inherit A, B, C's prior slots.
    useWorkspaceStore.getState().reorderCanvasSidebarNodes("a", "c", "after");
    const movedToEnd = sidebarOrder();
    const mapOrderAfterEndMove = canvasOrder();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const persisted = JSON.parse(
      localStorage.getItem("terminal-workspace.v1") ?? "{}",
    );
    const persistedManualOrder = persisted.workspaceUiState?.canvasSidebarManualOrder;
    const persistedPositions = persisted.canvasState?.nodes.map(
      ({ id, x, y }: { id: string; x: number; y: number }) => ({ id, x, y }),
    );

    const beforeCrossProjectDrop = JSON.stringify(useWorkspaceStore.getState().canvasState);
    useWorkspaceStore.getState().reorderCanvasSidebarNodes("a", "other", "before");
    const afterCrossProjectDrop = JSON.stringify(useWorkspaceStore.getState().canvasState);
    const orderAfterCrossProjectDrop = sidebarOrder();

    seed();
    // Move the last sidebar row before the first.
    useWorkspaceStore.getState().reorderCanvasSidebarNodes("c", "a", "before");
    const movedToFront = sidebarOrder();
    const movedNodeXY = useWorkspaceStore
      .getState()
      .canvasState.nodes.find((n) => n.id === "c");

    seed();
    // Dropping onto itself is a no-op, not a corruption.
    useWorkspaceStore.getState().reorderCanvasSidebarNodes("b", "b", "before");
    const selfDrop = sidebarOrder();

    return {
      movedToEnd,
      mapOrderAfterEndMove,
      movedToFront,
      movedNodeX: movedNodeXY?.x,
      movedNodeY: movedNodeXY?.y,
      selfDrop,
      persistedManualOrder,
      persistedPositions,
      crossProjectDropWasNoop: beforeCrossProjectDrop === afterCrossProjectDrop,
      orderAfterCrossProjectDrop,
    };
  });

  expect(result.movedToEnd).toEqual(["b", "c", "a", "other"]);
  expect(result.mapOrderAfterEndMove).toEqual(["a", "b", "c", "other"]);
  expect(result.movedToFront).toEqual(["c", "a", "b", "other"]);
  // C moves into A's previous slot; the other project remains untouched.
  expect(result.movedNodeX).toBe(10);
  expect(result.movedNodeY).toBe(7);
  expect(result.selfDrop).toEqual(["a", "b", "c", "other"]);
  expect(result.persistedManualOrder).toEqual(["b", "c", "a", "other"]);
  expect(result.persistedPositions).toEqual([
    { id: "a", x: 30, y: 7 },
    { id: "b", x: 10, y: 7 },
    { id: "c", x: 20, y: 7 },
    { id: "other", x: 90, y: 7 },
  ]);
  expect(result.crossProjectDropWasNoop).toBe(true);
  expect(result.orderAfterCrossProjectDrop).toEqual(["b", "c", "a", "other"]);
});

test("by-project sidebar order stays put until the user moves a terminal", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { projectBucketsByManualOrder } =
      await import("/src/lib/mapNodeOrdering.ts");

    const groups = [
      {
        id: "termfleet",
        name: "TermFleet",
        color: "#7aa2f7",
        projectRoot: "/work/termfleet",
      },
      { id: "bots", name: "Bots", color: "#9ece6a", projectRoot: "/work/bots" },
      {
        id: "hermes",
        name: "Hermes",
        color: "#bb9af7",
        projectRoot: "/work/hermes",
      },
    ];
    const tabs = [
      {
        id: "tab-termfleet-top",
        title: "termfleet top",
        emoji: "x",
        color: "#fff",
        groupId: "termfleet",
        terminals: [],
        splitLayout: { id: "p1", type: "terminal" as const },
        activePaneId: "p1",
      },
      {
        id: "tab-termfleet-low",
        title: "termfleet low",
        emoji: "x",
        color: "#fff",
        groupId: "termfleet",
        terminals: [],
        splitLayout: { id: "p2", type: "terminal" as const },
        activePaneId: "p2",
      },
      {
        id: "tab-bots",
        title: "bots",
        emoji: "x",
        color: "#fff",
        groupId: "bots",
        terminals: [],
        splitLayout: { id: "p3", type: "terminal" as const },
        activePaneId: "p3",
      },
      {
        id: "tab-hermes",
        title: "hermes",
        emoji: "x",
        color: "#fff",
        groupId: "hermes",
        terminals: [],
        splitLayout: { id: "p4", type: "terminal" as const },
        activePaneId: "p4",
      },
    ];
    const node = (id: string, tabId: string, x: number, y: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
      x,
      y,
      width: 160,
      height: 460,
    });
    const nodes = [
      node("termfleet-low", "tab-termfleet-low", 20, 260),
      node("bots", "tab-bots", 460, 80),
      node("hermes", "tab-hermes", 250, 160),
      node("termfleet-top", "tab-termfleet-top", 40, 120),
    ];

    const manualOrder = ["termfleet-low", "termfleet-top", "bots", "hermes"];
    const flatten = (orderedNodes: typeof nodes, order: string[]) =>
      projectBucketsByManualOrder(orderedNodes, tabs, groups, order).flatMap(
        (bucket) => bucket.nodes.map((node) => node.id),
      );
    const firstPass = flatten(nodes, manualOrder);

    // Live status refreshes can update map node objects and map-only movement
    // can update coordinates. Neither is permission to move sidebar rows.
    const refreshedNodes = nodes.map((node) => ({
      ...node,
      x: node.id === "termfleet-low" ? 900 : node.x,
      y: node.id === "termfleet-low" ? 20 : node.y,
      title: `${node.title} refreshed`,
    }));
    const afterRefresh = flatten(refreshedNodes, manualOrder);

    // Only an explicit user reorder changes the persisted order.
    const afterUserMove = flatten(
      refreshedNodes,
      ["termfleet-top", "termfleet-low", "bots", "hermes"],
    );

    const buckets = projectBucketsByManualOrder(nodes, tabs, groups, manualOrder).map(
      (bucket) => ({
        label: bucket.label,
        nodeIds: bucket.nodes.map((n) => n.id),
      }),
    );

    return { firstPass, afterRefresh, afterUserMove, buckets };
  });

  expect(result.firstPass).toEqual(["termfleet-low", "termfleet-top", "bots", "hermes"]);
  expect(result.afterRefresh).toEqual(result.firstPass);
  expect(result.afterUserMove).toEqual(["termfleet-top", "termfleet-low", "bots", "hermes"]);
  expect(result.buckets).toEqual([
    { label: "TermFleet", nodeIds: ["termfleet-low", "termfleet-top"] },
    { label: "Bots", nodeIds: ["bots"] },
    { label: "Hermes", nodeIds: ["hermes"] },
  ]);
});

test("restart hydration tidies project lanes and reopens the map sorted by project", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const { projectBucketsByCanvasPosition } = await import("/src/lib/mapNodeOrdering.ts");
    const tab = (id: string, groupId: string, initialCwd: string) => ({
      id,
      title: id,
      emoji: "x",
      color: "#fff",
      groupId,
      initialCwd,
      terminals: [],
      splitLayout: { id: `${id}-pane`, type: "terminal" as const },
      activePaneId: `${id}-pane`,
    });
    const node = (id: string, tabId: string, x: number, y: number) => ({
      id,
      type: "terminal" as const,
      title: id,
      terminalTabId: tabId,
      x,
      y,
      width: 1180,
      height: 720,
    });

    useWorkspaceStore.setState({
      tabs: [tab("a", "project-a", "/a"), tab("b", "project-b", "/b"), tab("c", "project-a", "/a")],
      groups: [
        { id: "project-a", name: "Project A", color: "#fff", projectRoot: "/a" },
        { id: "project-b", name: "Project B", color: "#fff", projectRoot: "/b" },
      ],
      canvasState: {
        selectedNodeId: "a-node",
        selectedNodeIds: ["a-node"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          node("a-node", "a", 20, 500),
          node("b-node", "b", 800, 200),
          node("c-node", "c", 30, 1400),
        ],
      },
      workspaceUiState: {
        ...useWorkspaceStore.getState().workspaceUiState,
        canvasSidebarSortMode: "manual",
      },
    });

    useWorkspaceStore.getState().hydrateRestoredWorkspace({
      tabs: useWorkspaceStore.getState().tabs,
      activeTabId: "a",
    });
    const state = useWorkspaceStore.getState();
    state.removeCanvasNode("a-node");
    const remainingProjectOrder = projectBucketsByCanvasPosition(
      useWorkspaceStore.getState().canvasState.nodes,
      useWorkspaceStore.getState().tabs,
      useWorkspaceStore.getState().groups,
    ).map((bucket) => bucket.label);
    return {
      sortMode: state.workspaceUiState.canvasSidebarSortMode,
      positions: state.canvasState.nodes.map(({ id, x, y }) => ({ id, x, y })),
      remainingProjectOrder,
    };
  });

  expect(result.sortMode).toBe("project");
  expect(result.remainingProjectOrder).toEqual(["Project A", "Project B"]);
  expect(result.positions).toEqual([
    { id: "a-node", x: 20, y: 200 },
    { id: "b-node", x: 1248, y: 200 },
    { id: "c-node", x: 20, y: 960 },
  ]);
});

test("canvas layout actions align, distribute, and arrange project terminals without changing order or viewport", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
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
    const terminalNode = (
      id: string,
      tabId: string,
      x: number,
      y: number,
      width = 100,
      height = 50,
    ) => ({
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
        tabs: [
          tab("tab-a", "project-a"),
          tab("tab-b", "project-a"),
          tab("tab-c", "project-a"),
          tab("tab-d", "project-b"),
        ],
        groups: [
          {
            id: "project-a",
            name: "Project A",
            color: "#7aa2f7",
            projectRoot: "/tmp/project-a",
          },
          {
            id: "project-b",
            name: "Project B",
            color: "#9ece6a",
            projectRoot: "/tmp/project-b",
          },
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
          state.canvasState.nodes.map((node) => [
            node.id,
            { x: node.x, y: node.y },
          ]),
        ),
      };
    };

    seed();
    useWorkspaceStore.getState().alignCanvasNodes(["a", "b", "c"], "left");
    const aligned = snapshot();

    seed();
    useWorkspaceStore
      .getState()
      .distributeCanvasNodes(["a", "b", "c"], "horizontal");
    const distributed = snapshot();

    seed();
    useWorkspaceStore.getState().arrangeProjectRow("project-a");
    const projectRow = snapshot();

    seed();
    useWorkspaceStore.getState().arrangeCanvasProjectLanes();
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
  // The note overlaps project-b's terminal, so it joins that lane and is laid
  // out with it — tidy leaves no card behind and never stacks one on another.
  expect(result.projectLanes.nodes.note).toEqual({ x: 178, y: 100 });
  expect(result.projectLanes.nodes.d).toEqual({ x: 178, y: 220 });
});

test("visible compact lanes button closes horizontal gaps by current lane order", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  await page.evaluate(async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
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
      tabs: [
        tab("tab-a", "project-a"),
        tab("tab-b", "project-a"),
        tab("tab-c", "project-b"),
      ],
      groups: [
        {
          id: "project-a",
          name: "Project A",
          color: "#7aa2f7",
          projectRoot: "/tmp/project-a",
        },
        {
          id: "project-b",
          name: "Project B",
          color: "#9ece6a",
          projectRoot: "/tmp/project-b",
        },
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

  // Lane arranging now lives behind the toolbar's Tidy popover.
  await page
    .getByRole("button", { name: "Tidy everything on this map" })
    .click();
  await page
    .getByRole("menuitem", { name: "Group every card into project lanes" })
    .click();

  const nodes = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    return Object.fromEntries(
      useWorkspaceStore
        .getState()
        .canvasState.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
  });

  expect(nodes).toEqual({
    a: { x: 158, y: 170 },
    b: { x: 158, y: 80 },
    c: { x: 10, y: 80 },
  });
});
