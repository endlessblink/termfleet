import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
  new URL("../src/stores/workspace.ts", import.meta.url),
  "utf8",
);

test("100-terminal soak fixture is explicit and creates the target scale", () => {
  expect(SOURCE).toContain('import.meta.env.VITE_TERMINAL_100_SOAK');
  expect(SOURCE).toContain("Array.from({ length: 100 }");
  expect(SOURCE).toContain('workspaceMode: "canvas"');
});
