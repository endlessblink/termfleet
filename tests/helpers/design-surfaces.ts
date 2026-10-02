// Shared by design-visual.spec.ts and design-a11y.spec.ts: the seeded synthetic workspace
// (mocked __TAURI_INTERNALS__, 2 projects, 6 sessions) and the 12 surface setups.
import type { Page } from "@playwright/test";

export const BASE = process.env.TF_DESIGN_URL as string;

const MASTER_PLAN = [
  "## Tasks",
  "### ACME-101: Rotate API tokens on schedule `in-progress`",
  "- done: Add rotation job",
  "- todo: Document the runbook",
  "### ACME-102: Stabilise flaky checkout test `blocked`",
  "### ACME-103: Migrate billing tables `todo`",
  "### ACME-104: Redesign settings page `todo`",
  "### ACME-105: Archive old logs `done`",
].join("\n");

export async function openPage(page: Page) {
  await page.addInitScript((plan: string) => {
    let id = 1;
    const callbacks = new Map<number, unknown>();
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(cb: unknown) {
        const n = id++;
        callbacks.set(n, cb);
        return n;
      },
      unregisterCallback(n: number) {
        callbacks.delete(n);
      },
      async invoke(c: string, args?: { path?: string }) {
        if (c === "daemon_status") return { reachable: false, mode: "browser" };
        if (c === "daemon_ensure_running") return { reachable: false, mode: "browser", message: "browser" };
        if (c === "grid_snapshot") return JSON.stringify({ cols: 80, rows: 24, cursor: { col: 0, line: 0 }, cursorVisible: false, altScreen: false, cells: [] });
        if (c === "fs_read_file") return String(args?.path ?? "").endsWith("MASTER_PLAN.md") ? plan : "";
        if (/list|discover|roots|catalog|read_dir/i.test(c)) return [];
        return null;
      },
    };
  }, MASTER_PLAN);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

function seed({ mode, extra }: { mode: string; extra: Record<string, unknown> }) {
  const store = (window as any).__termfleetWorkspaceStore;
  const now = Date.now();
  const groups = [
    { id: "g-api", name: "acme-api", color: "#d69a2d", projectRoot: "/home/demo/projects/acme-api", lastActiveTabId: "t1" },
    { id: "g-web", name: "acme-web", color: "#6ea8fe", projectRoot: "/home/demo/projects/acme-web", lastActiveTabId: "t4" },
  ];
  const mk = (id: string, title: string, g: (typeof groups)[number], provider: string | undefined, status: string, task?: string, nowLine?: string, summaryStatus?: string) => ({
    id, title, emoji: "", color: g.color, groupId: g.id, workstream: { kind: "terminal", gitBranch: "feat/" + id },
    initialCwd: g.projectRoot, activePaneId: "p-" + id, splitLayout: { id: "p-" + id, type: "terminal" },
    terminals: [{
      id: "pty-" + id, paneId: "p-" + id, cols: 100, rows: 28, status, agentProvider: provider,
      taskLine: task ? { text: task, source: "session-title", capturedAt: 1, expiresAt: null } : undefined,
      nowLine: nowLine ? { text: nowLine, source: "current-step", capturedAt: 1, expiresAt: null } : undefined,
      statusSummary: summaryStatus ? { task, path: g.projectRoot, now: nowLine, status: summaryStatus, provider, confidence: "high", tasksFromTodoWrite: true, updatedAt: now } : undefined,
      statusSummaryUpdatedAt: now, statusSummarySource: "sidecar",
    }],
  });
  const tabs = [
    mk("t1", "Fix auth token refresh", groups[0], "claude", "running", "Fix auth token refresh race", "Editing src/auth/refresh.ts", "working"),
    mk("t2", "Migrate billing tables", groups[0], "codex", "running", "Migrate billing tables to v2 schema", "Waiting for approval to run migration", "waiting"),
    mk("t3", "Shell", groups[0], undefined, "running"),
    mk("t4", "Redesign settings page", groups[1], "claude", "running", "Redesign settings page", "Idle — turn finished", "idle"),
    mk("t5", "E2E flaky tests", groups[1], "codex", "failed", "Stabilise flaky e2e tests", "Provider reported a failure", "blocked"),
    mk("t6", "dev server", groups[1], undefined, "exited"),
  ];
  const nodes = tabs.map((t, i) => ({ id: "n" + i, type: "terminal", title: t.title, terminalTabId: t.id, x: 40 + (i % 3) * 560, y: 40 + Math.floor(i / 3) * 360, width: 520, height: 320 }));
  store.setState({
    workspaceUiState: { ...store.getState().workspaceUiState, workspaceMode: mode, primarySidebarCollapsed: false, canvasSidebarCollapsed: false, terminalSidebarCollapsed: false, ...extra },
    groups, terminalGroups: groups, activeGroupFilter: null, projectRoot: groups[0].projectRoot,
    activeTabId: "t1", activeTerminalId: "pty-t1", hydrating: false,
    canvasState: { selectedNodeId: "n0", selectedNodeIds: [], viewport: { x: 20, y: 20, zoom: 0.85 }, nodes }, tabs,
  });
}

export const surfaces: Record<string, (page: Page) => Promise<void>> = {
  async terminal(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(1200);
  },
  async map(page) {
    await page.evaluate(seed, { mode: "canvas", extra: { primarySidebarPanel: "map" } });
    await page.waitForTimeout(1500);
  },
  async board(page) {
    await page.evaluate(seed, { mode: "canvas", extra: { primarySidebarPanel: "map" } });
    await page.waitForTimeout(1200);
    await page.locator('button[aria-label="Drawing board"]').first().click();
    await page.waitForTimeout(1500);
  },
  async tasks(page) {
    await page.evaluate(seed, { mode: "tasks", extra: {} });
    await page.waitForTimeout(1500);
  },
  async git(page) {
    await page.evaluate(seed, { mode: "graph", extra: {} });
    await page.waitForTimeout(1500);
  },
  async files(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(800);
    await page.locator('button[aria-label="Files"]').click();
    await page.waitForTimeout(1500);
  },
  async preview(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const st = (window as any).__termfleetWorkspaceStore;
      st.setState((s: any) => ({ tabs: s.tabs.map((t: any) => (t.id === "t1" ? { ...t, terminals: t.terminals.map((x: any) => ({ ...x, previewUrl: "http://127.0.0.1:5173" })) } : t)) }));
    });
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="Preview"]').first().click();
    await page.waitForTimeout(1200);
  },
  async palette(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(1000);
    await page.locator(".workbench-command-search input").click();
    await page.waitForTimeout(700);
  },
  async menu(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(1000);
    await page.locator(".workspace-sidebar-row").nth(1).click({ button: "right" });
    await page.waitForTimeout(600);
  },
  async approve(page) {
    await page.evaluate(seed, { mode: "canvas", extra: { primarySidebarPanel: "map" } });
    await page.waitForTimeout(1500);
    await page.getByText("Approve all", { exact: true }).first().click();
    await page.waitForTimeout(800);
  },
  async folder(page) {
    await page.evaluate(seed, { mode: "split", extra: {} });
    await page.waitForTimeout(800);
    await page.locator('button[aria-label="Files"]').click();
    await page.waitForTimeout(800);
    await page.locator('button[aria-label="Choose project folder"]').first().click();
    await page.waitForTimeout(1000);
  },
  async empty(page) {
    await page.waitForTimeout(300);
  },
};

