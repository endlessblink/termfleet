/** Prefer the daemon's actual PTY id for process and status lookups. */
export function effectiveTerminalPaneId(options: {
  livePtyId?: string | null;
  attachToPtyId?: string | null;
  runtimeSessionId?: string | null;
}): string | null {
  return options.livePtyId ?? options.attachToPtyId ?? options.runtimeSessionId ?? null;
}

/** Status sidecars are keyed by the stable runtime session, not a reattach id. */
export function statusSidecarPaneId(options: {
  livePtyId?: string | null;
  attachToPtyId?: string | null;
  runtimeSessionId?: string | null;
}): string | null {
  // Cold restore creates synthetic `recovered-*` tab/pane ids while the daemon keeps
  // the original pane UUID; use that UUID so the saved sidecar can be found.
  const originalPaneId = options.livePtyId ?? options.attachToPtyId;
  if (
    originalPaneId &&
    /(?:recovered-tab|recovered-pane)/i.test(options.runtimeSessionId ?? "")
  ) {
    return originalPaneId;
  }
  return options.runtimeSessionId ?? options.livePtyId ?? options.attachToPtyId ?? null;
}

export function statusSidecarPaneIds(options: {
  livePtyId?: string | null;
  attachToPtyId?: string | null;
  runtimeSessionId?: string | null;
}): string[] {
  const primary = statusSidecarPaneId(options);
  const values = primary ? [primary] : [];
  const runtime = options.runtimeSessionId ?? "";
  const suffix = runtime.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1];
  if (suffix && !values.includes(suffix)) values.push(suffix);
  return values;
}
