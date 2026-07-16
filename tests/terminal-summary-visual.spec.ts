import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1274, height: 692 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

const noisyTask =
  "The visual app surface now reports the intended hierarchy in the split header: title Validating terminal-summary behavior on map cards, path devops/termfleet, and Now map terminal source checks passed.";

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

async function seedSplitTerminal(
  page: import("@playwright/test").Page,
  activity: Record<string, unknown> = {
    title: "Building frontend",
    subtitle: "TypeScript and Vite production build",
    status: "success",
    command: "npm run build",
    source: "command",
    updatedAt: 1000,
  },
  options: { includePurpose?: boolean; outputLines?: string[] } = {},
) {
  await page.evaluate(({ taskText, activity, includePurpose, outputLines }) => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const group = {
      id: "group-termfleet",
      name: "termfleet",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: "tab-shell",
    };

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "split",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-shell",
      activeTerminalId: "pty-shell",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-shell",
        selectedNodeIds: ["node-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-shell",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-shell",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-shell",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-shell",
          paneId: "pane-shell",
          cols: 100,
          rows: 28,
          status: "running",
          durableActivity: activity,
          purpose: includePurpose ? {
            title: "Improving terminal-summary visual headers",
            source: "task-binding",
            updatedAt: 1000,
          } : undefined,
          terminalOutput: (outputLines ?? [
            taskText,
            "Viewed Image",
            "/tmp/tc-032-contextual-summary-split.png",
            "npm run build",
            "built in 2.4s",
          ]).join("\n"),
          taskLineup: includePurpose ? [{
            id: "task-visual-headers",
            content: "Improving terminal-summary visual headers",
            status: "in_progress",
            source: "todo-write",
            updatedAt: 1000,
          }] : undefined,
          statusSummary: {
            task: taskText,
            path: "devops/termfleet",
            now: "frontend build passed",
            status: "done",
            provider: "shell",
            confidence: "high",
            tasks: [{ id: "1", text: taskText, status: "done" }],
          },
        }],
        splitLayout: { id: "pane-shell", type: "terminal" },
        activePaneId: "pane-shell",
      }],
    });
  }, { taskText: noisyTask, activity, includePurpose: options.includePurpose ?? true, outputLines: options.outputLines });
}

test("running agent identity is visible in the terminal header and sidebar", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await seedSplitTerminal(page);

  await page.evaluate(() => {
    type Store = {
      getState: () => Record<string, any>;
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: false,
        canvasSidebarCollapsed: false,
      },
      tabs: state.tabs.map((tab: Record<string, any>) => ({
        ...tab,
        terminals: tab.terminals.map((terminal: Record<string, any>) => ({
          ...terminal,
          agentProvider: "codex",
          statusSummary: { ...terminal.statusSummary, provider: "codex", status: "working" },
        })),
      })),
    });
  });

  await expect(page.getByTestId("canvas-terminal-agent-provider")).toHaveText("GPT");
  await expect(page.getByTestId("sidebar-session-agent-provider")).toContainText("GPT");
  await expect(page.getByTestId("canvas-terminal-agent-provider").getByTestId("agent-provider-logo-codex")).toBeVisible();
  await page.screenshot({ path: "/tmp/termfleet-agent-identity-gpt.png" });

  await page.evaluate(() => {
    type Store = { getState: () => Record<string, any>; setState: (state: Record<string, unknown>) => void };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    const state = store.getState();
    store.setState({
      tabs: state.tabs.map((tab: Record<string, any>) => ({
        ...tab,
        terminals: tab.terminals.map((terminal: Record<string, any>) => ({
          ...terminal,
          statusSummary: { ...terminal.statusSummary, provider: "shell" },
        })),
      })),
    });
  });
  await expect(page.getByTestId("canvas-terminal-agent-provider")).toHaveText("GPT");

  await page.evaluate(() => {
    type Store = { getState: () => Record<string, any>; setState: (state: Record<string, unknown>) => void };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    const state = store.getState();
    store.setState({
      tabs: state.tabs.map((tab: Record<string, any>) => ({
        ...tab,
        terminals: tab.terminals.map((terminal: Record<string, any>) => ({
          ...terminal,
          agentProvider: "claude",
          statusSummary: { ...terminal.statusSummary, provider: "claude" },
        })),
      })),
    });
  });

  await expect(page.getByTestId("canvas-terminal-agent-provider")).toHaveText("CLAUDE");
  await expect(page.getByTestId("sidebar-session-agent-provider")).toContainText("CLAUDE");
  await expect(page.getByTestId("canvas-terminal-agent-provider").getByTestId("agent-provider-logo-claude")).toBeVisible();
  await page.screenshot({ path: "/tmp/termfleet-agent-identity-claude.png" });
});

