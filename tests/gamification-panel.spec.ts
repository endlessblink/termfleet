import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("progress is discoverable in the header and explains rewards", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.removeItem("termfleet.gamification.v1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("Lv 1");
  await expect(trigger).toContainText("0 pts");
  await expect(page.getByTestId("statusbar-gamification")).toHaveCount(0);

  await trigger.click();
  const panel = page.getByTestId("gamification-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Your progress");
  await expect(panel).toContainText("Goals finished");
  await expect(panel).toContainText("Achievements");
  await expect(panel).toContainText("Complete your first tracked goal.");
  await expect(panel).toContainText("How points work");
  await expect(panel).toContainText("+25");
  await expect(panel).toContainText("+10");
  await expect(panel).toContainText("2 finished goals and a peak of 3 terminals = 80 points.");
  await expect(panel.getByTestId("gamification-reset")).toContainText("Reset my progress");

  await trigger.press("Escape");
  await expect(panel).toBeHidden();
});

test("reset progress clears only the gamification record", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.setItem("termfleet.gamification.v1", JSON.stringify({ version: 1, completedTaskIds: ["goal-1", "goal-2"], maxConcurrentTerminals: 3, updatedAt: Date.now() }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toHaveAttribute("aria-label", "Progress level 1, 80 points");
  await trigger.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("gamification-reset").click({ force: true });
  await expect(trigger).toContainText("0 pts");
  await expect(await page.evaluate(() => localStorage.getItem("terminal-workspace.v1"))).not.toBeNull();
  expect(await page.evaluate(() => {
    const raw = localStorage.getItem("termfleet.gamification.v1");
    if (!raw) return true;
    const record = JSON.parse(raw);
    return record.version === 1 && record.completedTaskIds.length === 0 && record.maxConcurrentTerminals === 1;
  })).toBe(true);
});
