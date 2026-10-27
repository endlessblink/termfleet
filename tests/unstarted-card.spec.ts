import { expect, test } from "@playwright/test";

// Noam 2026-10-27 ("this terminal was opened for no reason"): after the last card is closed the app
// keeps one blank placeholder card. Selecting it used to start a real shell in the home folder.
// Now it starts nothing until the operator clicks Start terminal.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

type Store = {
  getState: () => {
    tabs: Array<{ id: string; unstarted?: boolean; terminals: unknown[] }>;
    removeTab: (id: string) => void;
    startTab: (id: string) => void;
  };
};

async function open(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

const storeOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    return { tabs: state.tabs.map((tab) => ({ id: tab.id, unstarted: tab.unstarted === true })) };
  });

test("closing the last card leaves a blank card that starts nothing until Start terminal is clicked", async ({ page }) => {
  await open(page);
  const before = await storeOf(page);
  expect(before.tabs.length).toBeGreaterThan(0);

  // Close every card, as the operator does one by one: the last close makes the placeholder.
  await page.evaluate(() => {
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore!;
    for (const tab of [...store.getState().tabs]) store.getState().removeTab(tab.id);
  });
  const placeholder = await storeOf(page);
  expect(placeholder.tabs).toHaveLength(1);
  expect(placeholder.tabs[0].unstarted).toBe(true);

  await page.waitForTimeout(1500);
  expect(await page.locator(".xterm").count(), "no terminal is mounted for the blank card").toBe(0);
  const start = page.locator('[data-testid="canvas-agent-connect-terminal"], [data-testid="split-start-terminal"]').first();
  await expect(start).toBeVisible();
  await expect(start).toContainText("Start terminal");

  await start.click();
  await expect.poll(async () => (await storeOf(page)).tabs[0].unstarted).toBe(false);
  await expect.poll(() => page.locator(".xterm").count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a card opened on purpose (a new terminal) is not held back", async ({ page }) => {
  await open(page);
  const tabs = await storeOf(page);
  expect(tabs.tabs.every((tab) => !tab.unstarted)).toBe(true);
});