test("regular split header rejects noisy scrollback titles and fits the current activity title", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await seedSplitTerminal(page);

  const title = page.getByTestId("split-terminal-summary-task");
  const now = page.getByTestId("split-terminal-summary-now");
  const path = page.getByTestId("split-terminal-summary-path");

  await expect(title).toHaveText("frontend build passed");
  await expect(title).not.toContainText("The visual app surface");
  await expect(now).toBeHidden();
  await expect(now).not.toContainText("The visual app surface");
  await expect(path).toContainText("/media/endlessblink/data/my-projects/ai-development/devops/termfleet");

  const metrics = await title.evaluate((element) => ({
    text: element.textContent?.trim() ?? "",
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.text.length).toBeLessThanOrEqual(64);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  await page.locator(".terminal-pane-frame").first().screenshot({
    path: "/tmp/tc-032-terminal-summary-visual.png",
  });

  await seedSplitTerminal(page, {
    title: "Playwright tests passed",
    subtitle: "terminal status summary contract · 31 passed · 933ms",
    targetPath: "tests/agent-status-summary.spec.ts",
    status: "success",
    command: "npx playwright test tests/agent-status-summary.spec.ts",
    source: "command",
    updatedAt: 2000,
  });

  await expect(title).toHaveText("frontend build passed");
  await expect(now).toBeHidden();
  await expect(now).not.toContainText("The visual app surface");
  const afterCommandChange = await title.evaluate((element) => element.textContent?.trim() ?? "");
  expect(afterCommandChange).toBe(metrics.text);
});

test("regular split header neutralizes stale verifier text when there is no real task", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await seedSplitTerminal(page, {
    title: "Terminal summary visual checks failed",
    subtitle: "headed app terminal summary visual contract",
    status: "error",
    command: "npm run verify:terminal-summary-visual",
    source: "command",
    updatedAt: 1000,
  }, {
    includePurpose: false,
    outputLines: [
      "Visually verify headed text paste and image paste",
      "I’m making the split stricter now: image-only paste uses negotiated bracketed mode.",
      "npm run verify:terminal-summary-visual",
      "terminal summary visual checks failed",
    ],
  });

  await expect(page.getByTestId("split-terminal-summary-task")).toHaveText("Idle");
  await expect(page.getByTestId("split-terminal-summary-task")).not.toContainText("bracketed paste");
  await expect(page.getByTestId("split-terminal-summary-now")).toBeHidden();
});

test("regular split header uses current agent prompt over stale verifier command", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await seedSplitTerminal(page, {
    title: "Checking keymap",
    subtitle: "npm run verify:keymap",
    status: "error",
    command: "npm run verify:keymap",
    source: "command",
    updatedAt: 1000,
  }, {
    includePurpose: false,
    outputLines: [
      "Ran git status --short",
      "Working (1m 05s • esc to interrupt)",
      "› Write tests for @filename",
      "reverse-i-search:",
    ],
  });

  await expect(page.getByTestId("split-terminal-summary-task")).toHaveText("Needs attention");
  await expect(page.getByTestId("split-terminal-summary-task")).not.toContainText("keymap");
  await expect(page.getByTestId("split-terminal-summary-now")).toBeHidden();
  await expect(page.getByTestId("split-terminal-summary-now")).not.toContainText("keymap");
});

