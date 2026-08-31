import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("hydration preserves a pane Goal when its tab id changes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { preserveLiveHeaderState } = await import("/src/stores/workspace.ts");
    const goal = {
      task: "Deliver a stable desktop release",
      path: "/repo/termfleet",
      now: "Idle — no work is running",
      status: "idle",
      provider: "shell",
      confidence: "high",
      mainTask: "Make the installed terminal cockpit clear and reliable so work is easy to resume.",
      mainTaskSource: "plan-explanation",
    } as const;
    const currentTabs = [{
      id: "live-tab",
      title: "TermFleet",
      terminals: [{
        id: "terminal-live-tab-pane-1",
        paneId: "pane-1",
        status: "starting",
        statusSummary: goal,
        statusSummarySource: "sidecar",
      }],
    }];
    const nextTabs = [{
      id: "recovered-tab",
      title: "TermFleet",
      terminals: [{
        id: "terminal-recovered-tab-pane-1",
        paneId: "pane-1",
        status: "starting",
      }],
    }];
    const preserved = preserveLiveHeaderState(nextTabs as never, currentTabs as never);
    return preserved[0]?.terminals[0];
  });

  expect(result?.statusSummary?.mainTaskSource).toBe("plan-explanation");
  expect(result?.statusSummary?.mainTask).toContain("installed terminal cockpit");
});

test("hydration keeps the incoming pane Goal when the live snapshot omitted it", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { preserveLiveHeaderState } = await import("/src/stores/workspace.ts");
    const goal = {
      task: "Checking the latest result",
      path: "/repo/termfleet",
      now: "Idle — no work is running",
      status: "idle",
      provider: "shell",
      confidence: "high",
      mainTask: "Help people understand each TermFleet terminal so they can resume the right work.",
      mainTaskSource: "plan-explanation",
    } as const;
    const currentTabs = [{
      id: "live-tab",
      title: "TermFleet",
      terminals: [{
        id: "terminal-live-tab-pane-1",
        paneId: "pane-1",
        status: "starting",
        statusSummary: { ...goal, mainTask: undefined, mainTaskSource: undefined },
      }],
    }];
    const nextTabs = [{
      id: "live-tab",
      title: "TermFleet",
      terminals: [{
        id: "terminal-live-tab-pane-1",
        paneId: "pane-1",
        status: "starting",
        statusSummary: goal,
      }],
    }];
    return preserveLiveHeaderState(nextTabs as never, currentTabs as never)[0]?.terminals[0];
  });

  expect(result?.statusSummary?.mainTask).toContain("resume the right work");
  expect(result?.statusSummary?.mainTaskSource).toBe("plan-explanation");
});

test("live daemon reconciliation replaces a saved starting status", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const status = await page.evaluate(async () => {
    const { preserveLiveHeaderState } = await import("/src/stores/workspace.ts");
    const currentTabs = [{
      id: "saved-tab",
      title: "Saved terminal",
      terminals: [{ id: "live-session", paneId: "saved-pane", status: "starting" }],
    }];
    const nextTabs = [{
      id: "saved-tab",
      title: "Saved terminal",
      terminals: [{ id: "live-session", paneId: "saved-pane", status: "reconnected" }],
    }];
    return preserveLiveHeaderState(nextTabs as never, currentTabs as never)[0]?.terminals[0]?.status;
  });

  expect(status).toBe("reconnected");
});

