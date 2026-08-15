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

test("saved workspace layout restores live daemon sessions without resurrecting killed ones", async ({ page }) => {
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
      tabProjects: state.tabs.map((tab) => ({
        id: tab.id,
        projectRoot: state.groups.find((group) => group.id === tab.groupId)?.projectRoot,
      })),
    };
  });

  expect(result.calls).toContain("daemon_list_sessions");
  expect(result.calls).not.toContain("workspace_persisted_sessions");
  expect(result.tabIds).toContain("saved-tab");
  expect(result.tabIds).toContain("11111111-1111-4111-8111-111111111111");
  expect(result.nodeTabIds).toContain("saved-tab");
  expect(result.nodeTabIds).toContain("11111111-1111-4111-8111-111111111111");
  expect(result.tabProjects).toContainEqual({
    id: "11111111-1111-4111-8111-111111111111",
    projectRoot: "/tmp/live",
  });
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

test("saved panes repair a stale daemon binding instead of hiding the live terminal", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const liveId = "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222";
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => cmd === "daemon_list_sessions"
        ? [{ id: liveId, cwd: "/repo/lifeboat" }]
        : null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "11111111-1111-4111-8111-111111111111",
        title: "Lifeboat",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: "lifeboat-group",
        initialCwd: "/repo/lifeboat",
        terminals: [{ id: "stale-session-id", paneId: "22222222-2222-4222-8222-222222222222", cols: 80, rows: 24, status: "starting" }],
        splitLayout: { id: "22222222-2222-4222-8222-222222222222", type: "terminal" },
        activePaneId: "22222222-2222-4222-8222-222222222222",
      }],
      activeTabId: "11111111-1111-4111-8111-111111111111",
      groups: [{ id: "lifeboat-group", name: "Lifeboat", color: "#7aa2f7", emoji: "⬛", emojiSource: "generated", projectRoot: "/repo/lifeboat" }],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === "11111111-1111-4111-8111-111111111111");
    return {
      tabCount: state.tabs.length,
      terminalId: tab?.terminals.find((terminal) => terminal.paneId === "22222222-2222-4222-8222-222222222222")?.id,
      groupId: tab?.groupId,
      cwd: state.liveCwds[liveId],
    };
  });

  expect(result.tabCount).toBe(1);
  expect(result.terminalId).toBe("terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222");
  expect(result.groupId).toBe("lifeboat-group");
  expect(result.cwd).toBe("/repo/lifeboat");
});

test("saved tabs restore a live pane that was omitted from the last checkpoint", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const liveId = "terminal-33333333-3333-4333-8333-333333333333-44444444-4444-4444-8444-444444444444";
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => cmd === "daemon_list_sessions"
        ? [{ id: liveId, cwd: "/repo/lifeboat" }]
        : null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "Lifeboat",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: "lifeboat-group",
        initialCwd: "/repo/lifeboat",
        terminals: [],
        splitLayout: { id: "44444444-4444-4444-8444-444444444444", type: "terminal" },
        activePaneId: "44444444-4444-4444-8444-444444444444",
      }],
      activeTabId: "33333333-3333-4333-8333-333333333333",
      groups: [{ id: "lifeboat-group", name: "Lifeboat", color: "#7aa2f7", emoji: "⬛", emojiSource: "generated", projectRoot: "/repo/lifeboat" }],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === "33333333-3333-4333-8333-333333333333");
    return { tabCount: state.tabs.length, terminalIds: tab?.terminals.map((terminal) => terminal.id) ?? [], groupId: tab?.groupId };
  });

  expect(result.tabCount).toBe(1);
  expect(result.terminalIds).toEqual(["terminal-33333333-3333-4333-8333-333333333333-44444444-4444-4444-8444-444444444444"]);
  expect(result.groupId).toBe("lifeboat-group");
});

