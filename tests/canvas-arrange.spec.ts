import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  CANVAS_UNFILED_PROJECT_ID,
  canvasProjectMembers,
  countCanvasLanes,
  planCanvasLanes,
  planCanvasRow,
  resolveCanvasNodeProjects,
  type ArrangeTab,
  type ArrangeableNode,
} from "../src/lib/canvasArrange";

// Tidy/align used to arrange terminals only, which quietly buried notes,
// drawing boards and localhost previews under the cards it moved. These pin the
// rule that replaced it: EVERY card on the map takes part, including card types
// that do not exist yet. The type-coverage test below reads the node-type union
// straight from the source, so adding a new card type without teaching tidy
// about it fails here instead of shipping a broken layout.

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function canvasNodeTypes(): string[] {
  const source = readSource("src/lib/types.ts");
  const match = source.match(/export type CanvasNodeType =([^;]+);/);
  expect(
    match,
    "CanvasNodeType union not found in src/lib/types.ts",
  ).toBeTruthy();
  const types = [...match![1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  expect(types.length).toBeGreaterThan(1);
  return types;
}

const tabs: ArrangeTab[] = [
  {
    id: "tab-a",
    groupId: "project-a",
    terminals: [{ paneId: "pane-a" }] as ArrangeTab["terminals"],
  },
  {
    id: "tab-b",
    groupId: "project-b",
    terminals: [] as ArrangeTab["terminals"],
  },
];

function node(
  id: string,
  x: number,
  y: number,
  extra: Partial<ArrangeableNode> = {},
): ArrangeableNode {
  return { id, x, y, width: 200, height: 120, ...extra };
}

test("every card type on the map gets a place in a lane tidy", () => {
  const types = canvasNodeTypes();
  // One card per declared type, all loose in the same area as project-a.
  const nodes: ArrangeableNode[] = types.map((type, index) =>
    node(`card-${type}`, 100 + index * 20, 100 + index * 20),
  );
  nodes.push(node("anchor", 80, 80, { terminalTabId: "tab-a" }));

  const projects = resolveCanvasNodeProjects(nodes, tabs);
  const positions = planCanvasLanes(nodes, projects);

  for (const item of nodes) {
    expect(
      positions.get(item.id),
      `${item.id} was left out of the tidy — tidy must move every card type`,
    ).toBeTruthy();
  }
});

test("a lane tidy leaves no two cards overlapping", () => {
  const nodes: ArrangeableNode[] = [
    node("term-a", 0, 0, { terminalTabId: "tab-a", width: 400, height: 300 }),
    node("term-b", 500, 40, {
      terminalTabId: "tab-b",
      width: 400,
      height: 300,
    }),
    node("preview", 20, 20, { linkedTerminalPaneId: "pane-a" }),
    node("note", 520, 60),
    node("board", 4000, 4000, { width: 380, height: 280 }),
  ];

  const projects = resolveCanvasNodeProjects(nodes, tabs);
  const positions = planCanvasLanes(nodes, projects);
  const placed = nodes.map((item) => {
    const next = positions.get(item.id)!;
    return { ...item, x: next.x, y: next.y };
  });

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      const overlaps =
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      expect(overlaps, `${a.id} and ${b.id} still overlap after tidy`).toBe(
        false,
      );
    }
  }
});

test("a localhost preview follows the terminal it belongs to", () => {
  const nodes: ArrangeableNode[] = [
    node("term-a", 0, 0, { terminalTabId: "tab-a" }),
    node("term-b", 2000, 0, { terminalTabId: "tab-b" }),
    node("preview", 1900, 400, { linkedTerminalPaneId: "pane-a" }),
  ];
  const projects = resolveCanvasNodeProjects(nodes, tabs);
  // Sitting next to project-b's terminal does not matter: the link wins.
  expect(projects.get("preview")).toBe("project-a");
  expect(
    canvasProjectMembers(nodes, tabs, "project-a").map((item) => item.id),
  ).toEqual(["term-a", "preview"]);
});

test("a loose note joins the project it is sitting in, far ones stay unfiled", () => {
  const nodes: ArrangeableNode[] = [
    node("term-a", 0, 0, { terminalTabId: "tab-a", width: 400, height: 300 }),
    node("near-note", 420, 40),
    node("far-note", 9000, 9000),
  ];
  const projects = resolveCanvasNodeProjects(nodes, tabs);
  expect(projects.get("near-note")).toBe("project-a");
  expect(projects.get("far-note")).toBe(CANVAS_UNFILED_PROJECT_ID);
  expect(countCanvasLanes(nodes, tabs)).toBe(2);
});

test("unfiled cards are laid out in the last lane, never first", () => {
  const nodes: ArrangeableNode[] = [
    node("loose", -5000, 0),
    node("term-a", 0, 0, { terminalTabId: "tab-a" }),
  ];
  const projects = resolveCanvasNodeProjects(nodes, tabs);
  const positions = planCanvasLanes(nodes, projects);
  expect(positions.get("term-a")!.x).toBeLessThan(positions.get("loose")!.x);
});

test("a project row lines up cards of any kind on one top edge", () => {
  const nodes: ArrangeableNode[] = [
    node("term-a", 0, 300, { terminalTabId: "tab-a", width: 400, height: 300 }),
    node("note", 500, 60),
  ];
  const positions = planCanvasRow(nodes);
  expect(positions.get("term-a")).toEqual({ x: 0, y: 60 });
  expect(positions.get("note")).toEqual({ x: 432, y: 60 });
});

test("no arrange path filters the map down to terminals", () => {
  const arrangeModule = readSource("src/lib/canvasArrange.ts");
  expect(arrangeModule).not.toMatch(/node\.type/);

  const store = readSource("src/stores/workspace.ts");
  const arrangeStart = store.indexOf(
    "arrangeProjectRow: (groupId: string) => {",
  );
  expect(
    arrangeStart,
    "tidy implementation not found in the store",
  ).toBeGreaterThan(0);
  const arrangeSlice = store.slice(
    arrangeStart,
    store.indexOf("reorderCanvasNodes:", arrangeStart),
  );
  expect(arrangeSlice.length).toBeGreaterThan(200);
  expect(
    arrangeSlice,
    "tidy must not whitelist card types — future features would be skipped",
  ).not.toMatch(/node\.type/);
});
