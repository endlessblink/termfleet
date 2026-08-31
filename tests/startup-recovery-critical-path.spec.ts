import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("normal cached dock recovery only reads layout and exact live sessions", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const liveId = "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222";
    const killedId = "terminal-33333333-3333-4333-8333-333333333333-44444444-4444-4444-8444-444444444444";
    const calls: string[] = [];
    const savedTab = (id: string, paneId: string, terminalId: string) => ({
      id,
      title: "Saved terminal",
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: "/tmp/live",
      terminals: [{ id: terminalId, paneId, cols: 80, rows: 24, status: "starting" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    });
    const layout = {
      tabs: [
        savedTab("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", liveId),
        savedTab("33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", killedId),
      ],
      activeTabId: "11111111-1111-4111-8111-111111111111",
      closedSessionIds: [killedId],
      closedProviderSessionIds: ["provider-killed"],
    };

    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        calls.push(cmd);
        if (cmd === "workspace_layout_load") return JSON.stringify(layout);
        if (cmd === "daemon_list_sessions") {
          return [
            { id: liveId, cwd: "/tmp/live", command: "/bin/bash", pid: 4101 },
            { id: killedId, cwd: "/tmp/killed", command: "codex resume provider-killed", pid: 4102 },
          ];
        }
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { hydrateWorkspace, useWorkspaceStore } = await import(
      `/src/stores/workspace.ts?critical-path=${Date.now()}`
    );
    useWorkspaceStore.setState({ hydrating: true });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      calls,
      ids: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id)),
      statuses: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.status)),
    };
  });

  expect(result.ids).toEqual([
    "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222",
  ]);
  expect(result.statuses).toEqual(["reconnected"]);
  expect(result.calls).toContain("workspace_layout_load");
  expect(result.calls).toContain("daemon_list_sessions");
  expect(result.calls).not.toContain("workspace_persisted_sessions");
  expect(result.calls).not.toContain("agent_status_list_sidecars");
  expect(result.calls).not.toContain("workstream_git_context");
  expect(result.calls).not.toContain("lifecycle_audit");
  expect(result.calls).not.toContain("workspace_layout_save");
});

test("dock startup does not schedule repeated full workspace hydration", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  const source = await page.evaluate(async () => (await fetch("/src/App.tsx")).text());

  expect(source).not.toContain("[500, 2000, 5000, 10000, 20000, 30000]");
  expect(source).toContain("reconcileLiveWorkspace");
});

test("late launcher sessions reconcile without recovery archaeology", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const liveId = "terminal-55555555-5555-4555-8555-555555555555-66666666-6666-4666-8666-666666666666";
    const calls: string[] = [];
    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        calls.push(cmd);
        if (cmd === "daemon_list_sessions") {
          return [{ id: liveId, cwd: "/tmp/late", command: "/bin/bash", pid: 4201 }];
        }
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { reconcileLiveWorkspace, useWorkspaceStore } = await import(
      `/src/stores/workspace.ts?live-path=${Date.now()}`
    );
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "55555555-5555-4555-8555-555555555555",
        title: "Saved late terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/late",
        terminals: [{
          id: liveId,
          paneId: "66666666-6666-4666-8666-666666666666",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "66666666-6666-4666-8666-666666666666", type: "terminal" },
        activePaneId: "66666666-6666-4666-8666-666666666666",
      }],
      activeTabId: "55555555-5555-4555-8555-555555555555",
      groups: [],
      terminalGroups: [],
      closedSessionIds: [],
      closedProviderSessionIds: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await reconcileLiveWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      calls,
      terminals: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => ({ id: terminal.id, status: terminal.status }))),
    };
  });

  expect(result.terminals).toEqual([{ id: "terminal-55555555-5555-4555-8555-555555555555-66666666-6666-4666-8666-666666666666", status: "reconnected" }]);
  expect(result.calls).toEqual(["daemon_list_sessions"]);
});
