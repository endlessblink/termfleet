import { expect, test } from "@playwright/test";
import { createCanvasMovementBatcher } from "../src/lib/canvasMovementTrace";

test("canvas position changes coalesce into content-free source counts", () => {
  const writes: unknown[] = [];
  const trace = createCanvasMovementBatcher((record) => writes.push(record));

  trace.record("drag", 3, -4, 1, ["pane-a"]);
  trace.record("drag", 2, 1, 1, ["pane-a"]);
  trace.record("auto-layout", 0, 18, 2, ["pane-b", "pane-c"]);
  trace.record("resize", Number.NaN, 1);
  expect(writes).toHaveLength(0);

  expect(trace.flush()).toBe(true);
  expect(writes).toEqual([{
    kind: "canvas-node-movement",
    updateCount: 3,
    nodeCount: 4,
    nodeIds: ["pane-a", "pane-b", "pane-c"],
    nodeIdsTruncated: false,
    sources: { drag: 2, "auto-layout": 1 },
    maxDeltaPx: 18,
  }]);
  expect(trace.flush()).toBe(false);
});

test("canvas movement node attribution stays bounded", () => {
  let written: { nodeIds: string[]; nodeIdsTruncated: boolean } | undefined;
  const trace = createCanvasMovementBatcher((record) => { written = record; });
  const ids = Array.from({ length: 24 }, (_, index) => `pane-${index}`);

  trace.record("auto-layout", 12, 20, ids.length, ids);
  trace.flush();

  expect(written?.nodeIds).toHaveLength(16);
  expect(written?.nodeIdsTruncated).toBe(true);
});