test("regular map header rejects noisy scrollback titles and fits the current activity title", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await seedSplitTerminal(page);
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
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
    });
  });

  const title = page.getByTestId("canvas-terminal-node-header-title");
  const description = page.getByTestId("canvas-terminal-node-description");
  const taskRow = page.getByTestId("canvas-terminal-node-task-row");
  const now = page.getByTestId("canvas-terminal-node-now");
  const path = page.getByTestId("canvas-terminal-node-header-path");

  await expect(title).toHaveText("frontend build passed");
  await expect(title).not.toContainText("The visual app surface");
  await expect(taskRow).toContainText("Task:");
  await expect(description).toContainText("Improving terminal-summary visual headers");
  await expect(description).not.toContainText("frontend build passed");
  await expect(description).not.toContainText("web$");
  await expect(description).not.toContainText("unfinished prompt");
  await expect(now).not.toContainText("The visual app surface");
  await expect(path).toContainText("devops/termfleet");
  await expect(page.getByTestId("canvas-terminal-status-block")).not.toContainText("running activity");
  await expect(page.getByTestId("canvas-terminal-status-block")).not.toContainText("model summary");

  const metrics = await title.evaluate((element) => ({
    text: element.textContent?.trim() ?? "",
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.text.length).toBeLessThanOrEqual(64);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  await page.getByTestId("canvas-terminal-node-header-title").screenshot({
    path: "/tmp/tc-032-terminal-summary-map-title.png",
  });
});

// Reproduces the REAL production failure: a plain shell with NO real task list, NO durable
// activity and NO purpose — the only signal is scraped scrollback prose, surfaced into BOTH
// `task` and `now`. That prose is terminal text, not a task description. The header must
// collapse to a clean current-activity state instead of reflecting typed/output prose.
test("map header neutralizes scraped prose when there is no real task", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const prose =
    "What was wrong: the header chunk (Workspace pill + title + path/now) sat inside a 3-column grid using auto-placement, so it landed wherever room was left.";

  await page.evaluate((proseText) => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-termfleet",
      name: "productivity",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity",
      lastActiveTabId: "tab-shell",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-prose-shell",
      activeTerminalId: "pty-prose-shell",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-prose-shell",
        selectedNodeIds: ["node-prose-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-prose-shell",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-prose-shell",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-prose-shell",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-prose-shell",
          paneId: "pane-prose-shell",
          cols: 100,
          rows: 28,
          status: "running",
          // No durableActivity, no purpose — only scraped scrollback.
          terminalOutput: [proseText, "› ", "[OMC] | thinking | session:2m"].join("\n"),
          statusSummary: {
            task: proseText,
            path: "ai-development/productivity",
            now: proseText,
            status: "working",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-prose-shell", type: "terminal" },
        activePaneId: "pane-prose-shell",
      }],
    });
  }, prose);

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "productivity" });
  const title = block.getByTestId("canvas-terminal-node-header-title");
  const description = block.getByTestId("canvas-terminal-node-description");
  const taskRow = block.getByTestId("canvas-terminal-node-task-row");
  const now = block.getByTestId("canvas-terminal-node-now");

  // The prose must not appear anywhere in the header.
  await expect(block).not.toContainText("header chunk");
  await expect(block).not.toContainText("auto-placement");
  await expect(taskRow).toContainText("Task:");
  await expect(title).toHaveText("Working");
  await expect(description).toHaveText("No task list");
  await expect(now).toContainText("Working");

  // Title fits its box (no horizontal overflow).
  const metrics = await title.evaluate((element) => ({
    text: element.textContent?.trim() ?? "",
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.text.length).toBeLessThanOrEqual(64);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  await block.screenshot({ path: "/tmp/tc-036-map-header-neutralized.png" });
});

