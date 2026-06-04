import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("map terminal rendering avoids pixelated live canvases and grouped preview DOM churn", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const ReactDom = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { TerminalCanvas } = await import("/src/components/TerminalCanvas.tsx");
    const { snapshotPreviewRows } = await import("/src/components/MagicCanvas.tsx");
    const React = ReactModule.default ?? ReactModule;

    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "360px";
    document.body.appendChild(host);

    const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot;
    const root = createRoot(host);
    root.render(
      React.createElement(TerminalCanvas, {
        sessionId: "visual-regression",
        renderScale: 2,
        cols: 80,
        rows: 24,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvasStyles = Array.from(host.querySelectorAll("canvas")).map((canvas) => {
      const element = canvas as HTMLCanvasElement;
      return {
        inline: element.style.imageRendering,
        computed: getComputedStyle(element).imageRendering,
      };
    });
    root.unmount();

    const magenta = { c: "[", fg: "#ff00ff", bg: "#000000" };
    const green = { c: "=", fg: "#00ff00", bg: "#000000" };
    const blank = { c: " ", fg: "#d0d0d0", bg: "#000000" };
    const row = [
      ...Array.from({ length: 24 }, () => ({ ...magenta })),
      ...Array.from({ length: 44 }, () => ({ ...green })),
      ...Array.from({ length: 28 }, () => ({ ...blank })),
    ];
    const snapshot = {
      cols: row.length,
      rows: 1,
      cursor: { col: 0, line: 0 },
      cursorVisible: false,
      altScreen: false,
      cells: [row],
    };

    const rows = snapshotPreviewRows(snapshot, 1, 96);
    return {
      canvasStyles,
      segmentCount: rows[0].segments.length,
      segmentText: rows[0].segments.map((segment) => segment.text).join(""),
    };
  });

  expect(result.canvasStyles).toHaveLength(2);
  for (const style of result.canvasStyles) {
    expect(style.inline).toBe("auto");
    expect(style.computed).not.toBe("pixelated");
  }

  expect(result.segmentCount).toBeLessThan(8);
  expect(result.segmentText.length).toBe(96);
});

test("overview preview sampling is capped and groups noisy terminal rows", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { snapshotPreviewRows } = await import("/src/components/MagicCanvas.tsx");

    const colors = ["#ff00ff", "#00ff00", "#00d0ff", "#d0d0d0"];
    const cells = Array.from({ length: 120 }, (_, rowIndex) =>
      Array.from({ length: 180 }, (_, colIndex) => {
        const block = Math.floor(colIndex / 12);
        const active = block % 3 !== 2;
        return {
          c: active ? String.fromCharCode(65 + ((rowIndex + block) % 26)) : " ",
          fg: colors[block % colors.length],
          bg: "#000000",
        };
      }),
    );

    const rows = snapshotPreviewRows({
      cols: 180,
      rows: 120,
      cursor: { col: 0, line: 0 },
      cursorVisible: false,
      altScreen: false,
      cells,
    });

    const segmentCounts = rows.map((row) => row.segments.length);
    const visibleChars = rows.map((row) =>
      row.segments.reduce((total, segment) => total + segment.text.length, 0),
    );

    return {
      rowCount: rows.length,
      maxSegments: Math.max(...segmentCounts),
      maxVisibleChars: Math.max(...visibleChars),
      totalSegments: segmentCounts.reduce((total, count) => total + count, 0),
    };
  });

  expect(result.rowCount).toBeLessThanOrEqual(14);
  expect(result.maxVisibleChars).toBeLessThanOrEqual(72);
  expect(result.maxSegments).toBeLessThanOrEqual(18);
  expect(result.totalSegments).toBeLessThan(14 * 72);
});
