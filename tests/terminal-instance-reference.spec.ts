import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  formatTerminalInstanceReference,
  terminalInstanceCode,
} from "../src/lib/terminalInstanceReference";

test.describe("terminal instance references", () => {
  test("keeps the copy action wired into the terminal settings menu", () => {
    const sidebarSource = readFileSync(
      new URL("../src/components/WorkbenchSidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebarSource).toContain('aria-label="Copy instance reference"');
    expect(sidebarSource).toContain("onClick={copyInstanceReference}");
    expect(sidebarSource).toContain("formatTerminalInstanceReference");
  });

  test("captures the rendered workspace surface", async ({ page }) => {
    const artifactPath = process.env.TERMFLEET_DESIGN_ARTIFACT;
    test.skip(!artifactPath, "Design evidence capture is opt-in");
    await page.goto("http://127.0.0.1:5177/");
    await page.screenshot({ path: artifactPath, fullPage: true });
  });

  test("builds a stable pane code", () => {
    expect(terminalInstanceCode("tab-a", "pane-b")).toBe(
      "terminal-tab-a-pane-b",
    );
  });

  test("includes readable context and the exact pane code", () => {
    expect(
      formatTerminalInstanceReference({
        title: "Resolve alignment",
        initialCwd: "/work/termfleet",
        tabId: "tab-a",
        paneId: "pane-b",
      }),
    ).toBe(
      [
        "TermFleet terminal instance",
        "Title: Resolve alignment",
        "Path: /work/termfleet",
        "Instance code: terminal-tab-a-pane-b",
      ].join("\n"),
    );
  });

  test("uses an explicit placeholder when the path is unavailable", () => {
    expect(
      formatTerminalInstanceReference({
        title: "Untitled",
        tabId: "tab-a",
        paneId: "pane-b",
      }),
    ).toContain("Path: (unknown)");
  });
});
