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
  await expect(startup.getByText("Restoring workspace")).toHaveCSS("opacity", "1");
  await expect(root).toHaveAttribute("inert", "");
  await expect(root).toHaveAttribute("aria-hidden", "true");
  await expect(startup.locator(".termfleet-startup__rule")).toHaveCount(0);

  const motionContract = await startup.evaluate((element) => {
    const lockup = element.querySelector(".termfleet-startup__lockup");
    const halo = element.querySelector(".termfleet-loader__halo");
    const prompt = element.querySelector(".termfleet-loader__prompt");
    const mark = element.querySelector(".termfleet-startup__mark");
    const hull = element.querySelector(".termfleet-loader__hull");
    const wordmark = element.querySelector(".termfleet-startup__letter");
    return {
      lockupIterations: lockup ? getComputedStyle(lockup).animationIterationCount : "",
      lockupAnimation: lockup ? getComputedStyle(lockup).animationName : "",
      haloIterations: halo ? getComputedStyle(halo).animationIterationCount : "",
      haloAnimation: halo ? getComputedStyle(halo).animationName : "",
      promptIterations: prompt ? getComputedStyle(prompt).animationIterationCount : "",
      promptAnimation: prompt ? getComputedStyle(prompt).animationName : "",
      markIterations: mark ? getComputedStyle(mark).animationIterationCount : "",
      markAnimation: mark ? getComputedStyle(mark).animationName : "",
      hullAnimation: hull ? getComputedStyle(hull).animationName : "",
      wordmarkAnimation: wordmark ? getComputedStyle(wordmark).animationName : "",
    };
  });
  expect(motionContract.lockupIterations).toBe("1");
  expect(motionContract.lockupAnimation).toBe("none");
  expect(motionContract.haloIterations).toBe("infinite");
  expect(motionContract.haloAnimation).toContain("halo-pulse");
  expect(motionContract.promptIterations).toBe("infinite");
  expect(motionContract.promptAnimation).toContain("prompt-drift");
  expect(motionContract.markIterations).toContain("infinite");
  expect(motionContract.markAnimation).toContain("mark-settle");
  expect(motionContract.hullAnimation).toBe("none");
  expect(motionContract.wordmarkAnimation).toBe("none");

  const startupScreenshot = "/tmp/termfleet-startup-final.png";
  await page.waitForTimeout(900);
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

test("startup animation reveals the command-fleet mark", async ({ page }, testInfo) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const startup = page.locator("#termfleet-startup");
  await expect(startup).toHaveAttribute("data-startup-state", "restoring");
  await expect(startup.locator(".termfleet-loader__hull")).toHaveCount(1);
  await expect(startup.locator(".termfleet-loader__halo")).toHaveCount(1);

  const letters = startup.locator(".termfleet-startup__letter");
  await expect(letters).toHaveCount(9);
  await expect(startup.locator(".termfleet-startup__name")).toHaveAttribute("aria-label", "TermFleet");

  const letterMotion = await letters.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        delay: style.animationDelay,
        weight: style.fontWeight,
      };
    }),
  );
  expect(letterMotion.every(({ animationName }) => animationName === "none")).toBe(true);
  expect(new Set(letterMotion.map(({ delay }) => delay)).size).toBe(1);
  expect(new Set(letterMotion.map(({ weight }) => weight)).size).toBe(1);

  const capturePhase = async (name: string, time: number) => {
    await startup.evaluate((element, currentTime) => {
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = currentTime;
      });
    }, time);
    const path = `/tmp/termfleet-startup-${name}.png`;
    await page.screenshot({ path });
    await testInfo.attach(`startup ${name}`, { path, contentType: "image/png" });
  };

  await capturePhase("command", 520);
  await expect(startup.locator(".termfleet-loader__hull")).not.toHaveCSS("opacity", "0");

  await capturePhase("fleet", 960);
  await expect(startup.locator(".termfleet-loader__terminal")).toHaveCSS("opacity", "1");

  await capturePhase("wordmark", 1800);
  expect(
    await letters.evaluateAll((elements) =>
      elements.filter(
        (element) => Number(getComputedStyle(element).opacity) > 0,
      ).length,
    ),
  ).toBeGreaterThan(4);

  await capturePhase("complete", 3000);
  await expect(startup.locator(".termfleet-loader__hull")).toHaveCSS("opacity", "1");
  expect(
    await letters.evaluateAll((elements) =>
      elements.every((element) => Number(getComputedStyle(element).opacity) > 0),
    ),
  ).toBe(true);

  for (const time of [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000]) {
    await startup.evaluate((element, currentTime) => {
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = currentTime;
      });
    }, time);
    await startup.locator(".termfleet-startup__lockup").screenshot({
      path: `/tmp/termfleet-startup-frame-${String(time).padStart(4, "0")}.png`,
    });

    const frameVisibility = await startup.evaluate((element) => {
      const selectors = [
        ".termfleet-startup__mark",
        ".termfleet-startup__name",
        ".termfleet-startup__status",
        ".termfleet-startup__progress",
      ];
      return selectors.map((selector) => {
        const node = element.querySelector<HTMLElement>(selector);
        const style = node ? getComputedStyle(node) : null;
        const rect = node?.getBoundingClientRect();
        return {
          selector,
          opacity: Number(style?.opacity ?? 0),
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        };
      });
    });
    expect(frameVisibility.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
  }
});
