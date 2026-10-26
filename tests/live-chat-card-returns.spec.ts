import { test, expect } from "@playwright/test";

const baseUrl = process.env.TERMFLEET_TEST_BASE_URL ?? "http://127.0.0.1:5177/";

// TF-091: the saved layout lost the film chat's card while its terminal kept running
// and its chat id sat on the closed list. The next start must show that card again.
test("a running chat whose card was dropped comes back on the next start", async ({ page }) => {
  await page.route(baseUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Card returns fixture</title>" }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const liveId = "terminal-5080a117-ffbd-4f1e-8084-6a41af386a42-6b4d9b33-32da-41b4-b23b-afbeb622597f";
    const chatId = "beb2d3de-8c1c-4d28-bb64-a8133d3cfbc7";
    const other = {
      id: "open-sibling", title: "Open sibling", emoji: "[]", color: "#7aa2f7", groupId: null, initialCwd: "/tmp/other",
      terminals: [{ id: "pty-open-sibling", paneId: "pane-open-sibling", cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: "pane-open-sibling", type: "terminal" }, activePaneId: "pane-open-sibling",
    };
    const disk = {
      tabs: [other], activeTabId: "open-sibling", groups: [], terminalGroups: [],
      closedSessionIds: ["terminal-46d71e27-old-dead-card"],
      closedProviderSessionIds: [chatId],
      agentRecoveryMigrationVersion: 1,
      canvasState: { nodes: [], selectedNodeId: null, selectedNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 } },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "workspace_layout_load") return JSON.stringify(disk);
        if (cmd === "daemon_list_sessions") {
          return [
            { id: "pty-open-sibling", cwd: "/tmp/other", pid: 4100 },
            { id: liveId, cwd: "/tmp/content-creation", command: `claude --resume ${chatId}; exec "\${SHELL:-bash}" -l`, pid: 99890 },
          ];
        }
        return null;
      },
      transformCallback: () => 1, unregisterCallback: () => {},
    };
    const { hydrateWorkspace, useWorkspaceStore } = await import("/src/stores/workspace.ts?card-returns");
    useWorkspaceStore.setState({ ...disk, hydrating: true, recoverySessions: [], dismissedRecoverySessionKeys: [], recoveryTransfers: [], closedRestoreTargets: [] });
    await hydrateWorkspace();
    await hydrateWorkspace({ background: true });
    const state = useWorkspaceStore.getState();
    return {
      terminalIds: state.tabs.flatMap((tab: { terminals: { id: string }[] }) => tab.terminals.map((terminal) => terminal.id)),
      closedProviderSessionIds: state.closedProviderSessionIds,
    };
  });
  expect(result.terminalIds).toContain("terminal-5080a117-ffbd-4f1e-8084-6a41af386a42-6b4d9b33-32da-41b4-b23b-afbeb622597f");
  expect(result.closedProviderSessionIds).not.toContain("beb2d3de-8c1c-4d28-bb64-a8133d3cfbc7");
});