test("map header separates missing task list from live approval request", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-productivity",
      name: "productivity",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
      lastActiveTabId: "tab-approval-shell",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-approval-shell",
      activeTerminalId: "pty-approval-shell",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-approval-shell",
        selectedNodeIds: ["node-approval-shell"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-approval-shell",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-approval-shell",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-approval-shell",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-approval-shell",
          paneId: "pane-approval-shell",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: [
            "productivity/flow-state . npm run test:e2e",
            "Confirm: permanently delete the E2E test account from PRODUCTION? Account playwright@test.flowstate (UUID 47cade92...), removing its tasks, projects, tombstones, and auth user.",
            "1. Yes, delete it from prod",
            "2. No, leave it",
            "3. Type something.",
            "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
          ].join("\n"),
        }],
        splitLayout: { id: "pane-approval-shell", type: "terminal" },
        activePaneId: "pane-approval-shell",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "productivity" });
  const title = block.getByTestId("canvas-terminal-node-header-title");
  const description = block.getByTestId("canvas-terminal-node-description");
  const taskRow = block.getByTestId("canvas-terminal-node-task-row");
  const now = block.getByTestId("canvas-terminal-node-now");

  await expect(title).toHaveText("Waiting for operator selection");
  await expect(title).not.toHaveText("No task list");
  await expect(title).not.toContainText("permanently delete");
  await expect(description).toHaveText("No task list");
  await expect(taskRow).toContainText("Task:");
  await expect(now).toContainText("Waiting for operator selection");
});

test("map header prefers active next-step prompt over stale durable command", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-bina-ve-ze",
      name: "bina-ve-ze",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze",
      lastActiveTabId: "tab-next-step-prompt",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-next-step-prompt",
      activeTerminalId: "pty-next-step-prompt",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-next-step-prompt",
        selectedNodeIds: ["node-next-step-prompt"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-next-step-prompt",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-next-step-prompt",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-next-step-prompt",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-next-step-prompt",
          paneId: "pane-next-step-prompt",
          cols: 100,
          rows: 28,
          status: "running",
          durableActivity: {
            title: "npm test",
            command: "npm test",
            status: "running",
            updatedAt: Date.now(),
          },
          terminalOutput: [
            "This is a clean checkpoint. The fallback from before is intact.",
            "",
            "Where to go:",
            "□ Next step",
            "",
            "The GI-lightmap pipeline is proven end-to-end. How do you want to proceed?",
            "1. Commit + pause here",
            "2. Push on to full shell now",
            "3. Commit, then continue",
            "4. Type something.",
            "Enter to select · ↑/↓ to navigate · Esc to cancel",
          ].join("\n"),
        }],
        splitLayout: { id: "pane-next-step-prompt", type: "terminal" },
        activePaneId: "pane-next-step-prompt",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "bina-ve-ze" });
  await expect(block.getByTestId("canvas-terminal-node-header-title")).toHaveText("Waiting for operator selection");
  await expect(block.getByTestId("canvas-terminal-node-now")).toHaveText("Waiting for operator selection");
  await expect(block.getByTestId("canvas-terminal-node-description")).toHaveText("No task list");
  await expect(block).not.toContainText("npm test");
});

test("map header keeps live cwd when persisted summary path belongs to another project", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-flow-state",
      name: "flow-state",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
      lastActiveTabId: "tab-stale-path",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-stale-path",
      activeTerminalId: "pty-stale-path",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-stale-path",
        selectedNodeIds: ["node-stale-path"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-stale-path",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-stale-path",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-stale-path",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-stale-path",
          paneId: "pane-stale-path",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: ["› lets", "gpt-5.5 default · /media/endlessblink/data/my-projects/ai-development/productivity/flow-state"].join("\n"),
          statusSummary: {
            task: "Ready",
            path: "income-zen",
            now: "income-zen",
            status: "idle",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-stale-path", type: "terminal" },
        activePaneId: "pane-stale-path",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });
  const path = block.getByTestId("canvas-terminal-node-header-path");
  const now = block.getByTestId("canvas-terminal-node-now");

  await expect(path).toContainText("productivity/flow-state");
  await expect(path).not.toContainText("income-zen");
  await expect(now).toHaveText("Idle");
  await expect(now).not.toContainText("income-zen");
});

