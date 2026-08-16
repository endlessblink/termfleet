import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 920 }, launchOptions: { executablePath: "/usr/bin/chromium", args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu" ] } });

test("accepted Workstream Quest marks only qualifying terminal shells", async ({ page }, testInfo) => {
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
    const terminals = workspace.tabs.flatMap((tab) => tab.terminals);
    terminals.forEach((terminal, index) => {
      terminal.status = index < 2 ? "running" : "idle";
      terminal.taskLineup = index < 2
        ? [{ id: `quest-${index}`, content: `Tracked work ${index + 1}`, status: "in_progress", source: "operator", updatedAt: Date.now() }]
        : [];
    });
    localStorage.setItem(workspaceKey, JSON.stringify(workspace));
    localStorage.setItem("termfleet.gamification.v6", JSON.stringify({
      version: 6, events: [], ignoredEventIds: [], maxActiveWorkstreams: 0,
      baselineActiveWorkstreams: 0, parallelWorkstreamStartedAt: Date.now(),
      parallelWorkstreamSeconds: 0, parallelBestSeconds: 0,
      activeQuestId: "parallel-work", questAcceptedAt: Date.now(),
      initializedAt: Date.now(), updatedAt: Date.now(),
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await expect(page.locator('.terminal-block-shell[data-quest-active="true"]')).toHaveCount(3, { timeout: 20000 });
  await expect(page.locator('.terminal-block-shell[data-quest-active="false"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: testInfo.outputPath("quest-beam.png"), fullPage: false });
});
