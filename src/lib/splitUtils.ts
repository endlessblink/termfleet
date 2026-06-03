import type { SplitNode } from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

export const SPLIT_GAP = 4; // pixels between panes
const MIN_PANE_PERCENT = 10; // minimum pane size as percentage

// ── Rect type ────────────────────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ── Handle info ──────────────────────────────────────────────────────────────

export interface HandleInfo {
  splitNodeId: string;
  handleIndex: number; // between children[i] and children[i+1]
  direction: "horizontal" | "vertical";
  rect: Rect;
  splitNodeSizes: number[];
  /** Total available size of the parent split (minus gaps), for drag delta calc */
  availableSize: number;
}

// ── Tree queries ─────────────────────────────────────────────────────────────

/** Get all leaf IDs from the split tree */
export function getAllLeafIds(node: SplitNode): string[] {
  if (node.type !== "split") return [node.id];
  return (node.children ?? []).flatMap(getAllLeafIds);
}

/** Count the number of leaves */
export function countLeaves(node: SplitNode): number {
  if (node.type !== "split") return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countLeaves(c), 0);
}

export function getLeafNode(node: SplitNode, paneId: string): SplitNode | undefined {
  if (node.type !== "split") return node.id === paneId ? node : undefined;
  for (const child of node.children ?? []) {
    const leaf = getLeafNode(child, paneId);
    if (leaf) return leaf;
  }
  return undefined;
}

/** Get the CWD for a specific pane from the tree */
export function getPaneCwd(node: SplitNode, paneId: string): string | undefined {
  if (node.type === "terminal") {
    return node.id === paneId ? node.cwd : undefined;
  }
  for (const child of node.children ?? []) {
    const cwd = getPaneCwd(child, paneId);
    if (cwd !== undefined) return cwd;
  }
  return undefined;
}

// ── Tree mutations (immutable) ───────────────────────────────────────────────

/** Update the CWD for a specific terminal leaf */
export function updatePaneCwdInTree(
  tree: SplitNode,
  paneId: string,
  cwd: string | undefined,
): SplitNode {
  if (tree.type === "terminal") {
    return tree.id === paneId ? { ...tree, cwd } : tree;
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        updatePaneCwdInTree(child, paneId, cwd)
      ),
    };
  }
  return tree;
}

export function updatePanePreviewUrlInTree(
  tree: SplitNode,
  paneId: string,
  previewUrl: string,
): SplitNode {
  if (tree.type === "preview") {
    return tree.id === paneId ? { ...tree, previewUrl } : tree;
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        updatePanePreviewUrlInTree(child, paneId, previewUrl)
      ),
    };
  }
  return tree;
}

/** Split a terminal leaf into a split node with the original + a new pane */
export function splitNodeInTree(
  tree: SplitNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  newPaneId: string,
  cwd?: string,
  newPaneType: "terminal" | "preview" = "terminal",
  previewUrl?: string,
  linkedTerminalPaneId?: string,
): SplitNode {
  if (tree.id === targetId && tree.type !== "split") {
    return {
      id: crypto.randomUUID(),
      type: "split",
      direction,
      children: [
        { ...tree },
        newPaneType === "preview"
          ? { id: newPaneId, type: "preview", previewUrl, linkedTerminalPaneId }
          : { id: newPaneId, type: "terminal", cwd },
      ],
      sizes: [50, 50],
    };
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        splitNodeInTree(child, targetId, direction, newPaneId, cwd, newPaneType, previewUrl, linkedTerminalPaneId)
      ),
    };
  }
  return tree;
}

/** Remove a terminal leaf from the tree; collapses single-child splits */
export function removeNodeFromTree(
  tree: SplitNode,
  targetId: string,
): SplitNode | null {
  if (tree.id === targetId) return null;
  if (!tree.children) return tree;

  const newChildren = tree.children
    .map((child) => removeNodeFromTree(child, targetId))
    .filter((c): c is SplitNode => c !== null);

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]; // collapse

  return { ...tree, children: newChildren };
}

/** Update sizes for a specific split node in the tree */
export function updateSizesInTree(
  tree: SplitNode,
  splitNodeId: string,
  sizes: number[],
): SplitNode {
  if (tree.id === splitNodeId) {
    return { ...tree, sizes };
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        updateSizesInTree(child, splitNodeId, sizes)
      ),
    };
  }
  return tree;
}

// ── Layout calculation ───────────────────────────────────────────────────────

