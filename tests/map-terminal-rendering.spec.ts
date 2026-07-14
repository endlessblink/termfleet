import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("selected live map terminals preserve alternate-screen projection without clipping overscale", () => {
  const source = readFileSync("src/components/MagicCanvas.tsx", "utf8");
  const liveTerminalBlock = source.match(/<TerminalComponent[\s\S]*?onSnapshot=\{\(snapshot\) => onTerminalSnapshot\(node\.id, snapshot\)\}[\s\S]*?\/>/);

  expect(liveTerminalBlock?.[0]).toContain("standalone");
  expect(liveTerminalBlock?.[0]).toContain("runtimeActive={selected}");
  expect(liveTerminalBlock?.[0]).toContain("mapProjection");
  expect(liveTerminalBlock?.[0]).not.toContain("mapProjection={false}");
  expect(liveTerminalBlock?.[0]).not.toContain("projectionMinScale");
});

test("selected live map terminal renders through non-transformed overlay, not activation card", () => {
  const source = readFileSync("src/components/MagicCanvas.tsx", "utf8");

  expect(source).toContain("const shouldUseNativeSplitForInteraction = false;");
  expect(source).toContain("terminal cards must not degrade into split-pane activation cards");
  expect(source).toContain('data-testid="canvas-terminal-overlay-layer"');
  expect(source).toContain('data-testid="canvas-terminal-live-overlay"');
  expect(source).toContain('data-testid="canvas-terminal-overlay-placeholder"');
  expect(source).toContain('window.dispatchEvent(new Event("termfleet-map-terminal-overlay-sync"));');
  expect(source).toContain("renderScale={shouldOverlayTerminal ? 1 : mapTerminalRenderScaleForZoom(zoom)}");
  expect(source).not.toContain("const shouldUseNativeSplitForInteraction = isDesktopNativeRuntime");
});

test("map Canvas2D terminals do not also mount the xterm renderer or per-pane status poller", () => {
  const terminal = readFileSync("src/components/Terminal.tsx", "utf8");
  const magicCanvas = readFileSync("src/components/MagicCanvas.tsx", "utf8");

  expect(terminal).toContain("if (canvasMode) return;");
  expect(terminal).toContain("if (standalone) return;");
  expect(terminal).not.toContain("if (canvasMode || !containerRef.current) return;");
  expect(magicCanvas).not.toContain("summarizeAgentStatus({");
  expect(magicCanvas).not.toContain("const statusEndpointConfigured");
});

test("selected map agent panes suppress synchronized-output control residue", () => {
  const terminalCanvas = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const vtGrid = readFileSync("src-tauri/src/vt_grid.rs", "utf8");
  const mapVerifier = readFileSync("scripts/verify-map-terminals.mjs", "utf8");

  const projectionGuard = terminalCanvas.match(/const preservesProjectionSize = \(\) =>[\s\S]*?;\n\n    channel\.onmessage/);
  const projectionClip = terminalCanvas.match(/const applyProjectionClip = \(\) => \{[\s\S]*?\n    \};/);
  expect(projectionGuard?.[0]).toContain("modesRef.current.altScreen");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.mouseReport");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.alternateScroll");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.sgrMouse");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.bracketedPaste");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.appCursor");
  // Viewport CLIP, not down-scale: render at 1:1 (no Math.min scale-to-fit that
  // made text tiny) and anchor the bottom rows; the shell's overflow:hidden clips.
  expect(projectionClip?.[0]).toContain("Math.min(0, shell.clientHeight - logicalH)");
  expect(projectionClip?.[0]).toContain("translateY");
  expect(projectionClip?.[0]).not.toContain("scale(");
  expect(terminalCanvas).toContain("syncOverlaySize();\n        if (mapProjection && modesRef.current.altScreen)");
  expect(terminalCanvas).toContain("true alt-screen TUI mode");
  expect(vtGrid).toContain("strip_unsupported_control_sequences");
  expect(vtGrid).toContain('SYNC_OUTPUT_ON: &[u8] = b"\\x1b[?2026h"');
  expect(vtGrid).toContain('SYNC_OUTPUT_OFF: &[u8] = b"\\x1b[?2026l"');
  expect(vtGrid).toContain("synchronized_output_markers_never_render_as_text");
  expect(vtGrid).toContain("split_synchronized_output_markers_never_render_as_text");
  expect(mapVerifier).toContain("preserve alternate-screen terminals with a 1:1 viewport clip (no down-scale)");
});

test("map terminal activation owns tab, pane, and focused terminal before paste", () => {
  const source = readFileSync("src/components/MagicCanvas.tsx", "utf8");
  const activationBlock = source.match(/const activateTerminalNode = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/)?.[0] ?? "";

  expect(activationBlock).toContain("selectCanvasNode(node.id)");
  expect(activationBlock).toContain("setActiveTab(terminalTabId)");
  expect(activationBlock).toContain("setActivePane(terminalTabId, terminalPaneId)");
  expect(activationBlock).toContain("setActiveTerminal(linkedTerminalId ?? `terminal-${terminalTabId}-${terminalPaneId}`)");
});

test("AskUserQuestion mouse-report prompts do not trigger map layout reconciliation", () => {
  const terminalCanvas = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const projectionGuard = terminalCanvas.match(/const preservesProjectionSize = \(\) =>[\s\S]*?;\n\n    channel\.onmessage/);

  expect(projectionGuard?.[0]).toContain("modesRef.current.altScreen");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.mouseReport");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.sgrMouse");
  expect(projectionGuard?.[0]).not.toContain("modesRef.current.alternateScroll");
  expect(terminalCanvas).toMatch(/AskUserQuestion-style primary-screen\s+\/\/ prompts/);
});

async function imageRegionStats(
  page: import("@playwright/test").Page,
  screenshot: Buffer,
  box: { x: number; y: number; width: number; height: number }
) {
  return page.evaluate(async ({ dataUrl, box }) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode screenshot"));
      image.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image, 0, 0);
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const width = Math.max(1, Math.min(canvas.width - x, Math.floor(box.width)));
    const height = Math.max(1, Math.min(canvas.height - y, Math.floor(box.height)));
    const pixels = context.getImageData(x, y, width, height).data;
    let brightPixels = 0;
    let edgePixels = 0;
    let previous = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = (pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722);
      if (luminance > 120) brightPixels += 1;
      if (index > 0 && Math.abs(luminance - previous) > 26) edgePixels += 1;
      previous = luminance;
    }
    return { brightPixels, edgePixels, width, height };
  }, {
    dataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
    box,
  });
}

test("MASTER_PLAN task parser keeps summary table titles and statuses readable", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { parseMasterPlanTasks } = await import("/src/lib/masterPlanTasks.ts");
    return parseMasterPlanTasks(`
| ID         | Title                            | Priority | Status            | Dependencies |
| ---------- | -------------------------------- | -------- | ----------------- | ------------ |
| MC-001     | Preserve canvas workspace mode   | P2       | DONE              | -            |
| ~~TC-014~~ | Native VTE path abandoned        | P2       | DONE (2026-05-28) | TC-017       |
| TC-019     | Warp-style chrome redesign       | P2       | IN_PROGRESS       | -            |

### TC-019: Warp-style chrome redesign

Acceptance:

- DONE: Preserve existing terminal behavior.
- TODO: Add stable task sidebar rows.
- BLOCKED: Waiting for screenshot approval.
`);
  });

  expect(result).toEqual([
    {
      id: "MC-001",
      title: "Preserve canvas workspace mode",
      status: "done",
      rawStatus: "DONE",
    },
    {
      id: "TC-014",
      title: "Native VTE path abandoned",
      status: "done",
      rawStatus: "DONE (2026-05-28)",
    },
    {
      id: "TC-019",
      title: "Warp-style chrome redesign",
      status: "in-progress",
      rawStatus: "IN_PROGRESS",
      checklist: [
        {
          id: "TC-019-1",
          text: "Preserve existing terminal behavior.",
          status: "done",
          rawStatus: "DONE",
        },
        {
          id: "TC-019-2",
          text: "Add stable task sidebar rows.",
          status: "todo",
          rawStatus: "TODO",
        },
        {
          id: "TC-019-3",
          text: "Waiting for screenshot approval.",
          status: "blocked",
          rawStatus: "BLOCKED",
        },
      ],
    },
  ]);
});