test("an explicitly linked legacy map conversation rebinds to its visible saved pane", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { bindLegacyMapSessionToSavedPane } = await import("/src/stores/workspace.ts");
    const tabId = "c6e8ae3b-96b6-477f-86d1-913dabced317";
    const paneId = "a8f82912-8501-44a7-bc4d-ab136da62110";
    const canonicalId = `terminal-${tabId}-${paneId}`;
    const legacyId = `terminal-${tabId}-terminal-map-${tabId}`;
    const tabs = [{
      id: tabId,
      title: "TermFleet",
      initialCwd: "/repo/termfleet",
      terminals: [{ id: canonicalId, paneId, cols: 80, rows: 24, status: "starting" }],
      splitLayout: { id: paneId, type: "terminal" },
      activePaneId: paneId,
    }];
    const canvasState = {
      selectedNodeId: null,
      selectedNodeIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{
        id: `terminal-map-${tabId}`,
        type: "terminal",
        title: "TermFleet",
        content: "",
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        terminalTabId: tabId,
        terminalPtyId: canonicalId,
        linkedTerminalPaneId: paneId,
      }],
    };
    const rebound = bindLegacyMapSessionToSavedPane(
      tabs as never,
      {
        id: legacyId,
        cwd: "/repo/termfleet",
        provider: "codex",
        providerSessionId: "01a04c3d-7beb-72d2-a6b3-9d5ecfc99166",
      } as never,
      canvasState as never,
    );
    const unlinked = bindLegacyMapSessionToSavedPane(
      tabs as never,
      {
        id: legacyId,
        cwd: "/repo/termfleet",
        provider: "codex",
        providerSessionId: "01a04c3d-7beb-72d2-a6b3-9d5ecfc99166",
      } as never,
      { ...canvasState, nodes: [] } as never,
    );
    return { terminal: rebound?.[0]?.terminals[0], unlinked };
  });

  expect(result.terminal).toMatchObject({
    id: "terminal-c6e8ae3b-96b6-477f-86d1-913dabced317-terminal-map-c6e8ae3b-96b6-477f-86d1-913dabced317",
    paneId: "a8f82912-8501-44a7-bc4d-ab136da62110",
    agentProvider: "codex",
    providerSessionId: "01a04c3d-7beb-72d2-a6b3-9d5ecfc99166",
    status: "reconnected",
  });
  expect(result.unlinked).toBeNull();
});

test("hydration preserves an exact provider session id when header state is merged", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { preserveLiveHeaderState } = await import("/src/stores/workspace.ts");
    const currentTabs = [{
      id: "saved-tab",
      title: "Saved terminal",
      terminals: [{
        id: "terminal-live-session",
        paneId: "saved-pane",
        status: "starting",
        agentProvider: "codex",
      }],
    }];
    const nextTabs = [{
      id: "saved-tab",
      title: "Saved terminal",
      terminals: [{
        id: "terminal-live-session",
        paneId: "saved-pane",
        status: "reconnected",
        agentProvider: "codex",
        providerSessionId: "019fae67-keep-this-exact-session-id",
      }],
    }];
    return preserveLiveHeaderState(nextTabs as never, currentTabs as never)[0]?.terminals[0];
  });

  expect(result?.status).toBe("reconnected");
  expect(result?.providerSessionId).toBe("019fae67-keep-this-exact-session-id");
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
      }, {
        id: "recovered-tab-killed-session",
        title: "Recovered old shell",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/killed",
        terminals: [{
          id: "killed-session",
          paneId: "recovered-pane-killed-session",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "recovered-pane-killed-session", type: "terminal" },
        activePaneId: "recovered-pane-killed-session",
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

    await hydrateWorkspace({ background: true });
    const state = useWorkspaceStore.getState();
    return {
      calls,
      tabIds: state.tabs.map((tab) => tab.id),
      nodeTabIds: state.canvasState.nodes
        .filter((node) => node.type === "terminal")
        .map((node) => node.terminalTabId),
    };
  });

  expect(result.calls).toContain("workspace_persisted_sessions");
  expect(result.tabIds).toEqual(["saved-tab"]);
  expect(result.nodeTabIds).toEqual(["saved-tab"]);
});

