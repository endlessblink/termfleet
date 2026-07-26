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
  expect(titleBlock).toMatch(/visibility:\s*"hidden"/);
});

test("map card task line stays on one line", () => {
  const style = magicCanvas.match(
    /terminalTaskValue:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalTaskValue style block").toBeTruthy();
  expect(style).toMatch(/whiteSpace:\s*"nowrap"/);
  expect(style, "wrapping ties header height to task length").not.toMatch(
    /whiteSpace:\s*"normal"/,
  );
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
