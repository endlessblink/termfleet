export interface TerminalInstanceReferenceInput {
  title: string;
  initialCwd?: string;
  tabId: string;
  paneId: string;
}

export function terminalInstanceCode(tabId: string, paneId: string): string {
  return `terminal-${tabId}-${paneId}`;
}

export function formatTerminalInstanceReference({
  title,
  initialCwd,
  tabId,
  paneId,
}: TerminalInstanceReferenceInput): string {
  return [
    "TermFleet terminal instance",
    `Title: ${title}`,
    `Path: ${initialCwd ?? "(unknown)"}`,
    `Instance code: ${terminalInstanceCode(tabId, paneId)}`,
  ].join("\n");
}