test("map header drops stale task-summary now labels from another project", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-flow-state-task-summary",
      name: "flow-state",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
      lastActiveTabId: "tab-flow-state-task-summary",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-flow-state-task-summary",
      activeTerminalId: "pty-flow-state-task-summary",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-flow-state-task-summary",
        selectedNodeIds: ["node-flow-state-task-summary"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-flow-state-task-summary",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-flow-state-task-summary",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-flow-state-task-summary",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-flow-state-task-summary",
          paneId: "pane-flow-state-task-summary",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: "› Verify the KDE widget guard works",
          statusSummary: {
            task: "Verifying the KDE widget guard",
            path: "productivity/flow-state",
            now: "income-zen",
            status: "working",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: true,
            tasks: [{ id: "task-1", text: "Verifying the KDE widget guard", status: "in_progress" }],
          },
        }],
        splitLayout: { id: "pane-flow-state-task-summary", type: "terminal" },
        activePaneId: "pane-flow-state-task-summary",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });
  await expect(block.getByTestId("canvas-terminal-node-header-path")).toContainText("productivity/flow-state");
  await expect(block.getByTestId("canvas-terminal-node-header-title")).toHaveText("Verifying the KDE widget guard");
  await expect(block.getByTestId("canvas-terminal-node-now")).toHaveText("Working");
  await expect(block).not.toContainText("income-zen");
});

test("map header does not promote stale closeout wording when there is no task list", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-flow-state-closeout",
      name: "productivity",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
      lastActiveTabId: "tab-flow-state-closeout",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-flow-state-closeout",
      activeTerminalId: "pty-flow-state-closeout",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-flow-state-closeout",
        selectedNodeIds: ["node-flow-state-closeout"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-flow-state-closeout",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-flow-state-closeout",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-flow-state-closeout",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-flow-state-closeout",
          paneId: "pane-flow-state-closeout",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: [
            "Nothing further needed.",
            "› /done",
            "· Perusing...",
            "›",
            "flow-state :5546 (config) | Opus 4.8",
          ].join("\n"),
          statusSummary: {
            task: "Verify the working tree is clean and nothing's left uncommitted.",
            path: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
            now: "Verify the working tree is clean and nothing's left uncommitted.",
            status: "done",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-flow-state-closeout", type: "terminal" },
        activePaneId: "pane-flow-state-closeout",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });
  await expect(block).toHaveAttribute("data-header-workspace-source", "workspace");
  await expect(block).toHaveAttribute("data-header-title-source", "neutral");
  await expect(block).toHaveAttribute("data-header-now-source", "neutral");
  await expect(block.getByTestId("canvas-terminal-node-workspace")).toHaveText("flow-state");
  await expect(block.getByTestId("canvas-terminal-node-description")).toHaveText("No task list");
  await expect(block.getByTestId("canvas-terminal-node-header-title")).toHaveText("Idle");
  await expect(block.getByTestId("canvas-terminal-node-now")).toHaveText("Idle");
  await expect(block).not.toContainText("Verify the working tree is clean");
});

test("map header ignores stale durable command after a completed agent run", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-flow-state-stale-durable",
      name: "flow-state",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
      lastActiveTabId: "tab-flow-state-stale-durable",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-flow-state-stale-durable",
      activeTerminalId: "pty-flow-state-stale-durable",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-flow-state-stale-durable",
        selectedNodeIds: ["node-flow-state-stale-durable"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-flow-state-stale-durable",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-flow-state-stale-durable",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-flow-state-stale-durable",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-flow-state-stale-durable",
          paneId: "pane-flow-state-stale-durable",
          cols: 100,
          rows: 28,
          status: "reconnected",
          durableActivity: {
            title: "npm test",
            command: "npm test",
            status: "running",
            updatedAt: Date.now() - 120_000,
          },
          terminalOutput: [
            "Existing unrelated files stay untouched.",
            "Worked for 1m 24s",
            "› $sure",
            "1. Root Cause",
          ].join("\n"),
          statusSummary: {
            task: "Verify the working tree is clean and nothing's left uncommitted.",
            path: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
            now: "Verify the working tree is clean and nothing's left uncommitted.",
            status: "done",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-flow-state-stale-durable", type: "terminal" },
        activePaneId: "pane-flow-state-stale-durable",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });
  await expect(block.getByTestId("canvas-terminal-node-header-title")).toHaveText("Idle");
  await expect(block.getByTestId("canvas-terminal-node-now")).toHaveText("Idle");
  await expect(block).not.toContainText("npm test");
});

