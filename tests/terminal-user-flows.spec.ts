import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function browserPtyOutputs(page: import("@playwright/test").Page) {
  return page.evaluate(() => Object.values(
    (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { output: string }>;
    }).__terminalWorkspaceBrowserPtys ?? {}
  ).map((session) => session.output));
}

async function browserPtySnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { output: string; subscribers: number }>;
    }).__terminalWorkspaceBrowserPtys ?? {}
  );
}

async function hasBrowserOutputLine(page: import("@playwright/test").Page, expected: string) {
  const outputs = await browserPtyOutputs(page);
  return outputs.some((text) => text.split(/\r?\n/).some((line) => line.trim() === expected));
}

async function browserPtyIdContaining(page: import("@playwright/test").Page, expected: string) {
  const snapshot = await browserPtySnapshot(page);
  return Object.entries(snapshot).find(([, session]) => session.output.includes(expected))?.[0] ?? null;
}

async function typeTerminalCommand(page: import("@playwright/test").Page, command: string) {
  await page.locator(".terminal-container:visible").first().click();
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();
  await expect(input).toBeFocused();
  await page.waitForTimeout(300);
  await input.pressSequentially(command, { delay: 10 });
  await input.press("Enter");
}

test("terminal split and map flows remain usable", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const openTerminalSurface = sidebar.getByRole("button", { name: "Open Terminal terminal surface" });
  const showTerminalOnMap = sidebar.getByRole("button", { name: "Show Terminal on map" });

  await expect(openTerminalSurface.first()).toBeVisible();
  await expect(showTerminalOnMap.first()).toBeVisible();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);

  await typeTerminalCommand(page, "echo FLOW_OK_123");
  await expect.poll(() => hasBrowserOutputLine(page, "FLOW_OK_123")).toBe(true);
  const firstPtyId = await browserPtyIdContaining(page, "FLOW_OK_123");
  expect(firstPtyId).not.toBeNull();
  await page.screenshot({ path: "docs/visual-baselines/tc-008-terminal-typed-command.png", fullPage: true });

  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("split right");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-container:visible")).toHaveCount(2);
  await page.locator(".terminal-container:visible").nth(1).click();
  await expect(page.getByRole("textbox", { name: "Terminal input" }).nth(1)).toBeFocused();
  await page.keyboard.type("echo SPLIT_OK_234", { delay: 10 });
  await page.keyboard.press("Enter");
  await expect.poll(() => hasBrowserOutputLine(page, "SPLIT_OK_234")).toBe(true);
  const activeSplitPtyId = await browserPtyIdContaining(page, "SPLIT_OK_234");
  expect(activeSplitPtyId).not.toBeNull();
  await page.screenshot({ path: "docs/visual-baselines/tc-009-terminal-split-right.png", fullPage: true });

  await showTerminalOnMap.first().click();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open full terminal" }).first()).toBeVisible();
  await expect(page.getByText("Open full terminal for shell work")).toHaveCount(0);
  await typeTerminalCommand(page, "echo MAP_OK_456");
  await expect.poll(() => hasBrowserOutputLine(page, "MAP_OK_456")).toBe(true);
  await expect.poll(async () => {
    const snapshot = await browserPtySnapshot(page);
    return activeSplitPtyId ? snapshot[activeSplitPtyId]?.output.includes("MAP_OK_456") : false;
  }).toBe(true);
  await expect.poll(async () => {
    const snapshot = await browserPtySnapshot(page);
    return activeSplitPtyId ? snapshot[activeSplitPtyId]?.subscribers ?? 0 : 0;
  }).toBe(1);
  await page.screenshot({ path: "docs/visual-baselines/tc-010-map-linked-terminal.png", fullPage: true });

  await openTerminalSurface.first().click();
  await expect(openTerminalSurface.first()).toBeVisible();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(2);
  await expect.poll(() => hasBrowserOutputLine(page, "MAP_OK_456")).toBe(true);

  await openTerminalSurface.first().click();
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("new terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(2);
  await expect(page.locator(".terminal-container:visible").first()).toBeVisible();

  await typeTerminalCommand(page, "echo NEW_OK_789");
  await expect.poll(() => hasBrowserOutputLine(page, "NEW_OK_789")).toBe(true);
  const newSessionPtyId = await browserPtyIdContaining(page, "NEW_OK_789");
  expect(newSessionPtyId).not.toBeNull();

  await showTerminalOnMap.last().click();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(2);
  await expect(page.getByText("Open full terminal for shell work")).toHaveCount(0);
  await page.screenshot({ path: "docs/visual-baselines/tc-011-new-terminal-session.png", fullPage: true });

  await page.getByRole("button", { name: "Close Terminal" }).last().click();
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(1);
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);
  await expect(page.getByText("Open full terminal for shell work")).toHaveCount(0);
  await expect.poll(async () => {
    const snapshot = await browserPtySnapshot(page);
    return newSessionPtyId ? snapshot[newSessionPtyId] ?? null : null;
  }).toBeNull();
  await page.screenshot({ path: "docs/visual-baselines/tc-012-map-close-session.png", fullPage: true });

  await openTerminalSurface.first().click();
  await expect(openTerminalSurface.first()).toBeVisible();
  await page.getByRole("button", { name: /Close .* terminal session/ }).first().click();
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(1);
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);
  await expect(page.getByText("Open full terminal for shell work")).toHaveCount(0);
  await expect.poll(async () => {
    const snapshot = await browserPtySnapshot(page);
    return firstPtyId ? snapshot[firstPtyId] ?? null : null;
  }).toBeNull();
  await expect.poll(async () => {
    const snapshot = await browserPtySnapshot(page);
    return activeSplitPtyId ? snapshot[activeSplitPtyId] ?? null : null;
  }).toBeNull();
  await typeTerminalCommand(page, "echo AFTER_TERMINAL_CLOSE_OK_901");
  await expect.poll(() => hasBrowserOutputLine(page, "AFTER_TERMINAL_CLOSE_OK_901")).toBe(true);
  await page.screenshot({ path: "docs/visual-baselines/tc-013-terminal-section-close-session.png", fullPage: true });
});

