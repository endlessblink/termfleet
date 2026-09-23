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
  await expect(panel).toContainText("Keep 3 workstreams running for 10 minutes");
  await expect(panel.getByTestId("gamification-milestone-rail")).toContainText("10m");
  await expect(panel.getByTestId("gamification-milestone-rail")).toContainText("30m");
  await expect(panel.getByTestId("gamification-milestone-rail")).toContainText("3h");
  await page.getByTestId("gamification-accept").click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("gamification-active-count")).toContainText("Quest started");
  await expect(panel.getByTestId("gamification-active-count")).toContainText("Paused");
  await expect(panel.getByTestId("gamification-active-count")).toContainText("add 2 live terminals");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("termfleet.gamification.v6") ?? "null").activeQuestId)).toBe("parallel-work");
  await expect(page.getByTestId("gamification-accept")).toHaveCount(0);
  await expect(panel).toContainText("0:00 / 10:00");
  await expect(panel).not.toContainText("Recent receipts");
  await expect(panel.getByTestId("gamification-focus-finish-goal")).toHaveCount(0);
  await trigger.press("Escape");
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(page.getByTestId("gamification-panel")).toContainText("0:00 / 10:00");
  await trigger.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("gamification-trigger").click();
  await expect(page.getByTestId("gamification-panel")).toContainText("0:00 / 10:00");
});

test("the dock status bar keeps Workstream Quest visible and opens its panel", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  const statusTrigger = page.getByTestId("gamification-status-trigger");
  await expect(statusTrigger).toBeVisible({ timeout: 20000 });
  await expect(statusTrigger).toContainText("Workstream quest");
  await statusTrigger.click();
  await expect(page.getByTestId("gamification-panel")).toBeVisible();
  await expect(page.getByTestId("gamification-panel")).toContainText("Workstream quest");
});

test("Quest opens a top-level popup above the cockpit", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("gamification-trigger").click();
  await expect(page.locator("body > [data-gamification-panel]")).toBeVisible();
  await expect(page.locator("body > [data-gamification-panel]")).toContainText("Workstream quest");
});

test("hovering Quest shows the active quest and offers the next quest after 180 minutes", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript((seed) => {
    localStorage.setItem("termfleet.gamification.v6", JSON.stringify(seed));
  }, {
    version: 6, events: [], ignoredEventIds: [], maxActiveWorkstreams: 3,
    baselineActiveWorkstreams: 3, parallelWorkstreamStartedAt: now - 10_800_000,
    parallelWorkstreamSeconds: 10_800, parallelBestSeconds: 10_800,
    activeQuestId: "parallel-work", questAcceptedAt: now - 10_800_000,
    initializedAt: now - 10_800_000, updatedAt: now,
  });
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("gamification-trigger");
  await expect(trigger).toContainText("Quest", { timeout: 20000 });
  await trigger.hover();
  const panel = page.getByTestId("gamification-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Finish the next tracked goal");
  await expect(panel.getByTestId("gamification-accept")).toContainText("Start quest");
  await expect(trigger).not.toContainText("180:00");
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
  await expect(panel).toContainText("Start quest");
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
  await expect(page.getByTestId("gamification-panel")).toContainText("0:00 / 10:00");
  expect(await page.evaluate(() => localStorage.getItem("termfleet.gamification.v6"))).not.toBeNull();
});

test("finishing a Workstream Quest celebrates the earned milestone", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("terminal-workspace.v1");
    localStorage.removeItem("terminal-workspace.test");
    localStorage.removeItem("termfleet.gamification.v6");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".terminal-block-shell").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Split right" }).first().click();
  await page.getByRole("button", { name: "Split right" }).last().click();
  await expect(page.locator(".terminal-block-shell")).toHaveCount(3, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const workspaceKey = Object.keys(localStorage).find((key) => key.startsWith("terminal-workspace."));
    if (!workspaceKey) throw new Error("workspace key was not persisted");
    const raw = localStorage.getItem(workspaceKey);
    if (!raw) throw new Error("workspace was not persisted");
    const workspace = JSON.parse(raw) as { tabs: Array<{ terminals: Array<Record<string, unknown>> }> };
    workspace.tabs.flatMap((tab) => tab.terminals).forEach((terminal, index) => {
      terminal.status = "running";
      terminal.taskLineup = [{ id: `quest-${index}`, content: `Tracked work ${index + 1}`, status: "in_progress", source: "operator", updatedAt: Date.now() }];
    });
    localStorage.setItem(workspaceKey, JSON.stringify(workspace));
    const now = Date.now();
    localStorage.setItem("termfleet.gamification.v6", JSON.stringify({
      version: 6, events: [], ignoredEventIds: [], maxActiveWorkstreams: 3,
      baselineActiveWorkstreams: 3, parallelWorkstreamStartedAt: now - 599_000,
      parallelWorkstreamSeconds: 599, parallelBestSeconds: 599,
      activeQuestId: "parallel-work", questAcceptedAt: now - 599_000,
      initializedAt: now - 599_000, updatedAt: now,
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('.terminal-block-shell[data-quest-active="true"]')).toHaveCount(3, { timeout: 20000 });
  await page.getByTestId("gamification-trigger").click();
  const celebration = page.getByTestId("gamification-quest-complete");
  await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem("termfleet.gamification.v6") ?? "null");
    localStorage.setItem("termfleet.gamification.v6", JSON.stringify({ ...record, parallelWorkstreamSeconds: 600, parallelBestSeconds: 600, updatedAt: Date.now() }));
    window.dispatchEvent(new Event("termfleet-gamification-changed"));
  });
  await expect(celebration).toBeVisible({ timeout: 5000 });
  await expect(celebration).toContainText("Milestone earned");
  await expect(celebration).toContainText("Parallel warm-up");
});
