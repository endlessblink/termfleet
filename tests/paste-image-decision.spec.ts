import { expect, test } from "@playwright/test";
import { decidePasteAction } from "../src/lib/keymap";

// Guards the terminal's clipboard-paste branching. The IMAGE branch (forward
// Ctrl-V / `\x16` so the agent reads the clipboard image) previously had NO test
// coverage, so it could — and did — regress silently "again". These pin the
// contract of the primary capture-phase paste handler in TerminalCanvas.tsx.

test("armed image with no text forwards the image paste (Ctrl-V to the agent)", () => {
  expect(decidePasteAction({ hasText: false, hasImage: true, armed: true })).toBe("image");
});

test("an UNarmed image with no text is ignored — the native event passes through", () => {
  // Must NOT be swallowed: a plain Ctrl+V image still reaches the agent via the
  // `\x16` keydown path. Swallowing here is exactly the silent image-paste break.
  expect(decidePasteAction({ hasText: false, hasImage: false, armed: false })).toBe("ignore");
  expect(decidePasteAction({ hasText: false, hasImage: true, armed: false })).toBe("ignore");
});

test("text always pastes — arming only disambiguates image intent, never text", () => {
  expect(decidePasteAction({ hasText: true, hasImage: false, armed: false })).toBe("text");
  expect(decidePasteAction({ hasText: true, hasImage: false, armed: true })).toBe("text");
});

test("text wins over an image when the clipboard carries both", () => {
  // If the source app put a text representation alongside the image, text paste
  // runs (the image is delegated to the agent via the keydown path instead).
  expect(decidePasteAction({ hasText: true, hasImage: true, armed: true })).toBe("text");
  expect(decidePasteAction({ hasText: true, hasImage: true, armed: false })).toBe("text");
});

test("empty clipboard is ignored", () => {
  expect(decidePasteAction({ hasText: false, hasImage: false, armed: true })).toBe("ignore");
});
