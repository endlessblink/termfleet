import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("map provider follows its pane after switching agents, preserving the sibling identity", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.evaluate(() => {
    const store = window.__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store unavailable");
    const now = Date.now();
    store.setState({
      tabs: [{
        id: "provider-tab", title: "Provider switch", emoji: "[]", color: "#7aa2f7", groupId: null,
        initialCwd: "/tmp/provider-switch", activePaneId: "codex-pane",
        splitLayout: { id: "provider-split", type: "split", direction: "horizontal", ratio: 0.5,
          children: [{ id: "codex-pane", type: "terminal" }, { id: "claude-pane", type: "terminal" }] },
        workstream: { kind: "agent", provider: "claude", status: "running", phase: "active", createdAt: now },
        terminals: [
          { id: "codex-pty", paneId: "codex-pane", cols: 80, rows: 24, status: "running", agentProvider: "codex",
            statusSummary: { provider: "codex", status: "working", confidence: "high", task: "Checking the current provider", now: "Reading files" } },
          { id: "claude-pty", paneId: "claude-pane", cols: 80, rows: 24, status: "running", agentProvider: "claude" },
        ],
      }],
      activeTabId: "provider-tab",
      workspaceUiState: { ...store.getState().workspaceUiState, workspaceMode: "canvas" },
      canvasState: {
        selectedNodeId: "codex-node", viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "codex-node", type: "terminal", title: "Codex pane", terminalTabId: "provider-tab",
            linkedTerminalPaneId: "codex-pane", terminalPtyId: "codex-pty", x: 0, y: 0, width: 700, height: 440 },
        ],
      },
    });
  });
  const codex = page.locator("section[data-node-id]");
  await expect(codex).toHaveCount(1);
  await expect(codex.locator('[aria-label="CODEX agent"]').first()).toBeVisible();
  await expect(codex.locator('[aria-label="CLAUDE agent"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__termfleetWorkspaceStore?.getState().tabs[0].terminals.find((terminal) => terminal.paneId === "claude-pane")?.agentProvider)).toBe("claude");

  // The same pane-owned summary remains usable before its provider field is populated.
  await page.evaluate(() => {
    const store = window.__termfleetWorkspaceStore!;
    const tab = store.getState().tabs[0];
    store.setState({ tabs: [{ ...tab, terminals: tab.terminals.map((terminal) =>
      terminal.paneId === "codex-pane" ? { ...terminal, agentProvider: undefined } : terminal,
    ) }] });
  });
  await expect(codex.locator('[aria-label="CODEX agent"]').first()).toBeVisible();

  // Saved launch metadata is still the fallback when that pane has no provider evidence.
  await page.evaluate(() => {
    const store = window.__termfleetWorkspaceStore!;
    const tab = store.getState().tabs[0];
    store.setState({ tabs: [{ ...tab, terminals: tab.terminals.map((terminal) =>
      terminal.paneId === "codex-pane" ? { ...terminal, statusSummary: undefined } : terminal,
    ) }] });
  });
  await expect(codex.locator('[aria-label="CLAUDE agent"]').first()).toBeVisible();
  await expect(codex.locator('[aria-label="CODEX agent"]')).toHaveCount(0);
});
