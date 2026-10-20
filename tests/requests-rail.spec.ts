import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asksSidecarFileName, parseAsksSidecar, railRows } from "../src/lib/requestsRail";

// Noam 2026-10-20: "I want updates on the sidebar of those terminals" + newest 3-4 at the bottom + live status.
test("the file name matches the one the bridge writes", () => {
  expect(asksSidecarFileName("abc")).toBe("asks-1a47e90b.json");
});

test("rows read like a chat: oldest first, newest last; in work only while the agent is busy", () => {
  const raw = JSON.stringify({
    working: true,
    asks: [
      { n: 3, text: "third", status: "open" },
      { n: 1, text: "first", status: "done", note: "checked" },
      { n: 2, text: "second", status: "partial" },
      { n: 4, text: "fourth", status: "open" },
    ],
  });
  const parsed = parseAsksSidecar(raw)!;
  const busy = railRows(parsed.asks, parsed.working);
  expect(busy.map((r) => `${r.word}|${r.text}`)).toEqual([
    "\u2713 Done|first",
    "Partly done|second",
    "Waiting|third",
    "In work|fourth",
  ]);
  const idle = railRows(parsed.asks, false);
  expect(idle.filter((r) => r.tone === "working")).toHaveLength(0);
  // a status change shows in the next reading
  const moved = railRows(parsed.asks.map((a) => (a.n === 4 ? { ...a, status: "done" } : a)), true);
  expect(moved.at(-1)?.word).toBe("\u2713 Done");
});

test("bad or empty files give no panel", () => {
  expect(parseAsksSidecar(null)).toBeNull();
  expect(parseAsksSidecar("{")).toBeNull();
  expect(parseAsksSidecar(JSON.stringify({ asks: [] }))).toBeNull();
});

test("the terminal card mounts the panel once, keyed by the daemon session id", () => {
  const src = readFileSync(path.resolve("src/components/Terminal.tsx"), "utf8");
  expect(src.match(/<RequestsRail /g)?.length).toBe(1);
  expect(src).toContain("<RequestsRail sessionId={attachToPtyId ?? runtimeSessionId} />");
});
