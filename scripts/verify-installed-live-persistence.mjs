#!/usr/bin/env node

import { collectSessions, loadWorkspace } from "./termfleetctl.mjs";

const dataRoot = process.env.TERMFLEET_DATA_DIR;
const { workspace, path: workspacePath } = loadWorkspace(dataRoot);
const sessionReport = await collectSessions({ dataRoot });
const liveIds = new Set(
  sessionReport.sessions
    .filter((session) => session.sources?.includes("live"))
    .map((session) => session.id),
);
const activeIds = new Set(
  (workspace.tabs ?? []).flatMap((tab) => (tab.terminals ?? []).map((terminal) => terminal.id)),
);
const closedIds = new Set(workspace.closedSessionIds ?? []);
// The daemon intentionally outlives the renderer and can contain historical
// sessions from older workspace generations. The restart contract is about the
// panes that are active in the current durable workspace, not every old PTY the
// daemon has ever retained. Treat the workspace as the source of truth for the
// expected set, while still rejecting a session that was explicitly closed.
const missingIds = [...activeIds].filter((id) => !liveIds.has(id));
const resurrectedIds = [...liveIds].filter((id) => activeIds.has(id) && closedIds.has(id));
const historicalLiveIds = [...liveIds].filter((id) => !activeIds.has(id));

if (missingIds.length || resurrectedIds.length) {
  console.error(JSON.stringify({ workspacePath, missingIds, resurrectedIds, historicalLiveIds }, null, 2));
  process.exit(1);
}

console.log(
  `INSTALLED_LIVE_PERSISTENCE_OK active=${activeIds.size} live=${liveIds.size} historical=${historicalLiveIds.length} closed=${closedIds.size}`,
);
