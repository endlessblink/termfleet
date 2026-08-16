import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 920 }, launchOptions: { executablePath: "/usr/bin/chromium", args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"] } });

test("progress panel requires acceptance before the live quest begins", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.removeItem("terminal-workspace.v1"); localStorage.removeItem("terminal-workspace.test"); localStorage.removeItem("termfleet.gamification.v2"); localStorage.removeItem("termfleet.gamification.v3"); localStorage.removeItem("termfleet.gamification.v4"); localStorage.removeItem("termfleet.gamification.v5"); localStorage.removeItem("termfleet.gamification.v6"); localStorage.removeItem("termfleet.gamification.v6.dev"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toContainText("Quest", { timeout: 20000 });
  await trigger.click();
  const panel = page.getByTestId("gamification-panel");
  await expect(panel).toContainText("Workstream quest");
  await expect(panel).toContainText("Hold the line");
  await expect(panel).toContainText("A 10-minute live run");
  await expect(panel).toContainText("Accept this quest to light up the terminals that count");
  await page.getByTestId("gamification-accept").click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Quest accepted");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("termfleet.gamification.v6") ?? "null").activeQuestId)).toBe("parallel-work");
  await expect(panel).toContainText("Next milestone: 10 minutes");
  await expect(page.getByTestId("gamification-accept")).toHaveCount(0);
  await expect(panel).toContainText("0:00 / 10:00");
  await expect(panel).toContainText("Next: 30 minutes, then 3 hours");
  await expect(panel).not.toContainText("Recent receipts");
  await expect(panel.getByTestId("gamification-focus-finish-goal")).toHaveCount(0);
  await trigger.press("Escape");
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(page.getByTestId("gamification-panel")).toContainText("Next milestone: 10 minutes");
  await trigger.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("gamification-trigger").click();
  await expect(page.getByTestId("gamification-panel")).toContainText("Next milestone: 10 minutes");
});

test("reset is explicit and preserves the workspace", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.removeItem("terminal-workspace.v1"); localStorage.removeItem("terminal-workspace.test"); localStorage.setItem("termfleet.gamification.v6.dev", JSON.stringify({ version: 6, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }], ignoredEventIds: [], maxActiveWorkstreams: 0, baselineActiveWorkstreams: 0, parallelWorkstreamStartedAt: null, parallelWorkstreamSeconds: 0, parallelBestSeconds: 0, initializedAt: 1, updatedAt: 1 })); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toContainText("Quest", { timeout: 20000 });
  await trigger.click();
  const panel = page.getByTestId("gamification-panel");
  await page.getByTestId("gamification-accept").click();
  await page.getByTestId("gamification-reset").click();
  await page.getByTestId("gamification-reset-confirm").click();
  await expect(panel).toContainText("Accept quest");
  await expect(await page.evaluate(() => localStorage.getItem("terminal-workspace.v1"))).not.toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("termfleet.gamification.v6") ?? "null").events.filter((event: { points: number }) => event.points > 0))).toEqual([]);
});

test("Escape closes the panel even while a terminal input owns focus", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("termfleet.gamification.v6");
    localStorage.removeItem("termfleet.gamification.v6.dev");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("gamification-trigger").click();
  await page.getByTestId("gamification-accept").click();
  await page.evaluate(() => (document.querySelector("textarea") as HTMLTextAreaElement | null)?.focus());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("gamification-panel")).toBeHidden();
});

test("restart starts a new profile instead of replaying the previous noisy score", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.setItem("termfleet.gamification.v3", JSON.stringify({ version: 3, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 925, occurredAt: 1 }], ignoredEventIds: [], maxActiveWorkstreams: 0, baselineActiveWorkstreams: 0, updatedAt: 1 }));
    localStorage.removeItem("termfleet.gamification.v6");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("gamification-trigger")).toContainText("Quest", { timeout: 20000 });
  expect(await page.evaluate(() => localStorage.getItem("termfleet.gamification.v6"))).not.toBeNull();
});

test("migrates an accepted quest from the previous release profile key", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("termfleet.gamification.v6");
    localStorage.setItem("termfleet.gamification.v6.dev", JSON.stringify({
      version: 6, events: [], ignoredEventIds: [], maxActiveWorkstreams: 0,
      baselineActiveWorkstreams: 0, parallelWorkstreamStartedAt: null,
      parallelWorkstreamSeconds: 0, parallelBestSeconds: 0,
      activeQuestId: "parallel-work", questAcceptedAt: Date.now(),
      initializedAt: Date.now(), updatedAt: Date.now(),
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("gamification-trigger").click();
  await expect(page.getByTestId("gamification-panel")).toContainText("Next milestone: 10 minutes");
  expect(await page.evaluate(() => localStorage.getItem("termfleet.gamification.v6"))).not.toBeNull();
});
