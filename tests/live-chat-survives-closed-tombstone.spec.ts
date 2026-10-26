import { expect, test } from "@playwright/test";
import { withoutLiveProviderTombstones } from "../src/lib/providerTombstones";

// TF-091: the film chat was closed in an old dead card, reopened in a new pane, and
// its live card vanished on the next relaunch because the chat id stayed tombstoned.
test("a chat running in an unclosed pane is no longer tombstoned", () => {
  const remaining = withoutLiveProviderTombstones(
    new Set(["beb2d3de", "still-closed"]),
    new Set(["terminal-old-dead-card"]),
    [{ id: "terminal-new-pane", command: "claude --resume beb2d3de; exec bash -l" }],
  );
  expect([...remaining]).toEqual(["still-closed"]);
});

test("a recorded provider id clears the tombstone too", () => {
  const remaining = withoutLiveProviderTombstones(
    new Set(["abc"]),
    new Set(),
    [{ id: "terminal-x", providerSessionId: "abc" }],
  );
  expect(remaining.size).toBe(0);
});

test("a pane the operator closed keeps its chat closed", () => {
  const remaining = withoutLiveProviderTombstones(
    new Set(["abc"]),
    new Set(["terminal-closed"]),
    [{ id: "terminal-closed", providerSessionId: "abc" }],
  );
  expect([...remaining]).toEqual(["abc"]);
});

test("hydration no longer drops tabs by chat id before the live list is known", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/stores/workspace.ts", "utf8");
  expect(source).toContain("baseTabs = withoutClosedSessionTabs(baseTabs, closedSessionIds);");
  expect(source.match(/withoutLiveProviderTombstones\(/g)?.length).toBe(2);
});
