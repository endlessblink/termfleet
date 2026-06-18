import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("map terminal rendering avoids pixelated live canvases and grouped preview DOM churn", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const ReactDom = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { TerminalCanvas } = await import("/src/components/TerminalCanvas.tsx");
    const { snapshotPreviewRows } = await import("/src/lib/snapshotPreviewRows.ts");
    const React = ReactModule.default ?? ReactModule;

    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "360px";
    document.body.appendChild(host);

    const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot;
    const root = createRoot(host);
    root.render(
      React.createElement(TerminalCanvas, {
        sessionId: "visual-regression",
        renderScale: 2,
        cols: 80,
        rows: 24,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvasStyles = Array.from(host.querySelectorAll("canvas")).map((canvas) => {
      const element = canvas as HTMLCanvasElement;
      return {
        inline: element.style.imageRendering,
        computed: getComputedStyle(element).imageRendering,
      };
    });
    root.unmount();

    const magenta = { c: "[", fg: "#ff00ff", bg: "#000000" };
    const green = { c: "=", fg: "#00ff00", bg: "#000000" };
    const blank = { c: " ", fg: "#d0d0d0", bg: "#000000" };
    const row = [
      ...Array.from({ length: 24 }, () => ({ ...magenta })),
      ...Array.from({ length: 44 }, () => ({ ...green })),
      ...Array.from({ length: 28 }, () => ({ ...blank })),
    ];
    const snapshot = {
      cols: row.length,
      rows: 1,
      cursor: { col: 0, line: 0 },
      cursorVisible: false,
      altScreen: false,
      cells: [row],
    };

    const rows = snapshotPreviewRows(snapshot, 1, 96);
    return {
      canvasStyles,
      segmentCount: rows[0].segments.length,
      segmentText: rows[0].segments.map((segment) => segment.text).join(""),
    };
  });

  expect(result.canvasStyles).toHaveLength(2);
  for (const style of result.canvasStyles) {
    expect(style.inline).toBe("auto");
    expect(style.computed).not.toBe("pixelated");
  }

  expect(result.segmentCount).toBeLessThan(8);
  expect(result.segmentText.length).toBe(96);
});

test("overview preview sampling is capped and groups noisy terminal rows", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { snapshotPreviewRows } = await import("/src/lib/snapshotPreviewRows.ts");

    const colors = ["#ff00ff", "#00ff00", "#00d0ff", "#d0d0d0"];
    const cells = Array.from({ length: 120 }, (_, rowIndex) =>
      Array.from({ length: 180 }, (_, colIndex) => {
        const block = Math.floor(colIndex / 12);
        const active = block % 3 !== 2;
        return {
          c: active ? String.fromCharCode(65 + ((rowIndex + block) % 26)) : " ",
          fg: colors[block % colors.length],
          bg: "#000000",
        };
      }),
    );

    const rows = snapshotPreviewRows({
      cols: 180,
      rows: 120,
      cursor: { col: 0, line: 0 },
      cursorVisible: false,
      altScreen: false,
      cells,
    });

    const segmentCounts = rows.map((row) => row.segments.length);
    const visibleChars = rows.map((row) =>
      row.segments.reduce((total, segment) => total + segment.text.length, 0),
    );

    return {
      rowCount: rows.length,
      maxSegments: Math.max(...segmentCounts),
      maxVisibleChars: Math.max(...visibleChars),
      totalSegments: segmentCounts.reduce((total, count) => total + count, 0),
    };
  });

  expect(result.rowCount).toBeLessThanOrEqual(14);
  expect(result.maxVisibleChars).toBeLessThanOrEqual(72);
  expect(result.maxSegments).toBeLessThanOrEqual(18);
  expect(result.totalSegments).toBeLessThan(14 * 72);
});

test("terminal map labels can be recolored from the right-click menu", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs: [{
        id: "tab-color",
        title: "Build release lane",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-color",
        terminals: [{ id: "pty-color", paneId: "pane-color", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-color", type: "terminal" },
        activePaneId: "pane-color",
      }],
      activeTabId: "tab-color",
      canvasState: {
        nodes: [{
          id: "node-color",
          type: "terminal",
          title: "Build release lane",
          terminalTabId: "tab-color",
          x: 100,
          y: 100,
          width: 820,
          height: 460,
        }],
        selectedNodeId: "node-color",
        selectedNodeIds: ["node-color"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.getByTestId("canvas-terminal-node-header-title").click({ button: "right" });
  await page.getByRole("menu", { name: "Terminal label color" }).getByRole("menuitem", { name: "Set terminal label color Amber" }).click();
  await expect(page.getByTestId("canvas-terminal-status-block")).toHaveCSS("border-left-color", "rgb(212, 164, 79)");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { nodes: Array<{ id: string; labelColor?: string }> } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.nodes.find((node) => node.id === "node-color")?.labelColor;
  })).toBe("#d4a44f");
});

