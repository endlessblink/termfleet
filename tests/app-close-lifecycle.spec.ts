import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("native close exits the process after the persistence barrier", async () => {
  const workspace = await readFile("src/stores/workspace.ts", "utf8");
  const rustEntry = await readFile("src-tauri/src/lib.rs", "utf8");
  const rustCommand = await readFile("src-tauri/src/commands.rs", "utf8");

  expect(workspace).toContain('await invoke("exit_application")');
  expect(workspace).not.toContain("await appWindow.destroy()");
  expect(rustEntry).toContain("commands::exit_application");
  expect(rustCommand).toContain("pub fn exit_application(app: tauri::AppHandle)");
  expect(rustCommand).toContain("app.exit(0)");
  expect(workspace).toContain("[termfleet.lifecycle] persistence barrier");
  expect(rustCommand).toContain("termfleet.lifecycle exit_application requested");
  expect(rustEntry).toContain("termfleet.lifecycle exit_requested");
  expect(rustEntry).toContain("termfleet.lifecycle exit");
  expect(rustEntry).toContain("termfleet.lifecycle destroyed");
  expect(rustEntry).not.toContain("app_handle.exit(0)");
});
