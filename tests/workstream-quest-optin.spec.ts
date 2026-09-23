import { expect, test } from "@playwright/test";

// Workstream Quest is experimental in the public preview: hidden for a new
// profile, kept for anyone who already has quest progress, toggled from the
// command bar.

test("a new profile does not show the Workstream Quest", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("gamification-trigger")).toHaveCount(0);
  await expect(page.getByTestId("gamification-status-trigger")).toHaveCount(0);
});

test("existing quest progress keeps the Workstream Quest visible", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("termfleet.gamification.v6", "{}");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("gamification-trigger")).toHaveCount(1);
  await expect(page.getByTestId("gamification-status-trigger")).toHaveCount(1);
});

test("the command bar shows and hides the Workstream Quest", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const setQuest = (enabled: boolean) =>
    page.evaluate((value) => {
      const store = (
        window as typeof window & {
          __termfleetWorkspaceStore?: {
            getState: () => {
              updateWorkspaceUiState: (updates: Record<string, unknown>) => void;
            };
          };
        }
      ).__termfleetWorkspaceStore;
      store?.getState().updateWorkspaceUiState({ workstreamQuestEnabled: value });
    }, enabled);

  await setQuest(true);
  await expect(page.getByTestId("gamification-trigger")).toHaveCount(1);
  await setQuest(false);
  await expect(page.getByTestId("gamification-trigger")).toHaveCount(0);
});