test("map header Task stays stable when stale summary and terminal text change", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => {
        workspaceUiState: Record<string, unknown>;
        tabs: Array<{
          id: string;
          terminals: Array<{ id: string; paneId: string; [key: string]: unknown }>;
          [key: string]: unknown;
        }>;
      };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-termfleet-stable-task",
      name: "termfleet",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: "tab-stable-task",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-stable-task",
      activeTerminalId: "pty-stable-task",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-stable-task",
        selectedNodeIds: ["node-stable-task"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-stable-task",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-stable-task",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-stable-task",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-stable-task",
          paneId: "pane-stable-task",
          cols: 100,
          rows: 28,
          status: "running",
          mainUserAsk: {
            text: "Fixing terminal task descriptions",
            source: "status-sidecar",
            updatedAt: 1000,
          },
          terminalOutput: "› Fix terminal task descriptions\nWorking (1m • esc to interrupt)",
          statusSummary: {
            task: "running real dev window verification",
            userTask: "Fixing terminal task descriptions",
            path: "devops/termfleet",
            now: "running real dev window verification",
            status: "working",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-stable-task", type: "terminal" },
        activePaneId: "pane-stable-task",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "termfleet" });
  const description = block.getByTestId("canvas-terminal-node-description");
  const path = block.getByTestId("canvas-terminal-node-header-path");
  const now = block.getByTestId("canvas-terminal-node-now");
  await expect(block).toHaveAttribute("data-header-task-source", "sidecar");
  await expect(block).toHaveAttribute("data-goal-source", "sidecar");
  await expect(block).toHaveAttribute("data-activity-source", "status-summary");
  await expect(block).toHaveAttribute("data-full-path", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet");
  await expect(description).toHaveText("Fixing terminal task descriptions");
  await expect(path).toHaveText("/media/endlessblink/data/my-projects/ai-development/devops/termfleet");
  await expect(now).toBeHidden();

  await page.evaluate(() => {
    type Store = {
      getState: () => { tabs: Array<{ id: string; terminals: Array<{ id: string; [key: string]: unknown }>; [key: string]: unknown }> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    store.setState({
      tabs: state.tabs.map((tab) =>
        tab.id === "tab-stable-task"
          ? {
              ...tab,
              terminals: tab.terminals.map((terminal) =>
                terminal.id === "pty-stable-task"
                  ? {
                      ...terminal,
                      terminalOutput: [
                        "› Explain this codebase",
                        "Working (3s • esc to interrupt)",
                        "old scrollback line from another viewport",
                      ].join("\n"),
                      statusSummary: {
                        task: "Explaining this codebase",
                        userTask: "Explaining this codebase",
                        path: "devops/termfleet",
                        now: "Reading terminal output",
                        status: "working",
                        provider: "shell",
                        confidence: "high",
                        tasksFromTodoWrite: false,
                      },
                    }
                  : terminal,
              ),
            }
          : tab,
      ),
    });
  });

  await expect(block).toHaveAttribute("data-header-task-source", "sidecar");
  await expect(description).toHaveText("Fixing terminal task descriptions");
  await expect(block).not.toContainText("Explaining this codebase");
});

test("map header shows the full live cwd instead of compacting long paths", async ({ page }) => {
  const cwd = "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state/packages/desktop/local-api";
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate((cwd) => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-flow-state-long-path",
      name: "flow-state",
      color: "#d69a2d",
      projectRoot: cwd,
      lastActiveTabId: "tab-flow-state-long-path",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: cwd,
      activeTabId: "tab-flow-state-long-path",
      activeTerminalId: "pty-flow-state-long-path",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-flow-state-long-path",
        selectedNodeIds: ["node-flow-state-long-path"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-flow-state-long-path",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-flow-state-long-path",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-flow-state-long-path",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: cwd,
        terminals: [{
          id: "pty-flow-state-long-path",
          paneId: "pane-flow-state-long-path",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: "› Explain this codebase",
          statusSummary: {
            task: "Ready",
            path: "local-api",
            now: "Awaiting command",
            status: "idle",
            provider: "shell",
            confidence: "low",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-flow-state-long-path", type: "terminal" },
        activePaneId: "pane-flow-state-long-path",
      }],
    });
  }, cwd);

  await expect(page.getByTestId("canvas-terminal-node-header-path")).toHaveText(cwd);
});

test("map header keeps pane goals and paths isolated across projects", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const termfleetPath = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";
    const flowStatePath = "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state";
    const termfleetGroup = {
      id: "group-termfleet-isolation",
      name: "termfleet",
      color: "#d69a2d",
      projectRoot: termfleetPath,
      lastActiveTabId: "tab-termfleet-isolation",
    };
    const flowStateGroup = {
      id: "group-flow-state-isolation",
      name: "flow-state",
      color: "#70a7ff",
      projectRoot: flowStatePath,
      lastActiveTabId: "tab-flow-state-isolation",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [termfleetGroup, flowStateGroup],
      terminalGroups: [termfleetGroup, flowStateGroup],
      activeGroupFilter: null,
      projectRoot: termfleetPath,
      activeTabId: "tab-termfleet-isolation",
      activeTerminalId: "pty-termfleet-isolation",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-termfleet-isolation",
        selectedNodeIds: ["node-termfleet-isolation"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [
          {
            id: "node-termfleet-isolation",
            type: "terminal",
            title: "TermFleet",
            terminalTabId: "tab-termfleet-isolation",
            x: 80,
            y: 70,
            width: 760,
            height: 330,
          },
          {
            id: "node-flow-state-isolation",
            type: "terminal",
            title: "FlowState",
            terminalTabId: "tab-flow-state-isolation",
            x: 900,
            y: 70,
            width: 760,
            height: 330,
          },
        ],
      },
      tabs: [
        {
          id: "tab-termfleet-isolation",
          title: "Terminal",
          emoji: "[]",
          color: "#d69a2d",
          groupId: termfleetGroup.id,
          initialCwd: termfleetPath,
          terminals: [{
            id: "pty-termfleet-isolation",
            paneId: "pane-termfleet-isolation",
            cols: 100,
            rows: 28,
            status: "running",
            activeRunId: "run-termfleet",
            mainUserAsk: {
              text: "Implement TerminalHeaderState as source of truth",
              source: "status-sidecar",
              updatedAt: 1000,
              runId: "run-termfleet",
            },
            terminalOutput: "› implement terminal header state\nWorking (1m • esc to interrupt)",
            statusSummary: {
              task: "Implementing terminal header state",
              userTask: "Implement TerminalHeaderState as source of truth",
              path: termfleetPath,
              now: "Wiring map and split headers",
              status: "working",
              provider: "shell",
              confidence: "high",
              tasksFromTodoWrite: false,
            },
          }],
          splitLayout: { id: "pane-termfleet-isolation", type: "terminal" },
          activePaneId: "pane-termfleet-isolation",
        },
        {
          id: "tab-flow-state-isolation",
          title: "Terminal",
          emoji: "[]",
          color: "#70a7ff",
          groupId: flowStateGroup.id,
          initialCwd: flowStatePath,
          terminals: [{
            id: "pty-flow-state-isolation",
            paneId: "pane-flow-state-isolation",
            cols: 100,
            rows: 28,
            status: "running",
            activeRunId: "run-flow-state",
            mainUserAsk: {
              text: "Implement TerminalHeaderState as source of truth",
              source: "status-sidecar",
              updatedAt: 1000,
              runId: "run-termfleet",
            },
            terminalOutput: "› explain this codebase\nWorking (1m • esc to interrupt)",
            statusSummary: {
              task: "Ready",
              path: flowStatePath,
              now: "Awaiting command",
              status: "idle",
              provider: "shell",
              confidence: "low",
              tasksFromTodoWrite: false,
            },
          }],
          splitLayout: { id: "pane-flow-state-isolation", type: "terminal" },
          activePaneId: "pane-flow-state-isolation",
        },
      ],
    });
  });

  const termfleetBlock = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "termfleet" });
  const flowStateBlock = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });

  await expect(termfleetBlock).toHaveAttribute("data-pane-id", "pane-termfleet-isolation");
  await expect(termfleetBlock).toHaveAttribute("data-goal-source", "sidecar");
  await expect(termfleetBlock).toHaveAttribute("data-full-path", "/media/endlessblink/data/my-projects/ai-development/devops/termfleet");
  await expect(termfleetBlock.getByTestId("canvas-terminal-node-description")).toHaveText("Implement TerminalHeaderState as source of truth");
  await expect(termfleetBlock.getByTestId("canvas-terminal-node-header-path")).toHaveText("/media/endlessblink/data/my-projects/ai-development/devops/termfleet");

  await expect(flowStateBlock).toHaveAttribute("data-pane-id", "pane-flow-state-isolation");
  await expect(flowStateBlock).toHaveAttribute("data-goal-source", "none");
  await expect(flowStateBlock).toHaveAttribute("data-full-path", "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state");
  await expect(flowStateBlock.getByTestId("canvas-terminal-node-workspace")).toHaveText("flow-state");
  await expect(flowStateBlock.getByTestId("canvas-terminal-node-description")).toHaveText("No task list");
  await expect(flowStateBlock.getByTestId("canvas-terminal-node-header-path")).toHaveText("/media/endlessblink/data/my-projects/ai-development/productivity/flow-state");
  await expect(flowStateBlock).not.toContainText("Implement TerminalHeaderState as source of truth");
  await expect(flowStateBlock).not.toContainText("termfleet");
});

