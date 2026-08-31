import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const monitor = path.join(root, "scripts", "monitor-cockpit-pane-health.mjs");

test("all-pane monitor fails when any preserved terminal is visibly dead", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "termfleet-pane-health-"));
  const statusDir = path.join(fixture, "agent-status");
  mkdirSync(statusDir, { recursive: true });
  const workspace = {
    closedSessionIds: ["terminal-closed"],
    closedProviderSessionIds: ["provider-closed"],
    tabs: [{
      id: "tab-one",
      title: "Terminal",
      initialCwd: "/tmp/project",
      terminals: [
        { id: "terminal-live", paneId: "pane-live" },
        { id: "terminal-dead", paneId: "pane-dead" },
        { id: "terminal-closed", paneId: "pane-closed" },
        { id: "terminal-replaced", paneId: "pane-replaced", providerSessionId: "provider-closed" },
      ],
    }],
  };
  const snapshot = {
    sourceApp: "termfleet",
    updatedAt: Date.now(),
    terminals: [
      { terminalId: "terminal-live", paneId: "pane-live", status: "reconnected", terminalVisibleText: "saved conversation" },
      { terminalId: "terminal-dead", paneId: "pane-dead", status: "exited", terminalVisibleText: "old scrollback" },
    ],
  };
  writeFileSync(path.join(fixture, "workspace.json"), JSON.stringify(workspace));
  writeFileSync(path.join(statusDir, "termfleet-cockpit-snapshot.json"), JSON.stringify(snapshot));

  const result = spawnSync(process.execPath, [monitor, "--once"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TERMFLEET_DATA_DIR: fixture },
  });
  assert.equal(result.status, 1);
  const matrix = JSON.parse(readFileSync(path.join(statusDir, "termfleet-pane-health.json"), "utf8"));
  assert.deepEqual(matrix.counts, { expected: 2, live: 1, dead: 1, unknown: 0 });
  assert.equal(matrix.passed, false);
  assert.equal(matrix.panes.find((pane) => pane.terminalId === "terminal-dead").health, "dead");
  assert.equal(matrix.panes.some((pane) => pane.terminalId === "terminal-closed"), false);
  assert.equal(matrix.panes.some((pane) => pane.terminalId === "terminal-replaced"), false);
});

test("all-pane monitor marks stale and empty rendered evidence unknown", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "termfleet-pane-health-unknown-"));
  const statusDir = path.join(fixture, "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(path.join(fixture, "workspace.json"), JSON.stringify({
    tabs: [{ id: "tab", title: "Terminal", terminals: [{ id: "terminal", paneId: "pane" }] }],
  }));
  writeFileSync(path.join(statusDir, "termfleet-cockpit-snapshot.json"), JSON.stringify({
    sourceApp: "termfleet",
    updatedAt: Date.now() - 60_000,
    terminals: [{ terminalId: "terminal", paneId: "pane", status: "reconnected", terminalVisibleText: "" }],
  }));
  const result = spawnSync(process.execPath, [monitor, "--once"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TERMFLEET_DATA_DIR: fixture },
  });
  assert.equal(result.status, 1);
  const matrix = JSON.parse(readFileSync(path.join(statusDir, "termfleet-pane-health.json"), "utf8"));
  assert.deepEqual(matrix.panes[0].reasons, ["snapshot-stale", "screen-empty"]);
  assert.equal(matrix.panes[0].health, "unknown");
});

test("all-pane monitor treats a preserved agent pane that fell back to an idle shell as dead", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "termfleet-pane-health-shell-fallback-"));
  const statusDir = path.join(fixture, "agent-status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(path.join(fixture, "workspace.json"), JSON.stringify({
    tabs: [{
      id: "saved-agent-tab",
      title: "lifeboat-live",
      terminals: [{
        id: "terminal-saved-agent",
        paneId: "saved-agent-pane",
        providerSessionId: "019f-exact-provider-session",
      }],
    }],
  }));
  writeFileSync(path.join(statusDir, "termfleet-cockpit-snapshot.json"), JSON.stringify({
    sourceApp: "termfleet",
    updatedAt: Date.now(),
    terminals: [{
      terminalId: "terminal-saved-agent",
      paneId: "saved-agent-pane",
      status: "reconnected",
      terminalVisibleText: "endlessblink@endlessblink:/repo/lifeboat-live$ ",
    }],
  }));

  const result = spawnSync(process.execPath, [monitor, "--once"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TERMFLEET_DATA_DIR: fixture },
  });
  assert.equal(result.status, 1);
  const matrix = JSON.parse(readFileSync(path.join(statusDir, "termfleet-pane-health.json"), "utf8"));
  assert.deepEqual(matrix.counts, { expected: 1, live: 0, dead: 1, unknown: 0 });
  assert.equal(matrix.panes[0].health, "dead");
  assert.deepEqual(matrix.panes[0].reasons, ["idle-shell-fallback"]);
});
