import { expect, test } from "@playwright/test";
import { headerProjectLabel } from "../src/lib/projectDisplay";

const groups = [{ id: "g1", name: "termfleet" }];

test("fresh launch with no project filter shows the live cwd folder, not a default", () => {
  const label = headerProjectLabel({
    groupFilter: null,
    groups,
    cwd: "/media/endlessblink/data/my-projects/ai-development/bots+automation/bina-meatezvet-bot",
    projectRoot: null,
  });
  expect(label).toBe("bina-meatezvet-bot");
});

test("falls back to the project root when no live cwd yet", () => {
  const label = headerProjectLabel({
    groupFilter: null,
    groups,
    cwd: null,
    projectRoot: "/home/me/work/my-app/",
  });
  expect(label).toBe("my-app");
});

test("a selected project filter keeps that project's identity", () => {
  const label = headerProjectLabel({
    groupFilter: "g1",
    groups,
    cwd: "/somewhere/else/scratch",
    projectRoot: "/home/me/code/termfleet",
  });
  expect(label).toBe("termfleet");
});

test("only falls back to a default when there is genuinely no folder context", () => {
  const label = headerProjectLabel({
    groupFilter: null,
    groups,
    cwd: null,
    projectRoot: null,
  });
  expect(label).toBe("All sessions");
});
