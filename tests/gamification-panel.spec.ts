import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 920 }, launchOptions: { executablePath: "/usr/bin/chromium", args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"] } });

test("progress panel explains missions and receipts", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.removeItem("terminal-workspace.v1"); localStorage.removeItem("terminal-workspace.test"); localStorage.removeItem("termfleet.gamification.v2"); localStorage.removeItem("termfleet.gamification.v3"); localStorage.removeItem("termfleet.gamification.v4"); localStorage.removeItem("termfleet.gamification.v5"); localStorage.removeItem("termfleet.gamification.v6"); localStorage.removeItem("termfleet.gamification.v6.dev"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toContainText("Lv 1");
  await expect(trigger).toContainText("0 pts");
  await trigger.click();
  const panel = page.getByTestId("gamification-panel");
  await expect(panel).toContainText("Workstream quest");
  await expect(panel).toContainText("Fleet Rank");
  await expect(panel).toContainText("Keep 3 workstreams running for 10 minutes");
  await expect(panel).toContainText("This challenge appears when an active workstream is running.");
  await expect(panel).toContainText("Latest badge");
  await expect(panel).not.toContainText("Recent receipts");
  await expect(panel.getByTestId("gamification-focus-finish-goal")).toHaveCount(0);
  await trigger.press("Escape");
  await expect(panel).toBeHidden();
});

test("reset is explicit and preserves the workspace", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.removeItem("terminal-workspace.v1"); localStorage.removeItem("terminal-workspace.test"); localStorage.setItem("termfleet.gamification.v6.dev", JSON.stringify({ version: 6, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }], ignoredEventIds: [], maxActiveWorkstreams: 0, baselineActiveWorkstreams: 0, parallelWorkstreamStartedAt: null, parallelWorkstreamSeconds: 0, parallelBestSeconds: 0, initializedAt: 1, updatedAt: 1 })); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toContainText("25 pts");
  await trigger.click();
  await page.getByTestId("gamification-reset").click();
  await page.getByTestId("gamification-reset-confirm").click();
  await expect(trigger).toContainText("0 pts");
  await expect(await page.evaluate(() => localStorage.getItem("terminal-workspace.v1"))).not.toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("termfleet.gamification.v6.dev") ?? "null").events)).toEqual([]);
});

test("restart starts a new profile instead of replaying the previous noisy score", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.setItem("termfleet.gamification.v3", JSON.stringify({ version: 3, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 925, occurredAt: 1 }], ignoredEventIds: [], maxActiveWorkstreams: 0, baselineActiveWorkstreams: 0, updatedAt: 1 }));
    localStorage.removeItem("termfleet.gamification.v6.dev");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("gamification-trigger")).toContainText("Lv 1");
  await expect(page.getByTestId("gamification-trigger")).toContainText("0 pts");
  expect(await page.evaluate(() => localStorage.getItem("termfleet.gamification.v6.dev"))).not.toBeNull();
});
