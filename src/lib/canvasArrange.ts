import type { CanvasNode, Tab } from "./types";

// Tidy/align on the operations map must move EVERY card it finds: terminals,
// notes, files, localhost previews, boards, and whatever card type ships next.
// Nothing in here may branch on a card's kind — a layout that whitelists kinds
// silently drops the newest feature on the floor and stacks terminals on top of
// it. Membership is resolved from links first, then geometry, so a brand-new
// card type is grouped correctly without touching this file.

export const CANVAS_PROJECT_LANE_GAP = 48;
export const CANVAS_PROJECT_ITEM_GAP = 40;
export const CANVAS_ROW_ITEM_GAP = 32;

/** Lane used by cards that belong to no project (a loose note, a scratch board). */
export const CANVAS_UNFILED_PROJECT_ID = "__unfiled__";

/**
 * How far (in map units) a card may sit from a project's cluster and still be
 * adopted by it. Beyond this it is treated as loose and goes to the last lane.
 */
export const CANVAS_PROJECT_ADOPTION_RADIUS = 480;

export type ArrangeableNode = Pick<
  CanvasNode,
  "id" | "x" | "y" | "width" | "height"
> &
  Partial<Pick<CanvasNode, "terminalTabId" | "linkedTerminalPaneId">>;

export type ArrangeTab = Pick<Tab, "id" | "groupId"> &
  Partial<Pick<Tab, "terminals">>;

export interface CanvasPosition {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectOf(node: ArrangeableNode): Rect {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  };
}

function mergeRect(into: Rect | undefined, next: Rect): Rect {
  if (!into) return { ...next };
  return {
    left: Math.min(into.left, next.left),
    top: Math.min(into.top, next.top),
    right: Math.max(into.right, next.right),
    bottom: Math.max(into.bottom, next.bottom),
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function edgeDistance(a: Rect, b: Rect): number {
  const dx = Math.max(b.left - a.right, a.left - b.right, 0);
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
  return Math.hypot(dx, dy);
}

/**
 * Project id for every card on the map.
 *
 * 1. A card that owns a terminal tab belongs to that tab's project.
 * 2. A card linked to a terminal pane (localhost preview, and anything else
 *    that adopts `linkedTerminalPaneId`) inherits that pane's project.
 * 3. Anything else — a note, a drawing board, a dropped file, a future card —
 *    joins the project whose cluster it is sitting in or nearest to.
 * 4. Otherwise it is unfiled and gets its own lane at the end.
 */
export function resolveCanvasNodeProjects(
  nodes: ArrangeableNode[],
  tabs: ArrangeTab[],
): Map<string, string> {
  const projectByTabId = new Map<string, string>();
  const projectByPaneId = new Map<string, string>();
  for (const tab of tabs) {
    const projectId = tab.groupId ?? CANVAS_UNFILED_PROJECT_ID;
    projectByTabId.set(tab.id, projectId);
    for (const terminal of tab.terminals ?? []) {
      if (terminal?.paneId) projectByPaneId.set(terminal.paneId, projectId);
    }
  }

  const resolved = new Map<string, string>();
  const clusters = new Map<string, Rect>();
  const loose: ArrangeableNode[] = [];

  for (const node of nodes) {
    const linked =
      (node.terminalTabId
        ? projectByTabId.get(node.terminalTabId)
        : undefined) ??
      (node.linkedTerminalPaneId
        ? projectByPaneId.get(node.linkedTerminalPaneId)
        : undefined);
    if (linked && linked !== CANVAS_UNFILED_PROJECT_ID) {
      resolved.set(node.id, linked);
      clusters.set(linked, mergeRect(clusters.get(linked), rectOf(node)));
    } else {
      loose.push(node);
    }
  }

  for (const node of loose) {
    const rect = rectOf(node);
    let bestId: string | null = null;
    let bestOverlap = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [projectId, cluster] of clusters) {
      const overlap = overlapArea(rect, cluster);
      const distance = edgeDistance(rect, cluster);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestDistance = distance;
        bestId = projectId;
        continue;
      }
      if (bestOverlap === 0 && distance < bestDistance) {
        bestDistance = distance;
        bestId = projectId;
      }
    }
    const adopted =
      bestId &&
      (bestOverlap > 0 || bestDistance <= CANVAS_PROJECT_ADOPTION_RADIUS)
        ? bestId
        : CANVAS_UNFILED_PROJECT_ID;
    resolved.set(node.id, adopted);
  }

  return resolved;
}

