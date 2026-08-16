import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { isExplicitTerminalExitCommand } from "../src/lib/terminalCloseIntent";

test("slash exit is an explicit close command", () => {
  expect(isExplicitTerminalExitCommand("/exit")).toBe(true);
  expect(isExplicitTerminalExitCommand("  /exit  ")).toBe(true);
  expect(isExplicitTerminalExitCommand("/exit now")).toBe(false);
});

test("the terminal X and sidebar X are wired to the same close authority", () => {
  const root = process.cwd();
  const sidebar = fs.readFileSync(path.join(root, "src/components/WorkbenchSidebar.tsx"), "utf8");
  const splitPane = fs.readFileSync(path.join(root, "src/components/SplitPane.tsx"), "utf8");
  expect(sidebar).toContain('title="Close terminal session"');
  expect(sidebar).toContain('event.target.closest("button, a, input, [role=button]")');
  expect(sidebar).toContain("closeTerminalSession(tab.id, \"sidebar-x\")");
  const workspace = fs.readFileSync(path.join(root, "src/stores/workspace.ts"), "utf8");
  expect(workspace).toContain("liveCwds");
  expect(workspace).toContain("getPtyCwd(tab.terminals[0].id, invoke)");
  expect(splitPane).toContain('title="Close Pane (Ctrl+Shift+W)"');
  expect(splitPane).toContain("closeActivePane();");
});

test("the installed launcher resolves restore helpers beside its real target", () => {
  const launcher = fs.readFileSync(path.join(process.cwd(), "scripts/termfleet-desktop-launcher.sh"), "utf8");
  expect(launcher).toContain('launcher_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"');
  expect(launcher).toContain('local filter_helper="$launcher_dir/filter-termfleet-restore.py"');
});
