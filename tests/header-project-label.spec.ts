import { expect, test } from "@playwright/test";
import { headerProjectLabel, workspaceLabelFor } from "../src/lib/projectDisplay";

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

// TC-044 — the node project chip must follow the terminal's actual folder, not
// keep showing a stale/default group ("termfleet") after the shell cd's away.
test("node label follows the live cwd when the terminal cd'd outside its project", () => {
  const label = workspaceLabelFor({
    project: { name: "termfleet", projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet" },
    cwd: "/media/endlessblink/data/my-projects/ai-development/bots+automation/bina-bot",
  });
  expect(label).toBe("bina-bot");
});

test("node label keeps the project name while the terminal is inside that project", () => {
  const label = workspaceLabelFor({
    project: { name: "termfleet", projectRoot: "/home/me/code/termfleet" },
    cwd: "/home/me/code/termfleet/src-tauri",
  });
  expect(label).toBe("termfleet");
});

test("node label uses the cwd folder when there is no assigned project", () => {
  const label = workspaceLabelFor({
    project: null,
    cwd: "/home/me/code/bina-bot",
  });
  expect(label).toBe("bina-bot");
});

test("node label trusts the project name when there is no root to compare", () => {
  const label = workspaceLabelFor({
    project: { name: "termfleet", projectRoot: null },
    cwd: "/somewhere/else",
  });
  expect(label).toBe("termfleet");
});