test("saved workspace layout reattaches saved daemon sessions without importing unsaved ones", async ({ page }) => {
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
          }, {
            id: "33333333-3333-4333-8333-333333333333",
            cwd: "/tmp/legacy-live",
            command: "/bin/bash",
            pid: 4343,
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
      }, {
        id: "legacy-tab",
        title: "Legacy live terminal",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/legacy-live",
        terminals: [{
          id: "33333333-3333-4333-8333-333333333333",
          paneId: "legacy-pane",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "legacy-pane", type: "terminal" },
        activePaneId: "legacy-pane",
      }, {
        id: "recovered-tab-33333333-3333-4333-8333-333333333333",
        title: "Legacy duplicate",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/legacy-live",
        terminals: [{
          id: "33333333-3333-4333-8333-333333333333",
          paneId: "recovered-pane-33333333-3333-4333-8333-333333333333",
          cols: 80,
          rows: 24,
          status: "starting",
        }],
        splitLayout: { id: "recovered-pane-33333333-3333-4333-8333-333333333333", type: "terminal" },
        activePaneId: "recovered-pane-33333333-3333-4333-8333-333333333333",
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

    await hydrateWorkspace({ background: true });
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
      terminalStatuses: state.tabs.flatMap((tab) =>
        tab.terminals.map((terminal) => ({ id: terminal.id, status: terminal.status })),
      ),
    };
  });

  expect(result.calls).toContain("daemon_list_sessions");
  expect(result.calls).toContain("workspace_persisted_sessions");
  expect(result.tabIds).toEqual(["saved-tab", "legacy-tab"]);
  expect(result.nodeTabIds).toEqual(["saved-tab", "legacy-tab"]);
  expect(result.tabProjects).not.toContainEqual(expect.objectContaining({
    id: "11111111-1111-4111-8111-111111111111",
  }));
  expect(result.terminalStatuses).not.toContainEqual(expect.objectContaining({
    id: "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222",
  }));
  expect(result.terminalStatuses.filter(
    (terminal) => terminal.id === "33333333-3333-4333-8333-333333333333",
  )).toEqual([{
    id: "33333333-3333-4333-8333-333333333333",
    status: "reconnected",
  }]);
});

test("late hydration preserves a terminal created while the disk layout is being reconciled", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") {
          return JSON.stringify({
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
          });
        }
        if (cmd === "daemon_list_sessions") {
          return [{
            id: "terminal-saved-tab-saved-pane",
            cwd: "/tmp/saved",
            initialCwd: "/tmp/saved",
            scrollbackBytes: 0,
          }];
        }
        if (cmd === "workspace_persisted_sessions") return [];
        if (cmd === "workstream_git_context") return { gitRoot: null };
        if (cmd === "workspace_layout_persist") return null;
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
        terminals: [],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      activeTerminalId: null,
      groups: [],
      terminalGroups: [],
      canvasState: {
        selectedNodeId: "node-new",
        selectedNodeIds: ["node-new"],
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

    useWorkspaceStore.getState().addTab({
      id: "new-tab",
      title: "flow-state",
      initialCwd: "/tmp/new",
    });

    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      tabIds: state.tabs.map((tab) => tab.id),
      activeTabId: state.activeTabId,
    };
  });

  expect(result.tabIds).toContain("new-tab");
  expect(result.activeTabId).toBe("new-tab");
});

test("unsaved external agent sessions never become tabs by folder or title", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const restoredId = "restored-agent-session";
    const calls: string[] = [];
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        calls.push(cmd);
        return cmd === "daemon_list_sessions"
          ? [{
          id: restoredId,
          cwd: "/repo/agent",
          initialCwd: "/repo/agent",
          command: "export TERMFLEET=1 TERMFLEET_SESSION_NAME_B64=YWdlbnQtb25l; exec codex resume 019f-restored",
            }]
          : cmd === "workspace_persisted_sessions" || cmd === "agent_status_list_sidecars"
            ? []
            : null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    window.localStorage.setItem = () => { throw new Error("cache unavailable"); };
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "recovered-tab-old-session",
        title: "agent",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
         initialCwd: "/repo/agent",
         restoreName: "agent-one",
        terminals: [{ id: "old-restored-id", paneId: "recovered-pane-old-session", cols: 80, rows: 24, status: "starting" }],
        splitLayout: { id: "recovered-pane-old-session", type: "terminal" },
        activePaneId: "recovered-pane-old-session",
      }],
      activeTabId: "recovered-tab-old-session",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      tabIds: state.tabs.map((tab) => tab.id),
      terminalIds: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id)),
      restoreNames: state.tabs.map((tab) => tab.restoreName),
    };
  });

  expect(result.tabIds).toEqual(["recovered-tab-old-session"]);
  expect(result.terminalIds).toEqual(["old-restored-id"]);
  expect(result.restoreNames).toEqual(["agent-one"]);
});

