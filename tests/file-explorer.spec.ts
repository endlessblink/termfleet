import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/components/FileExplorer.tsx"), "utf8");
const backendSource = readFileSync(resolve(process.cwd(), "src-tauri/src/commands.rs"), "utf8");

test("file explorer previews text files inside the cockpit", () => {
  expect(source).toContain('invoke<string>("fs_read_file"');
  expect(source).toContain('label="Preview file"');
  expect(source).toContain("Preview truncated at 200,000 characters");
});

test("file explorer keeps an explicit external-open action", () => {
  expect(source).toContain('label="Open externally"');
  expect(source).toContain('invoke("fs_open_external"');
  expect(backendSource).toContain('(\"kate\", &[])');
  expect(backendSource.indexOf('(\"kate\", &[])')).toBeLessThan(backendSource.indexOf('(\"xdg-open\", &[])'));
});