test("selection mode box-selects terminals and drags the selected group", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const terminalTab = (id: string, title: string) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: `/tmp/${id}`,
      terminals: [{ id: `pty-${id}`, paneId: `pane-${id}`, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: `pane-${id}`, type: "terminal" },
      activePaneId: `pane-${id}`,
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs: [
        terminalTab("tab-one", "Build one"),
        terminalTab("tab-two", "Build two"),
        terminalTab("tab-three", "Build three"),
      ],
      activeTabId: "tab-one",
      canvasState: {
        nodes: [
          { id: "node-one", type: "terminal", title: "Build one", terminalTabId: "tab-one", x: 40, y: 80, width: 820, height: 460 },
          { id: "node-two", type: "terminal", title: "Build two", terminalTabId: "tab-two", x: 920, y: 80, width: 820, height: 460 },
          { id: "node-three", type: "terminal", title: "Build three", terminalTabId: "tab-three", x: 1840, y: 80, width: 820, height: 460 },
        ],
        selectedNodeId: null,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.getByRole("button", { name: "Select terminals" }).click();
  const shellBox = await page.locator("[data-magic-canvas-shell]").boundingBox();
  if (!shellBox) throw new Error("Map shell not found");

  await page.mouse.move(shellBox.x + 20, shellBox.y + 650);
  await page.mouse.down();
  await page.mouse.move(shellBox.x + 1780, shellBox.y + 40, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeIds?: string[] } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.selectedNodeIds?.sort().join(",");
  })).toBe("node-one,node-two");

  const firstNode = page.locator("[data-magic-canvas-shell] [data-testid='canvas-terminal-node-header']").filter({ hasText: "Build two" });
  const firstBox = await firstNode.boundingBox();
  if (!firstBox) throw new Error("Selected node header not found");
  await page.mouse.move(firstBox.x + 24, firstBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 140, firstBox.y + 54, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { nodes: Array<{ id: string; x: number; y: number }> } };
      };
    }).__termfleetWorkspaceStore;
    const nodes = store?.getState().canvasState.nodes ?? [];
    return nodes.map((node) => `${node.id}:${node.x}:${node.y}`).sort().join("|");
  })).toBe("node-one:156:116|node-three:1840:80|node-two:1036:116");
});

test("map remains lightweight with more than 100 terminal nodes at overview zoom", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const tabs = Array.from({ length: 120 }, (_, index) => ({
      id: `tab-${index}`,
      title: `Fleet ${index + 1}`,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: `/tmp/fleet-${index}`,
      terminals: [{ id: `pty-${index}`, paneId: `pane-${index}`, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: `pane-${index}`, type: "terminal" },
      activePaneId: `pane-${index}`,
    }));

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs,
      activeTabId: "tab-0",
      canvasState: {
        nodes: tabs.map((tab, index) => ({
          id: `node-${index}`,
          type: "terminal",
          title: tab.title,
          terminalTabId: tab.id,
          x: (index % 12) * 860,
          y: Math.floor(index / 12) * 500,
          width: 820,
          height: 460,
        })),
        selectedNodeId: "node-0",
        selectedNodeIds: ["node-0"],
        viewport: { x: 0, y: 0, zoom: 0.45 },
      },
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveCount(120);
  await expect(page.locator(".terminal-container")).toHaveCount(0);
});

