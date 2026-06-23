import { expect, test } from "@playwright/test";
import {
  MIN_HEADER_HOLD_MS,
  nextStableHeader,
  resetStableHeader,
  stableHeader,
  type StableHeaderEntry,
} from "../src/lib/stableHeader";

test("first value commits immediately", () => {
  const out = nextStableHeader(null, { title: "A", now: "a" }, 1_000);
  expect(out).toEqual({ title: "A", now: "a", committedAt: 1_000 });
});

test("holds a change that arrives before the 5s floor", () => {
  const prev: StableHeaderEntry = { title: "A", now: "a", committedAt: 1_000 };
  // 1s later - within the hold window
  const out = nextStableHeader(prev, { title: "B", now: "b" }, 2_000);
  expect(out).toBe(prev); // unchanged, still showing A/a
});

test("commits a change once the 5s floor has passed", () => {
  const prev: StableHeaderEntry = { title: "A", now: "a", committedAt: 1_000 };
  const out = nextStableHeader(prev, { title: "B", now: "b" }, 1_000 + MIN_HEADER_HOLD_MS);
  expect(out).toEqual({ title: "B", now: "b", committedAt: 1_000 + MIN_HEADER_HOLD_MS });
});

test("an unchanged value never resets the hold clock", () => {
  const prev: StableHeaderEntry = { title: "A", now: "a", committedAt: 1_000 };
  const out = nextStableHeader(prev, { title: "A", now: "a" }, 3_000);
  expect(out).toBe(prev);
  expect(out.committedAt).toBe(1_000);
});

test("bypass surfaces a change immediately (failed/exited pane)", () => {
  const prev: StableHeaderEntry = { title: "Working", now: "running", committedAt: 1_000 };
  const out = nextStableHeader(prev, { title: "Needs attention", now: "Stopped with exit 1" }, 1_500, MIN_HEADER_HOLD_MS, true);
  expect(out.title).toBe("Needs attention");
  expect(out.committedAt).toBe(1_500);
});

test("real data replaces a placeholder immediately (no hold on initial population)", () => {
  // prev shows an idle/placeholder line — the agent's real summary must appear at once,
  // even though only 1ms has passed. (Otherwise the header is stuck on "Awaiting…" for 5s.)
  const prev: StableHeaderEntry = { title: "Working", now: "Awaiting terminal output", committedAt: 1_000 };
  const out = nextStableHeader(prev, { title: "LLM task extraction lane", now: "running grep" }, 1_001);
  expect(out.title).toBe("LLM task extraction lane");
  expect(out.now).toBe("running grep");
});

test("a change between two real values is held", () => {
  const prev: StableHeaderEntry = { title: "Fixing the panel", now: "running rtk grep", committedAt: 1_000 };
  const out = nextStableHeader(prev, { title: "Fixing the panel", now: "running cat" }, 2_000);
  expect(out).toBe(prev); // both substantive → hold the activity line for the full window
});

test("title+now move as a unit (no mismatched pair mid-window)", () => {
  const prev: StableHeaderEntry = { title: "A", now: "a", committedAt: 1_000 };
  // only `now` changed, but still within the window, so the whole pair holds
  const out = nextStableHeader(prev, { title: "A", now: "a2" }, 2_000);
  expect(out).toBe(prev);
});

test("stateful stableHeader holds then flushes by key", () => {
  resetStableHeader();
  const key = "tab:pane";
  expect(stableHeader(key, { title: "A", now: "a" }, { nowMs: 1_000 })).toEqual({ title: "A", now: "a" });
  // rapid change within window: held
  expect(stableHeader(key, { title: "B", now: "b" }, { nowMs: 2_000 })).toEqual({ title: "A", now: "a" });
  // after the floor: flushes
  expect(stableHeader(key, { title: "B", now: "b" }, { nowMs: 1_000 + MIN_HEADER_HOLD_MS })).toEqual({ title: "B", now: "b" });
  resetStableHeader();
});
