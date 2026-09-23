import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1274, height: 692 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function mockTauri(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
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
        if (command === "fs_read_file") return "";
        return null;
      },
      convertFileSrc(path: string) {
        return path;
      },
    };
  });
}

test("regular terminals without an agent display the SHELL signifier across split, canvas, and sidebar", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // 1. Regular terminal in split view
  await page.evaluate(() => {
    type Store = { getState: () => Record<string, any>; setState: (state: Record<string, unknown>) => void };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const tabId = "test-tab-shell";
    const paneId = "test-pane-shell";
    const group = {
      id: "group-shell",
      name: "termfleet",
      emoji: "📁",
      color: "#6ea8fe",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      tabIds: [tabId],
    };
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "split",
        primarySidebarCollapsed: false,
        primarySidebarPanel: "sessions",
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      activeGroupId: group.id,
      projectRoot: group.projectRoot,
      activeTabId: tabId,
      liveSessionIds: [paneId],
      canvasState: {
        selectedNodeId: "node-shell",
        selectedNodeIds: ["node-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-shell",
          type: "terminal",
          title: "Terminal 1",
          terminalTabId: tabId,
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: tabId,
        title: "Terminal 1",
        emoji: "📁",
        color: "#6ea8fe",
        groupId: group.id,
        initialCwd: group.projectRoot,
        splitLayout: { id: paneId, type: "terminal" },
        activePaneId: paneId,
        terminals: [{
          id: paneId,
          paneId,
          cols: 80,
          rows: 24,
          status: "running",
          agentProvider: "shell",
          terminalOutput: "bash-5.2$ ls\npackage.json src\n",
          statusSummary: {
            task: "Running local build commands",
            path: "devops/termfleet",
            now: "idle prompt",
            status: "ready",
            provider: "shell",
          },
        }],
      }],
    });
  });

  // Split pane header signifier
  const splitSignifier = page.getByTestId("split-terminal-regular-signifier");
  await expect(splitSignifier).toBeVisible();
  await expect(splitSignifier).toHaveText("SHELL");
  await expect(splitSignifier.getByTestId("terminal-signifier-logo-shell")).toBeVisible();
  await expect(page.locator('.terminal-pane-frame[data-terminal-kind="shell"]')).toBeVisible();

  // Sidebar session signifier
  const sidebarSignifier = page.getByTestId("sidebar-session-regular-signifier");
  await expect(sidebarSignifier).toBeVisible();
  await expect(sidebarSignifier).toContainText("SHELL");
  await expect(sidebarSignifier.getByTestId("terminal-signifier-logo-shell")).toBeVisible();

  // 2. Switch to canvas mode
  await page.evaluate(() => {
    type Store = { getState: () => Record<string, any>; setState: (state: Record<string, unknown>) => void };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
      },
    });
  });

  // Canvas card signifier
  const canvasSignifier = page.getByTestId("canvas-terminal-regular-signifier").first();
  await expect(canvasSignifier).toBeVisible();
  await expect(canvasSignifier).toHaveText("SHELL");
  await expect(canvasSignifier.getByTestId("terminal-signifier-logo-shell")).toBeVisible();

  // 3. Upgrade to an agent terminal (e.g. Codex / GPT)
  await page.evaluate(() => {
    type Store = { getState: () => Record<string, any>; setState: (state: Record<string, unknown>) => void };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      tabs: state.tabs.map((tab: Record<string, any>) => ({
        ...tab,
        workstream: {
          kind: "agent",
          provider: "codex",
          mission: "Writing features",
        },
        terminals: tab.terminals.map((terminal: Record<string, any>) => ({
          ...terminal,
          agentProvider: "codex",
          statusSummary: {
            ...terminal.statusSummary,
            provider: "codex",
            status: "working",
          },
        })),
      })),
    });
  });

  // In canvas: agent provider chip appears, regular signifier is gone
  await expect(page.getByTestId("canvas-terminal-agent-provider")).toBeVisible();
  await expect(page.getByTestId("canvas-terminal-agent-provider")).toHaveText("GPT");
  await expect(page.getByTestId("canvas-terminal-regular-signifier")).toHaveCount(0);

  // In sidebar: agent provider chip appears, regular signifier is gone
  await expect(page.getByTestId("sidebar-session-agent-provider")).toBeVisible();
  await expect(page.getByTestId("sidebar-session-agent-provider")).toContainText("GPT");
  await expect(page.getByTestId("sidebar-session-regular-signifier")).toHaveCount(0);
});