test("selected default-size map terminal keeps a usable live viewport before resize", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs: [{
        id: "tab-live-default",
        title: "Default live terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-live-default",
        terminals: [{ id: "pty-live-default", paneId: "pane-live-default", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-live-default", type: "terminal" },
        activePaneId: "pane-live-default",
      }],
      activeTabId: "tab-live-default",
      canvasState: {
        nodes: [{
          id: "node-live-default",
          type: "terminal",
          title: "Default live terminal",
          terminalTabId: "tab-live-default",
          x: 80,
          y: 80,
          width: 820,
          height: 460,
        }],
        selectedNodeId: "node-live-default",
        selectedNodeIds: ["node-live-default"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await expect(page.locator("[data-testid='canvas-terminal-node'] .terminal-container")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const container = document.querySelector("[data-testid='canvas-terminal-node'] .terminal-container");
    const terminalShell = document.querySelector("[data-testid='canvas-terminal-node'] .terminal-block-shell");
    const xtermScreen = document.querySelector("[data-testid='canvas-terminal-node'] .xterm-screen");
    const containerRect = container?.getBoundingClientRect();
    const shellRect = terminalShell?.getBoundingClientRect();
    const screenRect = xtermScreen?.getBoundingClientRect();
    return {
      containerHeight: Math.round(containerRect?.height ?? 0),
      shellHeight: Math.round(shellRect?.height ?? 0),
      screenHeight: Math.round(screenRect?.height ?? 0),
    };
  })).toMatchObject({
    containerHeight: expect.any(Number),
    shellHeight: expect.any(Number),
    screenHeight: expect.any(Number),
  });

  const dimensions = await page.evaluate(() => {
    const container = document.querySelector("[data-testid='canvas-terminal-node'] .terminal-container");
    const terminalShell = document.querySelector("[data-testid='canvas-terminal-node'] .terminal-block-shell");
    const xtermScreen = document.querySelector("[data-testid='canvas-terminal-node'] .xterm-screen");
    return {
      containerHeight: Math.round(container?.getBoundingClientRect().height ?? 0),
      shellHeight: Math.round(terminalShell?.getBoundingClientRect().height ?? 0),
      screenHeight: Math.round(xtermScreen?.getBoundingClientRect().height ?? 0),
    };
  });
  expect(dimensions.containerHeight).toBeGreaterThanOrEqual(260);
  expect(dimensions.shellHeight).toBeGreaterThanOrEqual(260);
  expect(dimensions.screenHeight).toBeGreaterThanOrEqual(220);
});

test("status bar summarizes durable terminal recovery states", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const terminalTab = (id: string, status: string, title = "Terminal") => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: `/tmp/${id}`,
      terminals: [{
        id: `pty-${id}`,
        paneId: `pane-${id}`,
        cols: 80,
        rows: 24,
        status,
        lastError: status === "failed" ? "daemon write failed" : undefined,
      }],
      splitLayout: { id: `pane-${id}`, type: "terminal" },
      activePaneId: `pane-${id}`,
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "split",
        primarySidebarCollapsed: false,
        primarySidebarPanel: "sessions",
      },
      tabs: [
        terminalTab("running", "running", "Running shell"),
        terminalTab("reconnected", "reconnected", "Restored shell"),
        terminalTab("stale", "stale", "Stale shell"),
        terminalTab("failed", "failed", "Failed shell"),
        terminalTab("exited", "exited", "Closed shell"),
      ],
      activeTabId: "running",
      activeTerminalId: "pty-running",
    });
  });

  await expect(page.getByTestId("statusbar-recovery-summary")).toContainText("1 reconnected");
  await expect(page.getByTestId("statusbar-recovery-summary")).toContainText("1 stale");
  await expect(page.getByTestId("statusbar-recovery-summary")).toContainText("1 failed");
  await expect(page.getByTestId("statusbar-recovery-summary")).toContainText("1 exited");
  await expect(page.getByText("2 ptys")).toBeVisible();
});

test("map notes can be edited without dragging the canvas", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.getByLabel("Add note").click();
  const editor = page.getByTestId("canvas-note-editor").last();
  await editor.fill("Check failing build, capture blocker, then re-run proof.");
  await expect(editor).toHaveValue("Check failing build, capture blocker, then re-run proof.");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: {
            viewport: { x: number; y: number };
            nodes: Array<{ type: string; title: string; content?: string }>;
          };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    const note = state?.nodes.find((candidate) => candidate.type === "note" && candidate.title === "Run note");
    return note ? `${state?.viewport.x}:${state?.viewport.y}:${note.content}` : null;
  })).toBe("0:0:Check failing build, capture blocker, then re-run proof.");
});

test("workspace store supports multi-select canvas movement and label colors", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeTabId: string | null;
          canvasState: {
            selectedNodeId: string | null;
            selectedNodeIds?: string[];
            nodes: Array<{ id: string; type: string; title: string; x: number; y: number; labelColor?: string; terminalTabId?: string }>;
          };
          addCanvasNode: (node: { id: string; type: string; title: string; x: number; y: number; width: number; height: number; labelColor?: string; terminalTabId?: string }) => void;
          selectCanvasNodes: (ids: string[]) => void;
          moveCanvasNodes: (ids: string[], delta: { x: number; y: number }) => void;
          removeCanvasNode: (id: string) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    state.addCanvasNode({
      id: "node-a",
      type: "note",
      title: "A",
      x: 10,
      y: 20,
      width: 220,
      height: 120,
      labelColor: "#7dbac3",
    });
    state.addCanvasNode({
      id: "node-b",
      type: "terminal",
      title: "B",
      x: 100,
      y: 200,
      width: 820,
      height: 460,
      terminalTabId: "missing-tab",
      labelColor: "#d4a44f",
    });
    state.selectCanvasNodes(["node-b", "node-a", "missing-node"]);
    state.moveCanvasNodes(["node-a", "node-b"], { x: 3.4, y: -2.6 });
    const moved = store.getState().canvasState;
    state.removeCanvasNode("node-b");
    const afterRemove = store.getState().canvasState;
    return {
      selectedNodeId: moved.selectedNodeId,
      selectedNodeIds: moved.selectedNodeIds,
      nodes: moved.nodes
        .filter((node) => node.id === "node-a" || node.id === "node-b")
        .map((node) => ({ id: node.id, x: node.x, y: node.y, labelColor: node.labelColor })),
      afterRemoveSelectedNodeId: afterRemove.selectedNodeId,
      afterRemoveSelectedNodeIds: afterRemove.selectedNodeIds,
    };
  });

  expect(result.selectedNodeId).toBe("node-b");
  expect(result.selectedNodeIds).toEqual(["node-b", "node-a"]);
  expect(result.nodes).toEqual(expect.arrayContaining([
    { id: "node-a", x: 13, y: 17, labelColor: "#7dbac3" },
    { id: "node-b", x: 103, y: 197, labelColor: "#d4a44f" },
  ]));
  expect(result.afterRemoveSelectedNodeId).toBe("node-a");
  expect(result.afterRemoveSelectedNodeIds).toEqual(["node-a"]);
});

