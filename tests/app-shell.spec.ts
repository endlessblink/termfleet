import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("TermFleet app shell and package metadata are not contaminated by FlowState assets", async () => {
  const [indexHtml, packageJson] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("package.json", "utf8"),
  ]);

  expect(indexHtml).toContain('<title>Terminal Workspace</title>');
  expect(indexHtml).toContain('<div id="root"></div>');
  expect(indexHtml).toContain('src="/src/main.tsx"');
  expect(indexHtml).not.toContain("FlowState");
  expect(indexHtml).not.toContain("fs-loader");
  expect(indexHtml).not.toContain("logo-glitch-tomato");
  expect(indexHtml).not.toContain("index-nWG0vcwN.js");

  const pkg = JSON.parse(packageJson) as { name?: string; main?: string };
  expect(pkg.name).toBe("terminal-workspace-tauri");
  expect(pkg.main).toBeUndefined();
  expect(packageJson).not.toContain('"flow-state"');
  expect(packageJson).not.toContain("dist-electron/main.cjs");
});
