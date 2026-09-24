import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { snapshotGoal } from "../src/components/CockpitSnapshotProbe";

test("a sidebar rename survives the row being rebuilt mid-edit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.prompt = () => {
      throw new Error("Terminal rename must not use window.prompt");
    };
  });
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Map", exact: true }).click();

  await page.evaluate(() => {
    const store = (
      window as typeof window & {
        __termfleetWorkspaceStore?: {
          getState: () => { workspaceUiState: Record<string, unknown> };
          setState: (state: Record<string, unknown>) => void;
        };
      }
    ).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");

    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarPanel: "map",
      },
      tabs: [
        {
          id: "tab-rename",
          title: "Old terminal name",
          emoji: "[]",
          color: "#7aa2f7",
          groupId: null,
          initialCwd: "/tmp/termfleet-rename",
          terminals: [
            {
              id: "pty-rename",
              paneId: "pane-rename",
              cols: 80,
              rows: 24,
              status: "running",
            },
          ],
          splitLayout: { id: "pane-rename", type: "terminal" },
          activePaneId: "pane-rename",
        },
      ],
      activeTabId: "tab-rename",
      canvasState: {
        nodes: [
          {
            id: "node-rename",
            type: "terminal",
            title: "Old terminal name",
            terminalTabId: "tab-rename",
            x: 100,
            y: 100,
            width: 820,
            height: 460,
          },
        ],
        selectedNodeId: "node-rename",
        selectedNodeIds: ["node-rename"],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  await page.getByTestId("canvas-sidebar-node-row").dblclick();
  await page.getByTestId("canvas-sidebar-rename-input").fill("Half-typed na");

  // Model the startup project reconcile moving this terminal into another project
  // group while the name is being typed: the row is rebuilt under a new heading.
  await page.evaluate(() => {
    const store = (
      window as typeof window & {
        __termfleetWorkspaceStore?: {
          getState: () => { groups: unknown[]; tabs: Array<{ id: string }> };
          setState: (state: Record<string, unknown>) => void;
        };
      }
    ).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const group = { id: "group-moved", name: "moved-project", color: "#9ece6a", projectRoot: "/tmp/moved-project" };
    store.setState({
      groups: [...state.groups, group],
      terminalGroups: [...state.groups, group],
      tabs: state.tabs.map((tab) => (tab.id === "tab-rename" ? { ...tab, groupId: "group-moved" } : tab)),
    });
  });

  const input = page.getByTestId("canvas-sidebar-rename-input");
  await expect(input).toHaveValue("Half-typed na");
  await input.pressSequentially("me");
  await input.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __termfleetWorkspaceStore?: { getState: () => { tabs: Array<{ id: string; title: string }> } };
          }
        ).__termfleetWorkspaceStore
          ?.getState()
          .tabs.find((tab) => tab.id === "tab-rename")?.title,
      ),
    )
    .toBe("Half-typed name");
});
