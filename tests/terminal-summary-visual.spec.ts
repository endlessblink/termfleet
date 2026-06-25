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

test("regular split header rejects noisy scrollback titles and fits the activity title", async ({ page }) => {
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

  await expect(title).toHaveText("Improving terminal-summary visual headers");
  await expect(title).not.toContainText("The visual app surface");
  await expect(now).toContainText("frontend build passed");
  await expect(path).toContainText("devops/termfleet");

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

  await expect(title).toHaveText("Improving terminal-summary visual headers");
  await expect(now).toContainText("frontend build passed");
  const afterCommandChange = await title.evaluate((element) => element.textContent?.trim() ?? "");
  expect(afterCommandChange).toBe(metrics.text);
});

test("regular split header keeps current verifier title over stale transcript purpose", async ({ page }) => {
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

  await expect(page.getByTestId("split-terminal-summary-task")).toHaveText("Improving terminal-summary visual headers");
  await expect(page.getByTestId("split-terminal-summary-task")).not.toContainText("bracketed paste");
  await expect(page.getByTestId("split-terminal-summary-now")).toContainText("terminal summary visual checks failed");
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

  await expect(page.getByTestId("split-terminal-summary-task")).toHaveText("Writing tests for selected file");
  await expect(page.getByTestId("split-terminal-summary-task")).not.toContainText("keymap");
  await expect(page.getByTestId("split-terminal-summary-now")).toContainText("keymap checks failed");
});

test("regular map header rejects noisy scrollback titles and fits the activity title", async ({ page }) => {
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

  await expect(title).toHaveText("Improving terminal-summary visual headers");
  await expect(title).not.toContainText("The visual app surface");
  await expect(taskRow).toContainText("Task:");
  await expect(description).toContainText("Improving terminal-summary visual headers");
  await expect(description).not.toContainText("frontend build passed");
  await expect(description).not.toContainText("web$");
  await expect(description).not.toContainText("unfinished prompt");
  await expect(now).toContainText("frontend build passed");
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

  await expect(title).toHaveText("Reviewing approval request");
  await expect(title).not.toHaveText("No task list");
  await expect(title).not.toContainText("permanently delete");
  await expect(description).toHaveText("No task list");
  await expect(taskRow).toContainText("Task:");
  await expect(now).toContainText("Waiting for operator selection");
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
  await expect(now).toHaveText("Awaiting command");
  await expect(now).not.toContainText("income-zen");
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
  await expect(title).toHaveText("Fixing terminal header activity description");
  await expect(description).toHaveText("Fixing terminal header activity description");
  await expect(now).toContainText("status summary server checks passed");

  await block.screenshot({ path: "/tmp/tc-033-map-header-no-review-prompt.png" });
});
