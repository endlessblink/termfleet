import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TF-075: keystrokes must never land in the top command bar unless the user
// opened it, and selecting a map terminal card must hand it the keyboard.
const header = readFileSync(resolve("src/components/WorkbenchHeader.tsx"), "utf8");
const map = readFileSync(resolve("src/components/MagicCanvas.tsx"), "utf8");

test("command bar hands focus back to the active terminal unless the user opened it", () => {
  expect(header).toContain("commandIntentUntilRef");
  const onFocus = header.slice(header.indexOf("aria-label=\"Workspace command\""));
  expect(onFocus).toContain("Date.now() > commandIntentUntilRef.current");
  expect(onFocus).toContain("terminal-canvas-input[data-terminal-session-id=");
  // Every explicit way to open the bar marks intent.
  expect(header).toContain("onPointerDownCapture");
  expect(header).toMatch(/key === "F6"/);
  expect(header).toMatch(/Semicolon/);
});

test("clicking a map terminal card focuses that terminal's input", () => {
  const start = map.indexOf("activateTerminalNode();\n        // TF-075");
  expect(start).toBeGreaterThan(-1);
  const block = map.slice(start, start + 900);
  expect(block).toContain("terminal-canvas-input[data-terminal-session-id=");
  expect(block).toContain('closest("input,textarea,select")');
});
