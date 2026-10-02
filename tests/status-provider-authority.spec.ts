import { expect, test } from "@playwright/test";

const baseUrl = process.env.TERMFLEET_TEST_BASE_URL ?? "http://127.0.0.1:5177/";

for (const observation of ["codex", "unknown", "error"] as const) {
  for (const age of ["fresh", "stale"] as const) {
    test(`${observation} exact process identity with ${age} Claude sidecar preserves pane attribution`, async ({ page }) => {
      await page.route(baseUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Exact provider fixture</title>" }));
      await page.goto(baseUrl);
      const result = await page.evaluate(async ({ observation, age }) => {
        const calls: Array<{ command: string; paneId?: string }> = [];
        const targetKey = "terminal-recovered-tab-recovered-pane";
        const siblingKey = "terminal-sibling-tab-sibling-pane";
        const sidecars = [targetKey, siblingKey].map((paneId) => JSON.stringify({
          paneId, provider: "claude", sessionId: "old-claude-conversation", cwd: "/tmp/shared-provider-project",
          updatedAt: Date.now() - (age === "stale" ? 24 * 60 * 60 * 1000 : 0),
          turn: "working", mainTask: "Reviewing the original Claude conversation", mainTaskSource: "opening-request",
          todos: [{ id: "claude-task", content: "Checking the original Claude task", status: "in_progress" }],
        }));
        (window as any).__TAURI_INTERNALS__ = {
          invoke: async (command: string, args: any) => {
            calls.push({ command, paneId: args?.paneId });
            if (command === "pane_agent_provider") {
              if (args.paneId === "actual-codex-pty") {
                if (observation === "error") throw new Error("fixture process read failed");
                return observation === "codex" ? "codex" : null;
              }
              if (args.paneId === "actual-claude-pty" || args.paneId === siblingKey) return "claude";
              return null;
            }
            if (command === "agent_status_list_sidecars") return sidecars;
            return null;
          },
          transformCallback: () => 1, unregisterCallback: () => {},
        };
        const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
        const makeTab = (id: string, paneId: string, ptyId: string) => ({
          id, title: id, emoji: "", color: "#000", groupId: null, initialCwd: "/tmp/shared-provider-project",
          activePaneId: paneId, splitLayout: { id: paneId, type: "terminal" },
          terminals: [{ id: ptyId, paneId, cols: 80, rows: 24, status: "running", agentProvider: "claude",
            providerSessionId: "old-claude-conversation", mainUserAsk: { text: "Original Claude request", source: "status-sidecar", capturedAt: 1 },
            taskLineup: [{ id: "claude-task", text: "Original Claude task", state: "in_progress", source: "todo-write" }],
            statusSummarySource: "sidecar", statusSummary: { provider: "claude", path: "/tmp/shared-provider-project", task: "Original Claude task", now: "Claude work", status: "working" } }],
        });
        useWorkspaceStore.setState({
          tabs: [makeTab("recovered-tab", "recovered-pane", "actual-codex-pty"), makeTab("sibling-tab", "sibling-pane", "actual-claude-pty")],
          activeTabId: "recovered-tab", liveCwds: {},
        } as any);
        const { startStatusPollLoop } = await import("/src/lib/statusPollLoop.ts");
        startStatusPollLoop();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { calls, panes: useWorkspaceStore.getState().tabs.map((tab) => tab.terminals[0]) };
      }, { observation, age });
      const [target, sibling] = result.panes;
      expect(sibling.agentProvider).toBe("claude");
      expect(sibling.providerSessionId).toBe("old-claude-conversation");
      if (observation === "codex") {
        expect(target.agentProvider).toBe("codex");
        expect(target.statusSummary?.provider).toBe("codex");
        expect(target.providerSessionId).toBeUndefined();
        expect(target.mainUserAsk).toBeUndefined();
        expect(target.taskLineup).toBeUndefined();
        expect(target.statusSummary?.task).not.toContain("Claude");
      } else {
        expect(target.agentProvider).toBe("claude");
        expect(target.providerSessionId).toBe("old-claude-conversation");
      }
      expect(result.calls.filter((call) => call.command === "pane_agent_provider").map((call) => call.paneId)).toContain("actual-codex-pty");
    });
  }
}
