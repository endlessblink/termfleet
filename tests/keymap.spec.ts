import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// TC-017d — keymap proof. Constructs real KeyboardEvents in Chromium and
// asserts the VT byte sequences the keymap emits (the single source of truth
// for input translation).

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("keymap translates keys to VT sequences", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { keyEventToBytes, encodePaste } = await import("/src/lib/keymap.ts");

    const ev = (key: string, opts: Partial<KeyboardEventInit> = {}) =>
      new KeyboardEvent("keydown", { key, ...opts });

    const toHex = (s: string | null) =>
      s === null ? null : Array.from(s).map((c) => c.charCodeAt(0)).join(",");

    return {
      enter: toHex(keyEventToBytes(ev("Enter"))),
      backspace: toHex(keyEventToBytes(ev("Backspace"))),
      tab: toHex(keyEventToBytes(ev("Tab"))),
      shiftTab: toHex(keyEventToBytes(ev("Tab", { shiftKey: true }))),
      esc: toHex(keyEventToBytes(ev("Escape"))),
      plainA: toHex(keyEventToBytes(ev("a"))),
      ctrlC: toHex(keyEventToBytes(ev("c", { ctrlKey: true }))),
      ctrlA: toHex(keyEventToBytes(ev("a", { ctrlKey: true }))),
      ctrlZ: toHex(keyEventToBytes(ev("z", { ctrlKey: true }))),
      altB: toHex(keyEventToBytes(ev("b", { altKey: true }))),
      // Arrows: normal (CSI) vs application-cursor (SS3) vs modified.
      upNormal: toHex(keyEventToBytes(ev("ArrowUp"))),
      upApp: toHex(keyEventToBytes(ev("ArrowUp"), { appCursor: true })),
      ctrlUp: toHex(keyEventToBytes(ev("ArrowUp", { ctrlKey: true }))),
      home: toHex(keyEventToBytes(ev("Home"))),
      del: toHex(keyEventToBytes(ev("Delete"))),
      pageUp: toHex(keyEventToBytes(ev("PageUp"))),
      f1: toHex(keyEventToBytes(ev("F1"))),
      f5: toHex(keyEventToBytes(ev("F5"))),
      shiftAlone: keyEventToBytes(ev("Shift")),
      metaK: keyEventToBytes(ev("k", { metaKey: true })),
      paste: toHex(encodePaste("a\nb", false)),
      pasteBracketed: toHex(encodePaste("x", true)),
    };
  });

  expect(out.enter).toBe("13"); // \r
  expect(out.backspace).toBe("127"); // DEL
  expect(out.tab).toBe("9");
  expect(out.shiftTab).toBe("27,91,90"); // ESC [ Z
  expect(out.esc).toBe("27");
  expect(out.plainA).toBe("97");
  expect(out.ctrlC).toBe("3"); // ETX
  expect(out.ctrlA).toBe("1"); // SOH
  expect(out.ctrlZ).toBe("26"); // SUB / VSUSP
  expect(out.altB).toBe("27,98"); // ESC b
  expect(out.upNormal).toBe("27,91,65"); // ESC [ A
  expect(out.upApp).toBe("27,79,65"); // ESC O A
  expect(out.ctrlUp).toBe("27,91,49,59,53,65"); // ESC [ 1 ; 5 A
  expect(out.home).toBe("27,91,72"); // ESC [ H
  expect(out.del).toBe("27,91,51,126"); // ESC [ 3 ~
  expect(out.pageUp).toBe("27,91,53,126"); // ESC [ 5 ~
  expect(out.f1).toBe("27,79,80"); // ESC O P
  expect(out.f5).toBe("27,91,49,53,126"); // ESC [ 1 5 ~
  expect(out.shiftAlone).toBeNull();
  expect(out.metaK).toBeNull();
  expect(out.paste).toBe("97,13,98"); // newline normalized to \r
  expect(out.pasteBracketed).toBe("27,91,50,48,48,126,120,27,91,50,48,49,126"); // ESC[200~ x ESC[201~
});

test("terminal paste shortcut is explicit and does not include random keys", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { isTerminalPasteShortcut } = await import("/src/lib/keymap.ts");
    const ev = (key: string, opts: Partial<KeyboardEventInit> = {}) =>
      new KeyboardEvent("keydown", { key, ...opts });

    return {
      ctrlShiftV: isTerminalPasteShortcut(ev("v", { ctrlKey: true, shiftKey: true })),
      metaShiftV: isTerminalPasteShortcut(ev("v", { metaKey: true, shiftKey: true })),
      plainV: isTerminalPasteShortcut(ev("v")),
      ctrlV: isTerminalPasteShortcut(ev("v", { ctrlKey: true })),
      repeatedCtrlShiftV: isTerminalPasteShortcut(ev("v", { ctrlKey: true, shiftKey: true, repeat: true })),
      enter: isTerminalPasteShortcut(ev("Enter")),
      x: isTerminalPasteShortcut(ev("x")),
      pasteEvent: isTerminalPasteShortcut(new KeyboardEvent("keyup", { key: "v", ctrlKey: true, shiftKey: true })),
    };
  });

  expect(out.ctrlShiftV).toBe(true);
  expect(out.metaShiftV).toBe(true);
  expect(out.plainV).toBe(false);
  expect(out.ctrlV).toBe(false);
  expect(out.repeatedCtrlShiftV).toBe(false);
  expect(out.enter).toBe(false);
  expect(out.x).toBe(false);
  expect(out.pasteEvent).toBe(false);
});

