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

test("verify waiting for hydration fixes the race condition", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // Wait for initial hydration to complete
  await page.waitForFunction(() => {
    const store = (window as any).__termfleetWorkspaceStore?.getState();
    return store && store.hydrating === false;
  });

  // Seed split terminal
  await page.evaluate(() => {
    const store = (window as any).__termfleetWorkspaceStore;
    const tabKey = "tab-shell";
    const paneKey = "pane-shell";
    const ptyKey = "pty-shell";
    const group = {
      id: "group-termfleet",
      name: "termfleet",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: tabKey,
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: tabKey,
      activeTerminalId: ptyKey,
      canvasState: {
        selectedNodeId: "node-shell",
        selectedNodeIds: ["node-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-shell",
          type: "terminal",
          title: "Terminal",
          terminalTabId: tabKey,
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: tabKey,
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: ptyKey,
          paneId: paneKey,
          cols: 100,
          rows: 28,
          status: "running",
          agentProvider: "codex",
          terminalOutput: "bash-5.2$",
          statusSummary: {
            task: "Improving terminal-summary visual headers",
            path: "devops/termfleet",
            now: "frontend build passed",
            status: "done",
            provider: "codex",
            confidence: "high",
          },
        }],
        splitLayout: { id: paneKey, type: "terminal" },
        activePaneId: paneKey,
      }],
    });
  });

  await expect(page.getByTestId("canvas-terminal-agent-provider")).toHaveText("GPT");
  console.log("SUCCESS! canvas-terminal-agent-provider has GPT!");
});
