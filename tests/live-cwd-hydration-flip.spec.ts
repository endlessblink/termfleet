import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// TF-045: a terminal started in one project and moved (cd) into another must
// stay in the project it is in now. The periodic live-session reconcile only
// knows the START folder and used to override the live reading, so the card
// flipped back into its start project every few seconds.
test("a live-session reconcile does not drag a moved terminal back to its start project", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const groupOf = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          setLiveCwd: (id: string, cwd: string) => void;
          hydrateRestoredWorkspace: (input: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const kernel = "/work/devops/in-control-kernel";
    const bots = "/work/bots+automation";
    const groups = [
      { id: "g-kernel", name: "in-control-kernel", color: "#7aa2f7", projectRoot: kernel },
      { id: "g-bots", name: "bots+automation", color: "#7dcfff", projectRoot: bots },
    ];
    const tab = {
      id: "tab-moved",
      title: "Terminal",
      emoji: "[]",
      color: "#7aa2f7",
      groupId: "g-bots",
      initialCwd: bots,
      terminals: [{ id: "pty-moved", paneId: "pane-moved", cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: "pane-moved", type: "terminal", cwd: bots },
      activePaneId: "pane-moved",
    };
    store.setState({ groups, terminalGroups: groups, tabs: [tab], activeTabId: tab.id });
    store.getState().setLiveCwd("pty-moved", bots);

    // Daemon session list: only the folder the shell was started in.
    store.getState().hydrateRestoredWorkspace({
      tabs: store.getState().tabs,
      activeTabId: tab.id,
      liveCwds: { "pty-moved": kernel },
    });
    return store.getState().tabs.find((t) => t.id === tab.id)?.groupId;
  });

  expect(groupOf).toBe("g-bots");
});

// Edge: before the live poll has reported anything (fresh launch), the
// daemon's folder is still the best evidence and must be used.
test("the daemon folder still files a terminal the live poll has not read yet", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const groupOf = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          tabs: Array<{ id: string; groupId: string | null }>;
          hydrateRestoredWorkspace: (input: Record<string, unknown>) => void;
        };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    const kernel = "/work/devops/in-control-kernel";
    const bots = "/work/bots+automation";
    const groups = [
      { id: "g-kernel", name: "in-control-kernel", color: "#7aa2f7", projectRoot: kernel },
      { id: "g-bots", name: "bots+automation", color: "#7dcfff", projectRoot: bots },
    ];
    const tab = {
      id: "tab-fresh",
      title: "Terminal",
      emoji: "[]",
      color: "#7aa2f7",
      groupId: null,
      initialCwd: bots,
      terminals: [{ id: "pty-fresh", paneId: "pane-fresh", cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: "pane-fresh", type: "terminal", cwd: bots },
      activePaneId: "pane-fresh",
    };
    store.setState({ groups, terminalGroups: groups, tabs: [tab], activeTabId: tab.id, liveCwds: {} });
    store.getState().hydrateRestoredWorkspace({
      tabs: store.getState().tabs,
      activeTabId: tab.id,
      liveCwds: { "pty-fresh": kernel },
    });
    return store.getState().tabs.find((t) => t.id === tab.id)?.groupId;
  });

  expect(groupOf).toBe("g-kernel");
});
