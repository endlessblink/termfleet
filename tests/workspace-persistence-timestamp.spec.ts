import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("workspace persistence keeps event timestamps stable across runtime-only updates", async ({ page }) => {
  // Load only the real store, without mounted terminals or background UI polling.
  await page.route("**/persistence-probe", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("http://127.0.0.1:5177/persistence-probe");
  const result = await page.evaluate(async () => {
    const { useWorkspaceStore: store, WORKSPACE_STORAGE_KEY: key } = await import("/src/stores/workspace.ts");
    const originalNow = Date.now;
    const originalSetItem = Storage.prototype.setItem;
    let now = 100_000;
    let writes = 0;
    Date.now = () => now;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) writes += 1;
      return originalSetItem.call(this, name, value);
    };
    const terminal = { id: "persist-pty", paneId: "persist-pane", cols: 80, rows: 24, status: "reconnected", lastStatusAt: 42 };
    const tab = { id: "persist-tab", title: "Work", emoji: "", color: "", groupId: null, terminals: [terminal], splitLayout: { id: terminal.paneId, type: "terminal" }, activePaneId: terminal.paneId };
    const capture = async (nextTab: typeof tab) => {
      store.setState({ hydrating: false, tabs: [nextTab] } as never);
      // Exercise the normal 250ms persistence scheduler and serialized dedup.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { serialized: localStorage.getItem(key), writes };
    };
    try {
      const initial = await capture(tab);
      now += 1000;
      const repeated = await capture({ ...tab });
      now += 1000;
      const runtimeOnly = await capture({ ...tab, terminals: [{ ...terminal, terminalVisibleText: "new viewport", terminalVisibleTextUpdatedAt: now } as typeof terminal] });
      now += 1000;
      const durable = await capture({ ...tab, title: "Renamed work" });
      now += 1000;
      const freshEvent = await capture({ ...tab, title: "Renamed work", terminals: [{ ...terminal, lastStatusAt: 99 }] });
      return { initial, repeated, runtimeOnly, durable, freshEvent };
    } finally {
      Date.now = originalNow;
      Storage.prototype.setItem = originalSetItem;
    }
  });
  expect(result.initial.serialized).not.toBeNull();
  expect(result.repeated.serialized).toBe(result.initial.serialized);
  expect(result.runtimeOnly.serialized).toBe(result.initial.serialized);
  expect(result.repeated.writes).toBe(result.initial.writes);
  expect(result.runtimeOnly.writes).toBe(result.initial.writes);
  expect(result.durable.serialized).not.toBe(result.initial.serialized);
  expect(result.durable.writes).toBe(result.initial.writes + 1);
  expect(JSON.parse(result.initial.serialized!).tabs[0].terminals[0].lastStatusAt).toBe(42);
  expect(JSON.parse(result.freshEvent.serialized!).tabs[0].terminals[0].lastStatusAt).toBe(99);
  expect(result.freshEvent.writes).toBe(result.initial.writes + 2);
});