test("map header rejects slash-command prompt echoes as task descriptions", async ({ page }) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-termfleet",
      name: "termfleet",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      lastActiveTabId: "tab-review-prompt",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-review-prompt",
      activeTerminalId: "pty-review-prompt",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-review-prompt",
        selectedNodeIds: ["node-review-prompt"],
        viewport: { x: 80, y: 80, zoom: 1 },
        nodes: [{
          id: "node-review-prompt",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-review-prompt",
          x: 80,
          y: 70,
          width: 940,
          height: 360,
        }],
      },
      tabs: [{
        id: "tab-review-prompt",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-review-prompt",
          paneId: "pane-review-prompt",
          cols: 100,
          rows: 28,
          status: "running",
          terminalOutput: [
            "› Fix terminal header activity description",
            "Working (12s • esc to interrupt)",
            "TERMFLEET_AGENT_STATUS_SUMMARY_SERVER_OK",
            "› it is not fixed at all... you havent verified anything",
            "› Run /review on my current changes",
          ].join("\n"),
          taskLineup: [{
            id: "task-header-description",
            content: "Fixing terminal header activity description",
            status: "in_progress",
            source: "todo-write",
            updatedAt: 1000,
          }],
          statusSummary: {
            task: "Run /review on my current changes",
            path: "devops/termfleet",
            now: "status summary server checks passed",
            status: "done",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: false,
          },
        }],
        splitLayout: { id: "pane-review-prompt", type: "terminal" },
        activePaneId: "pane-review-prompt",
      }],
    });
  });

  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "termfleet" });
  const title = block.getByTestId("canvas-terminal-node-header-title");
  const description = block.getByTestId("canvas-terminal-node-description");
  const taskRow = block.getByTestId("canvas-terminal-node-task-row");
  const now = block.getByTestId("canvas-terminal-node-now");

  await expect(block).not.toContainText("Run /review on my current changes");
  await expect(block).not.toContainText("you havent verified anything");
  await expect(taskRow).toContainText("Task:");
  await expect(title).toHaveText("status summary server checks passed");
  await expect(description).toHaveText("Fixing terminal header activity description");
  await expect(now).toContainText("status summary server checks passed");

  await block.screenshot({ path: "/tmp/tc-033-map-header-no-review-prompt.png" });
});
