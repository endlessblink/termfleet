import type { AgentProvider } from "./types";

/**
 * Full-screen agent TUIs that repaint their ENTIRE frame on a resize.
 *
 * Map nodes normally freeze an alt-screen terminal at its working size and clip
 * it, because reflowing a wide multiplexer (zellij/tmux) into a small node
 * fragments it. Agent TUIs are not multiplexers: OpenCode (opentui) redraws the
 * whole frame at the new geometry on every SIGWINCH, in both directions. Freezing
 * one leaves it pinned at its old size inside a bigger node with dead space
 * around it — the "TUI doesn't resize with the window" report.
 *
 * Verified against a real PTY (grow 100x30 → 150x45 and shrink → 80x24: the app
 * repaints out to the new last column/row every time) by
 * `scripts/verify-opencode-tui-resize.py`.
 */
const REFLOW_SAFE_PROVIDERS: ReadonlySet<string> = new Set(["opencode"]);

/** Launch commands that start one of the reflow-safe agent TUIs. */
const REFLOW_SAFE_COMMAND = /(?:^|[\s/])opencode(?:\s|$)/i;

/**
 * True when the pane is known to be running a full-screen agent TUI that
 * survives a reflow, so the map projection must resize it instead of freezing it.
 *
 * Both signals are best-effort and independent: `command` covers panes TermFleet
 * launched itself, `provider` covers hand-started sessions once a status hook has
 * stamped the pane's sidecar. Neither is required.
 */
export function isReflowSafeAgentTui(input: {
  command?: string | null;
  provider?: AgentProvider | string | null;
}): boolean {
  if (input.provider && REFLOW_SAFE_PROVIDERS.has(String(input.provider))) {
    return true;
  }
  return Boolean(input.command && REFLOW_SAFE_COMMAND.test(input.command));
}
