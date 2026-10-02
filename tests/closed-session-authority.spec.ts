import { test, expect } from "@playwright/test";

const baseUrl = process.env.TERMFLEET_TEST_BASE_URL ?? "http://127.0.0.1:5177/";

for (const phase of ["hydration", "reconciliation"] as const) {
  for (const match of ["pty", "provider"] as const) {
    test(`${phase} excludes historically closed ${match} cards without killing live PTYs`, async ({ page }) => {
      await page.route(baseUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Workspace authority fixture</title>" }));
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const result = await page.evaluate(async ({ phase, match }) => {
        const calls: string[] = [];
        const closedId = "terminal-77777777-7777-4777-8777-777777777777-88888888-8888-4888-8888-888888888888";
        const providerId = "99999999-9999-4999-8999-999999999999";
        const tab = {
          id: "77777777-7777-4777-8777-777777777777", title: "Historical closed card",
          emoji: "[]", color: "#7aa2f7", groupId: null, initialCwd: "/tmp/closed-authority",
          terminals: [{ id: closedId, paneId: "88888888-8888-4888-8888-888888888888", providerSessionId: providerId, cols: 80, rows: 24, status: "running" }],
          splitLayout: { id: "88888888-8888-4888-8888-888888888888", type: "terminal" },
          activePaneId: "88888888-8888-4888-8888-888888888888",
        };
        const disk = {
          tabs: [tab, { ...tab, id: "open-sibling", title: "Open sibling", terminals: [{ ...tab.terminals[0], id: "pty-open-sibling", providerSessionId: undefined }] }], activeTabId: "open-sibling", groups: [], terminalGroups: [],
          closedSessionIds: match === "pty" ? [closedId] : [],
          closedProviderSessionIds: match === "provider" ? [providerId] : [],
          agentRecoveryMigrationVersion: 1,
          canvasState: { nodes: [], selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 } },
        };
        (window as any).__TAURI_INTERNALS__ = {
          invoke: async (cmd: string) => {
            calls.push(cmd);
            if (cmd === "workspace_layout_load") return JSON.stringify(disk);
            if (cmd === "daemon_list_sessions") return [{ id: closedId, cwd: tab.initialCwd, providerSessionId: providerId, pid: 4201 }];
            return null;
          },
          transformCallback: () => 1, unregisterCallback: () => {},
        };
        const { hydrateWorkspace, reconcileLiveWorkspace, useWorkspaceStore } = await import(`/src/stores/workspace.ts?closed-authority=${phase}-${match}`);
        useWorkspaceStore.setState({ ...disk, hydrating: phase === "hydration", recoverySessions: [], dismissedRecoverySessionKeys: [], recoveryTransfers: [], closedRestoreTargets: [] });
        if (phase === "hydration") {
          await hydrateWorkspace();
          await hydrateWorkspace({ background: true });
        } else {
          await reconcileLiveWorkspace();
          await reconcileLiveWorkspace();
        }
        return { calls, kills: calls.filter((cmd) => cmd === "daemon_kill_session"), titles: useWorkspaceStore.getState().tabs.map((candidate: { title: string }) => candidate.title) };
      }, { phase, match });
      expect(result.calls).toContain("daemon_list_sessions");
      expect(result.titles).not.toContain("Historical closed card");
      expect(result.titles).toContain("Open sibling");
      expect(result.kills).toEqual([]);
    });
  }
}

test("explicit Close persists the exact decision before killing only the clicked PTY", async ({ page }) => {
  await page.route(baseUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Close authority fixture</title>" }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const events: Array<{ cmd: string; id?: string; closed?: string[] }> = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === "daemon_status") return { reachable: true, mode: "externalDaemon" };
        if (cmd === "daemon_list_sessions") return [{ id: "pty-sibling" }];
        if (cmd === "workspace_layout_save") events.push({ cmd, closed: JSON.parse(args.contents).closedSessionIds });
        if (cmd === "daemon_kill_session") events.push({ cmd, id: args.id });
        return null;
      },
      transformCallback: () => 1, unregisterCallback: () => {},
    };
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts?explicit-close-authority");
    const tabs = ["clicked", "sibling"].map((id) => ({
      id, title: id, emoji: "[]", color: "#7aa2f7", groupId: null, initialCwd: "/tmp/same-project",
      terminals: [{ id: `pty-${id}`, paneId: `pane-${id}`, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: `pane-${id}`, type: "terminal" }, activePaneId: `pane-${id}`,
    }));
    useWorkspaceStore.setState({ tabs, activeTabId: "clicked", hydrating: false, groups: [], terminalGroups: [], closedSessionIds: [], closedProviderSessionIds: [], closedRestoreTargets: [], recentlyClosed: [], canvasState: { nodes: [], selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 } } });
    await useWorkspaceStore.getState().closeTerminalSession("clicked");
    return { events, tabs: useWorkspaceStore.getState().tabs.map((tab: { id: string }) => tab.id) };
  });
  expect(result.tabs).toEqual(["sibling"]);
  expect(result.events.filter((event) => event.cmd === "daemon_kill_session")).toEqual([{ cmd: "daemon_kill_session", id: "pty-clicked" }]);
  const killIndex = result.events.findIndex((event) => event.cmd === "daemon_kill_session");
  expect(result.events.slice(0, killIndex).some((event) => event.closed?.includes("pty-clicked"))).toBe(true);
  expect(result.events.some((event) => event.closed?.includes("pty-sibling"))).toBe(false);
});
