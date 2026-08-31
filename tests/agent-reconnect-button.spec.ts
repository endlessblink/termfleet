import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 920 }, launchOptions: { executablePath: "/usr/bin/chromium", args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"] } });

test("sessions panel exposes the reconnect agents control", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const reconnect = page.getByTestId("sidebar-reconnect-agents");
  await expect(reconnect).toBeVisible();
  await expect(reconnect).toContainText("Reconnect agents");
  await expect(reconnect).toHaveAttribute("title", "Available in the desktop app");
});
