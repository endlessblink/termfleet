import { expect, test } from "@playwright/test";
import type { Tab } from "../src/lib/types";
import { mirroredWorkstream } from "../src/lib/statusPollProjection";

test("map workstreams receive the recovered Task line used by their terminal", () => {
  const tab = {
    id: "bina-tab",
    workstream: {
      kind: "agent",
      status: "working",
      createdAt: 1,
      task: "Running Playwright tests",
    },
  } as unknown as Tab;
  const taskLine = {
    text: "Keep the course landing page reliable",
    source: "opening-request",
    capturedAt: 2,
    expiresAt: null,
  } as const;

  const mirrored = mirroredWorkstream(tab, taskLine);

  expect(mirrored?.taskLine).toEqual(taskLine);
  expect(mirrored?.status).toBe("working");
});

test("plain terminal tabs are not given a synthetic workstream", () => {
  const tab = { id: "shell-tab" } as unknown as Tab;
  expect(
    mirroredWorkstream(tab, {
      text: "Running Playwright tests",
      source: "running-command",
      capturedAt: 2,
      expiresAt: null,
    }),
  ).toBeUndefined();
});