test("terminal task binding uses an in-app searchable picker", async ({ page }) => {
  const plan = `
| ID         | Title                            | Priority | Status            | Dependencies |
| ---------- | -------------------------------- | -------- | ----------------- | ------------ |
| MC-001     | Preserve canvas workspace mode   | P2       | DONE              | -            |
| TC-018     | BiDi terminal shaping            | P2       | TODO              | -            |
| TC-019     | Warp-style chrome redesign       | P2       | IN_PROGRESS       | -            |
`;

  await page.addInitScript((masterPlan) => {
    let callbackId = 1;
    const callbacks = new Map<number, unknown>();
    window.prompt = () => {
      throw new Error("Task binding must not use window.prompt");
    };
    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(callback: unknown) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string) {
        if (command === "fs_read_file") return masterPlan;
        if (command === "daemon_status") return { reachable: false, mode: "browser" };
        if (command === "daemon_ensure_running") return { reachable: false, mode: "browser", message: "browser" };
        if (command === "grid_snapshot") {
          return JSON.stringify({
            cols: 80,
            rows: 24,
            cursor: { col: 0, line: 0 },
            cursorVisible: false,
            altScreen: false,
            cells: [],
          });
        }
        return null;
      },
      convertFileSrc(path: string) {
        return path;
      },
    };
  }, plan);

  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown>; reconcileProjectGroups: () => void };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-termfleet",
      name: "TermFleet OSS",
      color: "#7aa2f7",
      projectRoot: "/workspace/termfleet",
      lastActiveTabId: "tab-shell",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: true,
        primarySidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      tabs: [{
        id: "tab-shell",
        title: "Terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: "group-termfleet",
        initialCwd: "/workspace/termfleet",
        terminals: [{ id: "pty-shell", paneId: "pane-shell", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-shell", type: "terminal" },
        activePaneId: "pane-shell",
      }],
      activeTabId: "tab-shell",
      canvasState: {
        selectedNodeId: "node-shell",
        selectedNodeIds: ["node-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-shell",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-shell",
          x: 0,
          y: 0,
          width: 820,
          height: 460,
        }],
      },
    });
    store.getState().reconcileProjectGroups();
  });

  await page.getByLabel("Bind MASTER_PLAN task").click();
  await expect(page.getByTestId("task-binding-picker")).toBeVisible();
  await expect(page.getByTestId("task-binding-option").filter({ hasText: "Warp-style chrome redesign" })).toBeVisible();
  await expect(page.getByTestId("task-binding-option").filter({ hasText: "Unknown DONE" })).toHaveCount(0);

  await page.getByTestId("task-binding-search").fill("warp");
  await expect(page.getByTestId("task-binding-option")).toHaveCount(1);
  await page.getByTestId("task-binding-option").click();

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { nodes: Array<{ id: string; taskBinding?: { taskId: string; planPath?: string } }> };
        };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.nodes.find((node) => node.id === "node-shell")?.taskBinding;
  })).toEqual({ taskId: "TC-019", planPath: "/workspace/termfleet/MASTER_PLAN.md" });

  await page.getByLabel("Change task binding").click();
  await page.getByTestId("task-binding-clear").click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { nodes: Array<{ id: string; taskBinding?: { taskId: string } }> };
        };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.nodes.find((node) => node.id === "node-shell")?.taskBinding ?? null;
  })).toBeNull();

  await page.getByLabel("Bind MASTER_PLAN task").click();
  await page.getByTestId("task-binding-manual-input").fill("TC-777");
  await page.getByTestId("task-binding-manual-bind").click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: { nodes: Array<{ id: string; taskBinding?: { taskId: string; planPath?: string } }> };
        };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.nodes.find((node) => node.id === "node-shell")?.taskBinding;
  })).toEqual({ taskId: "TC-777", planPath: "/workspace/termfleet/MASTER_PLAN.md" });
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

test("terminal map renaming uses in-app inputs and keeps linked tab titles in sync", async ({ page }) => {
  await page.addInitScript(() => {
    window.prompt = () => {
      throw new Error("Terminal rename must not use window.prompt");
    };
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
        id: "tab-rename",
        title: "Old terminal name",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-rename",
        terminals: [{ id: "pty-rename", paneId: "pane-rename", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-rename", type: "terminal" },
        activePaneId: "pane-rename",
      }],
      activeTabId: "tab-rename",
      canvasState: {
        nodes: [{
          id: "node-rename",
          type: "terminal",
          title: "Old terminal name",
          terminalTabId: "tab-rename",
          x: 100,
          y: 100,
          width: 820,
          height: 460,
        }],
        selectedNodeId: "node-rename",
        selectedNodeIds: ["node-rename"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.getByTestId("canvas-terminal-status-block").dblclick();
  await page.getByTestId("canvas-terminal-rename-input").fill("Map rename from card");
  await page.getByTestId("canvas-terminal-rename-input").press("Enter");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string }>;
          canvasState: { nodes: Array<{ id: string; title: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      tabTitle: state?.tabs.find((tab) => tab.id === "tab-rename")?.title,
      nodeTitle: state?.canvasState.nodes.find((node) => node.id === "node-rename")?.title,
    };
  })).toEqual({ tabTitle: "Map rename from card", nodeTitle: "Map rename from card" });

  await page.getByTestId("canvas-sidebar-node-row").dblclick();
  await page.getByTestId("canvas-sidebar-rename-input").fill("Sidebar rename works");
  await page.getByTestId("canvas-sidebar-rename-input").press("Enter");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string }>;
          canvasState: { nodes: Array<{ id: string; title: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      tabTitle: state?.tabs.find((tab) => tab.id === "tab-rename")?.title,
      nodeTitle: state?.canvasState.nodes.find((node) => node.id === "node-rename")?.title,
    };
  })).toEqual({ tabTitle: "Sidebar rename works", nodeTitle: "Sidebar rename works" });
});

