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
const splitPane = readFileSync(
  new URL("../src/components/SplitPane.tsx", import.meta.url),
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

test("fleet list tasks reserve two readable lines without changing height", () => {
  // The compact one-line version cut ordinary task names after three or four words.
  // Two fixed lines keep the list stable while making each card useful at a glance.
  expect(sidebar).not.toContain("sidebar-map-node-now-row");
  const style = sidebar.match(/sidebarHeaderTask:\s*\{[\s\S]*?\n {2}\},/)?.[0];
  expect(style, "sidebarHeaderTask style block").toBeTruthy();
  expect(style).toMatch(/WebkitLineClamp:\s*2/);
  expect(style).toMatch(/height:\s*"2\.8em"/);
  expect(style).not.toMatch(/whiteSpace:\s*"nowrap"/);
  expect(sidebar).toContain("truncateAtWordBoundary(header.goalLabel, 52)");
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

test("a missing goal still renders an explicit Task row instead of hiding it", () => {
  expect(magicCanvas).toContain('terminalHeader.sources.goal === "missing"');
  expect(magicCanvas).toContain("Waiting for a clear goal");
  expect(magicCanvas).toContain("const terminalHeaderHasTask = true;");
});

test("map cards keep the broad Goal separate from the specific Task and Now rows", () => {
  expect(magicCanvas).toContain("terminalHeaderContextDescription");
  expect(magicCanvas).toContain('data-testid="canvas-terminal-node-goal"');
  expect(magicCanvas).toContain("Goal:");
  expect(magicCanvas).toContain("terminalHeaderHasContext");
});

test("split terminal headers show a compact stable Goal line when context exists", () => {
  expect(splitPane).toContain("contextLabel");
  expect(splitPane).toContain('data-testid="split-terminal-summary-goal"');
  expect(splitPane).toContain('data-testid="split-agent-pane-goal"');
  expect(splitPane).toContain(">\n                            Goal\n");
  expect(splitPane).toContain('headerContext !== "Context not captured"');
  expect(splitPane).toContain("contextSource");
});

test("agent split headers keep the live work, broad goal, and current moment legible together", () => {
  const agentHeader = splitPane.slice(
    splitPane.indexOf("{isAgentPane && agentStatusSummary ?"),
    splitPane.indexOf(") : shellStatusSummary ?", splitPane.indexOf("{isAgentPane && agentStatusSummary ?")),
  );

  expect(agentHeader, "the agent header branch must exist").toContain("Task:");
  expect(agentHeader, "the broad goal must have its own labeled row").toContain(
    'data-testid="split-agent-pane-goal"',
  );
  expect(agentHeader, "the current moment must have its own labeled row").toContain(
    'data-testid="split-agent-pane-now"',
  );
  expect(agentHeader, "the agent branch must not hide the moment in an inline strip").toContain(
    "Now",
  );
});

test("regular split headers keep the current moment visible beside the path", () => {
  const shellStart = splitPane.indexOf(") : shellStatusSummary ?");
  const shellHeader = splitPane.slice(shellStart);

  expect(shellHeader).toContain('data-testid="split-terminal-summary-now"');
  expect(shellHeader).not.toContain('display: "none"');
  expect(shellHeader).toContain('gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)"');
});
