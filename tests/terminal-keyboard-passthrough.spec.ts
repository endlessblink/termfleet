import { expect, test } from "@playwright/test";

// Goal regression: when a terminal is focused, ITS keyboard belongs to the
// program inside it (zellij, vim, the shell). The two global capture-phase
// window keydown listeners (useKeybindings.ts, WorkbenchHeader.tsx) must yield
// to a focused terminal so combos like Ctrl+T (zellij tab mode), Ctrl+W,
// Ctrl+K, Shift+Tab pass through instead of triggering app chrome.
//
// "ctrl+t closes zellij" was caused by useKeybindings' global listener calling
// createNewTab() before the keystroke ever reached the terminal. The fix is the
// `terminalHasKeyboardFocus()` guard at the top of both global handlers.
//
// In the browser preview there is no Tauri runtime, so the canvas terminal isn't
// mounted; we instead verify the GUARD'S CONTRACT directly against the real
// module + the real DOM marker class, which is exactly what the app code checks.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("terminalHasKeyboardFocus is true only when the terminal input is focused", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { terminalHasKeyboardFocus, TERMINAL_INPUT_CLASS } = await import(
      "/src/lib/terminalFocus.ts"
    );

    // 1) Nothing terminal-ish focused → false (app shortcuts allowed).
    document.body.tabIndex = -1;
    document.body.focus();
    const whenBodyFocused = terminalHasKeyboardFocus();

    // 2) A non-terminal input focused → false (e.g. command bar / file rename).
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    const whenOtherInputFocused = terminalHasKeyboardFocus();

    // 3) An element with the terminal input class focused → true (terminal owns
    //    the keyboard; global app shortcuts must bail). This mirrors the hidden
    //    <textarea className={TERMINAL_INPUT_CLASS}> the canvas terminal renders.
    const term = document.createElement("textarea");
    term.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(term);
    term.focus();
    const whenTerminalFocused = terminalHasKeyboardFocus();

    return {
      classConstant: TERMINAL_INPUT_CLASS,
      whenBodyFocused,
      whenOtherInputFocused,
      whenTerminalFocused,
      activeIsTerminal:
        document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains(TERMINAL_INPUT_CLASS),
    };
  });

  // The class the guard keys on must match what TerminalCanvas renders.
  expect(result.classConstant).toBe("terminal-canvas-input");
  // The guard's truth table: only the terminal input claims the keyboard.
  expect(result.whenBodyFocused).toBe(false);
  expect(result.whenOtherInputFocused).toBe(false);
  expect(result.whenTerminalFocused).toBe(true);
  expect(result.activeIsTerminal).toBe(true);
});

test("zellij combos pass through to the PTY instead of being dropped", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  // The terminal's own key handler must ENCODE these combos (not drop them) so a
  // focused terminal forwards them to zellij. This exercises the real keymap the
  // canvas terminal uses (TerminalCanvas.handleKeyDown → keyEventToBytes).
  const bytes = await page.evaluate(async () => {
    const { keyEventToBytes } = await import("/src/lib/keymap.ts");
    const mk = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    return {
      // Ctrl+T → 0x14 (zellij tab mode). Was being stolen as "new app tab".
      ctrlT: keyEventToBytes(mk({ key: "t", ctrlKey: true }), { appCursor: false }),
      // Shift+Tab → CSI Z back-tab. Was doing nothing / escaping the terminal.
      shiftTab: keyEventToBytes(mk({ key: "Tab", shiftKey: true }), { appCursor: false }),
      // Ctrl+P (zellij pane mode) and Ctrl+W must also reach the shell.
      ctrlP: keyEventToBytes(mk({ key: "p", ctrlKey: true }), { appCursor: false }),
      ctrlW: keyEventToBytes(mk({ key: "w", ctrlKey: true }), { appCursor: false }),
      ctrlZ: keyEventToBytes(mk({ key: "z", ctrlKey: true }), { appCursor: false }),
    };
  });

  expect(bytes.ctrlT).toBe("\x14"); // Ctrl+T control byte
  expect(bytes.shiftTab).toBe("\x1b[Z"); // back-tab
  expect(bytes.ctrlP).toBe("\x10"); // Ctrl+P
  expect(bytes.ctrlW).toBe("\x17"); // Ctrl+W
  expect(bytes.ctrlZ).toBe("\x1a"); // Ctrl+Z / VSUSP
});

test("the REAL running app's global shortcut handlers yield to focused-terminal keys", async ({ page }) => {
  // This loads the actual app (App.tsx mounts useKeybindings + WorkbenchHeader,
  // which register their global window-capture keydown listeners). We then fire a
  // real cancelable Ctrl+T at window and read `defaultPrevented`: the app handlers
  // call e.preventDefault() ONLY when they act. So defaultPrevented === false
  // proves they bailed (key passes through to the terminal); true proves they
  // acted. This exercises the wired-up handlers in the running frontend, not a
  // helper in isolation.
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  // Wait until the app has actually mounted (its global keydown listeners are
  // registered in useEffect, so the DOM must be live before we probe).
  await page.waitForSelector(".terminal-area", { state: "attached" });
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    const { TERMINAL_INPUT_CLASS } = await import("/src/lib/terminalFocus.ts");

    const fireKeyFrom = (el: HTMLElement, init: KeyboardEventInit) => {
      el.focus();
      // Guard: only dispatch once focus actually committed to our element, so the
      // app's focus check sees the intended activeElement.
      if (document.activeElement !== el) return { ok: false, prevented: false };
      const ev = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      el.dispatchEvent(ev); // bubbles → window-capture listeners run
      return { ok: true, prevented: ev.defaultPrevented };
    };

    const term = document.createElement("textarea");
    term.className = TERMINAL_INPUT_CLASS;
    document.body.appendChild(term);

    const outside = document.createElement("input");
    document.body.appendChild(outside);

    const inTerminalCtrlT = fireKeyFrom(term, { key: "t", ctrlKey: true });
    const outsideTerminalCtrlT = fireKeyFrom(outside, { key: "t", ctrlKey: true });
    const inTerminalPaste = fireKeyFrom(term, { key: "v", ctrlKey: true, shiftKey: true });

    term.remove();
    outside.remove();
    return { inTerminalCtrlT, outsideTerminalCtrlT, inTerminalPaste };
  });

  // Both dispatches must have actually focused their element first.
  expect(result.inTerminalCtrlT.ok, "terminal input took focus for Ctrl+T").toBe(true);
  expect(result.outsideTerminalCtrlT.ok, "non-terminal input took focus for Ctrl+T").toBe(true);
  expect(result.inTerminalPaste.ok, "terminal input took focus for Ctrl+Shift+V").toBe(true);
  // Terminal focused → app must NOT consume Ctrl+T (it reaches zellij as 0x14).
  expect(result.inTerminalCtrlT.prevented).toBe(false);
  // Not in a terminal → the app's Ctrl+T (new tab) still fires (preventDefault).
  expect(result.outsideTerminalCtrlT.prevented).toBe(true);
  // Terminal focused → app chrome must also leave paste to TerminalCanvas.
  expect(result.inTerminalPaste.prevented).toBe(false);
});
