export type TerminalMouseButton = 0 | 1 | 2 | 64 | 65;

export interface TerminalMouseModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
}

export interface TerminalWheelModes {
  mouseReport?: boolean;
  altScreen?: boolean;
  alternateScrollSet?: boolean;
  alternateScroll?: boolean;
  appCursor?: boolean;
}

export type TerminalWheelAction =
  | { kind: "mouse-report" }
  | { kind: "app-arrows"; sequence: string }
  | { kind: "history" };

export interface TerminalMouseReport {
  button: TerminalMouseButton;
  col: number;
  row: number;
  sgr: boolean;
  release?: boolean;
  modifiers?: TerminalMouseModifiers;
}

function modifierBits(modifiers: TerminalMouseModifiers = {}) {
  return (modifiers.shiftKey ? 4 : 0) +
    (modifiers.altKey ? 8 : 0) +
    (modifiers.ctrlKey ? 16 : 0);
}

function legacyByte(value: number) {
  return String.fromCharCode(Math.min(255, Math.max(0, value)));
}

export function encodeMouseReport({
  button,
  col,
  row,
  sgr,
  release = false,
  modifiers,
}: TerminalMouseReport) {
  const x = Math.max(1, Math.floor(col));
  const y = Math.max(1, Math.floor(row));
  const encodedButton = button + modifierBits(modifiers);

  if (sgr) {
    return `\x1b[<${encodedButton};${x};${y}${release ? "m" : "M"}`;
  }

  const legacyButton = release ? 3 : encodedButton;
  return `\x1b[M${legacyByte(32 + legacyButton)}${legacyByte(32 + x)}${legacyByte(32 + y)}`;
}

export function pointerButtonToTerminalButton(button: number): TerminalMouseButton | null {
  if (button === 0) return 0;
  if (button === 1) return 1;
  if (button === 2) return 2;
  return null;
}

// A mouse-reporting app owns the wheel ONLY on the alternate screen (vim/htop),
// where the app controls the whole surface and there is no terminal scrollback.
// On the PRIMARY screen the scrollback lives in our grid, so plain wheel must
// scroll OUR history — an inline agent CLI (Claude/Codex) enables mouse-report
// for clicks but does NOT scroll on the wheel, so routing the wheel to it just
// black-holes scroll-up and the user can never reach the history sitting in the
// grid (TC-043).
export function shouldSendWheelToTerminalApp(modifiers: TerminalMouseModifiers, modes: TerminalWheelModes = {}): boolean {
  if (modes.mouseReport && modes.altScreen) return true;
  if (modifiers.shiftKey) return false;
  if (modifiers.altKey) return true;
  return Boolean(modes.altScreen && modes.alternateScrollSet && modes.alternateScroll);
}

export function terminalWheelAction(
  modifiers: TerminalMouseModifiers,
  modes: TerminalWheelModes = {},
  direction: "up" | "down" = "down"
): TerminalWheelAction {
  if (modes.mouseReport && modes.altScreen) return { kind: "mouse-report" };
  if (modifiers.shiftKey) return { kind: "history" };
  const useAppArrows = modifiers.altKey ||
    (modes.altScreen && modes.alternateScrollSet && modes.alternateScroll);
  if (useAppArrows) {
    return {
      kind: "app-arrows",
      sequence: direction === "up"
        ? modes.appCursor ? "\x1bOA" : "\x1b[A"
        : modes.appCursor ? "\x1bOB" : "\x1b[B",
    };
  }
  return { kind: "history" };
}
