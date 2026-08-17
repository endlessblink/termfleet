import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
  new URL("../src/components/TerminalCanvas.tsx", import.meta.url),
  "utf8",
);

test("terminal canvas uses the shared frame scheduler for primary paints", () => {
  expect(SOURCE).toContain('scheduleCanvasRender(sessionId, () => {');
  expect(SOURCE).not.toContain('requestAnimationFrame(() => {\n        if (disposed) return;');
});

test("terminal canvas replaces queued paints for the same pane", () => {
  expect(SOURCE).toContain("scheduleCanvasRender(sessionId, () => {");
  expect(SOURCE).not.toContain("scheduleCanvasRender(() => {");
});
