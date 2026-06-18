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
