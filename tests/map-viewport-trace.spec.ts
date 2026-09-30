import { expect, test } from "@playwright/test";
import { createMapViewportTrace } from "../src/lib/mapViewportTrace";

test("map viewport trace records only real changes and keeps the trigger", () => {
  const records: unknown[] = [];
  const trace = createMapViewportTrace((record) => records.push(JSON.parse(record)), () => 1234);

  expect(trace("manual-pan", { x: 0, y: 0, zoom: 1 }, { x: 12, y: -4, zoom: 1 })).toBe(true);
  expect(trace("manual-pan", { x: 12, y: -4, zoom: 1 }, { x: 12, y: -4, zoom: 1 })).toBe(false);
  expect(records).toEqual([
    {
      t: 1234,
      kind: "map-viewport-change",
      trigger: "manual-pan",
      from: { x: 0, y: 0, zoom: 1 },
      to: { x: 12, y: -4, zoom: 1 },
    },
  ]);
});

test("shared camera callers retain their source and invalid updates are ignored", () => {
  const records: Array<Record<string, unknown>> = [];
  const trace = createMapViewportTrace((record) => records.push(JSON.parse(record)), () => 9);
  const from = { x: 0, y: 0, zoom: 1 };

  expect(trace("sidebar-focus", from, { x: -24, y: 10, zoom: 1 })).toBe(true);
  expect(trace("header-focus", from, { x: -48, y: 20, zoom: 1 })).toBe(true);
  expect(trace("board-open", from, { x: 0, y: 0, zoom: 0.8 })).toBe(true);
  expect(trace("workspace-action", from, { x: Number.NaN, y: 0, zoom: 1 })).toBe(false);
  expect(records.map((record) => record.trigger)).toEqual([
    "sidebar-focus",
    "header-focus",
    "board-open",
  ]);
});
