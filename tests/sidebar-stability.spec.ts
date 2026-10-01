import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectBucketsByManualOrder } from "../src/lib/mapNodeOrdering";
import type { CanvasNode, Group, Tab } from "../src/lib/types";

// TF-069: the sidebar must stay put. Group order, card order and project membership
// never change because a terminal opened, closed, or was clicked.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

const group = (id: string): Group => ({ id, name: id, color: "#fff", projectRoot: `/p/${id}` });
const tab = (id: string, groupId: string) => ({ id, groupId }) as unknown as Tab;
const node = (id: string, tabId: string) => ({ id, type: "terminal", terminalTabId: tabId, x: 0, y: 0, width: 1, height: 1 }) as CanvasNode;

const groups = [group("g1"), group("g2"), group("g3")];
const tabs = [tab("t1", "g1"), tab("t2", "g2"), tab("t3", "g3")];
const nodes = [node("n1", "t1"), node("n2", "t2"), node("n3", "t3")];

test("groups keep the saved order 2, 1, 3 whatever order the cards come in", () => {
  const order = ["g2", "g1", "g3"];
  const keys = (list: CanvasNode[]) => projectBucketsByManualOrder(list, tabs, groups, [], { groupOrder: order }).map((b) => b.key);
  expect(keys(nodes)).toEqual(["g2", "g1", "g3"]);
  expect(keys([...nodes].reverse())).toEqual(["g2", "g1", "g3"]);
});

test("a group with no terminal is not listed as a row, and returns to its slot with the next terminal", () => {
  const order = ["g2", "g1", "g3"];
  const without = nodes.filter((n) => n.id !== "n1");
  expect(projectBucketsByManualOrder(without, tabs, groups, [], { groupOrder: order }).map((b) => b.key)).toEqual(["g2", "g3"]);
  expect(projectBucketsByManualOrder(nodes, tabs, groups, [], { groupOrder: order }).map((b) => b.key)).toEqual(["g2", "g1", "g3"]);
});

type Store = {
  getState: () => {
    tabs: Array<{ id: string; groupId: string | null; earlierSessions?: Array<{ savedText?: string; title: string }> }>;
    activeTabId: string | null;
    groups: Array<{ id: string; lastActiveTabId?: string }>;
    canvasState: { selectedNodeId: string | null; selectedNodeIds: string[]; nodes: Array<{ id: string }> };
    removeTab: (id: string) => void;
    selectCard: (nodeId: string) => void;
    archivePredecessor: (predecessorId: string, successorId: string, savedText?: string) => void;
  };
  setState: (state: Record<string, unknown>) => void;
};

async function seed(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const root = "/p";
    const gs = ["a", "b"].map((id) => ({ id: `g-${id}`, name: id, color: "#fff", projectRoot: `${root}/${id}` }));
    const mk = (id: string, g: string, cwd: string) => ({
      id,
      title: id,
      emoji: "[]",
      color: "#fff",
      groupId: g,
      initialCwd: cwd,
      terminals: [{ id: `pty-${id}`, paneId: `pane-${id}`, cols: 80, rows: 24, status: "running" }],
      splitLayout: { id: `pane-${id}`, type: "terminal" },
      activePaneId: `pane-${id}`,
    });
    const tabsSeed = [mk("a1", "g-a", "/p/a"), mk("a2", "g-a", "/p/a"), mk("a3", "g-a", "/p/a"), mk("b1", "g-b", "/p/b")];
    store.setState({
      groups: gs,
      terminalGroups: gs,
      tabs: tabsSeed,
      activeTabId: "a2",
      liveCwds: {},
      canvasState: {
        selectedNodeId: "terminal-map-a2",
        selectedNodeIds: ["terminal-map-a2"],
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: tabsSeed.map((t, i) => ({
          id: `terminal-map-${t.id}`,
          type: "terminal",
          title: t.id,
          terminalTabId: t.id,
          terminalCwd: t.initialCwd,
          x: i * 700,
          y: 0,
          width: 600,
          height: 400,
        })),
      },
    });
  });
}

test("closing a terminal selects another terminal of the same project, never one from another project", async ({ page }) => {
  await seed(page);
  const next = await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    store.getState().removeTab("a2");
    const state = store.getState();
    return { activeTabId: state.activeTabId, activeGroup: state.tabs.find((t) => t.id === state.activeTabId)?.groupId };
  });
  expect(next.activeGroup).toBe("g-a");
  expect(["a1", "a3"]).toContain(next.activeTabId);
});

test("selecting a card sets its own tab, its own node, and the project's last card in one step", async ({ page }) => {
  await seed(page);
  const state = await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    store.getState().selectCard("terminal-map-b1");
    const s = store.getState();
    return {
      activeTabId: s.activeTabId,
      selectedNodeId: s.canvasState.selectedNodeId,
      selectedNodeIds: s.canvasState.selectedNodeIds,
      lastActive: s.groups.find((g) => g.id === "g-b")?.lastActiveTabId,
    };
  });
  expect(state).toEqual({
    activeTabId: "b1",
    selectedNodeId: "terminal-map-b1",
    selectedNodeIds: ["terminal-map-b1"],
    lastActive: "b1",
  });
});

test("a handover keeps the old chat's text on the new card and removes the old card", async ({ page }) => {
  await seed(page);
  const result = await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    store.getState().archivePredecessor("a1", "a3", "the old chat text");
    const s = store.getState();
    const successor = s.tabs.find((t) => t.id === "a3");
    return {
      oldCardGone: !s.tabs.some((t) => t.id === "a1"),
      saved: successor?.earlierSessions?.map((e) => e.savedText),
    };
  });
  expect(result.oldCardGone).toBe(true);
  expect(result.saved).toEqual(["the old chat text"]);
});

test("source contract: every way of opening a card from the sidebar goes through one shared function", () => {
  const source = readFileSync("src/components/WorkbenchSidebar.tsx", "utf8");
  expect(source).toContain("onSelect={openCard}");
  expect(source).toContain("onClick={() => openCard(node)}");
  const open = source.slice(source.indexOf("const openCard"), source.indexOf("const groupVisibleNodes"));
  expect(open).toContain("selectCard(node.id)");
  // no pan guard: a click must always bring the clicked card into view
  expect(source).not.toContain("onScreen");
});
