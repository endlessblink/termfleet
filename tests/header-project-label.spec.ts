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

test("node label uses the Bina repo when a stale termfleet group owns the pane", () => {
  const label = workspaceLabelFor({
    project: {
      name: "termfleet",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze",
    gitRoot: "/media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze",
  });
  expect(label).toBe("bina-ve-ze");
});

test("node label keeps the project name while the terminal is inside that project", () => {
  const label = workspaceLabelFor({
    project: { name: "termfleet", projectRoot: "/home/me/code/termfleet" },
    cwd: "/home/me/code/termfleet/src-tauri",
  });
  expect(label).toBe("termfleet");
});

test("node label uses the project root folder when the assigned group is a parent category", () => {
  const label = workspaceLabelFor({
    project: {
      name: "productivity",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
  });
  expect(label).toBe("flow-state");
});

test("node label keeps a custom project name that is not a parent folder", () => {
  const label = workspaceLabelFor({
    project: {
      name: "TermFleet OSS",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
  });
  expect(label).toBe("TermFleet OSS");
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

// Real-world TC: the assigned group's projectRoot is the *category* folder
// ".../productivity" (name "productivity"), but the terminal lives in the git
// repo ".../productivity/flow-state" nested below it. The repo's own name is the
// truthful project — the git toplevel decides it.
test("node label prefers the git repo name when the project root is a shallow category", () => {
  const label = workspaceLabelFor({
    project: {
      name: "productivity",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
    gitRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
  });
  expect(label).toBe("flow-state");
});

test("git-repo project name holds even when the shell cd's into a subfolder of the repo", () => {
  const label = workspaceLabelFor({
    project: {
      name: "productivity",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state/src",
    gitRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
  });
  expect(label).toBe("flow-state");
});

test("git root does NOT override a correct project root when they match", () => {
  const label = workspaceLabelFor({
    project: { name: "termfleet", projectRoot: "/home/me/code/termfleet" },
    cwd: "/home/me/code/termfleet/src-tauri",
    gitRoot: "/home/me/code/termfleet",
  });
  expect(label).toBe("termfleet");
});

test("git root does NOT override a user's custom project name", () => {
  const label = workspaceLabelFor({
    project: {
      name: "My Stuff",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/productivity",
    },
    cwd: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
    gitRoot: "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state",
  });
  expect(label).toBe("My Stuff");
});

test("with no assigned project the git repo name wins over the raw cwd leaf", () => {
  const label = workspaceLabelFor({
    project: null,
    cwd: "/home/me/code/flow-state/src/lib",
    gitRoot: "/home/me/code/flow-state",
  });
  expect(label).toBe("flow-state");
});