test("Ctrl+Z restores the last closed terminal map session from app chrome", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(async () => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          closeTerminalSession: (id: string) => Promise<void>;
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs: [{
        id: "tab-undo",
        title: "Undo build",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/undo-build",
        terminals: [{ id: "pty-undo", paneId: "pane-undo", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-undo", type: "terminal", cwd: "/tmp/undo-build" },
        activePaneId: "pane-undo",
      }],
      activeTabId: "tab-undo",
      activeTerminalId: "pty-undo",
      canvasState: {
        nodes: [{
          id: "node-undo",
          type: "terminal",
          title: "Undo build",
          terminalTabId: "tab-undo",
          terminalCwd: "/tmp/undo-build",
          x: 320,
          y: 180,
          width: 820,
          height: 460,
          labelColor: "#d4a44f",
          taskBinding: { taskId: "TC-029", planPath: "MASTER_PLAN.md" },
        }],
        selectedNodeId: "node-undo",
        selectedNodeIds: ["node-undo"],
        viewport: { x: 12, y: 24, zoom: 0.8 },
      },
    });

    await store.getState().closeTerminalSession("tab-undo");
  });

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string }>;
          canvasState: { nodes: Array<{ id: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return `${state?.tabs.some((tab) => tab.id === "tab-undo")}:${state?.canvasState.nodes.some((node) => node.id === "node-undo")}`;
  })).toBe("false:false");

  await page.evaluate(async () => {
    const { TERMINAL_INPUT_CLASS } = await import("/src/lib/terminalFocus.ts");
    const input = document.createElement("textarea");
    input.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press("ControlOrMeta+Z");

  const restored = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeTabId: string | null;
          activeTerminalId: string | null;
          tabs: Array<{
            id: string;
            title: string;
            initialCwd?: string;
            terminals: Array<unknown>;
          }>;
          canvasState: {
            selectedNodeId: string | null;
            selectedNodeIds?: string[];
            nodes: Array<{
              id: string;
              terminalTabId?: string;
              x: number;
              y: number;
              labelColor?: string;
              taskBinding?: { taskId: string };
            }>;
          };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    const tab = state?.tabs.find((candidate) => candidate.id === "tab-undo");
    const node = state?.canvasState.nodes.find((candidate) => candidate.id === "node-undo");
    return {
      activeTabId: state?.activeTabId,
      activeTerminalId: state?.activeTerminalId,
      tab,
      node,
      selectedNodeId: state?.canvasState.selectedNodeId,
      selectedNodeIds: state?.canvasState.selectedNodeIds,
    };
  });

  expect(restored.activeTabId).toBe("tab-undo");
  expect(restored.activeTerminalId).toBeNull();
  expect(restored.tab).toMatchObject({
    id: "tab-undo",
    title: "Undo build",
    initialCwd: "/tmp/undo-build",
    terminals: [],
  });
  expect(restored.node).toMatchObject({
    id: "node-undo",
    terminalTabId: "tab-undo",
    x: 320,
    y: 180,
    labelColor: "#d4a44f",
    taskBinding: { taskId: "TC-029" },
  });
  expect(restored.selectedNodeId).toBe("node-undo");
  expect(restored.selectedNodeIds).toEqual(["node-undo"]);
});

test("closing a localhost preview pane never removes the linked terminal", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate(async () => {
    const { closeActivePane } = await import("/src/stores/workspace.ts");
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          setActivePane: (tabId: string, paneId: string) => void;
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "split",
        primarySidebarPanel: "map",
      },
      tabs: [{
        id: "tab-preview-safe",
        title: "Preview owner",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/preview-safe",
        terminals: [{
          id: "pty-preview-owner",
          paneId: "pane-terminal",
          cols: 80,
          rows: 24,
          status: "running",
          previewUrl: "http://127.0.0.1:43210",
        }],
        splitLayout: {
          id: "split-root",
          type: "split",
          direction: "horizontal",
          sizes: [50, 50],
          children: [
            { id: "pane-terminal", type: "terminal", cwd: "/tmp/preview-safe" },
            { id: "pane-preview", type: "preview", previewUrl: "http://127.0.0.1:43210", linkedTerminalPaneId: "pane-terminal" },
          ],
        },
        activePaneId: "pane-preview",
      }],
      activeTabId: "tab-preview-safe",
      activeTerminalId: "pty-preview-owner",
      canvasState: {
        nodes: [
          { id: "node-terminal-safe", type: "terminal", title: "Preview owner", terminalTabId: "tab-preview-safe", x: 0, y: 0, width: 820, height: 460 },
          { id: "node-preview-safe", type: "preview", title: "Preview localhost", terminalTabId: "tab-preview-safe", previewPaneId: "pane-preview", linkedTerminalPaneId: "pane-terminal", previewUrl: "http://127.0.0.1:43210", x: 860, y: 0, width: 620, height: 420 },
        ],
        selectedNodeId: "node-preview-safe",
        selectedNodeIds: ["node-preview-safe"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });

    await closeActivePane();
    const state = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; activePaneId: string; terminals: Array<{ id: string; paneId: string; previewUrl?: string }>; splitLayout: unknown }>;
          canvasState: { nodes: Array<{ id: string; type: string }> };
        };
      };
    }).__termfleetWorkspaceStore?.getState();
    return {
      tab: state?.tabs.find((tab) => tab.id === "tab-preview-safe"),
      nodes: state?.canvasState.nodes,
    };
  });

  expect(result.tab).toMatchObject({
    id: "tab-preview-safe",
    activePaneId: "pane-terminal",
    terminals: [{
      id: "pty-preview-owner",
      paneId: "pane-terminal",
      previewUrl: "http://127.0.0.1:43210",
    }],
  });
  expect(result.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "node-terminal-safe", type: "terminal" }),
  ]));
  expect(result.nodes).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "node-preview-safe" }),
  ]));
});

