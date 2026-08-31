export type TerminalViewportAction =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "delta"; delta: number };

export function terminalViewportAction(
  key: string,
  rows: number,
): TerminalViewportAction | null {
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
