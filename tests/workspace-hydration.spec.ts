import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("saved workspace layout blocks stale persisted sessions from resurrecting as tabs", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
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
        if (cmd === "workspace_layout_load") return null;
        if (cmd === "workspace_persisted_sessions") {
          return [{
            id: "terminal-orphan-tab-orphan-pane",
            cwd: "/tmp/orphan",
            scrollbackBytes: 4096,
          }];
        }
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "saved-tab",
        title: "Saved terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/saved",
        terminals: [{
          id: "terminal-saved-tab-saved-pane",
          paneId: "saved-pane",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      groups: [],
      terminalGroups: [],
      canvasState: {
        selectedNodeId: "node-saved",
        selectedNodeIds: ["node-saved"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: "node-saved",
          type: "terminal",
          title: "Saved terminal",
          terminalTabId: "saved-tab",
          x: 0,
          y: 0,
          width: 820,
          height: 460,
        }],
      },
    });

    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      calls,
      tabIds: state.tabs.map((tab) => tab.id),
      nodeTabIds: state.canvasState.nodes
        .filter((node) => node.type === "terminal")
        .map((node) => node.terminalTabId),
    };
  });

  expect(result.calls).not.toContain("workspace_persisted_sessions");
  expect(result.tabIds).toEqual(["saved-tab"]);
  expect(result.nodeTabIds).toEqual(["saved-tab"]);
});

test("saved workspace layout recovers live daemon sessions that another window dropped", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
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
          return [{
            id: "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222",
            cwd: "/tmp/live",
            command: "/bin/bash",
            pid: 4242,
          }];
        }
        if (cmd === "workspace_persisted_sessions") {
          return [{
            id: "terminal-closed-tab-closed-pane",
            cwd: "/tmp/closed",
            scrollbackBytes: 4096,
          }];
        }
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "saved-tab",
        title: "Saved terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/saved",
        terminals: [{
          id: "terminal-saved-tab-saved-pane",
          paneId: "saved-pane",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      groups: [],
      terminalGroups: [],
      canvasState: {
        selectedNodeId: "node-saved",
        selectedNodeIds: ["node-saved"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: "node-saved",
          type: "terminal",
          title: "Saved terminal",
          terminalTabId: "saved-tab",
          x: 0,
          y: 0,
          width: 820,
          height: 460,
        }],
      },
    });

    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      calls,
      tabIds: state.tabs.map((tab) => tab.id),
      nodeTabIds: state.canvasState.nodes
        .filter((node) => node.type === "terminal")
        .map((node) => node.terminalTabId),
    };
  });

  expect(result.calls).toContain("daemon_list_sessions");
  expect(result.calls).not.toContain("workspace_persisted_sessions");
  expect(result.tabIds).toEqual(["saved-tab", "11111111-1111-4111-8111-111111111111"]);
  expect(result.nodeTabIds).toEqual(["saved-tab", "11111111-1111-4111-8111-111111111111"]);
});

test("disk workspace layout is authoritative over orphan persisted sessions", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const calls: string[] = [];
    const diskWorkspace = {
      tabs: [{
        id: "disk-tab",
        title: "Disk terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/disk",
        terminals: [{
          id: "terminal-disk-tab-disk-pane",
          paneId: "disk-pane",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "disk-pane", type: "terminal" },
        activePaneId: "disk-pane",
      }],
      activeTabId: "disk-tab",
      groups: [],
      canvasState: {
        selectedNodeId: "node-disk",
        selectedNodeIds: ["node-disk"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: "node-disk",
          type: "terminal",
          title: "Disk terminal",
          terminalTabId: "disk-tab",
          x: 0,
          y: 0,
          width: 820,
          height: 460,
        }],
      },
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
        if (cmd === "workspace_layout_load") return JSON.stringify(diskWorkspace);
        if (cmd === "workspace_persisted_sessions") {
          return [{
            id: "terminal-orphan-tab-orphan-pane",
            cwd: "/tmp/orphan",
            scrollbackBytes: 4096,
          }];
        }
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: true,
      tabs: [],
      activeTabId: null,
      groups: [],
      terminalGroups: [],
      canvasState: {
        selectedNodeId: null,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
      },
    });

    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      calls,
      hydrating: state.hydrating,
      tabIds: state.tabs.map((tab) => tab.id),
      nodeTabIds: state.canvasState.nodes
        .filter((node) => node.type === "terminal")
        .map((node) => node.terminalTabId),
    };
  });

  expect(result.calls).toContain("workspace_layout_load");
  expect(result.calls).not.toContain("workspace_persisted_sessions");
  expect(result.hydrating).toBe(false);
  expect(result.tabIds).toEqual(["disk-tab"]);
  expect(result.nodeTabIds).toEqual(["disk-tab"]);
});

test("saved panes use live daemon folders before the first click", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: { cwd?: string }) => cmd === "daemon_list_sessions"
        ? [
          { id: "terminal-saved-a-pane", cwd: "/repo/data/ai-development/data/src" },
          { id: "terminal-saved-b-pane", cwd: "/repo/data/recreational/data/src" },
        ]
        : cmd === "workstream_git_context"
          ? args?.cwd?.includes("ai-development")
            ? { gitRoot: "/repo/data/ai-development/data" }
            : { gitRoot: "/repo/data/recreational/data" }
          : null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const tab = (id: string, terminalId: string) => ({
      id,
      title: "Terminal",
      emoji: "⬛",
      color: "#7aa2f7",
      groupId: "group-data",
      initialCwd: "/repo/category",
      terminals: [{ id: terminalId, paneId: terminalId.split("-").pop()!, cols: 80, rows: 24, status: "starting" }],
      splitLayout: { id: terminalId.split("-").pop()!, type: "terminal" as const },
      activePaneId: terminalId.split("-").pop()!,
    });
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [tab("saved-a", "terminal-saved-a-pane"), tab("saved-b", "terminal-saved-b-pane")],
      activeTabId: "saved-a",
      groups: [{ id: "group-data", name: "DATA", color: "#7aa2f7", emoji: "📝", emojiSource: "generated", projectRoot: "/repo/data" }],
      terminalGroups: [{ id: "group-data", name: "DATA", color: "#7aa2f7", emoji: "📝", emojiSource: "generated", projectRoot: "/repo/data" }],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      groups: state.groups.map((group) => ({ name: group.name, root: group.projectRoot, emoji: group.emoji })),
      tabGroups: state.tabs.map((candidate) => state.groups.find((group) => group.id === candidate.groupId)?.name),
    };
  });

  expect(result.groups.map(({ name, root }) => ({ name, root }))).toEqual([
    { name: "data · ai-development", root: "/repo/data/ai-development/data" },
    { name: "data · recreational", root: "/repo/data/recreational/data" },
  ]);
  expect(result.tabGroups).toEqual(["data · ai-development", "data · recreational"]);
  expect(new Set(result.groups.map(({ emoji }) => emoji)).size).toBe(2);
});
