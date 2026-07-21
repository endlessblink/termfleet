import { expect, test } from "@playwright/test";
import { shouldWriteStatusCandidate } from "../scripts/lib/agent-status-lifecycle.mjs";

test("an older hook cannot overwrite a newer lifecycle event", () => {
  expect(shouldWriteStatusCandidate(
    { turn: "waiting", turnEventAt: 100 },
    { turn: "idle", turnEventAt: 200 },
  )).toBe(false);
});

test("a newer lifecycle event replaces the current state", () => {
  expect(shouldWriteStatusCandidate(
    { turn: "working", turnEventAt: 201 },
    { turn: "waiting", turnEventAt: 200 },
  )).toBe(true);
});

test("legacy sidecars without event timestamps remain replaceable", () => {
  expect(shouldWriteStatusCandidate(
    { turn: "idle", turnEventAt: 200 },
    { turn: "working", updatedAt: 199 },
  )).toBe(true);
});
