import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

// Regression: immersive (fullscreen) terminal mode hides the WHOLE sidebar AND header
// (App.tsx only mounts them when !immersiveTerminal.enabled). It used to be persisted to
// localStorage, so an accidental Ctrl+Shift+F survived a reload and the sidebar came back
// hidden with no obvious way out ("the sidebar is not appearing"). It must now hydrate OFF
// every launch so a restart always restores the sidebar.
test("immersive terminal mode does not persist across a reload", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // Turn immersive mode ON via the store action and let the change persist.
  const enabledAfterToggle = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => {
          activeTabId: string | null;
          tabs: Array<{ id: string; activePaneId: string }>;
          workspaceUiState: { immersiveTerminal: { enabled: boolean } };
          toggleImmersiveTerminal: (tabId: string, paneId: string) => void;
        };
      };
    }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const state = store.getState();
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];
    if (!tab) throw new Error("No tab available to enter immersive mode");
    store.getState().toggleImmersiveTerminal(tab.id, tab.activePaneId);
    return store.getState().workspaceUiState.immersiveTerminal.enabled;
  });
  expect(enabledAfterToggle).toBe(true);

  // Reload — the persisted snapshot must hydrate immersive mode back OFF.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const enabledAfterReload = await page.evaluate(() => {
    const store = (window as typeof window & {
      __termfleetWorkspaceStore?: {
        getState: () => { workspaceUiState: { immersiveTerminal: { enabled: boolean } } };
      };
    }).__termfleetWorkspaceStore;
    return store?.getState().workspaceUiState.immersiveTerminal.enabled ?? null;
  });
  expect(enabledAfterReload).toBe(false);
});