test("saved groups restore a live pane when its old layout leaf was removed", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const liveId = "terminal-55555555-5555-4555-8555-555555555555-66666666-6666-4666-8666-666666666666";
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => cmd === "daemon_list_sessions"
        ? [{ id: liveId, cwd: "/repo/lifeboat" }]
        : null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    const { getAllLeafIds } = await import("/src/lib/splitUtils.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "55555555-5555-4555-8555-555555555555",
        title: "Lifeboat",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: "lifeboat-group",
        initialCwd: "/repo/lifeboat",
        terminals: [{ id: "old-session", paneId: "old-pane", cols: 80, rows: 24, status: "starting" }],
        splitLayout: { id: "current-pane", type: "terminal" },
        activePaneId: "current-pane",
      }],
      activeTabId: "55555555-5555-4555-8555-555555555555",
      groups: [{ id: "lifeboat-group", name: "Lifeboat", color: "#7aa2f7", emoji: "⬛", emojiSource: "generated", projectRoot: "/repo/lifeboat" }],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === "55555555-5555-4555-8555-555555555555");
    return {
      tabCount: state.tabs.length,
      terminalIds: tab?.terminals.map((terminal) => terminal.id) ?? [],
      leafIds: tab ? getAllLeafIds(tab.splitLayout) : [],
      groupId: tab?.groupId,
    };
  });

  expect(result.tabCount).toBe(1);
  expect(result.terminalIds).toContain("terminal-55555555-5555-4555-8555-555555555555-66666666-6666-4666-8666-666666666666");
  expect(result.leafIds).toContain("66666666-6666-4666-8666-666666666666");
  expect(result.groupId).toBe("lifeboat-group");
});

test("closed live panes stay closed while missing live panes reappear in the layout", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const closedId = "terminal-22222222-2222-4222-8222-222222222222-33333333-3333-4333-8333-333333333333";
    const missingId = "terminal-44444444-4444-4444-8444-444444444444-55555555-5555-4555-8555-555555555555";
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => cmd === "daemon_list_sessions"
        ? [{ id: closedId, cwd: "/tmp/closed" }, { id: missingId, cwd: "/tmp/missing" }]
        : null,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      closedSessionIds: [closedId],
      tabs: [{
        id: "saved-tab",
        title: "Saved terminal",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/saved",
        terminals: [{ id: "terminal-saved-tab-saved-pane", paneId: "saved-pane", cols: 80, rows: 24, status: "starting" }],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    return useWorkspaceStore.getState().tabs.map((tab) => ({ id: tab.id, cwd: tab.initialCwd }));
  });

  expect(result).toContainEqual({ id: "saved-tab", cwd: "/tmp/saved" });
  expect(result).toContainEqual({
    id: "44444444-4444-4444-8444-444444444444",
    cwd: "/tmp/missing",
  });
  expect(result).not.toContainEqual({
    id: "22222222-2222-4222-8222-222222222222",
    cwd: "/tmp/closed",
  });
});

test("a clicked-close tombstone removes the saved card even when restart races final tab removal", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const closedId = "terminal-77777777-7777-4777-8777-777777777777-88888888-8888-4888-8888-888888888888";
    const diskWorkspace = {
      tabs: [{
        id: "77777777-7777-4777-8777-777777777777",
        title: "Closed card",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/closed-card",
        terminals: [{ id: closedId, paneId: "88888888-8888-4888-8888-888888888888", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "88888888-8888-4888-8888-888888888888", type: "terminal" },
        activePaneId: "88888888-8888-4888-8888-888888888888",
      }],
      activeTabId: "77777777-7777-4777-8777-777777777777",
      groups: [],
      terminalGroups: [],
      openFiles: [],
      pinnedProjects: [],
      workspaceUiState: {},
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
      closedSessionIds: [closedId],
    };
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return JSON.stringify(diskWorkspace);
        if (cmd === "daemon_list_sessions") return [{ id: closedId, cwd: "/tmp/closed-card" }];
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({ hydrating: false, tabs: [], activeTabId: null, groups: [], terminalGroups: [], agentRecoveryMigrationVersion: 1, canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] } });
    await hydrateWorkspace();
    return useWorkspaceStore.getState().tabs.map((tab) => tab.title);
  });

  expect(result).not.toContain("Closed card");
});

