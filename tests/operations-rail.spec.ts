import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function resetWorkspace(page: Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function typeTerminalCommand(page: Page, command: string) {
  await page.locator(".terminal-container:visible").first().click();
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();
  await expect(input).toBeFocused();
  await input.pressSequentially(command, { delay: 10 });
  await input.press("Enter");
}

test("operations rail exposes one clear job per icon and gates preview until a URL exists", async ({ page }) => {
  await resetWorkspace(page);

  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const rail = sidebar.getByRole("navigation", { name: "Operations rail" });
  const files = rail.getByRole("button", { name: "Files" });
  const sessions = rail.getByRole("button", { name: "Sessions" });
  const map = rail.getByRole("button", { name: "Map" });
  const preview = rail.getByRole("button", { name: "Preview" });

  await expect(files).toHaveAttribute("title", "Show files panel");
  await expect(sessions).toHaveAttribute("title", "Sessions list");
  await expect(map).toHaveAttribute("title", "Operations map");
  await expect(preview).toHaveAttribute("title", "Preview unavailable until the active terminal prints a localhost URL");
  await expect(preview).toBeDisabled();

  await files.click();
  await expect(sidebar.getByLabel("Files panel")).toBeVisible();
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(files).toHaveAttribute("title", "Hide files panel");

  await map.click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();
  await expect(map).toHaveAttribute("aria-pressed", "true");

  await sessions.click();
  await expect(page.locator(".terminal-container:visible")).toBeVisible();
  await expect(sessions).toHaveAttribute("aria-pressed", "true");

  await typeTerminalCommand(page, "echo http://127.0.0.1:43210");
  await expect.poll(async () => page.evaluate(() => {
    const ptys = (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { output: string }>;
    }).__terminalWorkspaceBrowserPtys ?? {};
    return Object.values(ptys).some((session) => session.output.includes("http://127.0.0.1:43210"));
  })).toBe(true);

  await expect(preview).toBeEnabled();
  await expect(preview).toHaveAttribute("title", "Open preview pane for active terminal");
  await map.click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();
  await preview.click();
  await expect(page.locator("[data-magic-canvas-shell]")).toBeVisible();
  const mapPreview = page.locator("[data-magic-canvas-shell]").getByRole("region", { name: "Localhost preview" });
  await expect(mapPreview).toBeVisible();
  await expect(mapPreview.getByRole("textbox", { name: "Preview URL" })).toHaveValue("http://127.0.0.1:43210");
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("canvas-terminal-node").first().click();
  await expect(mapPreview.locator('iframe[title="Localhost preview"]')).toHaveCount(0);
  await expect(mapPreview.getByRole("status", { name: "Preview paused" })).toBeVisible();
  await mapPreview.click({ position: { x: 24, y: 24 } });
  await expect(mapPreview.locator('iframe[title="Localhost preview"]')).toHaveCount(1);
  await sidebar.screenshot({ path: "/tmp/termfleet-operations-rail-preview.png" });
});
