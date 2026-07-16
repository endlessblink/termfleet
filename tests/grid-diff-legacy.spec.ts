import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("legacy grid frames remain readable during a live daemon upgrade", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const decoded = await page.evaluate(async () => {
    const { decodeFrame, HEADER_BYTES } = await import("/src/lib/gridDiff.ts");
    const cellBytes = 14;
    const cells = [
      { ch: "O".codePointAt(0) ?? 0, fg: 0xd0d0d0ff, bg: 0x000000ff, style: 1 },
      { ch: "K".codePointAt(0) ?? 0, fg: 0x00cd00ff, bg: 0x000000ff, style: 0 },
    ];
    const view = new DataView(new ArrayBuffer(HEADER_BYTES + 4 + cells.length * cellBytes));
    view.setUint8(0, 1);
    view.setUint16(1, 80, true);
    view.setUint16(3, 24, true);
    view.setUint16(7, 2, true);
    view.setUint32(11, 2, true);
    view.setUint16(15, 1, true);
    view.setUint16(HEADER_BYTES, 3, true);
    view.setUint16(HEADER_BYTES + 2, cells.length, true);
    let offset = HEADER_BYTES + 4;
    for (const cell of cells) {
      view.setUint32(offset, cell.ch, true);
      view.setUint32(offset + 4, cell.fg, true);
      view.setUint32(offset + 8, cell.bg, true);
      view.setUint16(offset + 12, cell.style, true);
      offset += cellBytes;
    }

    return decodeFrame(view.buffer).dirtyRows[0];
  });

  expect(decoded.index).toBe(3);
  expect(decoded.cells).toEqual([
    expect.objectContaining({ c: "O", fg: "#d0d0d0", bg: "#000000", bold: true }),
    expect.objectContaining({ c: "K", fg: "#00cd00", bg: "#000000" }),
  ]);
});
