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
const durableIds = new Set(
  (workspace.tabs ?? []).flatMap((tab) => (tab.terminals ?? []).map((terminal) => terminal.id)),
);
const closedIds = new Set(workspace.closedSessionIds ?? []);
const missingIds = [...liveIds].filter((id) => !durableIds.has(id));
const resurrectedIds = [...liveIds].filter((id) => closedIds.has(id));

if (missingIds.length || resurrectedIds.length) {
  console.error(JSON.stringify({ workspacePath, missingIds, resurrectedIds }, null, 2));
  process.exit(1);
}

console.log(
  `INSTALLED_LIVE_PERSISTENCE_OK durable=${durableIds.size} live=${liveIds.size} closed=${closedIds.size}`,
);
