import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 780, height: 493 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("command menu stays inside the viewport and can reach its last action", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 780, height: 493 });
  await page.getByLabel("Workspace command").click();
  await page.keyboard.press("ControlOrMeta+K");

  const menu = page.locator(".workbench-command-menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);

  const lastAction = menu.locator(".workbench-command-result").last();
  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastAction).toBeVisible();
});
