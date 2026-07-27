import { expect, test } from "@playwright/test";
import { compactHeaderGoal } from "../src/lib/terminalHeaderDisplay";

// Live-pane regression (audit 2026-07-27, pane 1fb04acb): an operator request that
// began "In /media/.../bina-meatzevet-courses, find every place ..." had its path
// stripped — correctly, a cockpit label never shows a path — and the header then
// rendered the half-sentence "In , find every place ...". Stripping must take the
// clause that pointed at the path with it.

test("stripping an absolute path does not leave a stranded locator", () => {
  const goal = compactHeaderGoal(
    "In /media/someone/projects/courses-site, find every place the site stores biography content",
  );

  expect(goal).toBe("Find every place the site stores biography content");
  expect(goal).not.toMatch(/\s[,.](?:\s|$)/); // the audit's mangled-by-stripping rule
  expect(goal).not.toMatch(/^In\b/);
});

test("a space stranded in front of punctuation is closed up", () => {
  const goal = compactHeaderGoal(
    "Rename the checkout button in /home/someone/work/app/src , then update the tests",
  );

  expect(goal).not.toMatch(/\s[,.](?:\s|$)/);
  expect(goal).toContain("then update the tests");
});

test("a goal with no path is left alone", () => {
  expect(compactHeaderGoal("Fix the checkout page on small screens")).toBe(
    "Fix the checkout page on small screens",
  );
});
