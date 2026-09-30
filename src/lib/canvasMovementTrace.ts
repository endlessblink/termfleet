export type CanvasMovementSource = "drag" | "resize" | "workspace-update" | "auto-layout";

export interface CanvasMovementAggregate {
  kind: "canvas-node-movement";
  updateCount: number;
  nodeCount: number;
  nodeIds: string[];
  nodeIdsTruncated: boolean;
  sources: Partial<Record<CanvasMovementSource, number>>;
  maxDeltaPx: number;
}

const MAX_RECORDED_NODE_IDS = 16;

/** Coalesces high-frequency canvas mutations into a content-free summary. */
export function createCanvasMovementBatcher(
  write: (aggregate: CanvasMovementAggregate) => void,
) {
  let movementCount = 0;
  let nodeCount = 0;
  let maxDeltaPx = 0;
  const sources: Partial<Record<CanvasMovementSource, number>> = {};
  const nodeIds = new Set<string>();
  let nodeIdsTruncated = false;

  return {
    record(
      source: CanvasMovementSource,
      deltaX: number,
      deltaY: number,
      movedNodes = 1,
      movedNodeIds: readonly string[] = [],
    ) {
      if (![deltaX, deltaY, movedNodes].every(Number.isFinite) || movedNodes < 1) return;
      movementCount += 1;
      nodeCount += Math.floor(movedNodes);
      for (const id of movedNodeIds) {
        if (!id || nodeIds.has(id)) continue;
        if (nodeIds.size < MAX_RECORDED_NODE_IDS) nodeIds.add(id);
        else nodeIdsTruncated = true;
      }
      sources[source] = (sources[source] ?? 0) + 1;
      maxDeltaPx = Math.max(maxDeltaPx, Math.abs(deltaX), Math.abs(deltaY));
    },
    flush() {
      if (movementCount === 0) return false;
      write({
        kind: "canvas-node-movement",
        updateCount: movementCount,
        nodeCount,
        nodeIds: [...nodeIds],
        nodeIdsTruncated,
        sources: { ...sources },
        maxDeltaPx: Math.round(maxDeltaPx * 10) / 10,
      });
      movementCount = 0;
      nodeCount = 0;
      maxDeltaPx = 0;
      nodeIds.clear();
      nodeIdsTruncated = false;
      for (const source of Object.keys(sources) as CanvasMovementSource[]) delete sources[source];
      return true;
    },
  };
}
