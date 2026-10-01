import type { CanvasNode, Group, Tab } from "./types";
import { projectNameFor } from "./projectDisplay";

export interface MapProjectBucket {
  key: string;
  label: string;
  nodes: CanvasNode[];
}

interface BucketAccumulator {
  key: string;
  label: string;
  nodes: CanvasNode[];
}

function finitePosition(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function horizontalOverlap(a: CanvasNode, b: CanvasNode) {
  const left = Math.max(finitePosition(a.x), finitePosition(b.x));
  const right = Math.min(
    finitePosition(a.x) + Math.max(0, finitePosition(a.width)),
    finitePosition(b.x) + Math.max(0, finitePosition(b.width)),
  );
  return Math.max(0, right - left);
}

function sameVisualStack(a: CanvasNode, b: CanvasNode) {
  const minWidth = Math.min(
    Math.max(1, finitePosition(a.width)),
    Math.max(1, finitePosition(b.width)),
  );
  return horizontalOverlap(a, b) >= minWidth * 0.35;
}

export function compareCanvasNodesByPosition(a: CanvasNode, b: CanvasNode) {
  if (sameVisualStack(a, b)) {
    const y = finitePosition(a.y) - finitePosition(b.y);
    if (y !== 0) return y;
  }
  const x = finitePosition(a.x) - finitePosition(b.x);
  if (x !== 0) return x;
  const y = finitePosition(a.y) - finitePosition(b.y);
  if (y !== 0) return y;
  return a.id.localeCompare(b.id);
}

export function orderCanvasNodesByManualOrder(
  nodes: CanvasNode[],
  manualOrder: string[],
): CanvasNode[] {
  const positions = new Map(manualOrder.map((id, index) => [id, index]));
  return [...nodes].sort((a, b) => {
    const aPosition = positions.get(a.id);
    const bPosition = positions.get(b.id);
    if (aPosition === undefined && bPosition === undefined) return 0;
    if (aPosition === undefined) return 1;
    if (bPosition === undefined) return -1;
    return aPosition - bPosition;
  });
}

export function projectBucketsByManualOrder(
  nodes: CanvasNode[],
  tabs: Tab[],
  groups: Group[],
  manualOrder: string[],
  options: { unassignedLabel?: string; groupOrder?: string[] } = {},
): MapProjectBucket[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const buckets = new Map<string, BucketAccumulator>();
  const unassignedKey = "__unassigned__";

  for (const node of orderCanvasNodesByManualOrder(nodes, manualOrder)) {
    const groupId = node.terminalTabId
      ? tabsById.get(node.terminalTabId)?.groupId ?? null
      : null;
    const key = groupId ?? unassignedKey;
    const group = groupId ? groupsById.get(groupId) : undefined;
    const label = group?.name
      ?? (groupId
        ? projectNameFor(groupId, groups)
        : options.unassignedLabel ?? projectNameFor(null, groups));
    const bucket = buckets.get(key);
    if (bucket) bucket.nodes.push(node);
    else buckets.set(key, { key, label, nodes: [node] });
  }

  // Groups keep their saved slot whether they hold 0, 1 or 5 terminals; groups
  // not saved yet follow in the order they already appeared (new ones at the end).
  for (const group of groups) {
    if (!buckets.has(group.id)) {
      buckets.set(group.id, { key: group.id, label: group.name, nodes: [] });
    }
  }
  const saved = options.groupOrder ?? [];
  const slot = (key: string) => {
    const index = saved.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const appeared = [...buckets.values()];
  return appeared
    .map((bucket, index) => ({ bucket, index }))
    .sort((a, b) => {
      if (a.bucket.key === unassignedKey) return b.bucket.key === unassignedKey ? 0 : 1;
      if (b.bucket.key === unassignedKey) return -1;
      return slot(a.bucket.key) - slot(b.bucket.key) || a.index - b.index;
    })
    .map(({ bucket }) => bucket);
}

export function projectBucketsByCanvasPosition(
  nodes: CanvasNode[],
  tabs: Tab[],
  groups: Group[],
  options: { unassignedLabel?: string } = {},
): MapProjectBucket[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const buckets = new Map<string, BucketAccumulator>();
  const unassignedKey = "__unassigned__";

  for (const node of nodes) {
    const groupId = node.terminalTabId ? tabsById.get(node.terminalTabId)?.groupId ?? null : null;
    const key = groupId ?? unassignedKey;
    const group = groupId ? groupsById.get(groupId) : undefined;
    const label = group?.name ?? (groupId ? projectNameFor(groupId, groups) : options.unassignedLabel ?? projectNameFor(null, groups));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.nodes.push(node);
    } else {
      buckets.set(key, { key, label, nodes: [node] });
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      nodes: [...bucket.nodes].sort(compareCanvasNodesByPosition),
    }))
    .sort((a, b) => {
      const firstA = a.nodes[0];
      const firstB = b.nodes[0];
      const x = finitePosition(firstA?.x ?? 0) - finitePosition(firstB?.x ?? 0);
      if (x !== 0) return x;
      const y = finitePosition(firstA?.y ?? 0) - finitePosition(firstB?.y ?? 0);
      if (y !== 0) return y;
      return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
    });
}
