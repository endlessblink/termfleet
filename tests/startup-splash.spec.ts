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
    const prompt = element.querySelector(".termfleet-loader__prompt");
    const vessel = element.querySelector(".termfleet-loader__vessel");
    const hull = element.querySelector(".termfleet-loader__hull");
    return {
      lockupIterations: lockup ? getComputedStyle(lockup).animationIterationCount : "",
      lockupAnimation: lockup ? getComputedStyle(lockup).animationName : "",
      promptIterations: prompt ? getComputedStyle(prompt).animationIterationCount : "",
      promptAnimation: prompt ? getComputedStyle(prompt).animationName : "",
      vesselIterations: vessel ? getComputedStyle(vessel).animationIterationCount : "",
      vesselAnimation: vessel ? getComputedStyle(vessel).animationName : "",
      hullIterations: hull ? getComputedStyle(hull).animationIterationCount : "",
      hullAnimation: hull ? getComputedStyle(hull).animationName : "",
    };
  });
  expect(motionContract.lockupIterations).toBe("1");
  expect(motionContract.lockupAnimation).toBe("none");
  expect(motionContract.promptIterations).toBe("1");
  expect(motionContract.promptAnimation).toContain("termfleet-prompt-draw");
  expect(motionContract.vesselIterations).toBe("infinite");
  expect(motionContract.vesselAnimation).toContain("termfleet-vessel-idle");
  expect(motionContract.hullIterations).toBe("1");
  expect(motionContract.hullAnimation).toContain("termfleet-vessel-assemble");

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

test("startup animation tells a terminal-to-vessel story", async ({ page }, testInfo) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const startup = page.locator("#termfleet-startup");
  await expect(startup).toHaveAttribute("data-startup-state", "restoring");
  await expect(startup.locator(".termfleet-startup__mark > rect")).toHaveCount(0);

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
  expect(letterMotion.every(({ animationName }) => animationName === "termfleet-letter-arrive")).toBe(true);
  expect(new Set(letterMotion.map(({ delay }) => delay)).size).toBe(9);
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

  await capturePhase("command", 160);
  await expect(startup.locator(".termfleet-loader__prompt")).not.toHaveCSS("opacity", "0");
  await expect(startup.locator(".termfleet-loader__hull")).not.toHaveCSS("opacity", "0");

  await capturePhase("vessel", 600);
  await expect(startup.locator(".termfleet-loader__hull")).toHaveCSS("opacity", "1");
  await expect(startup.locator(".termfleet-loader__stern")).toHaveCSS("opacity", "1");
  await expect(startup.locator(".termfleet-loader__stack")).toHaveCSS("opacity", "1");
  await expect(startup.locator(".termfleet-loader__terminal")).toHaveCSS("opacity", "1");

  await capturePhase("wordmark", 840);
  await expect(startup.locator(".termfleet-loader__prompt")).toHaveCSS("opacity", "0");
  expect(
    await letters.evaluateAll((elements) =>
      elements.filter(
        (element) => getComputedStyle(element).clipPath !== "inset(0px 100% 0px 0px)",
      ).length,
    ),
  ).toBeGreaterThan(4);

  await capturePhase("complete", 1200);
  await expect(startup.locator(".termfleet-loader__terminal")).toHaveCSS("opacity", "1");
  expect(
    await letters.evaluateAll((elements) =>
      elements.every((element) => getComputedStyle(element).clipPath === "inset(0px)"),
    ),
  ).toBe(true);

  for (const time of [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200]) {
    await startup.evaluate((element, currentTime) => {
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = currentTime;
      });
    }, time);
    await startup.locator(".termfleet-startup__lockup").screenshot({
      path: `/tmp/termfleet-startup-frame-${String(time).padStart(4, "0")}.png`,
    });
  }
});