/** Calculate pixel bounds for every leaf in the tree */
export function calculatePaneBounds(
  node: SplitNode,
  containerRect: Rect,
): Map<string, Rect> {
  const result = new Map<string, Rect>();

  if (node.type !== "split") {
    result.set(node.id, containerRect);
    return result;
  }

  const children = node.children ?? [];
  if (children.length === 0) return result;

  const sizes = node.sizes ?? children.map(() => 100 / children.length);
  const isH = node.direction === "horizontal";
  const totalGap = SPLIT_GAP * (children.length - 1);
  const totalAvailable = (isH ? containerRect.width : containerRect.height) - totalGap;

  let offset = 0;

  for (let i = 0; i < children.length; i++) {
    const childSize = (sizes[i] / 100) * totalAvailable;
    const childRect: Rect = isH
      ? {
          left: containerRect.left + offset,
          top: containerRect.top,
          width: childSize,
          height: containerRect.height,
        }
      : {
          left: containerRect.left,
          top: containerRect.top + offset,
          width: containerRect.width,
          height: childSize,
        };

    const childBounds = calculatePaneBounds(children[i], childRect);
    for (const [id, bounds] of childBounds) {
      result.set(id, bounds);
    }

    offset += childSize + SPLIT_GAP;
  }

  return result;
}

/** Calculate resize handle positions */
export function calculateHandles(
  node: SplitNode,
  containerRect: Rect,
): HandleInfo[] {
  if (node.type === "terminal") return [];

  const children = node.children ?? [];
  if (children.length < 2) return [];

  const sizes = node.sizes ?? children.map(() => 100 / children.length);
  const isH = node.direction === "horizontal";
  const totalGap = SPLIT_GAP * (children.length - 1);
  const totalAvailable = (isH ? containerRect.width : containerRect.height) - totalGap;

  const handles: HandleInfo[] = [];
  let offset = 0;

  for (let i = 0; i < children.length; i++) {
    const childSize = (sizes[i] / 100) * totalAvailable;

    // Recurse into child
    const childRect: Rect = isH
      ? {
          left: containerRect.left + offset,
          top: containerRect.top,
          width: childSize,
          height: containerRect.height,
        }
      : {
          left: containerRect.left,
          top: containerRect.top + offset,
          width: containerRect.width,
          height: childSize,
        };

    handles.push(...calculateHandles(children[i], childRect));

    // Handle between this child and next
    if (i < children.length - 1) {
      const handleRect: Rect = isH
        ? {
            left: containerRect.left + offset + childSize,
            top: containerRect.top,
            width: SPLIT_GAP,
            height: containerRect.height,
          }
        : {
            left: containerRect.left,
            top: containerRect.top + offset + childSize,
            width: containerRect.width,
            height: SPLIT_GAP,
          };

      handles.push({
        splitNodeId: node.id,
        handleIndex: i,
        direction: node.direction!,
        rect: handleRect,
        splitNodeSizes: [...sizes],
        availableSize: totalAvailable,
      });
    }

    offset += childSize + SPLIT_GAP;
  }

  return handles;
}

// ── Pane navigation ──────────────────────────────────────────────────────────

/** Find the adjacent pane in a given direction */
export function findAdjacentPane(
  bounds: Map<string, Rect>,
  currentId: string,
  direction: "up" | "down" | "left" | "right",
): string | null {
  const current = bounds.get(currentId);
  if (!current) return null;

  // Center of current pane
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const [id, rect] of bounds) {
    if (id === currentId) continue;

    const ox = rect.left + rect.width / 2;
    const oy = rect.top + rect.height / 2;

    // Check direction
    const dx = ox - cx;
    const dy = oy - cy;

    let valid = false;
    switch (direction) {
      case "left":
        valid = dx < -1;
        break;
      case "right":
        valid = dx > 1;
        break;
      case "up":
        valid = dy < -1;
        break;
      case "down":
        valid = dy > 1;
        break;
    }
    if (!valid) continue;

    // Distance (prefer panes on the same axis)
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }

  return bestId;
}

// ── Resize drag helpers ──────────────────────────────────────────────────────

/** Clamp and normalize sizes after a drag */
export function resizeSizes(
  currentSizes: number[],
  handleIndex: number,
  deltaPercent: number,
): number[] {
  const sizes = [...currentSizes];

  sizes[handleIndex] = Math.max(MIN_PANE_PERCENT, sizes[handleIndex] + deltaPercent);
  sizes[handleIndex + 1] = Math.max(MIN_PANE_PERCENT, sizes[handleIndex + 1] - deltaPercent);

  // Normalize to 100
  const sum = sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < sizes.length; i++) {
    sizes[i] = (sizes[i] / sum) * 100;
  }

  return sizes;
}