test("agent prompt paste bracketing only wraps risky prompt pastes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { shouldBracketAgentPromptPaste } = await import("/src/lib/keymap.ts");

    return {
      multilineClaude: shouldBracketAgentPromptPaste(
        "first line\nsecond line",
        "Claude Code\nesc to interrupt",
      ),
      largeCodexPrompt: shouldBracketAgentPromptPaste(
        "x".repeat(140),
        "gpt-5 thinking\ncontext left 42%",
      ),
      shortClaudeText: shouldBracketAgentPromptPaste("hello", "Claude Code\nesc to interrupt"),
      multilineShell: shouldBracketAgentPromptPaste("first line\nsecond line", "$ "),
    };
  });

  expect(out.multilineClaude).toBe(true);
  expect(out.largeCodexPrompt).toBe(true);
  expect(out.shortClaudeText).toBe(false);
  expect(out.multilineShell).toBe(false);
});

test("canvas terminal clears hidden textarea around paste and input events", () => {
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const onBeforeInputBlock =
    source.match(/const onBeforeInput = \(event: InputEvent\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";
  const handleKeyDownBlock =
    source.match(/const handleKeyDown = \(event: React\.KeyboardEvent<HTMLTextAreaElement>\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  const captureKeyDownBlock =
    source.match(/const onCaptureKeyDown = \(event: KeyboardEvent\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";

  expect(source).toContain("const clearHiddenInput");
  expect(source).toContain("clearHiddenInput();");
  expect(source).toContain("const sendPasteText");
  expect(source).toContain("shouldBracketPasteForVisibleAgentPrompt(text)");
  expect(source).toContain("modesRef.current.bracketedPaste || shouldBracketPasteForVisibleAgentPrompt(text)");
  expect(source).toContain("const clipboardHasImage");
  expect(source).toContain('send("\\x16", nextTerminalInputSequence(), "canvas-image-paste-shortcut")');
  // Ctrl+Shift+V must read the clipboard from the Rust BACKEND, never rely on
  // WebKitGTK's blocked navigator.clipboard.readText() nor on a native `paste`
  // event firing (both broke text paste "again"). Guards against regressing back
  // to a webview-only read.
  expect(source).toContain("const pasteFromClipboardShortcut");
  expect(source).toContain('invoke<string>("clipboard_read_text")');
  expect(source).toContain("const onPaste = (event: ClipboardEvent)");
  expect(source).toContain("event.stopImmediatePropagation()");
  expect(source).toContain('input.addEventListener("paste", onPaste, true)');
  expect(source).toContain('event.inputType === "insertFromPaste"');
  expect(source).toContain('input.addEventListener("beforeinput", onBeforeInput, true)');
  expect(source).toContain('input.addEventListener("input", clear, true)');
  expect(onBeforeInputBlock).not.toContain("event.preventDefault()");
  expect(source).toMatch(/const handlePaste = \(event: React\.ClipboardEvent<HTMLTextAreaElement>\) => \{[\s\S]*const text = event\.clipboardData\.getData\("text"\);[\s\S]*const armed = performance\.now\(\) <= pasteShortcutArmedUntilRef\.current;[\s\S]*if \(!text && !\(armed && clipboardHasImage\(event\.clipboardData\)\)\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*sendImagePasteShortcut\(\);/);
  expect(source).toMatch(/const onPaste = \(event: ClipboardEvent\) => \{[\s\S]*const text = event\.clipboardData\?\.getData\("text\/plain"\) \?\? "";[\s\S]*const armed = performance\.now\(\) <= pasteShortcutArmedUntilRef\.current;[\s\S]*decidePasteAction\(\{[\s\S]*if \(action === "ignore"\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*if \(action === "image"\) \{[\s\S]*sendImagePasteShortcut\(\);/);
  expect(source).toMatch(/const handleInput = \(event: React\.FormEvent<HTMLTextAreaElement>\) => \{[\s\S]*event\.currentTarget\.value = "";/);
  expect(source).toContain("onInput={handleInput}");

  expect(handleKeyDownBlock).toMatch(/\(event\.ctrlKey \|\| event\.metaKey\) && event\.shiftKey && key === "c"[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*copySelection\(\);/);
  expect(handleKeyDownBlock).toMatch(/isTerminalPasteShortcut\(event\.nativeEvent\)[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*pasteFromClipboardShortcut\(\);[\s\S]*return;/);
  expect(captureKeyDownBlock).toMatch(/isTerminalPasteShortcut\(event\)[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*pasteFromClipboardShortcut\(\);[\s\S]*return;/);
  expect(captureKeyDownBlock).toMatch(/\(event\.ctrlKey \|\| event\.metaKey\) && event\.shiftKey && key === "c"[\s\S]*event\.stopPropagation\(\);[\s\S]*return;/);
});
