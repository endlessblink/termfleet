import { expect, test } from "@playwright/test";
import { findFreeCanvasSpot, type ArrangeableNode } from "../src/lib/canvasArrange";

// FEATURE-64: a child terminal launched by a parent agent lands on the map next to
// its parent without covering any card and without moving any card that is there.
const parent: ArrangeableNode = { id: "parent", x: 0, y: 0, width: 600, height: 400 };
const size = { width: 600, height: 400 };

function overlaps(a: ArrangeableNode, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("an empty map places the child directly to the right of its parent", () => {
  const spot = findFreeCanvasSpot(parent, size, [parent]);
  expect(spot.y).toBe(0);
  expect(spot.x).toBeGreaterThan(parent.x + parent.width);
  expect(spot.x - (parent.x + parent.width)).toBeLessThanOrEqual(64);
});

test("the child never covers any card, whatever its type", () => {
  const nodes: ArrangeableNode[] = [
    parent,
    { id: "note-right", x: 640, y: 0, width: 300, height: 200 },
    { id: "preview-below", x: 0, y: 440, width: 900, height: 500 },
    { id: "board-far", x: 640, y: 240, width: 200, height: 200 },
  ];
  const spot = findFreeCanvasSpot(parent, size, nodes);
  const placed = { ...spot, ...size };
  for (const node of nodes) expect(overlaps(node, placed), node.id).toBe(false);
});

test("placing children one after another stacks them without overlap", () => {
  const nodes: ArrangeableNode[] = [parent];
  for (let index = 0; index < 8; index += 1) {
    const spot = findFreeCanvasSpot(parent, size, nodes);
    const placed = { id: `child-${index}`, ...spot, ...size };
    for (const node of nodes) expect(overlaps(node, placed), `${placed.id} vs ${node.id}`).toBe(false);
    nodes.push(placed);
  }
});

test("existing cards are never moved or mutated", () => {
  const nodes: ArrangeableNode[] = [parent, { id: "other", x: 640, y: 0, width: 600, height: 400 }];
  const before = JSON.stringify(nodes);
  findFreeCanvasSpot(parent, size, nodes);
  expect(JSON.stringify(nodes)).toBe(before);
});

test("the same map always gives the same spot", () => {
  const nodes: ArrangeableNode[] = [parent, { id: "other", x: 640, y: 0, width: 600, height: 400 }];
  expect(findFreeCanvasSpot(parent, size, nodes)).toEqual(findFreeCanvasSpot(parent, size, nodes));
});