test("map shell header prefers summarized task path and now over raw prompt chrome", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; terminals: unknown[] }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateTab(tab.id, {
      title: "endlessblink",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue",
      terminals: [{
        id: "pty-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "« gpt-5.5 default · -",
        terminalOutput: "translate to hebrew\nWhat changed:\nquality-gate tests passed\n› Use /skills to list available skills\ngpt-5.5 default · ~",
        statusSummary: {
          task: "Translate post copy to Hebrew",
          path: "inner-dialogue",
          now: "Checking the rewritten Hebrew post and verification notes",
          status: "working",
          provider: "shell",
          confidence: "medium",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("Translate post copy to Hebrew");
  await expect(page.getByTestId("canvas-terminal-node-workspace")).toHaveText("inner-dialogue");
  await expect(page.getByTestId("canvas-terminal-node-header-path")).toHaveText("inner-dialogue");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("Checking the rewritten Hebrew post and verification notes");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("gpt-5.5 default");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toContainText("Tasks");
  await expect(page.getByTestId("canvas-terminal-task-row")).toContainText("Translate post copy to Hebrew");
  await expect(page.getByTestId("canvas-terminal-task-state")).toContainText("Working");
  await expect(page.getByTestId("canvas-terminal-task-next")).toContainText("Next: Checking the rewritten Hebrew post and verification notes");
  await expect(page.getByRole("main").getByRole("button", { name: "Close endlessblink" })).toBeVisible();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; terminals: Array<{ paneId?: string }> }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateTab(tab.id, {
      title: "Terminal",
      terminals: [{
        id: "pty-stale-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "« | gpt-5.5 default · -",
        terminalOutput: [
          "translate to hebrew",
          "What changed:",
          "- server-side quality gate now validates generated posts",
          "- editor button regression passed",
          "› Use /skills to list available skills",
          "gpt-5.5 default · ~",
        ].join("\n"),
        statusSummary: {
          task: "Terminal",
          path: "workspace root unknown",
          now: "« | gpt-5.5 default · -",
          status: "working",
          provider: "shell",
          confidence: "low",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("translate to hebrew");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("server-side quality gate now validates generated posts");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("gpt-5.5 default");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; terminals: Array<{ paneId?: string }> }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateTab(tab.id, {
      title: "Terminal",
      terminals: [{
        id: "pty-gibberish-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "› sfgdsafgd ||> sfgdsafg ||> sfgdsaf",
        terminalOutput: [
          "translate to hebrew",
          "Verified:",
          "- production route: 200 OK",
          "- Live UI smoke test clicked the real production menu action",
          "You can start the process now.",
          "› sfgdsafgd ||> sfgdsafg ||> sfgdsaf",
          "gpt-5.5 default · ~",
        ].join("\n"),
        statusSummary: {
          task: "Supervised agent run",
          path: "home/endlessblink",
          now: "› sfgdsafgd ||> sfgdsafg ||> sfgdsaf",
          status: "working",
          provider: "shell",
          confidence: "low",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("translate to hebrew");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("production route: 200 OK");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("sfgdsafgd");
  await expect(page.getByTestId("canvas-terminal-node-header-title")).not.toContainText("Supervised agent run");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; terminals: Array<{ paneId?: string }> }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateTab(tab.id, {
      title: "Terminal",
      terminals: [{
        id: "pty-skills-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "«│ gpt-5.5 default • -",
        terminalOutput: [
          "mirror that architecture for post rewrites instead of adding a one-off",
          "The editor already has a screenplay conversion preview pattern; I'll mirror that architecture for post rewrites.",
          "Explored",
          "Search .impeccable.md in .",
          "Read screenplay-convert-dialog.tsx, smoke.spec.ts, editor-ai-regression.spec.ts",
          "Reviewing approval request (1m 48s • esc to interrupt)",
          "apply_patch touching /media/endlessblink/data/my-projects/ai-development/inner-dialogue",
          "Use /skills to list available skills",
          "«│ gpt-5.5 default • -",
        ].join("\n"),
        statusSummary: {
          task: "Terminal",
          path: "home/endlessblink",
          now: "Use /skills to list available skills",
          status: "working",
          provider: "shell",
          confidence: "low",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("mirror that architecture for post rewrites instead of adding a one-off");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("The editor already has a screenplay conversion preview pattern; I'll mirror that architecture for post rewrites.");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("/skills");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("gpt-5.5 default");
});

test("map summary cards expose workspace labels for parallel sessions", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const terminalTab = (
      id: string,
      title: string,
      paneId: string,
      initialCwd: string,
      groupId: string | null,
      task: string,
    ) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId,
      initialCwd,
      terminals: [{
        id: `pty-${id}`,
        paneId,
        cols: 80,
        rows: 24,
        status: "running",
        currentActivity: "npm run dev",
        terminalOutput: task,
        statusSummary: {
          task,
          path: initialCwd.split("/").filter(Boolean).slice(-2).join("/"),
          now: "Serving localhost preview",
          status: "working",
          provider: "shell",
          confidence: "medium",
        },
      }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: false,
        primarySidebarCollapsed: false,
        primarySidebarPanel: "map",
      },
      groups: [
        {
          id: "group-termfleet",
          name: "TermFleet OSS",
          color: "#7aa2f7",
          projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
          lastActiveTabId: "tab-termfleet",
        },
      ],
      terminalGroups: [
        {
          id: "group-termfleet",
          name: "TermFleet OSS",
          color: "#7aa2f7",
          projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
          lastActiveTabId: "tab-termfleet",
        },
      ],
      tabs: [
        terminalTab("tab-termfleet", "Terminal", "pane-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "group-termfleet", "Run TermFleet checks"),
        terminalTab("tab-arthouse", "Terminal", "pane-arthouse", "/media/endlessblink/data/my-projects/ai-development/content-creation/arthouse", null, "Run Arthouse checks"),
      ],
      activeTabId: "tab-termfleet",
      canvasState: {
        selectedNodeId: "node-termfleet",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "node-termfleet", type: "terminal", title: "Terminal", terminalTabId: "tab-termfleet", x: 0, y: 0, width: 620, height: 420 },
          { id: "node-arthouse", type: "terminal", title: "Terminal", terminalTabId: "tab-arthouse", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/content-creation/arthouse", x: 660, y: 0, width: 620, height: 420 },
        ],
      },
    });
  });

  const workspaceLabels = page.getByTestId("canvas-terminal-node-workspace");
  await expect(workspaceLabels.filter({ hasText: "TermFleet OSS" })).toBeVisible();
  await expect(workspaceLabels.filter({ hasText: "arthouse" })).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-node-header-title").filter({ hasText: "Run TermFleet checks" })).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-node-header-title").filter({ hasText: "Run Arthouse checks" })).toBeVisible();
});

test("map panel summarizes visible nodes by workspace branch role and service", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const now = Date.now();
    const group = {
      id: "group-termfleet",
      name: "TermFleet OSS",
      color: "#7aa2f7",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: "tab-shell",
    };
    const tab = (id: string, title: string, paneId: string, initialCwd: string, groupId: string | null, terminal: Record<string, unknown>, workstream?: Record<string, unknown>) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId,
      initialCwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, ...terminal }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
      ...(workstream ? { workstream } : {}),
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: false,
        primarySidebarCollapsed: false,
        primarySidebarPanel: "map",
      },
      groups: [group],
      terminalGroups: [group],
      tabs: [
        tab("tab-shell", "Terminal", "pane-shell", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "group-termfleet", {
          status: "running",
          currentActivity: "npm run dev",
          previewUrl: "http://127.0.0.1:5177",
        }, {
          kind: "terminal",
          status: "running",
          phase: "active",
          gitBranch: "feat/map-intel",
          createdAt: now,
        }),
        tab("tab-agent", "Agent", "pane-agent", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "group-termfleet", {
          status: "running",
          currentActivity: "coding",
        }, {
          kind: "agent",
          provider: "codex",
          role: "verifier",
          status: "running",
          phase: "active",
          gitBranch: "feat/map-intel",
          mission: "Verify map intelligence",
          createdAt: now,
        }),
        tab("tab-docs", "Terminal", "pane-docs", "/media/endlessblink/data/my-projects/ai-development/docs-site", null, {
          status: "running",
          currentActivity: "pnpm docs",
        }, {
          kind: "terminal",
          status: "running",
          phase: "active",
          gitBranch: "docs/homepage",
          createdAt: now,
        }),
      ],
      activeTabId: "tab-shell",
      canvasState: {
        selectedNodeId: "node-shell",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "node-shell", type: "terminal", title: "Terminal", terminalTabId: "tab-shell", x: 0, y: 0, width: 620, height: 420 },
          { id: "node-agent", type: "terminal", title: "Agent", terminalTabId: "tab-agent", x: 660, y: 0, width: 620, height: 420 },
          { id: "node-docs", type: "terminal", title: "Terminal", terminalTabId: "tab-docs", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/docs-site", x: 0, y: 460, width: 620, height: 420 },
          { id: "node-preview", type: "preview", title: "Preview docs", terminalTabId: "tab-shell", previewPaneId: "pane-preview", previewUrl: "http://127.0.0.1:5177", x: 660, y: 460, width: 620, height: 420 },
        ],
      },
    });
  });

  const mapPanel = page.locator('[aria-label="Operations panel"]');
  await mapPanel.getByTestId("map-workspace-summary-toggle").click();
  await expect(mapPanel.getByTestId("map-workspace-summary")).toContainText("2 workspaces");
  await expect(mapPanel.getByTestId("map-workspace-summary")).toContainText("3 roles");
  await expect(mapPanel.getByTestId("map-workspace-summary")).toContainText("2 branches");
  await expect(mapPanel.getByTestId("map-workspace-summary")).toContainText("1 service");
  await expect(mapPanel.getByTestId("map-workspace-group").filter({ hasText: "TermFleet OSS" })).toContainText("3 nodes");
  await expect(mapPanel.getByTestId("map-workspace-group").filter({ hasText: "docs-site" })).toContainText("1 node");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).toContainText("feat/map-intel");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).toContainText("docs/homepage");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).toContainText("verifier");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).toContainText("preview");

  await mapPanel.getByTestId("map-filter-preview").click();
  await expect(mapPanel.getByTestId("map-workspace-summary-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(mapPanel.getByTestId("map-workspace-summary")).toContainText("1 workspace");
  await expect(mapPanel.getByTestId("map-workspace-group").filter({ hasText: "TermFleet OSS" })).toContainText("2 nodes");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).toContainText("preview");
  await expect(mapPanel.getByTestId("map-workspace-summary-facets")).not.toContainText("docs/homepage");
});

