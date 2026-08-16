/** Commands that are an explicit operator request to close the current pane. */
export function isExplicitTerminalExitCommand(line: string): boolean {
  return line.trim().replace(/\s+/g, " ") === "/exit";
}
