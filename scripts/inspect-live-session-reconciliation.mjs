#!/usr/bin/env node

import { collectSessions, loadWorkspace } from "./termfleetctl.mjs";

const dataRoot = process.env.TERMFLEET_DATA_DIR;
const workspaceInfo = loadWorkspace(dataRoot);
const workspace = workspaceInfo.workspace ?? {};
const sessions = await collectSessions({ dataRoot });
const workspaceIds = new Set(
  (workspace.tabs ?? []).flatMap((tab) => (tab.terminals ?? []).map((terminal) => terminal.id)),
);
const closedIds = new Set(workspace.closedSessionIds ?? []);
const live = sessions.sessions.filter((session) => (session.sources ?? []).includes("live"));

console.log(JSON.stringify({
  workspaceTerminalCount: workspaceIds.size,
  closedSessionCount: closedIds.size,
  liveSessionCount: live.length,
  closedLive: live
    .filter((session) => closedIds.has(session.id))
    .map(({ id, cwd, command }) => ({ id, cwd, command })),
  unattachedLive: live
    .filter((session) => !workspaceIds.has(session.id) && !closedIds.has(session.id))
    .map(({ id, cwd, command }) => ({ id, cwd, command })),
  unattachedPersisted: sessions.sessions
    .filter((session) =>
      (session.sources ?? []).includes("persisted") &&
      !workspaceIds.has(session.id) &&
      !closedIds.has(session.id),
    )
    .map(({ id, cwd, command, scrollbackBytes }) => ({ id, cwd, command, scrollbackBytes })),
}, null, 2));
