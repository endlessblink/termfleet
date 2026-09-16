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
  /**
   * The grid holds scrollback above the live screen. `false` means we KNOW it does
   * not, so TermFleet's history is a guaranteed dead end.
   */
  hasHistory?: boolean;
  /**
   * Allow the wheel to fall back to the app's own page keys when there is no
   * history to scroll. Opt-in per surface (the map), because it sends keys the app
   * did not explicitly request.
   */
  appPageKeys?: boolean;
}

export type TerminalWheelAction =
  | { kind: "mouse-report" }
  | { kind: "app-arrows"; sequence: string }
  | { kind: "app-pages"; sequence: string }
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
  if (modifiers.shiftKey) return false;
  if (modes.mouseReport && modes.altScreen) return true;
  // The app asked for the mouse and we have no history to offer: a primary-screen
  // app that repaints in place (OpenCode) would otherwise lose the wheel twice —
  // our history is empty and the app never sees the report.
  if (modes.mouseReport && modes.hasHistory === false) return true;
  if (modifiers.altKey) return true;
  return Boolean(modes.altScreen && modes.alternateScrollSet && modes.alternateScroll);
}

export function terminalWheelAction(
  modifiers: TerminalMouseModifiers,
  modes: TerminalWheelModes = {},
  direction: "up" | "down" = "down"
): TerminalWheelAction {
  if (modifiers.shiftKey) return { kind: "history" };
  // Alt screen (vim/htop): the app owns the whole surface. Primary screen with no
  // grid history (OpenCode): forwarding the wheel is the only way it can scroll —
  // our history would swallow it into nothing. With real history on the primary
  // screen, TC-043 still wins and the wheel scrolls our scrollback instead.
  if (modes.mouseReport && (modes.altScreen || modes.hasHistory === false)) {
    return { kind: "mouse-report" };
  }
  // Nothing to scroll AND the app never asked for the mouse: the wheel would be a
  // guaranteed no-op. Give the app its own page keys so the gesture still scrolls
  // its content instead of dying on an empty history (the map's terminal cards).
  if (modes.appPageKeys && modes.hasHistory === false && !modifiers.altKey) {
    return {
      kind: "app-pages",
      sequence: direction === "up" ? "\x1b[5~" : "\x1b[6~",
    };
  }
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