/** Ids of every card belonging to one project, in reading order. */
export function canvasProjectMembers(
  nodes: ArrangeableNode[],
  tabs: ArrangeTab[],
  projectId: string,
): ArrangeableNode[] {
  const projects = resolveCanvasNodeProjects(nodes, tabs);
  return nodes.filter((node) => projects.get(node.id) === projectId);
}

function sortForRow(nodes: ArrangeableNode[]): ArrangeableNode[] {
  return [...nodes].sort((left, right) => left.x - right.x || left.y - right.y);
}

function sortForLane(nodes: ArrangeableNode[]): ArrangeableNode[] {
  return [...nodes].sort((left, right) => left.y - right.y || left.x - right.x);
}

/**
 * Lay one project's cards out in a single row, tallest-anchored at the top so a
 * short note and a tall terminal still line up on their top edge.
 */
export function planCanvasRow(
  nodes: ArrangeableNode[],
  gap: number = CANVAS_ROW_ITEM_GAP,
): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  if (nodes.length < 2) return positions;
  const rowY = Math.min(...nodes.map((node) => node.y));
  let cursorX = Math.min(...nodes.map((node) => node.x));
  for (const node of sortForRow(nodes)) {
    positions.set(node.id, { x: cursorX, y: rowY });
    cursorX += node.width + gap;
  }
  return positions;
}

/**
 * Lay the whole map out as one column per project, unfiled cards last. Every
 * card passed in gets a position — none is skipped and none is overlapped.
 */
export function planCanvasLanes(
  nodes: ArrangeableNode[],
  projectByNodeId: Map<string, string>,
  options: { laneGap?: number; itemGap?: number } = {},
): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  if (nodes.length < 2) return positions;
  const laneGap = options.laneGap ?? CANVAS_PROJECT_LANE_GAP;
  const itemGap = options.itemGap ?? CANVAS_PROJECT_ITEM_GAP;

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));

  const lanes = new Map<string, ArrangeableNode[]>();
  for (const node of nodes) {
    const projectId = projectByNodeId.get(node.id) ?? CANVAS_UNFILED_PROJECT_ID;
    const lane = lanes.get(projectId) ?? [];
    lane.push(node);
    lanes.set(projectId, lane);
  }

  const sortedLanes = [...lanes.entries()].sort(
    ([leftId, leftNodes], [rightId, rightNodes]) => {
      // Loose cards always land in the final lane so projects stay readable.
      if (leftId === CANVAS_UNFILED_PROJECT_ID) return 1;
      if (rightId === CANVAS_UNFILED_PROJECT_ID) return -1;
      const leftX = Math.min(...leftNodes.map((node) => node.x));
      const rightX = Math.min(...rightNodes.map((node) => node.x));
      if (leftX !== rightX) return leftX - rightX;
      const leftY = Math.min(...leftNodes.map((node) => node.y));
      const rightY = Math.min(...rightNodes.map((node) => node.y));
      return leftY - rightY;
    },
  );

  let cursorX = minX;
  for (const [, laneNodes] of sortedLanes) {
    const ordered = sortForLane(laneNodes);
    const laneWidth = Math.max(...ordered.map((node) => node.width));
    let cursorY = minY;
    for (const node of ordered) {
      positions.set(node.id, { x: cursorX, y: cursorY });
      cursorY += node.height + itemGap;
    }
    cursorX += laneWidth + laneGap;
  }

  return positions;
}

/** How many distinct lanes a lane-tidy would produce, for enabling the button. */
export function countCanvasLanes(
  nodes: ArrangeableNode[],
  tabs: ArrangeTab[],
): number {
  if (nodes.length === 0) return 0;
  const projects = resolveCanvasNodeProjects(nodes, tabs);
  return new Set(projects.values()).size;
}
