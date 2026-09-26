// Which TermFleet terminal does a Codex hook event belong to?
//
// Normally the hook runs as a child of the Codex program inside the terminal, so
// the TERMFLEET_PANE_ID it inherits is right. Newer Codex runs ONE shared
// background service (`codex app-server --managed-daemon`) for every chat; hooks
// then run inside that service and inherit the pane id of whichever terminal
// first started it. Live 2026-09-26: the service started from a termfleet
// terminal at 13:23, so an in-control-kernel chat's status landed on that
// termfleet card and its own card read "Shell / No task declared".
//
// So when the hook sits under a Codex process that has no terminal, the
// inherited id is not trusted. The chat is matched to the interactive Codex
// window instead: one resumed with this chat's id, a remembered earlier match,
// or the only Codex window in the chat's folder. If none is certain, return ""
// and write nothing rather than paint another terminal's card.
import { readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ancestors, argv, isProviderProcess, paneOf, terminalOf } from "./single-chat-owner.mjs";
import { normalizeCwd, statusDir } from "./agent-status-paths.mjs";

function cwdOf(procRoot, pid) {
  try {
    return normalizeCwd(readlinkSync(join(procRoot, String(pid), "cwd")));
  } catch {
    return "";
  }
}

function readBindings(bindingsPath) {
  try {
    const parsed = JSON.parse(readFileSync(bindingsPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBinding(bindingsPath, conversationId, paneId, now) {
  try {
    const bindings = readBindings(bindingsPath);
    if (bindings[conversationId]?.paneId === paneId) return;
    bindings[conversationId] = { paneId, at: now };
    const tmp = `${bindingsPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(bindings));
    renameSync(tmp, bindingsPath);
  } catch {
    // A lost binding only costs a re-match on the next event.
  }
}

/** Interactive Codex windows running inside TermFleet terminals. */
function codexWindows(procRoot) {
  let entries = [];
  try {
    entries = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const windows = [];
  for (const name of entries) {
    const pid = Number(name);
    const args = argv(procRoot, pid);
    if (!isProviderProcess("codex", args)) continue;
    const paneId = paneOf(procRoot, pid);
    if (!paneId || !terminalOf(procRoot, pid)) continue;
    windows.push({ pid, paneId, args, cwd: cwdOf(procRoot, pid) });
  }
  return windows;
}

export function resolveCodexPaneId({
  envPaneId,
  conversationId,
  cwd,
  selfPid = process.pid,
  procRoot = "/proc",
  bindingsPath = join(statusDir(), "codex-chat-panes.json"),
  now = Date.now(),
}) {
  const chain = [...ancestors(procRoot, selfPid)];
  const owner = chain.find((pid) => isProviderProcess("codex", argv(procRoot, pid)));
  // Hook runs inside the Codex window itself (or outside Codex, e.g. tests):
  // the inherited terminal id is the right one.
  if (!owner || terminalOf(procRoot, owner)) return envPaneId;

  if (!conversationId) return "";
  const windows = codexWindows(procRoot);
  const panes = (list) => [...new Set(list.map((window) => window.paneId))];

  const resumed = panes(windows.filter((window) => window.args.includes(conversationId)));
  if (resumed.length === 1) {
    writeBinding(bindingsPath, conversationId, resumed[0], now);
    return resumed[0];
  }

  const bindings = readBindings(bindingsPath);
  const bound = bindings[conversationId]?.paneId;
  if (bound && windows.some((window) => window.paneId === bound)) return bound;

  // Windows already known to hold a DIFFERENT chat are not candidates.
  const taken = new Set(
    Object.entries(bindings)
      .filter(([id]) => id !== conversationId)
      .map(([, value]) => value?.paneId),
  );
  const folder = normalizeCwd(cwd);
  const sameFolder = panes(
    windows.filter((window) => folder && window.cwd === folder && !taken.has(window.paneId)),
  );
  if (sameFolder.length === 1) {
    writeBinding(bindingsPath, conversationId, sameFolder[0], now);
    return sameFolder[0];
  }
  return "";
}
