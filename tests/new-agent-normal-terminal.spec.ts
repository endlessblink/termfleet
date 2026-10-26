import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The desktop "New agent" wizard must open an ordinary terminal card (like every other
// card) with the agent already started on the task, never the agent-run workstream view
// (owner report 2026-10-10: "it needs to load a normal terminal like all the others and start the chat").
const dialog = readFileSync("src/components/NewAgentTerminalDialog.tsx", "utf8");

test("interactive New agent opens a normal terminal running the agent on the task", () => {
  const terminalBranch = dialog.slice(dialog.indexOf("if(profile==='terminal'){"), dialog.indexOf("const id=createAgentWorkstream("));
  expect(terminalBranch.length).toBeGreaterThan(0);
  expect(terminalBranch).toContain("createDefaultTab(");
  expect(terminalBranch).toContain("childStartupCommand(provider,mission.trim())");
  expect(terminalBranch).toContain("return;");
  // The agent session starts in the daemon BEFORE the card is added, so the card attaches
  // to the agent instead of mounting a plain shell first.
  expect(terminalBranch.indexOf("daemon_ensure_session")).toBeGreaterThan(-1);
  expect(terminalBranch.indexOf("daemon_ensure_session")).toBeLessThan(terminalBranch.indexOf("addTab(tab"));
  expect(terminalBranch).not.toContain("createAgentWorkstream(");
});

// Owner report 2026-10-10: "cant find projects that I know I have" — the picker listed only
// projects already on the map. It now also lists project folders found on disk.
test("New agent project list includes project folders that are not on the map", () => {
  expect(dialog).toContain("invoke<string[]>('fs_find_project_folders'");
  expect(dialog).toContain("folders.filter(folder=>!onMap.has(folder))");
  expect(dialog).toContain("const visibleProjects=choices.filter(");
  const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
  expect(lib).toContain("commands::fs_find_project_folders");
});
