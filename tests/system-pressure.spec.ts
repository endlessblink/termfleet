import { expect, test } from "@playwright/test";
import { classifySystemPressure } from "../src/lib/systemPressure";

const GIB = 1024 ** 3;

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

type PressureInvokeResult =
  | { kind: "success"; snapshot: Parameters<typeof classifySystemPressure>[0] }
  | { kind: "error" };

async function openWithPressureInvoke(
  page: import("@playwright/test").Page,
  result: PressureInvokeResult,
) {
  await page.addInitScript((pressureResult) => {
    localStorage.clear();
    let callbackId = 1;
    const callbacks = new Map<number, unknown>();
    const runtime = window as typeof window & {
      __systemPressureInvocations?: string[];
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    runtime.__systemPressureInvocations = [];
    runtime.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(callback: unknown) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string) {
        if (command === "system_pressure_snapshot") {
          runtime.__systemPressureInvocations?.push(command);
          if (pressureResult.kind === "error") throw new Error("pressure unavailable");
          return pressureResult.snapshot;
        }
        if (command === "workspace_layout_load") return null;
        if (command === "workspace_persisted_sessions") return [];
        if (command === "daemon_status") return { reachable: false, mode: "browser" };
        if (command === "daemon_ensure_running") {
          return { reachable: false, mode: "browser", message: "browser test" };
        }
        if (command === "grid_snapshot") {
          return JSON.stringify({
            cols: 80,
            rows: 24,
            cursor: { col: 0, line: 0 },
            cursorVisible: false,
            altScreen: false,
            cells: [],
          });
        }
        return null;
      },
      convertFileSrc(path: string) {
        return path;
      },
    };
  }, result);

  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __systemPressureInvocations?: string[] })
      .__systemPressureInvocations?.length ?? 0
  ))).toBeGreaterThan(0);
}

test("classifies heavy swap and blocked processes as high host pressure", () => {
  const summary = classifySystemPressure({
    cpuCount: 24,
    loadAverage1m: 12,
    memTotalBytes: 78 * GIB,
    memAvailableBytes: 29 * GIB,
    swapTotalBytes: 31 * GIB,
    swapFreeBytes: 11 * GIB,
    swapUsedBytes: 20 * GIB,
    ioSomeAvg10: 4,
    procsRunning: 13,
    procsBlocked: 15,
  });

  expect(summary.severity).toBe("high");
  expect(summary.label).toBe("system pressure high");
  expect(summary.title).toContain("swap 20.0Gi");
  expect(summary.title).toContain("15 blocked");
});

test("does not surface a warning for normal host pressure", () => {
  const summary = classifySystemPressure({
    cpuCount: 24,
    loadAverage1m: 3,
    memTotalBytes: 78 * GIB,
    memAvailableBytes: 40 * GIB,
    swapTotalBytes: 31 * GIB,
    swapFreeBytes: 31 * GIB,
    swapUsedBytes: 0,
    ioSomeAvg10: 0,
    procsRunning: 2,
    procsBlocked: 0,
  });

  expect(summary.severity).toBe("normal");
});

test("status bar keeps normal host pressure hidden", async ({ page }) => {
  await openWithPressureInvoke(page, {
    kind: "success",
    snapshot: {
      cpuCount: 8,
      loadAverage1m: 2,
      swapTotalBytes: 16 * GIB,
      swapUsedBytes: 0,
      cpuSomeAvg10: 2,
      memorySomeAvg10: 0,
      ioSomeAvg10: 0,
      procsBlocked: 0,
    },
  });

  await expect(page.getByTestId("statusbar-system-pressure")).toHaveCount(0);
});

test("status bar shows elevated host pressure with its reason", async ({ page }) => {
  await openWithPressureInvoke(page, {
    kind: "success",
    snapshot: {
      cpuCount: 4,
      loadAverage1m: 4,
      swapTotalBytes: 16 * GIB,
      swapUsedBytes: 0,
      cpuSomeAvg10: 2,
      memorySomeAvg10: 0,
      ioSomeAvg10: 0,
      procsBlocked: 0,
    },
  });

  const indicator = page.getByTestId("statusbar-system-pressure");
  await expect(indicator).toHaveText("system pressure elevated");
  await expect(indicator).toHaveAttribute("title", "load 4.0/4");
});

test("status bar shows high host pressure with its reason", async ({ page }) => {
  await openWithPressureInvoke(page, {
    kind: "success",
    snapshot: {
      cpuCount: 8,
      loadAverage1m: 2,
      swapTotalBytes: 16 * GIB,
      swapUsedBytes: 0,
      cpuSomeAvg10: 2,
      memorySomeAvg10: 0,
      ioSomeAvg10: 0,
      procsBlocked: 2,
    },
  });

  const indicator = page.getByTestId("statusbar-system-pressure");
  await expect(indicator).toHaveText("system pressure high");
  await expect(indicator).toHaveAttribute("title", "2 blocked");
});

test("status bar hides host pressure when the native snapshot fails", async ({ page }) => {
  await openWithPressureInvoke(page, { kind: "error" });

  await expect(page.getByTestId("statusbar-system-pressure")).toHaveCount(0);
});
