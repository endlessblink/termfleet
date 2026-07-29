import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Regression cover for the "map card jumps and the terminal text jiggles" report
// (2026-07-26). Root cause: the card header changed height whenever the live
// status text changed - the big activity line was mounted and unmounted, and the
// task line re-wrapped - and every header height change resized the terminal
// underneath, which reflowed the PTY grid. Height must not depend on what the
// status happens to say.
const magicCanvas = readFileSync(
  new URL("../src/components/MagicCanvas.tsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../src/components/WorkbenchSidebar.tsx", import.meta.url),
  "utf8",
);

test("map card headline row keeps a fixed height", () => {
  const style = magicCanvas.match(
    /terminalStatusTitle:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalStatusTitle style block").toBeTruthy();
  expect(style).toMatch(/height:\s*\d+,/);
  expect(style, "a minimum lets the row still grow").not.toMatch(
    /minHeight:\s*\d+,/,
  );
});

test("map card headline row always renders a label and a value", () => {
  // The empty state used to render null, collapsing the row by ~9px.
  const titleStart = magicCanvas.indexOf("styles.terminalStatusTitle}");
  const titleBlock = magicCanvas.slice(titleStart, titleStart + 2600);
  expect(titleBlock.length).toBeGreaterThan(0);
  expect(titleBlock, "empty headline must not unmount the row").not.toMatch(
    /\)\s*:\s*null\}/,
  );
  // The headline now ALWAYS carries the goal, so it has no empty state of its own to
  // reserve — the reserved/hidden row moved below it, to the "Now:" line (pinned by
  // "the card shows the goal on top and the moment under it, always").
  const style = magicCanvas.match(
    /terminalStatusTitle:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style).toMatch(/height:\s*\d+,/);
});

test("map card task line is a FIXED two-line box", () => {
  // Changed deliberately 2026-07-28: the operator asked for two lines so a real goal is
  // readable ("exercise-demo-gif-pipeline" told them nothing a week later). The jiggle
  // came from a row whose height VARIED with the text, not from two lines as such — so
  // wrapping is allowed only while the height stays fixed and the text stays clamped.
  const style = magicCanvas.match(
    /terminalTaskValue:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalTaskValue style block").toBeTruthy();
  expect(style).toMatch(/WebkitLineClamp:\s*2/);
  expect(style, "the box must not grow with the text").toMatch(
    /height:\s*"[\d.]+em"/,
  );
  expect(style, "a minimum lets the row grow again").not.toMatch(
    /minHeight:/,
  );

  const bigRow = magicCanvas.match(
    /terminalNowActiveValue:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(bigRow, "terminalNowActiveValue style block").toBeTruthy();
  expect(bigRow).toMatch(/WebkitLineClamp:\s*2/);
});

test("fleet list rows reserve no blank lines", () => {
  // Reserving an invisible activity row left large dead gaps in the list.
  expect(sidebar).not.toContain("sidebar-map-node-now-row");
  const style = sidebar.match(/sidebarHeaderTask:\s*\{[\s\S]*?\n {2}\},/)?.[0];
  expect(style, "sidebarHeaderTask style block").toBeTruthy();
  expect(style).toMatch(/whiteSpace:\s*"nowrap"/);
  expect(style).toMatch(/height:\s*"1\.4em"/);
  expect(style, "a two-line box is half empty for one-line tasks").not.toMatch(
    /WebkitLineClamp:\s*2/,
  );
});

test("the card shows the goal on top and the moment under it, always", () => {
  // The operator's chosen layout (2026-07-28): "Goal on top, current step under it".
  // Before this the two swapped places depending on whether an activity existed, so the
  // big line was sometimes the goal and sometimes the moment.
  const bigRow = magicCanvas.slice(
    magicCanvas.indexOf("styles.terminalStatusTitle}"),
  );
  expect(bigRow.slice(0, 1200)).toContain(">Task:<");
  expect(
    bigRow.slice(0, 1200),
    "the big row must not switch between Task and Now",
  ).not.toContain("Now Active:");

  const nowRow = magicCanvas.slice(
    magicCanvas.indexOf('data-testid="canvas-terminal-node-task-row"') - 400,
  );
  expect(nowRow.slice(0, 1600)).toContain(">\n                Now:\n              <");
  // Reserved, never unmounted: an empty second row must not change the card's height.
  expect(nowRow.slice(0, 1600)).toMatch(/visibility: terminalHeaderNowRowVisible/);
});