test("map sidebar filters operations nodes by visible work state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied ??= [];
          (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied?.push(text);
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          workspaceUiState: Record<string, unknown>;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const now = Date.now();
    const terminalTab = (id: string, title: string, paneId: string, terminal: Record<string, unknown>, workstream?: Record<string, unknown>) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, ...terminal }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
      ...(workstream ? { workstream } : {}),
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: false,
        primarySidebarCollapsed: false,
        primarySidebarPanel: "map",
      },
      tabs: [
        terminalTab("tab-active", "Active shell", "pane-active", {
          status: "running",
          currentActivity: "npm run dev",
          activityKind: "running",
        }),
        terminalTab("tab-failed", "Failed build", "pane-failed", {
          status: "failed",
          currentActivity: "cargo check failed",
        }),
        terminalTab("tab-waiting", "Waiting agent", "pane-waiting", {
          status: "exited",
        }, {
          kind: "agent",
          provider: "codex",
          status: "waiting",
          phase: "needs-input",
          activityKind: "waiting",
          mission: "Review deploy error",
          createdAt: now,
        }),
        terminalTab("tab-tests", "Test runner", "pane-tests", {
          status: "running",
          currentActivity: "npm test running",
          activityKind: "testing",
        }),
        terminalTab("tab-preview", "Preview service", "pane-preview", {
          status: "exited",
          previewUrl: "http://localhost:5177",
          terminalOutput: "VITE ready at http://localhost:5177\nGET / 200",
        }),
      ],
      activeTabId: "tab-active",
      canvasState: {
        selectedNodeId: "node-active",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "node-active", type: "terminal", title: "Active shell", terminalTabId: "tab-active", x: 0, y: 0, width: 820, height: 460 },
          { id: "node-failed", type: "terminal", title: "Failed build", terminalTabId: "tab-failed", x: 860, y: 0, width: 820, height: 460 },
          { id: "node-waiting", type: "terminal", title: "Waiting agent", terminalTabId: "tab-waiting", x: 0, y: 500, width: 820, height: 460 },
          { id: "node-tests", type: "terminal", title: "Test runner", terminalTabId: "tab-tests", x: 860, y: 500, width: 820, height: 460 },
          { id: "node-preview-terminal", type: "terminal", title: "Preview service", terminalTabId: "tab-preview", x: 1720, y: 0, width: 820, height: 460 },
        ],
      },
    });
  });

  const mapPanel = page.locator('[aria-label="Operations panel"]');
  await expect(mapPanel.getByTestId("map-filter-all")).toContainText("5");
  await expect(mapPanel.getByTestId("map-filter-active")).toContainText("2");
  await expect(mapPanel.getByTestId("map-filter-failed")).toContainText("1");
  await expect(mapPanel.getByTestId("map-filter-waiting")).toContainText("1");
  await expect(mapPanel.getByTestId("map-filter-testing")).toContainText("1");
  await expect(mapPanel.getByTestId("map-filter-preview")).toContainText("1");
  await expect(mapPanel.getByTestId("map-local-services")).toContainText("1 detected");
  await expect(mapPanel.getByTestId("map-local-services-toggle")).toHaveAttribute("aria-expanded", "true");
  await mapPanel.getByTestId("map-local-services-toggle").click();
  await expect(mapPanel.getByTestId("map-local-services-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(mapPanel.getByTestId("map-local-service-row")).toHaveCount(0);
  await mapPanel.getByTestId("map-local-services-toggle").click();
  await expect(mapPanel.getByTestId("map-local-service-row")).toContainText("localhost:5177");
  await expect(mapPanel.getByTestId("map-local-service-row")).toContainText("stopped");
  await expect(mapPanel.getByTestId("map-local-service-row")).toContainText("Preview service");
  await expect(mapPanel.getByTestId("map-local-service-row")).not.toContainText("localhost:5177:5177");
  await expect(mapPanel.getByTestId("map-local-service-row")).not.toContainText("VITE ready");
  await expect(mapPanel.getByRole("button", { name: "Copy http://localhost:5177" })).toBeVisible();
  await expect(mapPanel.getByRole("button", { name: "Copy logs for http://localhost:5177" })).toBeVisible();
  await expect(mapPanel.getByRole("button", { name: "Open http://localhost:5177 on map" })).toBeVisible();

  await mapPanel.getByRole("button", { name: "Copy http://localhost:5177" }).click();
  await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("URL copied");
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied?.at(-1)
  )).toBe("http://localhost:5177");

  await mapPanel.getByRole("button", { name: "Copy logs for http://localhost:5177" }).click();
  await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("Logs copied");
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied?.at(-1)
  )).toContain("GET / 200");

  await mapPanel.getByRole("button", { name: "Open http://localhost:5177 on map" }).click();
  await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("Map window opened");
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { selectedNodeId: string | null; nodes: Array<{ id: string; type: string; previewUrl?: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    const node = state?.nodes.find((candidate) => candidate.type === "preview" && candidate.previewUrl === "http://localhost:5177");
    return node ? `${state?.selectedNodeId}:${node.id}` : null;
  })).toBe("service-preview-tab-preview-5177:service-preview-tab-preview-5177");
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    if (!raw) return null;
    const workspace = JSON.parse(raw) as {
      canvasState?: { nodes?: Array<{ id: string; type: string; previewUrl?: string; linkedTerminalPaneId?: string }> };
    };
    const node = workspace.canvasState?.nodes?.find((candidate) => candidate.id === "service-preview-tab-preview-5177");
    return node ? `${node.type}:${node.previewUrl}:${node.linkedTerminalPaneId}` : null;
  })).toBe("preview:http://localhost:5177:pane-preview");

  await mapPanel.getByTestId("map-local-service-row").click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { selectedNodeId: string | null };
        };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.selectedNodeId;
  })).toBe("service-preview-tab-preview-5177");

  await mapPanel.getByTestId("map-filter-failed").click();
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Failed build");
  await expect(mapPanel.getByTestId("map-node-list")).not.toContainText("Active shell");

  await mapPanel.getByTestId("map-filter-waiting").click();
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Waiting agent");
  await expect(mapPanel.getByTestId("map-node-list")).not.toContainText("Failed build");

  await mapPanel.getByTestId("map-filter-testing").click();
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Test runner");
  await expect(mapPanel.getByTestId("map-node-list")).not.toContainText("Waiting agent");

  await mapPanel.getByTestId("map-filter-preview").click();
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Preview service");
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Preview localhost");
  await mapPanel.getByText("Preview localhost:5177").hover();
  await mapPanel.getByRole("button", { name: "Close Preview localhost:5177" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    if (!state) return null;
    return {
      previewExists: state.canvasState.nodes.some((node) => node.id === "service-preview-tab-preview-5177"),
      terminalNodeExists: state.canvasState.nodes.some((node) => node.id === "node-preview-terminal"),
      terminalTabExists: state.tabs.some((tab) => tab.id === "tab-preview"),
    };
  })).toEqual({
    previewExists: false,
    terminalNodeExists: true,
    terminalTabExists: true,
  });
  await expect(mapPanel.getByTestId("map-node-list")).toContainText("Preview service");
  await expect(mapPanel.getByTestId("map-node-list")).not.toContainText("Preview localhost");
  await mapPanel.getByRole("button", { name: "Open http://localhost:5177 on map" }).click();
  await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("Map window opened");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expect(mapPanel.getByTestId("map-local-services")).toContainText("1 detected");
  await expect(mapPanel.getByTestId("map-local-service-row")).toContainText("localhost:5177");
  await expect(mapPanel.getByTestId("map-local-service-row")).toContainText("Preview service");
  await mapPanel.getByTestId("map-local-service-row").click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { selectedNodeId: string | null };
        };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.selectedNodeId;
  })).toBe("service-preview-tab-preview-5177");
});
