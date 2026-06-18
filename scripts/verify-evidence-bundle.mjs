#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEvidenceBundle, main as exportEvidenceBundleMain } from "./export-evidence-bundle.mjs";

function encodeId(id) {
  return Buffer.from(id, "utf8").toString("hex");
}

function writeFixture(root) {
  const sessionsDir = path.join(root, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionId = "terminal-agent-pane-a";
  const encoded = encodeId(sessionId);
  fs.writeFileSync(path.join(sessionsDir, `${encoded}.scrollback`), Buffer.alloc(40));
  fs.writeFileSync(
    path.join(sessionsDir, `${encoded}.meta.json`),
    JSON.stringify({ cwd: "/home/alice/private/project", command: "npm run dev --token=ghp_secretvalue" })
  );
  fs.writeFileSync(
    path.join(root, "workspace.json"),
    JSON.stringify({
      activeTabId: "agent-tab",
      projectRoot: "/home/alice/private/project",
      tabs: [
        {
          id: "agent-tab",
          title: "Agent run",
          initialCwd: "/home/alice/private/project",
          terminals: [{
            id: sessionId,
            paneId: "pane-a",
            cols: 120,
            rows: 30,
            status: "running",
            previewUrl: "http://127.0.0.1:5177",
          }],
          splitLayout: { id: "pane-a", type: "terminal" },
          activePaneId: "pane-a",
          workstream: {
            kind: "agent",
            provider: "codex",
            mission: "Ship demo proof",
            cwd: "/home/alice/private/project",
            status: "running",
            phase: "active",
            currentActivity: "Running npm run build",
            evidence: "npm run build passed with sk-secret123456789",
            statusSummary: {
              task: "Ship demo proof",
              path: "/home/alice/private/project",
              now: "Running npm run build",
              status: "working",
              provider: "codex",
              proof: "Need screenshot",
            },
            createdAt: 1000,
          },
        },
      ],
      canvasState: {
        nodes: [
          {
            id: "node-a",
            type: "terminal",
            title: "Demo terminal",
            terminalTabId: "agent-tab",
            taskBinding: {
              taskId: "TC-021",
              planPath: "/home/alice/private/project/MASTER_PLAN.md",
            },
          },
          {
            id: "preview-a",
            type: "preview",
            title: "Preview",
            previewUrl: "http://localhost:3000",
          },
        ],
      },
    })
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "termfleet-evidence-"));
try {
  writeFixture(root);
  const env = {
    TERMFLEET_DATA_DIR: root,
    TERMFLEET_DAEMON_SOCKET: path.join(root, "missing.sock"),
  };
  const bundle = await createEvidenceBundle({
    env,
    commands: ["npm run build", "npm run verify:map-terminals"],
  });
  const serialized = JSON.stringify(bundle);
  assert.match(serialized, /<path:\.\.\.\//);
  assert.doesNotMatch(serialized, /\/home\/alice/);
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serialized, /ghp_secretvalue|sk-secret123456789/);
  assert.deepEqual(bundle.previewUrls, ["http://127.0.0.1:5177", "http://localhost:3000"]);
  assert.equal(bundle.taskBindings[0].taskId, "TC-021");
  assert.equal(bundle.agents.agents[0].mission, "Ship demo proof");
  assert.match(bundle.agents.agents[0].evidence, /<redacted-token>/);

  const out = path.join(root, "bundle.md");
  await exportEvidenceBundleMain(["--out", out, "--command", "npm run build"], env);
  const markdown = fs.readFileSync(out, "utf8");
  assert.match(markdown, /# TermFleet Evidence Bundle/);
  assert.match(markdown, /npm run build/);
  assert.match(markdown, /http:\/\/localhost:3000/);
  assert.doesNotMatch(markdown, /\/home\/alice/);

  console.log("evidence bundle verification passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