test("project session can be created without using files first", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });

  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByPlaceholder("FlowState, Botson, Inner Dialogue...").fill("Daily Project");
  await page.getByPlaceholder("/media/.../project").fill("/browser-workspace");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(sidebar.getByRole("button", { name: "Switch to Daily Project" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Open Daily Project terminal surface" })).toBeVisible();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);

  await typeTerminalCommand(page, "echo PROJECT_OK_321");
  await expect.poll(() => hasBrowserOutputLine(page, "PROJECT_OK_321")).toBe(true);
});

test("header project switcher can open create project from map context", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });

  await sidebar.getByRole("button", { name: "Map", exact: true }).click();
  await expect(sidebar.getByText("Map", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create project" }).click();

  await expect(sidebar.getByText("Projects", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("FlowState, Botson, Inner Dialogue...")).toBeVisible();
  await expect(page.getByPlaceholder("/media/.../project")).toBeVisible();
});

test("project context follows header, sidebar, command palette, and map switching", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const projectTabs = page.getByRole("tablist", { name: "Projects" });

  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByPlaceholder("FlowState, Botson, Inner Dialogue...").fill("Alpha Project");
  await page.getByPlaceholder("/media/.../project").fill("/browser-workspace/alpha");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(projectTabs.getByRole("tab", { name: "Switch to Alpha Project" })).toHaveAttribute("aria-selected", "true");
  await typeTerminalCommand(page, "echo ALPHA_STAYS_ALIVE");
  await expect.poll(() => hasBrowserOutputLine(page, "ALPHA_STAYS_ALIVE")).toBe(true);

  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByPlaceholder("FlowState, Botson, Inner Dialogue...").fill("Beta Project");
  await page.getByPlaceholder("/media/.../project").fill("/browser-workspace/beta");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(projectTabs.getByRole("tab", { name: "Switch to Beta Project" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(1);
  await expect(sidebar.getByText("Beta Project · browser-workspace/beta")).toBeVisible();
  await expect.poll(() => hasBrowserOutputLine(page, "ALPHA_STAYS_ALIVE")).toBe(true);
  await page.screenshot({ path: "docs/visual-baselines/tc-052-project-context-terminal.png", fullPage: true });

  await page.waitForTimeout(200);
  await page.screenshot({ path: "docs/visual-baselines/tc-053-project-context-switcher.png", fullPage: true });
  await projectTabs.getByRole("tab", { name: "Switch to Alpha Project" }).click();
  await expect(projectTabs.getByRole("tab", { name: "Switch to Alpha Project" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(1);
  await expect(sidebar.getByText("Alpha Project · browser-workspace/alpha")).toBeVisible();

  await sidebar.getByRole("button", { name: "Switch to Beta Project" }).click();
  await expect(projectTabs.getByRole("tab", { name: "Switch to Beta Project" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("sessions: Alpha Project");
  await page.keyboard.press("Enter");
  await expect(projectTabs.getByRole("tab", { name: "Switch to Alpha Project" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(1);

  await sidebar.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open full terminal" }).first()).toBeVisible();
  await expect(page.getByText("Alpha Project").first()).toBeVisible();
  await expect(page.getByText(/browser-workspace\/alpha/).first()).toBeVisible();
  await page.screenshot({ path: "docs/visual-baselines/tc-054-project-context-map.png", fullPage: true });
});

test("new terminal affordance supports plus button menu and keyboard creation", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const newTerminalButton = sidebar.getByRole("button", { name: "New terminal" });

  await expect(newTerminalButton).toBeVisible();
  await expect(newTerminalButton).toHaveAttribute("title", /Ctrl\+Shift\+T/);
  await expect(newTerminalButton).toHaveAttribute("aria-haspopup", "menu");

  await newTerminalButton.click({ button: "right" });
  await expect(newTerminalButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Launch configurations")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Split workbench/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await newTerminalButton.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu", { name: "New terminal launch configurations" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /New terminal/ })).toBeFocused();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator(".workspace-sidebar-row")).toHaveCount(2);
  await expect(page.locator(".terminal-container:visible").first()).toBeVisible();
});
