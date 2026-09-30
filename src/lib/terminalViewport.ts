export type TerminalViewportAction =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "delta"; delta: number };

export interface TerminalViewportModes {
  /** The pane is on the alternate screen: a TUI owns the whole surface. */
  altScreen?: boolean;
  /**
   * The grid holds scrollback above the live screen. `false` means we KNOW it does
   * not; `undefined` means an older frame didn't say, and history is still claimed.
   */
  hasHistory?: boolean;
  /**
   * Any-event mouse tracking is on: a fullscreen app (Claude Code) owns the
   * primary screen and its own scrolling, so the grid history is stale frames.
   */
  mouseMotion?: boolean;
}

export function terminalWheelRowDelta(
  delta: number,
  deltaMode: number,
  cellHeight: number,
  pageRows: number,
): number {
  if (deltaMode === 1) return delta;
  if (deltaMode === 2) return delta * Math.max(1, pageRows);
  return delta / Math.max(1, cellHeight);
}

/** Normalize browser wheel units into app-owned wheel notches. */
export function terminalWheelNotchDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta / 3;
  if (deltaMode === 2) return delta;
  return delta / 99;
}

export function consumeTerminalWheelRows(
  rowDelta: number,
  remainder: number,
): { rows: number; remainder: number } {
  const total = rowDelta + remainder;
  const rows = Math.trunc(total);
  return { rows, remainder: total - rows };
}

export function terminalViewportAction(
  key: string,
  rows: number,
  modes: TerminalViewportModes = {},
): TerminalViewportAction | null {
  // Never claim history navigation we cannot show. Two cases:
  //  - the alternate screen has no grid scrollback (the TUI owns that surface);
  //  - an app that repaints in place on the PRIMARY screen never scrolls its
  //    output and emits no line feeds, so the grid accumulates no history at all.
  //    OpenCode does this. Claiming the key there swallows it into an empty
  //    history while the app that owns the scrollable content never sees it — the
  //    pane simply cannot scroll. Return null so the key falls through to the PTY.
  // Primary-screen panes with real history keep TermFleet history navigation.
  if (modes.altScreen) return null;
  if (modes.hasHistory === false) return null;
  if (modes.mouseMotion) return null;
  const page = Math.max(1, Math.floor(rows));
  switch (key) {
    case "Home":
      return { kind: "top" };
    case "End":
      return { kind: "bottom" };
    case "PageUp":
      return { kind: "delta", delta: page };
    case "PageDown":
      return { kind: "delta", delta: -page };
    default:
      return null;
  }
}
