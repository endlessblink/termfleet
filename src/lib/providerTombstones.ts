export function providerSessionIdFromCommand(command?: string): string | undefined {
  const match = command?.match(/(?:^|[;\s])(?:--?resume|resume)\s+([^\s;]+)/);
  return match?.[1]?.trim() || undefined;
}

/**
 * TF-091: closing an old card tombstones its chat id, but that chat can be reopened
 * in another pane later. A chat that is running in a pane nobody closed is not
 * closed, so its tombstone is dropped instead of hiding the live card.
 */
export function withoutLiveProviderTombstones(
  closedProviderSessionIds: Set<string>,
  closedSessionIds: Set<string>,
  liveSessions: { id: string; command?: string; providerSessionId?: string }[],
): Set<string> {
  const remaining = new Set(closedProviderSessionIds);
  for (const session of liveSessions) {
    if (closedSessionIds.has(session.id)) continue;
    const providerSessionId = session.providerSessionId ?? providerSessionIdFromCommand(session.command);
    if (providerSessionId) remaining.delete(providerSessionId);
  }
  return remaining;
}