test("project emojis identify map terminals by path without using task colors", async ({ page }) => {
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

    const tab = (id: string, groupId: string, cwd: string, paneId: string) => ({
      id,
      title: "Terminal",
      emoji: "[]",
      color: "#7aa2f7",
      groupId,
      initialCwd: cwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });
    const termfleet = {
      id: "group-termfleet",
      name: "termfleet",
      color: "#7aa2f7",
      emoji: "🧭",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    };
    const docs = {
      id: "group-docs",
      name: "docs-site",
      color: "#9ece6a",
      emoji: "📝",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/docs-site",
    };

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: false,
        primarySidebarCollapsed: false,
        primarySidebarPanel: "map",
      },
      groups: [termfleet, docs],
      terminalGroups: [termfleet, docs],
      activeGroupFilter: null,
      activeGroupId: null,
      activeTabId: "tab-termfleet-a",
      tabs: [
        tab("tab-termfleet-a", "group-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "pane-termfleet-a"),
        tab("tab-termfleet-b", "group-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "pane-termfleet-b"),
        tab("tab-docs", "group-docs", "/media/endlessblink/data/my-projects/ai-development/docs-site", "pane-docs"),
      ],
      canvasState: {
        selectedNodeId: "node-termfleet-a",
        selectedNodeIds: ["node-termfleet-a"],
        viewport: { x: 0, y: 0, zoom: 0.42 },
        nodes: [
          { id: "node-termfleet-a", type: "terminal", title: "Terminal", terminalTabId: "tab-termfleet-a", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", x: 0, y: 0, width: 820, height: 460 },
          { id: "node-termfleet-b", type: "terminal", title: "Terminal", terminalTabId: "tab-termfleet-b", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", x: 860, y: 0, width: 820, height: 460 },
          { id: "node-docs", type: "terminal", title: "Terminal", terminalTabId: "tab-docs", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/docs-site", x: 1720, y: 0, width: 820, height: 460 },
        ],
      },
    });
  });

  await expect(page.getByTestId("canvas-terminal-project-emoji").filter({ hasText: "🧭" })).toHaveCount(2);
  await expect(page.getByTestId("canvas-terminal-project-emoji").filter({ hasText: "📝" })).toHaveCount(1);
  await expect(page.getByTestId("canvas-terminal-project-emoji-zoom")).toHaveCount(3);
  await expect(page.getByTestId("map-node-project-emoji").filter({ hasText: "🧭" })).toHaveCount(2);

  await page.getByTestId("map-node-project-emoji").filter({ hasText: "🧭" }).first().click();
  // Full emoji picker: search by emoji name and pick from the searchable grid.
  await page.getByTestId("project-emoji-picker").getByLabel("Search emoji").fill("rocket");
  await page.getByTestId("project-emoji-picker").getByRole("option", { name: "rocket", exact: true }).click();
  await expect(page.getByTestId("canvas-terminal-project-emoji").filter({ hasText: "🚀" })).toHaveCount(2);
  await expect(page.getByTestId("canvas-terminal-project-emoji").filter({ hasText: "📝" })).toHaveCount(1);
  await expect(page.getByTestId("map-node-project-emoji").filter({ hasText: "🚀" })).toHaveCount(2);

  await page.getByTestId("canvas-terminal-node-header-title").first().click({ button: "right" });
  await page.getByRole("menu", { name: "Terminal label color" }).getByRole("menuitem", { name: "Set terminal label color Amber" }).click();
  await expect(page.getByTestId("canvas-terminal-project-emoji").filter({ hasText: "🚀" })).toHaveCount(2);
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          groups: Array<{ id: string; emoji?: string }>;
          canvasState: { nodes: Array<{ id: string; labelColor?: string }> };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      emoji: state?.groups.find((group) => group.id === "group-termfleet")?.emoji,
      labelColor: state?.canvasState.nodes.find((node) => node.id === "node-termfleet-a")?.labelColor,
    };
  })).toEqual({ emoji: "🚀", labelColor: "#d4a44f" });
});

test("shift-drag box-selects terminals while regular and middle drags pan the map", async ({ page }) => {
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

  const shellBox = await page.locator("[data-magic-canvas-shell]").boundingBox();
  if (!shellBox) throw new Error("Map shell not found");

  await page.mouse.move(shellBox.x + 20, shellBox.y + 650);
  await page.mouse.down();
  await page.mouse.move(shellBox.x + 140, shellBox.y + 610, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeIds?: string[]; viewport: { x: number; y: number } } };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    return `${state?.selectedNodeIds?.join(",") ?? ""}|${state?.viewport.x}:${state?.viewport.y}`;
  })).toBe("|120:-40");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    store.setState({
      canvasState: {
        ...store.getState().canvasState,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.mouse.move(shellBox.x + 20, shellBox.y + 650);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(shellBox.x + 95, shellBox.y + 580, { steps: 4 });
  await page.mouse.up({ button: "middle" });

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeIds?: string[]; viewport: { x: number; y: number } } };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    return `${state?.selectedNodeIds?.join(",") ?? ""}|${state?.viewport.x}:${state?.viewport.y}`;
  })).toBe("|75:-70");

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    store.setState({
      canvasState: {
        ...store.getState().canvasState,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.mouse.move(shellBox.x + 20, shellBox.y + 650);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(shellBox.x + 1780, shellBox.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeIds?: string[] } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.selectedNodeIds?.sort().join(",");
  })).toBe("node-one,node-two");

  const firstNode = page.locator("[data-magic-canvas-shell] [data-testid='canvas-terminal-node-header']").filter({ hasText: "Build one" });
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

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    store.setState({
      canvasState: {
        ...store.getState().canvasState,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  const movedBox = await firstNode.boundingBox();
  if (!movedBox) throw new Error("Moved selected node header not found");
  await page.mouse.move(movedBox.x + 24, movedBox.y + 18);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(movedBox.x + 104, movedBox.y - 42, { steps: 4 });
  await page.mouse.up({ button: "middle" });

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          canvasState: {
            viewport: { x: number; y: number };
            nodes: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    const nodes = state?.nodes.map((node) => `${node.id}:${node.x}:${node.y}`).sort().join("|");
    return `${state?.viewport.x}:${state?.viewport.y}|${nodes}`;
  })).toBe("80:-60|node-one:156:116|node-three:1840:80|node-two:1036:116");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeIds?: string[] } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.selectedNodeIds?.sort().join(",");
  })).toBe("node-one,node-two");

  await page.mouse.click(shellBox.x + 20, shellBox.y + 650);

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeId: string | null; selectedNodeIds?: string[] } };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    return `${state?.selectedNodeId ?? ""}|${state?.selectedNodeIds?.join(",") ?? ""}`;
  })).toBe("|");
});

test("clicking a selected external page header clears its map selection", async ({ page }) => {
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
      canvasState: {
        nodes: [{
          id: "node-external-page",
          type: "preview",
          title: "External page",
          previewUrl: "http://127.0.0.1:43210/",
          x: 80,
          y: 100,
          width: 620,
          height: 420,
        }],
        selectedNodeId: "node-external-page",
        selectedNodeIds: ["node-external-page"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.getByTestId("canvas-node-header").click();

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { selectedNodeId: string | null; selectedNodeIds?: string[] } };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState().canvasState;
    return `${state?.selectedNodeId ?? ""}|${state?.selectedNodeIds?.join(",") ?? ""}`;
  })).toBe("|");

  await expect(page.locator('[data-node-id="node-external-page"]')).toBeVisible();
  await page.locator('[data-node-id="node-external-page"]').screenshot({
    path: test.info().outputPath("external-page-deselected.png"),
  });
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

test("selected default-size map terminal does not resize itself on click", async ({ page }) => {
  const source = readFileSync("src/components/MagicCanvas.tsx", "utf8");
  expect(source).not.toContain("READABLE_LIVE_TERMINAL_SIZE");

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

  await expect(page.locator("[data-testid='canvas-terminal-live-overlay'] .terminal-container")).toBeVisible();
  await expect(page.locator("[data-testid='canvas-terminal-node'] [data-testid='canvas-terminal-overlay-placeholder']")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const container = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .terminal-container");
    const terminalShell = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .terminal-block-shell");
    const xtermScreen = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .xterm-screen");
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
    const node = document.querySelector("[data-testid='canvas-terminal-node']");
    const content = document.querySelector("[data-testid='canvas-terminal-task-content']");
    const overlay = document.querySelector("[data-testid='canvas-terminal-live-overlay']");
    const container = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .terminal-container");
    const terminalShell = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .terminal-block-shell");
    const xtermScreen = document.querySelector("[data-testid='canvas-terminal-live-overlay'] .xterm-screen");
    const contentRect = content?.getBoundingClientRect();
    const overlayRect = overlay?.getBoundingClientRect();
    return {
      nodeWidth: Math.round(node?.getBoundingClientRect().width ?? 0),
      nodeHeight: Math.round(node?.getBoundingClientRect().height ?? 0),
      overlayLeftDelta: Math.round(Math.abs((overlayRect?.left ?? 0) - (contentRect?.left ?? 0))),
      overlayTopDelta: Math.round(Math.abs((overlayRect?.top ?? 0) - (contentRect?.top ?? 0))),
      overlayWidthDelta: Math.round(Math.abs((overlayRect?.width ?? 0) - (contentRect?.width ?? 0))),
      overlayHeightDelta: Math.round(Math.abs((overlayRect?.height ?? 0) - (contentRect?.height ?? 0))),
      containerHeight: Math.round(container?.getBoundingClientRect().height ?? 0),
      shellHeight: Math.round(terminalShell?.getBoundingClientRect().height ?? 0),
      screenHeight: Math.round(xtermScreen?.getBoundingClientRect().height ?? 0),
    };
  });
  expect(dimensions.nodeWidth).toBe(820);
  expect(dimensions.nodeHeight).toBe(460);
  expect(dimensions.overlayLeftDelta).toBeLessThanOrEqual(2);
  expect(dimensions.overlayTopDelta).toBeLessThanOrEqual(2);
  expect(dimensions.overlayWidthDelta).toBeLessThanOrEqual(2);
  expect(dimensions.overlayHeightDelta).toBeLessThanOrEqual(2);
  expect(dimensions.containerHeight).toBeGreaterThanOrEqual(260);
  expect(dimensions.shellHeight).toBeGreaterThanOrEqual(260);
  expect(dimensions.screenHeight).toBeGreaterThanOrEqual(220);
});

