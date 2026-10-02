import { expect, test, type Page } from "@playwright/test";
import { parseMasterPlanTasks } from "../src/lib/masterPlanTasks";
import { projectShortcuts, recordProjectVisit } from "../src/lib/projectBoardHistory";

const plan = `
| ID | Title | Priority | Status | Dependencies |
|----|-------|----------|--------|--------------|
| **TASK-081** | **Prove food flow** | **P0** | IN PROGRESS | TASK-052 |
| ~~**FEATURE-001**~~ | ~~**Streaming responses**~~ | **P1** | DONE | - |
| **TASK-018** | **Session export** | **P2** | PENDING | - |

## Completed work

| ID | Title | Completed |
|----|-------|-----------|
| ~~FEATURE-001~~ | Streaming responses | 2026-02-18 |
`;

test("formatted project plan IDs remain readable tasks", () => {
  expect(parseMasterPlanTasks(plan)).toEqual([
    { id: "TASK-081", title: "Prove food flow", status: "in-progress", rawStatus: "IN PROGRESS" },
    { id: "FEATURE-001", title: "Streaming responses", status: "done", rawStatus: "DONE" },
    { id: "TASK-018", title: "Session export", status: "todo", rawStatus: "PENDING" },
  ]);
});

test("short rows and changing table columns do not discard the whole plan", () => {
  expect(parseMasterPlanTasks(`
| ID | Title | Priority | Status |
| TASK-001 | Missing status | P2 |

| ID | Title | Status |
| TASK-002 | Next table | TODO |
`)).toEqual([
    { id: "TASK-001", title: "Missing status", status: "unknown", rawStatus: "Unknown" },
    { id: "TASK-002", title: "Next table", status: "todo", rawStatus: "TODO" },
  ]);
});

async function mountBoard(page: Page, contents = plan) {
  await page.route("http://127.0.0.1:5177/board-test", (route) => route.fulfill({
    contentType: "text/html", body: '<!doctype html><html><body><div id="board"></div></body></html>',
  }));
  await page.goto("http://127.0.0.1:5177/board-test");
  await page.evaluate(async (contents) => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$ = () => {};
    (window as any).$RefreshSig$ = () => (type: unknown) => type;
    (window as any).__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/global.css");
    const roots = ["/work/claude-and-conquer", "/work/other"];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: { path?: string }) => {
        if (command === "fs_find_master_plan_roots") return roots;
        if (command === "fs_read_file") return args.path?.includes("claude-and-conquer")
          ? contents : "| TASK-999 | Other task | TODO |";
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { ProjectPlansBoard } = await import("/src/components/ProjectPlansBoard.tsx");
    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState({ projectRoot: roots[0], groups: [], tabs: [] });
    createRoot(document.getElementById("board")!).render(React.createElement(ProjectPlansBoard));
  }, contents);
  const board = page.getByTestId("project-plans-board");
  return board;
}

test("selected project shows cards and its own totals while filters keep working", async ({ page }) => {
  const board = await mountBoard(page);
  await expect(board.getByRole("heading", { name: "claude-and-conquer", exact: true })).toBeVisible();
  await expect(board.getByLabel("Project totals").getByText("3", { exact: true })).toBeVisible();
  await expect(board.getByText("Prove food flow", { exact: true })).toBeVisible();
  await expect(board.getByText("Session export", { exact: true })).toBeVisible();
  await expect(board.getByText("Other task", { exact: true })).toHaveCount(0);
  await expect(board.getByText("Streaming responses", { exact: true })).toHaveCount(0);
  await board.getByLabel("Show Done").check();
  await expect(board.getByText("Streaming responses", { exact: true })).toBeVisible();
  await board.getByLabel("Search project plan tasks").fill("food");
  await expect(board.getByText("Session export", { exact: true })).toHaveCount(0);
  await expect(board.getByLabel("Project totals").getByText("3", { exact: true })).toBeVisible();
  await board.getByLabel("Choose project", { exact: true }).click();
  const picker = board.getByRole("dialog", { name: "Project picker" });
  await picker.getByLabel("Search projects").fill("other");
  await picker.getByRole("button", { name: "Open other", exact: true }).click();
  await expect(board.getByText("Other task", { exact: true })).toBeVisible();
  await expect(board.getByLabel("Project totals").getByText("1", { exact: true })).toBeVisible();
  await expect(board.getByLabel("Recent projects").getByRole("button").first()).toHaveAccessibleName("Open other");
  await expect(board.getByText("All projects", { exact: true })).toHaveCount(0);
});

