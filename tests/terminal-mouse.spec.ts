import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 900, height: 600 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("terminal mouse reports encode SGR and legacy VT sequences", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { encodeMouseReport, pointerButtonToTerminalButton } = await import(
      "/src/lib/terminalMouse.ts"
    );
    const hex = (value: string) =>
      [...value].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");

    return {
      leftPressSgr: encodeMouseReport({ button: 0, col: 12, row: 3, sgr: true }),
      leftReleaseSgr: encodeMouseReport({ button: 0, col: 12, row: 3, sgr: true, release: true }),
      ctrlRightSgr: encodeMouseReport({
        button: 2,
        col: 4,
        row: 5,
        sgr: true,
        modifiers: { ctrlKey: true },
      }),
      wheelDownLegacyHex: hex(encodeMouseReport({ button: 65, col: 9, row: 2, sgr: false })),
      leftReleaseLegacyHex: hex(encodeMouseReport({
        button: 0,
        col: 9,
        row: 2,
        sgr: false,
        release: true,
      })),
      leftButton: pointerButtonToTerminalButton(0),
      middleButton: pointerButtonToTerminalButton(1),
      rightButton: pointerButtonToTerminalButton(2),
      ignoredButton: pointerButtonToTerminalButton(4),
    };
  });

  expect(out.leftPressSgr).toBe("\x1b[<0;12;3M");
  expect(out.leftReleaseSgr).toBe("\x1b[<0;12;3m");
  expect(out.ctrlRightSgr).toBe("\x1b[<18;4;5M");
  expect(out.wheelDownLegacyHex).toBe("1b 5b 4d 61 29 22");
  expect(out.leftReleaseLegacyHex).toBe("1b 5b 4d 23 29 22");
  expect(out.leftButton).toBe(0);
  expect(out.middleButton).toBe(1);
  expect(out.rightButton).toBe(2);
  expect(out.ignoredButton).toBeNull();
});
