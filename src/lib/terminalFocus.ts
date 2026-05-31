// Single source of truth for "is a terminal currently the keyboard owner?".
//
// The canvas terminal captures keys through a hidden <textarea> (class
// `terminal-canvas-input`). When that textarea is focused, the terminal — and
// the program running inside it (zellij, vim, a shell) — must receive EVERY
// keystroke, including combos the app chrome would otherwise claim (Ctrl+T,
// Ctrl+W, Ctrl+K, Shift+Tab, …). Real web terminals work this way: a focused
// terminal owns the keyboard; app shortcuts only apply when focus is elsewhere.
//
// App-level global keydown listeners run in the CAPTURE phase at `window`, so
// they fire BEFORE the textarea's own handler. Each such listener must call
// `terminalHasKeyboardFocus()` first and bail when it returns true, so the key
// falls through to the terminal instead of triggering an app action.

/** Class on the canvas terminal's hidden, focus-owning input element. */
export const TERMINAL_INPUT_CLASS = "terminal-canvas-input";

/**
 * True when the focused element is a terminal input — i.e. the terminal owns the
 * keyboard and global app shortcuts should NOT fire.
 */
export function terminalHasKeyboardFocus(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && active.classList.contains(TERMINAL_INPUT_CLASS);
}