test("closed workspace identities suppress saved, live, and recovered terminals across projects", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const paperId = "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222";
    const arthouseId = "terminal-33333333-3333-4333-8333-333333333333-44444444-4444-4444-8444-444444444444";
    const openId = "terminal-55555555-5555-4555-8555-555555555555-66666666-6666-4666-8666-666666666666";
    const diskWorkspace = {
      tabs: [
        {
          id: "paper-tab",
          title: "paper-bot",
          emoji: "⬛",
          color: "#7aa2f7",
          groupId: null,
          initialCwd: "/work/paper-bot/",
          terminals: [{ id: paperId, paneId: "22222222-2222-4222-8222-222222222222", cols: 80, rows: 24, status: "running" }],
          splitLayout: { id: "22222222-2222-4222-8222-222222222222", type: "terminal" },
          activePaneId: "22222222-2222-4222-8222-222222222222",
        },
        {
          id: "arthouse-tab",
          title: "arthouse",
          emoji: "⬛",
          color: "#7aa2f7",
          groupId: null,
          initialCwd: "/work/arthouse",
          terminals: [{ id: arthouseId, paneId: "44444444-4444-4444-8444-444444444444", cols: 80, rows: 24, status: "running" }],
          splitLayout: { id: "44444444-4444-4444-8444-444444444444", type: "terminal" },
          activePaneId: "44444444-4444-4444-8444-444444444444",
        },
      ],
      activeTabId: "paper-tab",
      groups: [],
      terminalGroups: [],
      openFiles: [],
      pinnedProjects: [],
      workspaceUiState: {},
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
      closedRestoreTargets: [{ cwd: "/work/paper-bot" }, { cwd: "/work/arthouse/" }],
    };
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return JSON.stringify(diskWorkspace);
        if (cmd === "daemon_list_sessions") return [
          { id: paperId, cwd: "/work/paper-bot" },
          { id: arthouseId, cwd: "/work/arthouse" },
          { id: openId, cwd: "/work/open" },
        ];
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({ hydrating: false, tabs: [], activeTabId: null, groups: [], terminalGroups: [], agentRecoveryMigrationVersion: 1, canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] } });
    await hydrateWorkspace();
    return useWorkspaceStore.getState().tabs.map((tab) => ({ title: tab.title, cwd: tab.initialCwd }));
  });

  expect(result).not.toContainEqual({ title: "paper-bot", cwd: "/work/paper-bot/" });
  expect(result).not.toContainEqual({ title: "arthouse", cwd: "/work/arthouse" });
  expect(result).toContainEqual({ title: "open", cwd: "/work/open" });
});

test("one-time FlowState repair restores only recent, open sidecars with restartable panes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const recentId = "terminal-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const closedId = "terminal-cccccccc-cccc-4ccc-8ccc-cccccccccccc-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const staleId = "terminal-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-ffffffff-ffff-4fff-8fff-ffffffffffff";
    const sidecars = [
      JSON.stringify({ paneId: recentId, cwd: "/repo/productivity/flow-state", updatedAt: now }),
      JSON.stringify({ paneId: closedId, cwd: "/repo/productivity/flow-state", updatedAt: now }),
      JSON.stringify({ paneId: staleId, cwd: "/repo/productivity/flow-state", updatedAt: now - 7 * 60 * 60 * 1000 }),
      JSON.stringify({ paneId: "terminal-outside-project-pane", cwd: "/repo/other", updatedAt: now }),
    ];
    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return null;
        if (cmd === "daemon_list_sessions") return [];
        if (cmd === "agent_status_list_sidecars") return sidecars;
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      agentRecoveryMigrationVersion: 0,
      closedSessionIds: [closedId],
      tabs: [{
        id: "saved-tab",
        title: "Saved terminal",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/repo/saved",
        terminals: [{ id: "terminal-saved-tab-saved-pane", paneId: "saved-pane", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    const repaired = state.tabs.find((tab) => tab.terminals.some((terminal) => terminal.id === recentId));
    return {
      tabCount: state.tabs.length,
      ids: state.tabs.map((tab) => tab.terminals[0]?.id),
      migrationVersion: state.agentRecoveryMigrationVersion,
      repairedStatus: repaired?.terminals[0]?.status,
    };
  });

  expect(result.tabCount).toBe(2);
  expect(result.ids).toContain("terminal-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  expect(result.ids).not.toContain("terminal-cccccccc-cccc-4ccc-8ccc-cccccccccccc-dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  expect(result.ids).not.toContain("terminal-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-ffffffff-ffff-4fff-8fff-ffffffffffff");
  expect(result.migrationVersion).toBe(1);
  expect(result.repairedStatus).toBe("stale");
});