test("external restored agent sessions reattach to their saved tab", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const restoredId = "restored-agent-session";
    const calls: string[] = [];
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        calls.push(cmd);
        return cmd === "daemon_list_sessions"
          ? [{
            id: restoredId,
            cwd: "/repo/agent",
            initialCwd: "/repo/agent",
            command: "export TERMFLEET=1 TERMFLEET_SESSION_NAME_B64=YWdlbnQtb25l; exec codex resume 019f-restored",
          }]
          : cmd === "workspace_persisted_sessions" || cmd === "agent_status_list_sidecars"
            ? []
            : cmd === "workstream_git_context"
              ? null
              : null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    window.localStorage.setItem = () => { throw new Error("cache unavailable"); };
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [{
        id: "saved-agent-tab",
        title: "agent",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/repo/agent",
        restoreName: "agent-one",
        terminals: [{ id: "stale-agent-id", paneId: "saved-agent-pane", cols: 80, rows: 24, status: "killed", providerSessionId: "019f-restored" }],
        splitLayout: { id: "saved-agent-pane", type: "terminal" },
        activePaneId: "saved-agent-pane",
      }],
      activeTabId: "saved-agent-tab",
      closedSessionIds: [],
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const state = useWorkspaceStore.getState();
    return {
      activeTabId: state.activeTabId,
      calls,
      tabIds: state.tabs.map((tab) => tab.id),
      terminalIds: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id)),
    };
  });

  expect(result.activeTabId).toBe("saved-agent-tab");
  expect(result.tabIds).toEqual(["saved-agent-tab"]);
  expect(result.terminalIds).toEqual(["restored-agent-session"]);
});

test("external restored agent sessions keep their exact provider session id on the saved tab", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const restoredId = "restored-agent-session";
    (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "daemon_list_sessions") {
          return [{
            id: restoredId,
            cwd: "/repo/agent",
            initialCwd: "/repo/agent",
            provider: "codex",
            providerSessionId: "019f-restored-exact",
            command: "export TERMFLEET=1 TERMFLEET_SESSION_NAME_B64=YWdlbnQtb25l; exec codex resume 019f-restored-exact",
          }];
        }
        if (cmd === "workspace_persisted_sessions" || cmd === "agent_status_list_sidecars") {
          return [];
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
        id: "saved-agent-tab",
        title: "agent",
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/repo/agent",
        restoreName: "agent-one",
        terminals: [{ id: "stale-agent-id", paneId: "saved-agent-pane", cols: 80, rows: 24, status: "killed", providerSessionId: "019f-restored-exact" }],
        splitLayout: { id: "saved-agent-pane", type: "terminal" },
        activePaneId: "saved-agent-pane",
      }],
      activeTabId: "saved-agent-tab",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    const terminal = useWorkspaceStore.getState().tabs[0]?.terminals[0];
    return {
      id: terminal?.id,
      providerSessionId: terminal?.providerSessionId,
      agentProvider: terminal?.agentProvider,
    };
  });

  expect(result).toEqual({
    id: "restored-agent-session",
    providerSessionId: "019f-restored-exact",
    agentProvider: "codex",
  });
});

