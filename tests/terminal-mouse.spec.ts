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
    const {
      encodeMouseReport,
      pointerButtonToTerminalButton,
      shouldSendWheelToTerminalApp,
      terminalWheelAction,
    } = await import("/src/lib/terminalMouse.ts");
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
      plainWheelUsesTerminalHistory: shouldSendWheelToTerminalApp({ altKey: false }),
      altWheelUsesTerminalApp: shouldSendWheelToTerminalApp({ altKey: true }),
      // TC-043: mouse-report on the PRIMARY screen (inline agent CLI) must NOT
      // steal the wheel — the scrollback lives in our grid, so plain wheel = history.
      mouseReportPrimaryWheelUsesHistory: shouldSendWheelToTerminalApp(
        { altKey: false },
        { mouseReport: true }
      ),
      // mouse-report on the ALTERNATE screen (vim/htop) still owns the wheel.
      mouseReportAltScreenWheelUsesTerminalApp: shouldSendWheelToTerminalApp(
        { altKey: false },
        { mouseReport: true, altScreen: true }
      ),
      alternateScrollWheelUsesTerminalApp: shouldSendWheelToTerminalApp(
        { altKey: false },
        { altScreen: true, alternateScroll: true, alternateScrollSet: true }
      ),
      plainAltScreenWheelUsesTerminalHistory: shouldSendWheelToTerminalApp(
        { altKey: false },
        { altScreen: true, alternateScroll: false }
      ),
      appCursorOnlyWheelUsesTerminalHistory: shouldSendWheelToTerminalApp(
        { altKey: false },
        { altScreen: true, appCursor: true }
      ),
      bracketedPasteOnlyWheelUsesTerminalHistory: shouldSendWheelToTerminalApp(
        { altKey: false },
        { altScreen: true }
      ),
      disabledAlternateScrollUsesHistory: shouldSendWheelToTerminalApp(
        { altKey: false },
        { altScreen: true, alternateScroll: false, alternateScrollSet: true }
      ),
      shiftAltScreenWheelUsesTerminalHistory: shouldSendWheelToTerminalApp(
        { altKey: false, shiftKey: true },
        { altScreen: true, alternateScroll: false }
      ),
      shiftMouseReportingWheelUsesTerminalApp: shouldSendWheelToTerminalApp(
        { altKey: false, shiftKey: true },
        { mouseReport: true, altScreen: true }
      ),
      plainWheelAction: terminalWheelAction({ altKey: false }, {}, "down"),
      altScreenWheelDownAction: terminalWheelAction(
        { altKey: false },
        { altScreen: true, alternateScroll: false },
        "down"
      ),
      altScreenAppCursorWheelDownAction: terminalWheelAction(
        { altKey: false },
        { altScreen: true, appCursor: true },
        "down"
      ),
      explicitAlternateScrollWheelUpAction: terminalWheelAction(
        { altKey: false },
        { altScreen: true, alternateScroll: true, alternateScrollSet: true },
        "up"
      ),
      appCursorWheelUpAction: terminalWheelAction(
        { altKey: false },
        { altScreen: true, alternateScroll: true, alternateScrollSet: true, appCursor: true },
        "up"
      ),
      shiftAltScreenWheelAction: terminalWheelAction(
        { altKey: false, shiftKey: true },
        { altScreen: true },
        "down"
      ),
      mouseReportWheelAction: terminalWheelAction(
        { altKey: false, shiftKey: true },
        { mouseReport: true, altScreen: true },
        "down"
      ),
      // TC-043: primary-screen mouse-report (inline Claude/Codex) → our history,
      // so scroll-up reaches the grid's scrollback instead of black-holing.
      mouseReportPrimaryWheelAction: terminalWheelAction(
        { altKey: false },
        { mouseReport: true },
        "up"
      ),
      // alt-screen mouse-report (vim/htop) still goes to the app.
      mouseReportAltScreenWheelAction: terminalWheelAction(
        { altKey: false },
        { mouseReport: true, altScreen: true },
        "up"
      ),
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
  expect(out.plainWheelUsesTerminalHistory).toBe(false);
  expect(out.altWheelUsesTerminalApp).toBe(true);
  expect(out.mouseReportPrimaryWheelUsesHistory).toBe(false);
  expect(out.mouseReportAltScreenWheelUsesTerminalApp).toBe(true);
  expect(out.alternateScrollWheelUsesTerminalApp).toBe(true);
  expect(out.plainAltScreenWheelUsesTerminalHistory).toBe(false);
  expect(out.appCursorOnlyWheelUsesTerminalHistory).toBe(false);
  expect(out.bracketedPasteOnlyWheelUsesTerminalHistory).toBe(false);
  expect(out.disabledAlternateScrollUsesHistory).toBe(false);
  expect(out.shiftAltScreenWheelUsesTerminalHistory).toBe(false);
  expect(out.shiftMouseReportingWheelUsesTerminalApp).toBe(true);
  expect(out.plainWheelAction).toEqual({ kind: "history" });
  expect(out.altScreenWheelDownAction).toEqual({ kind: "history" });
  expect(out.altScreenAppCursorWheelDownAction).toEqual({ kind: "history" });
  expect(out.explicitAlternateScrollWheelUpAction).toEqual({ kind: "app-arrows", sequence: "\x1b[A" });
  expect(out.appCursorWheelUpAction).toEqual({ kind: "app-arrows", sequence: "\x1bOA" });
  expect(out.shiftAltScreenWheelAction).toEqual({ kind: "history" });
  expect(out.mouseReportWheelAction).toEqual({ kind: "mouse-report" });
  expect(out.mouseReportPrimaryWheelAction).toEqual({ kind: "history" });
  expect(out.mouseReportAltScreenWheelAction).toEqual({ kind: "mouse-report" });
});
