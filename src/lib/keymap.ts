// TC-017d — keymap: the single source of truth for translating a browser
// KeyboardEvent into the VT byte sequence a PTY expects. No optimistic echo —
// we only encode input; the PTY echoes and the grid updates via diffs.
//
// References: xterm control sequences (DECCKM application cursor keys, SS3 vs
// CSI), readline/vt220 function keys.

export interface KeymapModes {
  /** DECCKM — application cursor keys (vim, less): arrows use SS3 (ESC O). */
  appCursor: boolean;
}

const DEFAULT_MODES: KeymapModes = { appCursor: false };

export function isTerminalPasteShortcut(event: KeyboardEvent): boolean {
  return (
    event.type === "keydown" &&
    event.key.toLowerCase() === "v" &&
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    !event.repeat
  );
}

/** Modifier code per xterm's `CSI 1 ; <mod> <final>` convention. */
function modifierCode(event: KeyboardEvent): number {
  let code = 1;
  if (event.shiftKey) code += 1;
  if (event.altKey) code += 2;
  if (event.ctrlKey) code += 4;
  return code;
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.shiftKey || event.altKey || event.ctrlKey;
}

/** Arrow / Home / End: SS3 in app-cursor mode, CSI otherwise; CSI when modified. */
function cursorSeq(event: KeyboardEvent, finalChar: string, modes: KeymapModes): string {
  if (hasModifier(event)) {
    return `\x1b[1;${modifierCode(event)}${finalChar}`;
  }
  return modes.appCursor ? `\x1bO${finalChar}` : `\x1b[${finalChar}`;
}

/** `CSI <num> ~` keys (Home/End/PageUp/…) with optional modifier. */
function tildeSeq(event: KeyboardEvent, num: number): string {
  if (hasModifier(event)) {
    return `\x1b[${num};${modifierCode(event)}~`;
  }
  return `\x1b[${num}~`;
}

const FUNCTION_SS3: Record<string, string> = {
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
};

const FUNCTION_CSI: Record<string, number> = {
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
};

/**
 * Translate a keydown event to bytes, or `null` if it should be ignored (pure
 * modifier presses, browser shortcuts the caller handles, IME composition).
 */
export function keyEventToBytes(
  event: KeyboardEvent,
  modes: KeymapModes = DEFAULT_MODES,
): string | null {
  const { key } = event;

  // Bare modifier keys produce no input.
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") {
    return null;
  }
  // Meta/Cmd shortcuts (copy/paste, app shortcuts) are not terminal input.
  if (event.metaKey) return null;

  switch (key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return event.altKey ? "\x1b\x7f" : "\x7f";
    case "Tab":
      return event.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return cursorSeq(event, "A", modes);
    case "ArrowDown":
      return cursorSeq(event, "B", modes);
    case "ArrowRight":
      return cursorSeq(event, "C", modes);
    case "ArrowLeft":
      return cursorSeq(event, "D", modes);
    case "Home":
      return cursorSeq(event, "H", modes);
    case "End":
      return cursorSeq(event, "F", modes);
    case "Insert":
      return tildeSeq(event, 2);
    case "Delete":
      return tildeSeq(event, 3);
    case "PageUp":
      return tildeSeq(event, 5);
    case "PageDown":
      return tildeSeq(event, 6);
    default:
      break;
  }

  if (key in FUNCTION_SS3 && !hasModifier(event)) return FUNCTION_SS3[key];
  if (key in FUNCTION_SS3) return `\x1b[1;${modifierCode(event)}${FUNCTION_SS3[key].slice(-1)}`;
  if (key in FUNCTION_CSI) return tildeSeq(event, FUNCTION_CSI[key]);

  // Single printable character.
  if (key.length === 1) {
    if (event.ctrlKey) {
      const ctrl = controlByte(key);
      if (ctrl !== null) {
        return event.altKey ? `\x1b${ctrl}` : ctrl;
      }
    }
    // Alt+<char> sends ESC-prefixed (Meta) per xterm convention.
    return event.altKey ? `\x1b${key}` : key;
  }

  return null;
}

/**
 * Map a key to its Ctrl control byte. Ctrl+A..Z → 0x01..0x1a, plus the standard
 * Ctrl+@ \[ \\ \] ^ _ and Ctrl+Space (NUL).
 */
function controlByte(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    return String.fromCharCode(lower.charCodeAt(0) - 96); // 'a'(97) → 1
  }
  switch (key) {
    case " ":
    case "@":
      return "\x00";
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    case "?":
      return "\x7f";
    default:
      return null;
  }
}

/**
 * What the terminal's primary (capture-phase) clipboard `paste` handler should do.
 * The desktop terminal has no image-to-disk pipeline: an image paste is realized
 * by forwarding Ctrl-V (`\x16`) to the PTY so the running agent reads the image
 * from the clipboard itself. The contract (TC-033):
 *   - "ignore" — no text AND no *armed* image: let the native event pass (do NOT
 *                preventDefault). A plain Ctrl+V image still reaches the agent via
 *                the `\x16` keydown path, so this branch must not swallow it.
 *   - "image"  — no text, but an image is on the clipboard and the Ctrl+Shift+V
 *                paste shortcut was armed in time: forward `\x16`.
 *   - "text"   — text is present: bracketed-paste it. Text does NOT require arming
 *                (arming only disambiguates image-paste intent).
 * Pure + exported so the image branch — previously untested, which is why it
 * regressed silently "again" — is guarded by tests/paste-image-decision.spec.ts.
 */
export type PasteAction = "ignore" | "image" | "text";

export function decidePasteAction(input: {
  hasText: boolean;
  hasImage: boolean;
  armed: boolean;
}): PasteAction {
  if (!input.hasText && !(input.armed && input.hasImage)) return "ignore";
  if (!input.hasText) return "image";
  return "text";
}

/** Wrap pasted text in bracketed-paste markers when the app enabled the mode. */
export function encodePaste(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  return bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized;
}

/**
 * Decide whether a paste should be force-wrapped in bracketed-paste markers when
 * the PTY hasn't reported bracketed mode but an agent TUI is clearly on screen.
 * Without this, multi-line / large pastes into a Claude/codex/gpt prompt get
 * duplicated, garbled, or auto-run because the agent's own paste handling and the
 * shell both see the raw newlines (TC-033 T3). Single short pastes are left raw.
 */
export function shouldBracketAgentPromptPaste(text: string, visibleText: string): boolean {
  if (!/[\r\n]/.test(text) && text.length < 120) return false;
  return /\b(?:gpt-\d|Claude|Opus|context left|tab to queue message|esc to interrupt|Pasted (?:text|Content))\b/i.test(
    visibleText,
  );
}
