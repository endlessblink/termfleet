import { expect, test } from "@playwright/test";
import {
  recordTerminalGeometry,
  type TerminalGeometrySample,
} from "../src/lib/terminalGeometryLog";

test("geometry collectors run only once per second per pane", () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const calls: string[] = [];
  const collect = (id: string) => () => {
    calls.push(id);
    return { id } as TerminalGeometrySample;
  };
  try {
    recordTerminalGeometry("lazy-pane-a", collect("lazy-pane-a"));
    expect(calls).toEqual(["lazy-pane-a"]);
    now += 999;
    recordTerminalGeometry("lazy-pane-a", collect("lazy-pane-a"));
    expect(calls).toEqual(["lazy-pane-a"]);
    recordTerminalGeometry("lazy-pane-b", collect("lazy-pane-b"));
    expect(calls).toEqual(["lazy-pane-a", "lazy-pane-b"]);
    now += 1;
    recordTerminalGeometry("lazy-pane-a", collect("lazy-pane-a"));
    expect(calls).toEqual(["lazy-pane-a", "lazy-pane-b", "lazy-pane-a"]);

    // The existing eager API and timer-driven samples share the same pane budget.
    now += 1000;
    recordTerminalGeometry({ id: "lazy-pane-a" } as TerminalGeometrySample);
    recordTerminalGeometry("lazy-pane-a", collect("lazy-pane-a"));
    expect(calls).toHaveLength(3);
    now += 2000;
    recordTerminalGeometry("lazy-pane-a", collect("lazy-pane-a"));
    expect(calls).toHaveLength(4);
  } finally {
    Date.now = originalNow;
  }
});
