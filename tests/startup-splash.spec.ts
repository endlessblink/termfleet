import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

declare global {
  interface Window {
    __termfleetStartupCalls?: string[];
    __releaseWorkspaceLayout?: () => void;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let releaseWorkspaceLayout: (() => void) | undefined;
    const workspaceLayout = new Promise<null>((resolve) => {
      releaseWorkspaceLayout = () => resolve(null);
    });
    const calls: string[] = [];

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          calls.push(command);
          if (command === "workspace_layout_load") return workspaceLayout;
          if (command === "workspace_persisted_sessions") return [];
          if (command.includes("list") || command.includes("statuses")) return [];
          return null;
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
      },
    });

    window.__termfleetStartupCalls = calls;
    window.__releaseWorkspaceLayout = () => releaseWorkspaceLayout?.();
  });
});

test("startup screen holds the app until workspace restoration is painted", async ({ page }, testInfo) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const startup = page.locator("#termfleet-startup");
  const root = page.locator("#root");

  await expect(startup).toBeVisible();
  await expect(startup).toHaveAttribute("data-startup-state", "restoring");
  await expect(startup.getByText("Restoring workspace")).toHaveCSS("opacity", "0");
  await expect(root).toHaveAttribute("inert", "");
  await expect(root).toHaveAttribute("aria-hidden", "true");
  await expect(startup.locator(".termfleet-startup__rule")).toHaveCount(0);

  const motionContract = await startup.evaluate((element) => {
    const lockup = element.querySelector(".termfleet-startup__lockup");
    const mark = element.querySelector(".termfleet-startup__mark");
    return {
      lockupIterations: lockup ? getComputedStyle(lockup).animationIterationCount : "",
      markAnimation: mark ? getComputedStyle(mark).animationName : "",
    };
  });
  expect(motionContract.lockupIterations).toBe("1");
  expect(motionContract.markAnimation).toBe("none");

  const startupScreenshot = "/tmp/termfleet-startup-final.png";
  await page.screenshot({ path: startupScreenshot });
  await testInfo.attach("startup screen", {
    path: startupScreenshot,
    contentType: "image/png",
  });

  const callsBeforeReady = await page.evaluate(() => window.__termfleetStartupCalls ?? []);
  expect(callsBeforeReady).not.toContain("daemon_ensure_session");
  expect(callsBeforeReady).not.toContain("pty_spawn");

  await page.evaluate(() => window.__releaseWorkspaceLayout?.());

  await expect(startup).toBeHidden();
  await expect(root).not.toHaveAttribute("inert", "");
  await expect(root).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".app-layout")).toBeVisible();
});

test("reduced motion keeps the startup mark still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#termfleet-startup")).toHaveAttribute(
    "data-startup-state",
    "restoring",
  );

  const animations = await page.locator("#termfleet-startup").evaluate((element) =>
    element
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running")
      .map((animation) => animation.effect?.getTiming().iterations),
  );
  expect(animations).toEqual([]);
});