for (const width of [1800, 600]) {
  test(`long project board scrolls down and back up inside a ${width}px workspace`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const longPlan = "| ID | Title | Status |\n|---|---|---|\n" + Array.from({ length: 80 }, (_, index) =>
      `| TASK-${String(index + 1).padStart(3, "0")} | Scroll task ${String(index + 1).padStart(3, "0")} | TODO |`).join("\n");
    const board = await mountBoard(page, longPlan);
    await page.evaluate(() => {
      Object.assign(document.body.style, { margin: "0", height: "100vh", overflow: "hidden" });
      Object.assign(document.getElementById("board")!.style, { height: "100%", minHeight: "0", overflow: "hidden" });
    });
    await expect(board.getByText("Scroll task 080", { exact: true })).toHaveCount(1);
    const main = board.locator(".project-board-main");
    const mainRect = await main.boundingBox();
    expect(mainRect).not.toBeNull();
    expect(mainRect!.y + mainRect!.height).toBeLessThanOrEqual(801);
    expect(await main.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await main.hover({ position: { x: 30, y: 30 } });
    await page.mouse.wheel(0, 20000);
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(board.getByText("Scroll task 080", { exact: true })).toBeInViewport();
    await page.mouse.wheel(0, -20000);
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(board.getByRole("heading", { name: "claude-and-conquer", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("project shortcuts rank real usage, cap both lists at five and ignore unavailable roots", () => {
  let history = { selected: "", projects: [] };
  for (let index = 0; index < 8; index++) history = recordProjectVisit(history, `/work/project-${index}`, index + 1);
  history = recordProjectVisit(history, "/work/project-1", 10);
  history = recordProjectVisit(history, "/work/project-1", 11);
  history = recordProjectVisit(history, "/gone", 12);
  const shortcuts = projectShortcuts(history, Array.from({ length: 8 }, (_, index) => `/work/project-${index}`));
  expect(shortcuts.frequent.map((item) => item.root)).toEqual(["/work/project-1", "/work/project-7", "/work/project-6", "/work/project-5", "/work/project-4"]);
  expect(shortcuts.recent.map((item) => item.root)).toEqual(["/work/project-1", "/work/project-7", "/work/project-6", "/work/project-5", "/work/project-4"]);
});

test("project visits persist across reopening and polling does not inflate usage", async ({ page }) => {
  let board = await mountBoard(page);
  await expect(board.getByLabel("Recent projects").getByRole("button").first()).toHaveAccessibleName("Open claude-and-conquer");
  await board.getByLabel("Choose project", { exact: true }).click();
  await board.getByRole("dialog").getByRole("button", { name: "Open other", exact: true }).click();
  await expect(board.getByRole("heading", { name: "other", exact: true })).toBeVisible();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("termfleet.projectBoard.history.v1")!));
  await expect.poll(async () => (await stored()).selected).toBe("/work/other");
  const visits = (await stored()).projects.find((item: any) => item.root === "/work/other").visits;
  await page.waitForTimeout(5200);
  expect((await stored()).projects.find((item: any) => item.root === "/work/other").visits).toBe(visits);
  board = await mountBoard(page);
  await expect(board.getByRole("heading", { name: "other", exact: true })).toBeVisible();
  await expect.poll(async () => (await stored()).projects.find((item: any) => item.root === "/work/other").visits).toBe(visits + 1);
});

test("project board stays inside a narrow workspace with no overlapping cards", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 760, height: 900 });
  const board = await mountBoard(page);
  await expect(board.getByText("Prove food flow", { exact: true })).toBeVisible();
  expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const cards = await board.locator(".watchpost-task-card").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("project-board-narrow.png") });
  await page.screenshot({ path: "/tmp/tf072-board-narrow.png" });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.screenshot({ path: "/tmp/tf072-board-desktop.png" });
  await board.getByLabel("Choose project", { exact: true }).click();
  await page.screenshot({ path: "/tmp/tf072-board-picker.png" });
});