test("manual-sized selected live terminal is not reset to the readable default", async ({ page }) => {
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
        id: "tab-user-sized",
        title: "User sized terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-user-sized",
        terminals: [{ id: "pty-user-sized", paneId: "pane-user-sized", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-user-sized", type: "terminal" },
        activePaneId: "pane-user-sized",
      }],
      activeTabId: "tab-user-sized",
      canvasState: {
        nodes: [{
          id: "node-user-sized",
          type: "terminal",
          title: "User sized terminal",
          terminalTabId: "tab-user-sized",
          x: 80,
          y: 80,
          width: 820,
          height: 460,
          userSized: true,
        }],
        selectedNodeId: "node-user-sized",
        selectedNodeIds: ["node-user-sized"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await expect(page.locator("[data-testid='canvas-terminal-live-overlay'] .terminal-container")).toBeVisible();
  await expect(page.locator("[data-testid='canvas-terminal-node'] [data-testid='canvas-terminal-overlay-placeholder']")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const node = document.querySelector("[data-testid='canvas-terminal-node']");
    return {
      width: Math.round(node?.getBoundingClientRect().width ?? 0),
      height: Math.round(node?.getBoundingClientRect().height ?? 0),
    };
  })).toEqual({ width: 820, height: 460 });
});

test("readable map mounts only the primary live terminal renderer", async ({ page }) => {
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

    const tabs = Array.from({ length: 6 }, (_, index) => ({
      id: `tab-readable-${index}`,
      title: `Readable ${index}`,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: `/tmp/termfleet-readable-${index}`,
      terminals: [{
        id: `pty-readable-${index}`,
        paneId: `pane-readable-${index}`,
        cols: 80,
        rows: 24,
        status: "running",
      }],
      splitLayout: { id: `pane-readable-${index}`, type: "terminal" },
      activePaneId: `pane-readable-${index}`,
    }));

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs,
      activeTabId: "tab-readable-0",
      canvasState: {
        nodes: tabs.map((tab, index) => ({
          id: `node-readable-${index}`,
          type: "terminal",
          title: `Readable ${index}`,
          terminalTabId: tab.id,
          x: 80 + index * 140,
          y: 80,
          width: 820,
          height: 460,
        })),
        selectedNodeId: "node-readable-0",
        selectedNodeIds: ["node-readable-0"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await expect(page.locator("[data-testid='canvas-terminal-node']")).toHaveCount(6);
  await expect(page.getByTestId("canvas-terminal-live-overlay")).toHaveCount(1);
  await expect(page.locator("[data-testid='canvas-terminal-live-overlay'] .terminal-container")).toHaveCount(1);
  await expect(page.locator("[data-testid='canvas-terminal-node'] [data-testid='canvas-terminal-overlay-placeholder']")).toHaveCount(1);
});

test("task sidebar docks as an inner column flush inside the card", async ({ page }) => {
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
        id: "tab-empty-tasks",
        title: "Empty tasks terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-empty-tasks",
        terminals: [{
          id: "pty-empty-tasks",
          paneId: "pane-empty-tasks",
          cols: 80,
          rows: 24,
          status: "running",
          taskSidebarCollapsed: false,
          statusSummary: {
            task: "Running",
            path: "termfleet",
            now: "watching output",
            status: "working",
            provider: "shell",
            confidence: "medium",
            tasks: [],
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-empty-tasks", type: "terminal" },
        activePaneId: "pane-empty-tasks",
      }],
      activeTabId: "tab-empty-tasks",
      canvasState: {
        nodes: [{
          id: "node-empty-tasks",
          type: "terminal",
          title: "Empty tasks terminal",
          terminalTabId: "tab-empty-tasks",
          x: 80,
          y: 80,
          width: 820,
          height: 460,
        }],
        selectedNodeId: "node-empty-tasks",
        selectedNodeIds: ["node-empty-tasks"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  // TC-042 — the expanded list docks as an in-flow inner column of the card: the
  // terminal makes room for it, the list sits flush against the terminal content
  // (no gap) and stays INSIDE the node (no detached overhanging slab).
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  const openContentBox = await page.getByTestId("canvas-terminal-task-content").boundingBox();
  const openNodeBox = await page.getByTestId("canvas-terminal-node").boundingBox();
  const openSidebarBox = await page.getByTestId("canvas-terminal-task-sidebar").boundingBox();
  if (!openContentBox || !openNodeBox || !openSidebarBox) throw new Error("Open terminal content, sidebar, or node is not visible");
  // List is flush against the terminal content — no gap.
  expect(Math.abs(openSidebarBox.x - (openContentBox.x + openContentBox.width))).toBeLessThanOrEqual(2);
  // List stays inside the card — its right edge does not overhang the node.
  expect(openSidebarBox.x + openSidebarBox.width).toBeLessThanOrEqual(openNodeBox.x + openNodeBox.width + 2);
  await page.getByLabel("Minimize tasks").click();
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toHaveCount(0);
  const collapsedContentBox = await page.getByTestId("canvas-terminal-task-content").boundingBox();
  if (!collapsedContentBox) throw new Error("Collapsed terminal content is not visible");
  // Collapsing the list to the slim rail gives the terminal its room back.
  expect(collapsedContentBox.width).toBeGreaterThan(openContentBox.width + 100);
  await page.getByTestId("canvas-terminal-task-rail").click();
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  const reopenedContentBox = await page.getByTestId("canvas-terminal-task-content").boundingBox();
  const reopenedSidebarBox = await page.getByTestId("canvas-terminal-task-sidebar").boundingBox();
  if (!reopenedContentBox || !reopenedSidebarBox) throw new Error("Reopened terminal content or sidebar is not visible");
  expect(Math.round(reopenedContentBox.width)).toBe(Math.round(openContentBox.width));
  expect(Math.abs(reopenedSidebarBox.x - (reopenedContentBox.x + reopenedContentBox.width))).toBeLessThanOrEqual(2);
});

// TC-039/TC-042 — the expanded task list must read as ONE card with the terminal,
// not a detached floating panel. It's an in-flow inner column of the card: flush
// against the terminal content, contained within the node bounds, full height.
test("expanded task list reads as one card with the terminal", async ({ page }) => {
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
        id: "tab-onecard",
        title: "One card terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-onecard",
        terminals: [{
          id: "pty-onecard",
          paneId: "pane-onecard",
          cols: 80,
          rows: 24,
          status: "running",
          taskSidebarCollapsed: false,
          statusSummary: {
            task: "Running", path: "termfleet", now: "watching output",
            status: "working", provider: "shell", confidence: "medium",
            tasks: [], tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-onecard", type: "terminal" },
        activePaneId: "pane-onecard",
      }],
      activeTabId: "tab-onecard",
      canvasState: {
        nodes: [{
          id: "node-onecard", type: "terminal", title: "One card terminal",
          terminalTabId: "tab-onecard", x: 80, y: 80, width: 820, height: 460,
        }],
        selectedNodeId: "node-onecard",
        selectedNodeIds: ["node-onecard"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  const sidebar = page.getByTestId("canvas-terminal-task-sidebar");
  await expect(sidebar).toBeVisible();
  const nodeEl = page.getByTestId("canvas-terminal-node");
  const content = page.getByTestId("canvas-terminal-task-content");

  // The list is a real inner column of ONE card: it sits flush against the
  // terminal content (no gap) and entirely inside the node's bounds (no detached,
  // overhanging slab past the card's right edge).
  const nodeBox = await nodeEl.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  const contentBox = await content.boundingBox();
  if (!nodeBox || !sidebarBox || !contentBox) throw new Error("node, content, or sidebar not visible");
  // Flush against the terminal content — no gap.
  expect(Math.abs(sidebarBox.x - (contentBox.x + contentBox.width))).toBeLessThanOrEqual(2);
  // Contained within the card — the right edge does not overhang the node.
  expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(nodeBox.x + nodeBox.width + 2);
  // Spans the card's height (one unit with the terminal, not a floating panel).
  expect(Math.abs(sidebarBox.height - contentBox.height)).toBeLessThanOrEqual(2);
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

test("split terminal body fills the available pane height", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

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
        workspaceMode: "split",
        primarySidebarCollapsed: false,
        primarySidebarPanel: "sessions",
      },
      tabs: [{
        id: "tab-fill",
        title: "Tall terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/termfleet-fill",
        terminals: [{
          id: "pty-fill",
          paneId: "pane-fill",
          cols: 80,
          rows: 24,
          status: "running",
        }],
        splitLayout: { id: "pane-fill", type: "terminal", cwd: "/tmp/termfleet-fill" },
        activePaneId: "pane-fill",
      }],
      activeTabId: "tab-fill",
      activeTerminalId: "pty-fill",
    });
  });

  await expect(page.locator(".terminal-pane-frame")).toBeVisible();
  await expect(page.locator(".terminal-pane-frame .terminal-container")).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const pane = document.querySelector(".terminal-pane-frame");
    const container = document.querySelector(".terminal-pane-frame .terminal-container");
    const paneRect = pane?.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();
    return {
      paneHeight: Math.round(paneRect?.height ?? 0),
      containerHeight: Math.round(containerRect?.height ?? 0),
      containerBottomGap: Math.round((paneRect?.bottom ?? 0) - (containerRect?.bottom ?? 0)),
      containerTopGap: Math.round((containerRect?.top ?? 0) - (paneRect?.top ?? 0)),
    };
  });

  expect(dimensions.paneHeight).toBeGreaterThan(500);
  expect(dimensions.containerHeight).toBeGreaterThan(dimensions.paneHeight - 96);
  expect(dimensions.containerBottomGap).toBeLessThanOrEqual(2);
  expect(dimensions.containerTopGap).toBeGreaterThanOrEqual(20);
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

test("workspace store renames terminal map nodes and their linked tabs together", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string }>;
          canvasState: {
            nodes: Array<{ id: string; type: string; title: string; terminalTabId?: string }>;
          };
          addCanvasNode: (node: { id: string; type: string; title: string; x: number; y: number; width: number; height: number; terminalTabId?: string }) => void;
          renameCanvasNode: (id: string, title: string) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const activeTabId = state.activeTabId;
    if (!activeTabId) throw new Error("No active tab to link");

    state.addCanvasNode({
      id: "terminal-rename-node",
      type: "terminal",
      title: "Old terminal title",
      x: 100,
      y: 140,
      width: 820,
      height: 460,
      terminalTabId: activeTabId,
    });
    state.renameCanvasNode("terminal-rename-node", "  Build monitor  ");
    state.renameCanvasNode("terminal-rename-node", "   ");

    const next = store.getState();
    return {
      nodeTitle: next.canvasState.nodes.find((node) => node.id === "terminal-rename-node")?.title,
      tabTitle: next.tabs.find((tab) => tab.id === activeTabId)?.title,
    };
  });

  expect(result).toEqual({
    nodeTitle: "Build monitor",
    tabTitle: "Build monitor",
  });
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
  await page.evaluate(async () => {
    const { TERMINAL_INPUT_CLASS } = await import("/src/lib/terminalFocus.ts");
    const input = document.createElement("textarea");
    input.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(input);
    input.focus();
  });
  await page.evaluate(async () => {
    const { TERMINAL_INPUT_CLASS } = await import("/src/lib/terminalFocus.ts");
    const input = document.createElement("textarea");
    input.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press("Control+Z");

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

test("Delete closes the selected terminal map node and Ctrl+Z restores it", async ({ page }) => {
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
        id: "tab-delete",
        title: "Delete me",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/delete-me",
        terminals: [{ id: "pty-delete", paneId: "pane-delete", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "pane-delete", type: "terminal", cwd: "/tmp/delete-me" },
        activePaneId: "pane-delete",
      }],
      activeTabId: "tab-delete",
      activeTerminalId: "pty-delete",
      canvasState: {
        nodes: [{
          id: "node-delete",
          type: "terminal",
          title: "Delete me",
          terminalTabId: "tab-delete",
          terminalCwd: "/tmp/delete-me",
          x: 220,
          y: 140,
          width: 820,
          height: 460,
          labelColor: "#7dbac3",
        }],
        selectedNodeId: "node-delete",
        selectedNodeIds: ["node-delete"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title").filter({ hasText: "Delete me" })).toBeVisible();
  await page.locator("[data-magic-canvas-shell]").focus();
  await page.keyboard.press("Delete");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string }>;
          canvasState: { nodes: Array<{ id: string }> };
          recentlyClosed: Array<{ tab: { id: string } }>;
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return [
      state?.tabs.some((tab) => tab.id === "tab-delete"),
      state?.canvasState.nodes.some((node) => node.id === "node-delete"),
      state?.recentlyClosed[0]?.tab.id,
    ].join(":");
  })).toBe("false:false:tab-delete");

  await page.evaluate(async () => {
    const { TERMINAL_INPUT_CLASS } = await import("/src/lib/terminalFocus.ts");
    const input = document.createElement("textarea");
    input.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press("Control+Z");

  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { activeTabId: string | null };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().activeTabId;
  })).toBe("tab-delete");

  const restored = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeTabId: string | null;
          tabs: Array<{ id: string; title: string; terminals: Array<unknown>; initialCwd?: string }>;
          canvasState: {
            selectedNodeId: string | null;
            selectedNodeIds?: string[];
            nodes: Array<{ id: string; terminalTabId?: string; x: number; y: number; labelColor?: string }>;
          };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      activeTabId: state?.activeTabId,
      tab: state?.tabs.find((tab) => tab.id === "tab-delete"),
      node: state?.canvasState.nodes.find((node) => node.id === "node-delete"),
      selectedNodeId: state?.canvasState.selectedNodeId,
      selectedNodeIds: state?.canvasState.selectedNodeIds,
    };
  });

  expect(restored.activeTabId).toBe("tab-delete");
  expect(restored.tab).toMatchObject({
    id: "tab-delete",
    title: "Delete me",
    initialCwd: "/tmp/delete-me",
  });
  if (restored.tab?.terminals.length) {
    expect(restored.tab.terminals[0]).toMatchObject({
      paneId: "pane-delete",
      status: "reconnected",
    });
  }
  expect(restored.node).toMatchObject({
    id: "node-delete",
    terminalTabId: "tab-delete",
    x: 220,
    y: 140,
    labelColor: "#7dbac3",
  });
  expect(restored.selectedNodeId).toBe("node-delete");
  expect(restored.selectedNodeIds).toEqual(["node-delete"]);
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
        workspaceMode: "canvas",
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
  const lanePlan = `
| ID         | Title                            | Priority | Status            | Dependencies |
| ---------- | -------------------------------- | -------- | ----------------- | ------------ |
| TC-027     | LLM task extraction lane          | P1       | IN_PROGRESS       | -            |

### TC-027: LLM task extraction lane

Acceptance:

- DONE: Parse stable lane checklist items.
- DONE: Render completed lane tasks.
- TODO: Render remaining lane tasks.
`;
  await page.addInitScript((masterPlan) => {
    let callbackId = 1;
    const callbacks = new Map<number, unknown>();
    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(callback: unknown) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string) {
        if (command === "fs_read_file") return masterPlan;
        if (command === "daemon_status") return { reachable: false, mode: "browser" };
        if (command === "daemon_ensure_running") return { reachable: false, mode: "browser", message: "browser" };
        if (command === "grid_snapshot") {
          return JSON.stringify({
            cols: 80,
            rows: 24,
            cursor_x: 0,
            cursor_y: 0,
            cells: [],
          });
        }
        return null;
      },
    };
  }, lanePlan);

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
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: unknown[] }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
          updateCanvasNode: (id: string, updates: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
    });
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateCanvasNode(node.id, {
      taskBinding: { taskId: "TC-027", planPath: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet/MASTER_PLAN.md" },
    });
    store.getState().updateTab(tab.id, {
      title: "endlessblink",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      terminals: [{
        id: "pty-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Running 2 tests using 1 worker",
        terminalOutput: [
          "npx playwright test tests/map-terminal-rendering.spec.ts -g \"map shell header prefers summarized task path and now\" --reporter=line",
          "Running 2 tests using 1 worker",
          "… +35 lines (ctrl + t to view transcript)",
          "1 passed (10.5s)",
          "The next assertion was still expecting the sidebar to disappear when the terminal summary becomes stale. That is exactly the old changing behavior.",
          "Working (10m 52s • esc to interrupt)",
        ].join("\n"),
        statusSummary: {
          task: "Running 2 tests using 1 worker",
          path: "inner-dialogue",
          now: "stale. That is exactly the old changing behavior.",
          status: "working",
          provider: "shell",
          confidence: "medium",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("LLM task extraction lane");
  await expect(page.getByTestId("canvas-terminal-node-workspace")).toHaveText("termfleet");
  await expect(page.getByTestId("canvas-terminal-node-header-path")).toHaveText("devops/termfleet");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("map-terminal-rendering.spec.ts · grep: map shell header prefers summarized task path and now");
  await expect(page.getByTestId("canvas-terminal-node-header-title")).not.toContainText("Running 2 tests");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("stale");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toContainText("Tasks");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toContainText("3");
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(3);
  const contentBox = await page.getByTestId("canvas-terminal-task-content").boundingBox();
  const tasksBox = await page.getByTestId("canvas-terminal-task-sidebar").boundingBox();
  if (!contentBox || !tasksBox) throw new Error("Terminal content column or task sidebar is not visible");
  expect(tasksBox.x).toBeGreaterThanOrEqual(contentBox.x + contentBox.width - 1);
  expect(tasksBox.width).toBeGreaterThanOrEqual(220);
  expect(contentBox.width).toBeGreaterThan(560);
  expect(Math.abs(tasksBox.y - contentBox.y)).toBeLessThanOrEqual(1);
  const viewportBeforeTaskScroll = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { viewport: { x: number; y: number; zoom: number } } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.viewport;
  });
  await page.mouse.move(tasksBox.x + tasksBox.width / 2, tasksBox.y + Math.min(tasksBox.height - 8, 80));
  await page.mouse.wheel(0, -420);
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { viewport: { x: number; y: number; zoom: number } } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.viewport;
  })).toEqual(viewportBeforeTaskScroll);
  await expect(page.getByRole("main").getByRole("button", { name: "Close endlessblink" })).toBeVisible();

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: Array<{ paneId?: string }> }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
          updateCanvasNode: (id: string, updates: Record<string, unknown>) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    store.getState().updateCanvasNode(node.id, { taskBinding: undefined });
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

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toContainText("mirror that architecture for post rewrites");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("The editor already has a screenplay conversion preview pattern; I'll mirror that architecture for post rewrites.");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("/skills");
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
        id: "pty-playwright-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Running 2 tests using 1 worker",
        terminalOutput: [
          "npx playwright test tests/map-terminal-rendering.spec.ts -g \"map shell header prefers summarized task path and now\" --reporter=line",
          "Running 2 tests using 1 worker",
          "… +35 lines (ctrl + t to view transcript)",
          "1 passed (10.5s)",
        ].join("\n"),
        statusSummary: {
          task: "Running 2 tests using 1 worker",
          path: "devops/termfleet",
          now: "stale. That is exactly the old changing behavior.",
          status: "working",
          provider: "shell",
          confidence: "medium",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("Playwright test");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("map-terminal-rendering.spec.ts · grep: map shell header prefers summarized task path and now");
  await expect(page.getByTestId("canvas-terminal-node-header-title")).not.toContainText("Running 2 tests");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("stale");

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
        id: "pty-tool-log-summary-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Search",
        terminalOutput: [
          "I’m going to wire the real sidebar into the terminal body now. The key change is: the terminal output area becomes a two-column layout only when task rows exist; otherwise it stays unchanged.",
          "Explored",
          "Read MagicCanvas.tsx",
          "Search",
          "terminalTaskPanel|canvas-terminal-task-sidebar|agentTaskPanel|TerminalComponent|nodeBody|terminalBody|liveTerminalBody|node.type === \"terminal\" ? in MagicCanvas.tsx",
          "Read MagicCanvas.tsx",
        ].join("\n"),
        statusSummary: {
          task: "Search",
          path: "devops/termfleet",
          now: "terminalBody|liveTerminalBody|node.type ...",
          status: "working",
          provider: "shell",
          confidence: "low",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).not.toHaveText("Search");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("terminalBody|liveTerminalBody");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("canvas-terminal-task-rail")).toContainText("Tasks");
  await expect(page.getByTestId("canvas-terminal-task-rail")).toContainText("No list");
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(0);
  await expect(page.getByTestId("canvas-terminal-task-empty")).toHaveCount(0);

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
      terminals: [{
        id: "pty-plan-mode-menu-fixture",
        paneId: node.id,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Working",
        statusSummary: {
          task: "Running verify:canvas-all",
          path: "devops/termfleet",
          now: "Press enter to confirm or esc to go back",
          status: "working",
          provider: "shell",
          confidence: "medium",
          tasks: [{
            id: "stale-term",
            text: "TERM",
            provenance: "summary",
            at: Date.now(),
            excerpt: "stale bad task",
            sourceHash: "stale-term",
          }],
        },
        taskLineup: [{
          id: "stale-term",
          content: "TERM",
          status: "pending",
          source: "summary",
          updatedAt: Date.now(),
        }],
        terminalOutput: [
          "Implement this plan?",
          "› Implement the plan.",
          "1. Yes, implement this plan",
          "2. Yes, clear context and implement",
          "3. No, stay in Plan mode",
          "Press enter to confirm or esc to go back",
        ].join("\n"),
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(0);

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
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateTab(tab.id, {
      terminals: [{
        id: "pty-real-prompt-fixture",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Working",
        terminalOutput: [
          "Working (48s • esc to interrupt)",
          "› Find and fix a bug in @filename",
          "gpt-5.5 default",
        ].join("\n"),
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(0);

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: Array<{ paneId?: string }> }>;
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
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateTab(tab.id, {
      terminals: [{
        id: "pty-lineup-state-fixture",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Working",
        terminalOutput: [
          "Random terminal text that must not become tasks.",
          "› Delete text in the TUI",
          "Working on the task sidebar.",
        ].join("\n"),
        taskLineup: [
          {
            id: "todo-sidebar-canonical",
            content: "Make the sidebar source canonical",
            status: "in_progress",
            source: "todo-write",
            updatedAt: 1000,
          },
          {
            id: "todo-sidebar-scope",
            content: "Show only the agent/current lane's lineup",
            status: "pending",
            source: "todo-write",
            updatedAt: 1000,
          },
          {
            id: "todo-sidebar-done",
            content: "Render completed tasks crossed and muted",
            status: "completed",
            source: "todo-write",
            updatedAt: 1000,
          },
        ],
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toContainText("Tasks");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toContainText("3");
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(3);

  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; title: string; terminals: Array<Record<string, unknown>> }>;
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
    const terminal = tab.terminals[0];
    store.getState().updateTab(tab.id, {
      terminals: [{
        ...terminal,
        terminalOutput: [
          "Implement this plan?",
          "1. Yes, implement this plan",
          "2. No, stay in Plan mode",
          "TERM",
        ].join("\n"),
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(3);
  await expect(page.getByTestId("canvas-terminal-task-row").nth(0)).toContainText("Make the sidebar source canonical");
  await expect(page.getByTestId("canvas-terminal-task-row").nth(1)).toContainText("Show only the agent/current lane");
  await expect(page.getByTestId("canvas-terminal-task-row").nth(2)).toContainText("Render completed tasks crossed and muted");
});

test("map terminal task rail opens a visible canonical checklist", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: Array<Record<string, unknown>> }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
          updateCanvasNode: (id: string, updates: Record<string, unknown>) => void;
          selectCanvasNode: (id: string) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateCanvasNode(node.id, {
      x: 80,
      y: 130,
      width: 760,
      height: 520,
    });
    store.getState().selectCanvasNode(node.id);
    store.getState().updateTab(tab.id, {
      terminals: [{
        id: "pty-task-rail-click-visual",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        activeRunId: "run-2",
        currentActivity: "Working",
        taskSidebarCollapsed: true,
        terminalOutput: [
          "Implement this plan?",
          "1. Yes, implement this plan",
          "TERM",
        ].join("\n"),
        taskLineup: [
          { id: "legacy-random", content: "This stale operator row must not render", status: "in_progress", source: "operator", updatedAt: 1 },
          { id: "summary-random", content: "This stale summary row must not render", status: "pending", source: "summary", updatedAt: 1 },
          { id: "todo-old-run", runId: "run-1", content: "Summarize recent commits", status: "completed", source: "todo-write", updatedAt: 1 },
          { id: "todo-one", runId: "run-2", content: "Keep task state canonical", status: "in_progress", source: "todo-write", updatedAt: 2 },
          { id: "todo-two", runId: "run-2", content: "Open the rail into a stable list", status: "pending", source: "todo-write", updatedAt: 2 },
          { id: "todo-three", runId: "run-2", content: "Show completed tasks crossed out", status: "completed", source: "todo-write", updatedAt: 2 },
        ],
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-task-rail")).toContainText("Tasks");
  await expect(page.getByTestId("canvas-terminal-task-rail")).toContainText("3");
  await page.getByTestId("canvas-terminal-task-rail").click();

  await expect(page.getByTestId("canvas-terminal-task-sidebar")).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(3);
  await expect(page.getByTestId("canvas-terminal-task-row")).toContainText([
    "Keep task state canonical",
    "Open the rail into a stable list",
    "Show completed tasks crossed out",
  ]);
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).not.toContainText("stale operator");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).not.toContainText("stale summary");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).not.toContainText("Summarize recent commits");
  await expect(page.getByTestId("canvas-terminal-task-sidebar")).not.toContainText(/Task 1\/|operator task list|summary/i);

  const sidebarBox = await page.getByTestId("canvas-terminal-task-sidebar").boundingBox();
  expect(sidebarBox).toBeTruthy();
  const screenshot = await page.screenshot({ fullPage: true });
  const stats = await imageRegionStats(page, screenshot, sidebarBox!);
  expect(stats.brightPixels).toBeGreaterThan(180);
  expect(stats.edgePixels).toBeGreaterThan(260);
});

test("map shell header uses durable activity instead of stale transcript summary", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string; terminals: unknown[] }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
    });
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateTab(tab.id, {
      title: "Terminal",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      terminals: [{
        id: "pty-durable-activity-fixture",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "web$ npm run unfinished prompt text",
        durableActivity: {
          title: "Testing checkout flow",
          subtitle: "12 tests · Chromium",
          status: "running",
          command: "npx playwright test tests/checkout.spec.ts",
          source: "command",
          startedAt: 1000,
          updatedAt: 2000,
        },
        terminalOutput: [
          "npx playwright test tests/checkout.spec.ts --project=chromium",
          "Running 12 tests using 1 worker",
          "web$ npm run unfinished prompt text",
        ].join("\n"),
        statusSummary: {
          task: "Search",
          path: "devops/termfleet",
          now: "web$ npm run unfinished prompt text",
          status: "working",
          provider: "shell",
          confidence: "high",
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveText("Testing checkout flow");
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("12 tests · Chromium");
  await expect(page.getByTestId("canvas-terminal-node-header-title")).not.toHaveText("Search");
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("unfinished prompt");
  await expect(page.getByTestId("canvas-terminal-task-rail")).toContainText("No list");
  await expect(page.getByTestId("canvas-terminal-task-row")).toHaveCount(0);
  await expect(page.getByTestId("canvas-terminal-task-rail")).not.toContainText("Testing checkout flow");
});

test("map shell header replaces source-file activity with readable task activity", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: unknown[] }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
    });
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateTab(tab.id, {
      title: "bina-ve-ze",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze",
      terminals: [{
        id: "pty-map-source-file-activity",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Editing ModelScene.tsx",
        statusSummary: {
          task: "#36 Bottom-sheet pull-up + clearer launcher button",
          path: "web-dev/bina-ve-ze",
          now: "Editing ModelScene.tsx",
          status: "working",
          provider: "codex",
          confidence: "high",
          tasksFromTodoWrite: true,
        },
        taskLineup: [{
          id: "task-36",
          content: "#36 Bottom-sheet pull-up + clearer launcher button",
          status: "in_progress",
          source: "todo-write",
          updatedAt: Date.now(),
        }],
        terminalOutput: "Editing ModelScene.tsx\n[OMC] thinking",
      }],
    });
  });

  // The activity only restates the task ("Improving <task>"), so there is no distinct
  // second line: the task itself becomes the one prominent line and the raw source-file
  // activity ("ModelScene.tsx") never surfaces.
  await expect(page.getByTestId("canvas-terminal-node-description")).toHaveText("#36 Bottom-sheet pull-up + clearer launcher button");
  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveCount(0);
  await expect(page.getByTestId("canvas-terminal-node-now")).not.toContainText("ModelScene.tsx");
});

test("map shell header treats ready prompt as idle instead of capture failure", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: unknown[] }>;
          canvasState: { nodes: Array<{ id: string; type: string; terminalTabId?: string }> };
          updateTab: (id: string, updates: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
    });
    const node = state.canvasState.nodes.find((candidate) => candidate.type === "terminal");
    if (!node?.terminalTabId) throw new Error("Terminal map node is unavailable");
    const tab = state.tabs.find((candidate) => candidate.id === node.terminalTabId);
    if (!tab) throw new Error("Terminal tab is unavailable");
    const paneId = tab.activePaneId ?? node.id;
    store.getState().updateTab(tab.id, {
      title: "termfleet",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      terminals: [{
        id: "pty-map-ready-prompt",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "TF_HDR_DONE",
        terminalVisibleText: "endlessblink@endlessblink:/repo/termfleet$",
        terminalOutput: "done\nendlessblink@endlessblink:/repo/termfleet$",
        statusSummary: {
          task: "Ready",
          path: "devops/termfleet",
          now: "Awaiting command",
          status: "working",
          provider: "shell",
          confidence: "low",
          tasksFromTodoWrite: false,
        },
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-node-description")).toHaveText("Task not captured");
  // An idle pane with no distinct step collapses to the single honest Task line — the
  // "Now Active" row is hidden rather than restating a bare "Idle" status word.
  await expect(page.getByTestId("canvas-terminal-node-header-title")).toHaveCount(0);
  await expect(page.getByTestId("canvas-terminal-node-now")).toHaveText("Idle");
});

test("split shell header uses the same durable summary policy as the map", async ({ page }) => {
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
          tabs: Array<{ id: string; title: string; activePaneId?: string; terminals: unknown[] }>;
          updateTab: (id: string, updates: Record<string, unknown>) => void;
          setWorkspaceMode: (mode: "split" | "canvas" | "graph") => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "split",
      },
    });
    store.getState().setWorkspaceMode("split");
    const tab = state.tabs[0];
    if (!tab) throw new Error("Terminal tab is unavailable");
    const paneId = tab.activePaneId ?? "root";
    store.getState().updateTab(tab.id, {
      title: "Terminal",
      initialCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      terminals: [{
        id: "pty-split-durable-policy-fixture",
        paneId,
        cols: 100,
        rows: 30,
        status: "running",
        currentActivity: "Search",
        durableActivity: {
          title: "Checking activity summary wording",
          subtitle: "terminal status summary contract · 1 test · 1 worker",
          targetPath: "tests/agent-status-summary.spec.ts",
          status: "running",
          command: "npx playwright test tests/agent-status-summary.spec.ts",
          source: "command",
          startedAt: 1000,
          updatedAt: 2000,
        },
        terminalOutput: [
          "npx playwright test tests/agent-status-summary.spec.ts",
          "Running 1 test using 1 worker",
          "web$ npm run unfinished prompt text",
        ].join("\n"),
        statusSummary: {
          task: "Search",
          path: "stale/project",
          now: "web$ npm run unfinished prompt text",
          status: "working",
          provider: "shell",
          confidence: "high",
        },
      }],
    });
  });

  await expect(page.getByTestId("split-terminal-summary-task")).toHaveText("Checking activity summary wording");
  await expect(page.getByTestId("split-terminal-summary-path")).toContainText("tests/agent-status-summary.spec.ts");
  await expect(page.getByTestId("split-terminal-summary-now")).toContainText("terminal status summary contract · 1 test · 1 worker");
  await expect(page.getByTestId("split-terminal-summary-task")).not.toHaveText("Search");
  await expect(page.getByTestId("split-terminal-summary-now")).not.toContainText("unfinished prompt");
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
      activeGroupFilter: null,
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

test("terminal folders reconcile into project rows without moving the map viewport", async ({ page }) => {
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
          reconcileProjectGroups: () => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const terminalTab = (id: string, title: string, paneId: string, initialCwd?: string) => ({
      id,
      title,
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "sessions",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
      groups: [{
        id: "group-termfleet",
        name: "TermFleet OSS",
        color: "#7aa2f7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      }],
      terminalGroups: [{
        id: "group-termfleet",
        name: "TermFleet OSS",
        color: "#7aa2f7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      }],
      tabs: [
        terminalTab("tab-termfleet", "TermFleet shell", "pane-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet"),
        terminalTab("tab-docs", "Docs shell", "pane-docs", "/media/endlessblink/data/my-projects/ai-development/docs-site"),
        terminalTab("tab-inner", "Inner Dialogue shell", "pane-inner"),
      ],
      activeTabId: "tab-termfleet",
      activeGroupFilter: null,
      activeGroupId: null,
      projectRoot: null,
      canvasState: {
        selectedNodeId: "node-termfleet",
        selectedNodeIds: ["node-termfleet"],
        viewport: { x: -321, y: 88, zoom: 0.62 },
        nodes: [
          { id: "node-termfleet", type: "terminal", title: "TermFleet shell", terminalTabId: "tab-termfleet", x: 0, y: 0, width: 620, height: 420 },
          { id: "node-docs", type: "terminal", title: "Docs shell", terminalTabId: "tab-docs", x: 660, y: 0, width: 620, height: 420 },
          { id: "node-inner", type: "terminal", title: "Inner Dialogue shell", terminalTabId: "tab-inner", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue", x: 1320, y: 0, width: 620, height: 420 },
        ],
      },
    });
    store.getState().reconcileProjectGroups();
  });

  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  await expect(sidebar.getByRole("button", { name: "Switch to TermFleet OSS" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Switch to docs-site" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Switch to inner-dialogue" })).toBeVisible();

  const reconciled = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          groups: Array<{ id: string; name: string; projectRoot?: string }>;
          canvasState: { viewport: { x: number; y: number; zoom: number } };
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return {
      groups: state?.groups.map((group) => ({
        name: group.name,
        root: group.projectRoot,
        count: state.tabs.filter((tab) => tab.groupId === group.id).length,
      })),
      viewport: state?.canvasState.viewport,
    };
  });
  expect(reconciled.groups).toEqual([
    {
      name: "TermFleet OSS",
      root: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      count: 1,
    },
    {
      name: "docs-site",
      root: "/media/endlessblink/data/my-projects/ai-development/docs-site",
      count: 1,
    },
    {
      name: "inner-dialogue",
      root: "/media/endlessblink/data/my-projects/ai-development/content-creation/inner-dialogue",
      count: 1,
    },
  ]);
  expect(reconciled.viewport).toEqual({ x: -321, y: 88, zoom: 0.62 });

  await sidebar.getByRole("button", { name: "Switch to docs-site" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeGroupFilter: string | null;
          groups: Array<{ id: string; name: string }>;
        };
      };
    }).__termfleetWorkspaceStore;
    const state = store?.getState();
    return state?.groups.find((group) => group.id === state.activeGroupFilter)?.name;
  })).toBe("docs-site");
  await expect(sidebar.getByText("Docs shell")).toBeVisible();
  await expect(sidebar.getByText("TermFleet shell")).not.toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { canvasState: { viewport: { x: number; y: number; zoom: number } } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().canvasState.viewport;
  })).toEqual({ x: -321, y: 88, zoom: 0.62 });
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
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied?.at(-1)
  )).toBe("http://localhost:5177");
  if (await mapPanel.getByTestId("map-local-service-action-status").count()) {
    await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("URL copied");
  }

  await mapPanel.getByRole("button", { name: "Copy logs for http://localhost:5177" }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __termfleetCopied?: string[] }).__termfleetCopied?.at(-1)
  )).toContain("GET / 200");
  if (await mapPanel.getByTestId("map-local-service-action-status").count()) {
    await expect(mapPanel.getByTestId("map-local-service-action-status")).toHaveText("Logs copied");
  }

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

