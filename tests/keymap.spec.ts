import { expect, test } from "@playwright/test";

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
