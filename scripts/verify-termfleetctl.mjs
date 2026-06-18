#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectAgents,
  collectSessions,
  collectTermfleetStatus,
  listPersistedSessions,
} from "./termfleetctl.mjs";

function encodeId(id) {
  return Buffer.from(id, "utf8").toString("hex");
}

function writeFixture(root) {
  fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
  const sessionId = "terminal-11111111-1111-4111-8111-111111111111-pane-a";
  const encoded = encodeId(sessionId);
  fs.writeFileSync(path.join(root, "sessions", `${encoded}.scrollback`), Buffer.alloc(32));
  fs.writeFileSync(
    path.join(root, "sessions", `${encoded}.meta.json`),
    JSON.stringify({ cwd: "/work/demo", command: "bash" })
  );
  fs.writeFileSync(
    path.join(root, "workspace.json"),
    JSON.stringify({
      activeTabId: "agent-tab",
      projectRoot: "/work/demo",
      tabs: [
        {
          id: "agent-tab",
          title: "Fix login",
          initialCwd: "/work/demo",
          terminals: [{ id: sessionId, paneId: "pane-a", cols: 120, rows: 30 }],
          workstream: {
            kind: "agent",
            provider: "codex",
            role: "Codex",
            mission: "Fix login",
            cwd: "/work/demo",
            cwdLabel: "demo",
            gitRoot: "/work/demo",
            gitBranch: "main",
            gitDirty: false,
            worktreePath: "/work/demo",
            isolationMode: "shared-worktree",
            isolationStatus: "shared",
            worktreeCleanupStatus: "not-needed",
            status: "running",
            phase: "active",
            currentActivity: "Editing auth callback",
            activityKind: "editing",
            lastSummary: "Auth callback patched",
            nextAction: "Run browser smoke",
            evidence: "tests pending",
            memory: "OAuth mismatch found",
            promptCount: 1,
            sentCount: 1,
            signalCount: 2,
            controlCount: 0,
            runId: "codex-123",
            createdAt: 1000,
            activityUpdatedAt: 2000,
            statusSummary: {
              task: "Fix login",
              path: "/work/demo",
              now: "Editing auth callback",
              status: "working",
              provider: "codex",
              confidence: "medium",
              proof: "Need browser smoke",
            },
          },
        },
      ],
    })
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "termfleetctl-"));
try {
  writeFixture(root);
  const env = {
    TERMFLEET_DATA_DIR: root,
    TERMFLEET_DAEMON_SOCKET: path.join(root, "missing.sock"),
  };

  const persisted = listPersistedSessions(root);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].cwd, "/work/demo");
  assert.equal(persisted[0].scrollbackBytes, 24);

  const status = await collectTermfleetStatus({ env });
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.daemon.reachable, false);
  assert.equal(status.workspace.loaded, true);
  assert.deepEqual(status.counts, {
    liveSessions: 0,
    persistedSessions: 1,
    sessions: 1,
    agents: 1,
  });

  const sessions = await collectSessions({ env });
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].id, persisted[0].id);
  assert.deepEqual(sessions.sessions[0].sources, ["persisted"]);

  const agents = await collectAgents({ env });
  assert.equal(agents.agents.length, 1);
  assert.equal(agents.agents[0].runId, "codex-123");
  assert.equal(agents.agents[0].mission, "Fix login");
  assert.equal(agents.agents[0].proof, "Need browser smoke");
  assert.deepEqual(agents.agents[0].terminalIds, [persisted[0].id]);

  console.log("termfleetctl contract verification passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
