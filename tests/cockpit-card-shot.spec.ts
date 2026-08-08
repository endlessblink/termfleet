// Look at the card, do not infer it.
//
// Three rounds of "relaunched, nothing changed" came from shipping changes that unit
// tests approved and nobody ever rendered. This spec seeds a map card with a real goal
// and a real current step, screenshots it, and asserts what the operator would see.
import { expect, test } from "@playwright/test";

async function mockTauri(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    let callbackId = 1;
    const callbacks = new Map<number, unknown>();
    (
      window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
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
        if (command === "daemon_status")
          return { reachable: false, mode: "browser" };
        if (command === "daemon_ensure_running")
          return { reachable: false, mode: "browser", message: "browser" };
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
    };
  });
}

const GOAL = "Covering the shorter deployment wording";
const DISPLAYED_GOAL = "No task declared";
const STEP = "Verifying the whole path still tracks at the new analysis size";

test("a map card rejects a meta-process task and shows an honest fallback", async ({
  page,
}) => {
  await mockTauri(page);
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() =>
    localStorage.removeItem("terminal-workspace.v1"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(
    ({ goal, displayedGoal, step }) => {
      type Store = {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
      const store = (
        window as typeof window & { __termfleetWorkspaceStore?: Store }
      ).__termfleetWorkspaceStore;
      if (!store) throw new Error("TermFleet test store is unavailable");
      const group = {
        id: "group-censor",
        name: "bina-meatzevet-courses",
        color: "#d69a2d",
        projectRoot: "/home/op/projects/bina-meatzevet-courses",
        lastActiveTabId: "tab-censor",
      };
      const workstream = {
        kind: "terminal",
        gitBranch: "release/bina-courses-august",
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
        activeTabId: "tab-censor",
        activeTerminalId: "pty-censor",
        hydrating: false,
        canvasState: {
          selectedNodeId: "node-censor",
          selectedNodeIds: [],
          viewport: { x: 40, y: 40, zoom: 1 },
          nodes: [
            {
              id: "node-censor",
              type: "terminal",
              title: "Terminal",
              terminalTabId: "tab-censor",
              x: 40,
              y: 30,
              width: 820,
              height: 320,
            },
          ],
        },
        tabs: [
          {
            id: "tab-censor",
            title: "Terminal",
            emoji: "[]",
            color: "#d69a2d",
            groupId: group.id,
            workstream,
            initialCwd: group.projectRoot,
            activePaneId: "pane-censor",
            splitLayout: { type: "leaf", paneId: "pane-censor" },
            terminals: [
              {
                id: "pty-censor",
                paneId: "pane-censor",
                cols: 100,
                rows: 28,
                status: "running",
                agentProvider: "claude",
                mainUserAsk: {
                  text: displayedGoal,
                  source: "status-sidecar",
                  updatedAt: 1,
                },
                taskLine: {
                  text: goal,
                  source: "session-title",
                  capturedAt: 1,
                  expiresAt: null,
                },
                nowLine: {
                  text: step,
                  source: "current-step",
                  capturedAt: 1,
                  expiresAt: null,
                },
                statusSummary: {
                  task: goal,
                  path: group.projectRoot,
                  now: step,
                  status: "working",
                  provider: "claude",
                  confidence: "high",
                  tasksFromTodoWrite: true,
                  updatedAt: Date.now(),
                },
                statusSummaryUpdatedAt: Date.now(),
                statusSummarySource: "sidecar",
              },
            ],
          },
        ],
      });
    },
    { goal: GOAL, displayedGoal: DISPLAYED_GOAL, step: STEP },
  );

  const card = page.getByTestId("canvas-terminal-status-block").first();
  await expect(card).toBeVisible();
  const goalRow = page.getByTestId("canvas-terminal-node-description").first();

  await expect(goalRow).toHaveText(DISPLAYED_GOAL);
  await expect(page.getByTestId("canvas-terminal-node-branch")).toHaveText(
    "release/bina-courses-august",
  );

  await card.screenshot({ path: ".captures/cockpit-card-goal-and-now.png" });
});