test("background recovery never persists unsaved daemon inventory", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const savedLayouts: string[] = [];
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("cache unavailable");
    };
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: { contents?: string }) => {
        if (cmd === "workspace_layout_save" && args?.contents) savedLayouts.push(args.contents);
        if (cmd === "daemon_list_sessions") return [
          { id: "external-agent", cwd: "/repo/agent", command: "export TERMFLEET=1; exec claude --resume 019f-agent" },
          { id: "ordinary-shell", cwd: "/repo/shell", command: "/bin/bash" },
        ];
        if (cmd === "workspace_persisted_sessions" || cmd === "agent_status_list_sidecars") return [];
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: false,
      tabs: [],
      activeTabId: null,
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace({ background: true });
    const state = useWorkspaceStore.getState();
    window.localStorage.setItem = originalSetItem;
    return {
      tabIds: state.tabs.map((tab) => tab.id),
      terminalIds: state.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id)),
      savedLayouts,
    };
  });

  expect(result.tabIds).toEqual([]);
  expect(result.terminalIds).toEqual([]);
  expect(result.savedLayouts.some((layout) => layout.includes("external-agent"))).toBe(false);
  expect(result.savedLayouts.some((layout) => layout.includes("ordinary-shell"))).toBe(false);
});

test("disk workspace layout keeps saved tabs without resurrecting dead persisted sessions", async ({ page }) => {
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
            id: "orphan-session",
            cwd: "/tmp/orphan",
            scrollbackBytes: 4096,
            lifecycle: "recoverable",
            backupOnly: false,
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
    await hydrateWorkspace({ background: true });
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
  expect(result.calls).toContain("workspace_persisted_sessions");
  expect(result.hydrating).toBe(false);
  expect(result.tabIds).toEqual(["disk-tab"]);
  expect(result.nodeTabIds).toEqual(["disk-tab"]);
});