test("map sidebar lists every visible map terminal even when a project filter is active", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.locator('.workspace-rail-button[aria-label="Map"]').click();

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

    const tab = (id: string, groupId: string, cwd: string, paneId: string) => ({
      id,
      title: "Terminal",
      emoji: "[]",
      color: "#7aa2f7",
      groupId,
      initialCwd: cwd,
      terminals: [{ id: `pty-${id}`, paneId, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });

    const groups = [
      {
        id: "group-termfleet",
        name: "termfleet",
        color: "#7aa2f7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      },
      {
        id: "group-paperbot",
        name: "paper-bot",
        color: "#9ece6a",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot",
      },
      {
        id: "group-bina",
        name: "bina-veze",
        color: "#bb9af7",
        projectRoot: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-veze",
      },
    ];

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        canvasSidebarCollapsed: false,
        primarySidebarCollapsed: false,
        primarySidebarPanel: "map",
      },
      groups,
      terminalGroups: groups,
      activeGroupFilter: "group-termfleet",
      activeGroupId: "group-termfleet",
      activeTabId: "tab-termfleet",
      tabs: [
        tab("tab-termfleet", "group-termfleet", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", "pane-termfleet"),
        tab("tab-paperbot", "group-paperbot", "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot", "pane-paperbot"),
        tab("tab-bina", "group-bina", "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-veze", "pane-bina"),
      ],
      canvasState: {
        selectedNodeId: "node-termfleet",
        selectedNodeIds: ["node-termfleet"],
        viewport: { x: 0, y: 0, zoom: 0.7 },
        nodes: [
          { id: "node-termfleet", type: "terminal", title: "Terminal", terminalTabId: "tab-termfleet", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet", x: 0, y: 0, width: 620, height: 420 },
          { id: "node-paperbot", type: "terminal", title: "Terminal", terminalTabId: "tab-paperbot", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/bots+automation/paper-bot", x: 660, y: 0, width: 620, height: 420 },
          { id: "node-bina", type: "terminal", title: "Terminal", terminalTabId: "tab-bina", terminalCwd: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-veze", x: 1320, y: 0, width: 620, height: 420 },
        ],
      },
    });
  });

  const mapPanel = page.locator('[aria-label="Operations panel"]');
  await expect(mapPanel.getByTestId("map-filter-all")).toContainText("3");
  const nodeList = mapPanel.getByTestId("map-node-list");
  await expect(nodeList.getByText("termfleet", { exact: true })).toBeVisible();
  await expect(nodeList.getByText("paper-bot", { exact: true })).toBeVisible();
  await expect(nodeList.getByText("bina-veze", { exact: true })).toBeVisible();
});
