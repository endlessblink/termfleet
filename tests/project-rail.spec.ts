import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 960, height: 760 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function seedProjectRail(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const roots = {
      termfleet: "/work/ai-development/devops/termfleet",
      flow: "/work/ai-development/productivity/flow-state",
      hermes: "/work/ai-development/devops/hermes",
      paper: "/work/ai-development/bots+automation/paper-bot",
      arthouse: "/work/ai-development/content-creation/arthouse",
    };
    const groups = Object.entries(roots).map(([id, projectRoot]) => ({
      id,
      name: id === "flow" ? "flow-state" : id === "paper" ? "paper-bot" : id,
      projectRoot,
      color: "#7aa2f7",
      emoji: "[]",
    }));
    const tab = (id: string, groupId: string) => ({
      id,
      title: id,
      emoji: "[]",
      color: "#7aa2f7",
      groupId,
      initialCwd: roots[groupId as keyof typeof roots],
      terminals: [{
        id: `pty-${id}`,
        paneId: `pane-${id}`,
        cols: 80,
        rows: 24,
        status: "running",
        statusSummary: {
          task: `Writing a deliberately long task description for ${id} without covering another session`,
          path: roots[groupId as keyof typeof roots],
          now: `Checking the compact session summary for ${id}`,
          status: "working",
          updatedAt: Date.now(),
        },
      }],
      splitLayout: { id: `pane-${id}`, type: "terminal" },
      activePaneId: `pane-${id}`,
    });
    store.setState({
      groups,
      terminalGroups: groups,
      tabs: [tab("term-1", "termfleet"), tab("term-2", "termfleet"), tab("flow-1", "flow")],
      activeTabId: "term-1",
      activeGroupFilter: "termfleet",
      activeGroupId: "termfleet",
      projectRoot: roots.termfleet,
      pinnedProjects: [roots.hermes],
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        primarySidebarPanel: "sessions",
        primarySidebarCollapsed: false,
        projectSidebarExpandedSections: [],
      },
    });
  });
}

test("project rail promotes work in use and keeps inactive folders compact", async ({ page }) => {
  await seedProjectRail(page);
  const rail = page.getByTestId("project-rail");

  const projectBrowser = rail.getByRole("button", { name: "Projects", exact: true });
  await expect(projectBrowser).toHaveAttribute("aria-expanded", "false");
  await expect(rail.getByText("In use", { exact: true })).not.toBeVisible();
  await projectBrowser.click();
  await expect(projectBrowser).toHaveAttribute("aria-expanded", "true");
  await expect(rail.getByText("In use", { exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Switch to termfleet" })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("button", { name: "Switch to hermes" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Switch to flow-state" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Switch to paper-bot" })).not.toBeVisible();

  const botsSection = rail.getByRole("button", { name: /Bots & automation/ });
  await expect(botsSection).toHaveAttribute("aria-expanded", "false");
  await botsSection.click();
  await expect(rail.getByRole("button", { name: "Switch to paper-bot" })).toBeVisible();
  await rail.getByRole("button", { name: "Switch to paper-bot" }).hover();
  await rail.getByRole("button", { name: "Pin paper-bot" }).click();
  await expect(rail.getByRole("button", { name: "Switch to paper-bot" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Unpin paper-bot" })).toHaveAttribute("aria-pressed", "true");

  await rail.getByRole("button", { name: "Search projects" }).click();
  await rail.getByRole("textbox", { name: "Search projects" }).fill("content-creation");
  await expect(rail.getByRole("button", { name: "Switch to arthouse" })).toBeVisible();
  await rail.getByRole("button", { name: "Switch to arthouse" }).click();
  await expect.poll(() => page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: { getState: () => { activeGroupFilter: string | null } };
    }).__termfleetWorkspaceStore;
    return store?.getState().activeGroupFilter;
  })).toBe("arthouse");
  await expect(projectBrowser).toHaveAttribute("aria-expanded", "false");
  await expect(rail.getByText("In use", { exact: true })).not.toBeVisible();

  expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("expanded project folders are remembered after reload", async ({ page }) => {
  await seedProjectRail(page);
  const rail = page.getByTestId("project-rail");
  await rail.getByRole("button", { name: "Projects", exact: true }).click();
  const contentSection = rail.getByRole("button", { name: /Content creation/ });
  await contentSection.click();
  await expect(contentSection).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const restoredRail = page.getByTestId("project-rail");
  await expect(restoredRail.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute("aria-expanded", "false");
  await restoredRail.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(restoredRail.getByRole("button", { name: /Content creation/ })).toHaveAttribute("aria-expanded", "true");
});

test("session rows stay compact and never cover the next session", async ({ page }) => {
  await seedProjectRail(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const rows = sidebar.locator(".session-sidebar-row");

  await expect(rows).toHaveCount(2);
  await expect(sidebar.getByTestId("sidebar-session-summary")).toHaveCount(2);
  await expect(sidebar.getByTestId("sidebar-session-task-row")).toHaveCount(0);
  await expect(sidebar.getByTestId("sidebar-session-now-row")).toHaveCount(0);

  const boxes = await rows.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  expect(boxes.every((box) => box.height <= 60)).toBe(true);
  expect(boxes.every((box, index) => index === boxes.length - 1 || box.bottom <= boxes[index + 1].top)).toBe(true);
});