test("background enrichment resolves saved panes to their live repository folders", async ({ page }) => {
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
    await hydrateWorkspace({ background: true });
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

test("restart applies the durable layout even when no daemon sessions are listed yet", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const diskWorkspace = {
      tabs: [{
        id: "durable-tab",
        title: "Recovered project",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/durable",
        terminals: [{
          id: "terminal-durable-tab-durable-pane",
          paneId: "durable-pane",
          cols: 80,
          rows: 24,
          status: "running",
        }],
        splitLayout: { id: "durable-pane", type: "terminal" },
        activePaneId: "durable-pane",
      }],
      activeTabId: "durable-tab",
      groups: [],
      openFiles: [],
      pinnedProjects: [],
      workspaceUiState: {},
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
      closedSessionIds: [],
    };
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return JSON.stringify(diskWorkspace);
        if (cmd === "daemon_list_sessions") return [];
        if (cmd === "workspace_persisted_sessions") return [];
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({
      hydrating: true,
      tabs: [{
        id: "stale-tab",
        title: "Stale cache",
        emoji: "[]",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/tmp/stale",
        terminals: [{ id: "terminal-stale-tab-stale-pane", paneId: "stale-pane", cols: 80, rows: 24, status: "running" }],
        splitLayout: { id: "stale-pane", type: "terminal" },
        activePaneId: "stale-pane",
      }],
      activeTabId: "stale-tab",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });
    await hydrateWorkspace();
    return useWorkspaceStore.getState().tabs.map((tab) => tab.id);
  });

  expect(result).toEqual(["durable-tab"]);
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

test("closed and unsaved live panes stay absent from the saved layout", async ({ page }) => {
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

  expect(result).toEqual([{ id: "saved-tab", cwd: "/tmp/saved" }]);
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

test("closed workspace identities and unsaved daemon panes stay absent across projects", async ({ page }) => {
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
      closedSessionIds: [paperId, arthouseId],
    };
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown>; transformCallback: () => number; unregisterCallback: () => void } }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return JSON.stringify(diskWorkspace);
        if (cmd === "daemon_list_sessions") return [
          { id: paperId, cwd: "/work/paper-bot" },
          { id: arthouseId, cwd: "/work/arthouse" },
          { id: openId, cwd: "/work/paper-bot" },
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
  expect(result).toEqual([]);
});

test("sidecar history cannot reconstruct panes without a durable saved layout", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const recentId = "terminal-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const sidecarOnlyId = "terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222";
    const lifeboatId = "terminal-33333333-3333-4333-8333-333333333333-44444444-4444-4444-8444-444444444444";
    const closedId = "terminal-cccccccc-cccc-4ccc-8ccc-cccccccccccc-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const staleId = "terminal-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-ffffffff-ffff-4fff-8fff-ffffffffffff";
    const sidecars = [
      JSON.stringify({ paneId: recentId, cwd: "/repo/productivity/flow-state", updatedAt: now }),
      JSON.stringify({ paneId: sidecarOnlyId, cwd: "/repo/productivity/flow-state", updatedAt: now, provider: "codex", sessionId: "flow-sidecar-only" }),
      JSON.stringify({ paneId: lifeboatId, cwd: "/repo/devops/hermes/lifeboat-live", updatedAt: now, provider: "claude", sessionId: "lifeboat-sidecar-only" }),
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
        if (cmd === "workspace_persisted_sessions") return [
          { id: recentId, cwd: "/repo/productivity/flow-state", scrollbackBytes: 64, lifecycle: "recoverable", backupOnly: false },
          { id: lifeboatId, cwd: "/repo/devops/hermes/lifeboat-live", scrollbackBytes: 64, lifecycle: "unknown", backupOnly: false },
          { id: closedId, cwd: "/repo/productivity/flow-state", scrollbackBytes: 64, lifecycle: "intentional-kill", backupOnly: true },
        ];
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
    await hydrateWorkspace({ background: true });
    const state = useWorkspaceStore.getState();
    const repaired = state.tabs.find((tab) => tab.terminals.some((terminal) => terminal.id === recentId));
    return {
      tabCount: state.tabs.length,
      ids: state.tabs.map((tab) => tab.terminals[0]?.id),
      migrationVersion: state.agentRecoveryMigrationVersion,
      repairedStatus: repaired?.terminals[0]?.status,
      recoveryReview: state.recoverySessions
        .filter((session) => [recentId, sidecarOnlyId, lifeboatId, closedId, staleId].includes(session.id))
        .map((session) => ({ id: session.id, lifecycle: session.lifecycle }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  });

  expect(result.tabCount).toBe(1);
  expect(result.ids).toEqual(["terminal-saved-tab-saved-pane"]);
  expect(result.migrationVersion).toBe(0);
  expect(result.repairedStatus).toBeUndefined();
  expect(result.recoveryReview).toEqual([]);
});

test("dead persisted terminals remain manual recovery records even when unclosed", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const recoveredId = "recovered-short-scrollback-session";
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
        if (cmd === "daemon_list_sessions") return [];
        if (cmd === "workspace_persisted_sessions") {
          return [{
            id: recoveredId,
            cwd: "/repo/untouched",
            scrollbackBytes: 32,
            lifecycle: "recoverable",
            backupOnly: false,
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
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: "/repo/saved",
        terminals: [{ id: "saved-session", paneId: "saved-pane", cols: 80, rows: 24, status: "starting" }],
        splitLayout: { id: "saved-pane", type: "terminal" },
        activePaneId: "saved-pane",
      }],
      activeTabId: "saved-tab",
      groups: [],
      terminalGroups: [],
      canvasState: { selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
    });

    await hydrateWorkspace({ background: true });
    return { calls, tabs: useWorkspaceStore.getState().tabs.map((tab) => ({ id: tab.id, cwd: tab.initialCwd })) };
  });

  expect(result.calls).toContain("workspace_persisted_sessions");
  expect(result.tabs).toEqual([{ id: "saved-tab", cwd: "/repo/saved" }]);
});
