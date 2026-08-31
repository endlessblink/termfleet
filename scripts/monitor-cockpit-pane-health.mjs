#!/usr/bin/env node
// Lightweight, continuous all-pane visibility for agents and recovery gates.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.TERMFLEET_DATA_DIR
  || path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME, ".local", "share"), "terminal-workspace");
const statusDir = process.env.TERMFLEET_STATUS_DIR || path.join(dataDir, "agent-status");
const snapshotPath = process.env.TERMFLEET_COCKPIT_SNAPSHOT_PATH || path.join(statusDir, "termfleet-cockpit-snapshot.json");
const workspacePath = process.env.TERMFLEET_WORKSPACE_PATH || path.join(dataDir, "workspace.json");
const outputPath = process.env.TERMFLEET_PANE_HEALTH_PATH || path.join(statusDir, "termfleet-pane-health.json");
const intervalMs = Math.max(500, Number(process.env.TERMFLEET_PANE_HEALTH_INTERVAL_MS || 2_000));
const snapshotMaxAgeMs = Math.max(2_000, Number(process.env.TERMFLEET_PANE_HEALTH_MAX_AGE_MS || 10_000));
const once = process.argv.includes("--once") || process.argv.includes("--health-once");

mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function looksLikeIdleShellPrompt(screen) {
  const lines = String(screen || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const lastLine = lines.at(-1) || "";
  return /^[^\s@]+@[^\s:]+:.*(?:[$#])\s*$/.test(lastLine)
    || /^(?:>|❯|➜)\s*$/.test(lastLine);
}

function durableTargets(workspace) {
  const closed = new Set(workspace.closedSessionIds || []);
  const closedProviders = new Set(workspace.closedProviderSessionIds || []);
  return (workspace.tabs || [])
    .filter((tab) => !String(tab.id || "").startsWith("recovered-tab-"))
    .flatMap((tab) => (tab.terminals || []).map((terminal) => ({
      tabId: tab.id,
      tabTitle: tab.title,
      terminalId: terminal.id,
      paneId: terminal.paneId,
      cwd: tab.initialCwd || "",
      expectedProviderSessionId: terminal.providerSessionId || null,
      intentionallyClosed: closed.has(terminal.id)
        || closed.has(`terminal-${tab.id}-${terminal.paneId}`)
        || (terminal.providerSessionId && closedProviders.has(terminal.providerSessionId))
        || terminal.manualStopRequested === true
        || terminal.recoveryLifecycle === "closed-by-user",
    })))
    .filter((target) => !target.intentionallyClosed);
}

function buildMatrix(workspace, snapshot, nowMs = Date.now()) {
  const snapshotAgeMs = nowMs - Number(snapshot.updatedAt || 0);
  const snapshotFresh = snapshot.sourceApp === "termfleet"
    && snapshotAgeMs >= 0
    && snapshotAgeMs <= snapshotMaxAgeMs;
  const rendered = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
  const panes = durableTargets(workspace).map((target) => {
    const visible = rendered.find((pane) =>
      pane.terminalId === target.terminalId
      || pane.paneId === target.terminalId
      || pane.paneId === target.paneId);
    const status = String(visible?.status || "missing");
    const visibleScreen = String(visible?.terminalVisibleText || "");
    const reasons = [];
    if (!snapshotFresh) reasons.push("snapshot-stale");
    if (!visible) reasons.push("pane-missing");
    if (["exited", "failed", "stale"].includes(status)) reasons.push(`status-${status}`);
    if (visible && !visibleScreen.trim()) reasons.push("screen-empty");
    if (
      visible &&
      target.expectedProviderSessionId &&
      !["exited", "failed", "stale"].includes(status) &&
      looksLikeIdleShellPrompt(visibleScreen)
    ) {
      reasons.push("idle-shell-fallback");
    }
    const health = reasons.some((reason) => reason === "pane-missing" || reason.startsWith("status-"))
      || reasons.includes("idle-shell-fallback")
      ? "dead"
      : reasons.length
        ? "unknown"
        : "live";
    return {
      ...target,
      health,
      reasons,
      status,
      visibleScreen,
      visibleScreenUpdatedAt: visible?.terminalVisibleTextUpdatedAt || null,
      task: visible?.task || "",
      now: visible?.now || "",
      nativeCapture: visible?.nativeCapture || snapshot.nativeCaptures?.[visible?.paneId] || null,
    };
  });
  return {
    schemaVersion: 1,
    source: "termfleet-live-pane-health",
    updatedAt: nowMs,
    snapshotUpdatedAt: Number(snapshot.updatedAt || 0),
    snapshotAgeMs,
    counts: {
      expected: panes.length,
      live: panes.filter((pane) => pane.health === "live").length,
      dead: panes.filter((pane) => pane.health === "dead").length,
      unknown: panes.filter((pane) => pane.health === "unknown").length,
    },
    passed: panes.length > 0 && panes.every((pane) => pane.health === "live"),
    panes,
  };
}

function writeMatrix() {
  if (!existsSync(workspacePath)) throw new Error(`workspace missing: ${workspacePath}`);
  if (!existsSync(snapshotPath)) throw new Error(`cockpit snapshot missing: ${snapshotPath}`);
  const matrix = buildMatrix(readJson(workspacePath), readJson(snapshotPath));
  const temporary = `${outputPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(matrix, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
  const summary = `expected=${matrix.counts.expected} live=${matrix.counts.live} dead=${matrix.counts.dead} unknown=${matrix.counts.unknown}`;
  console.log(`${matrix.passed ? "TERMFLEET_PANE_HEALTH_OK" : "TERMFLEET_PANE_HEALTH_FAIL"} ${summary} output=${outputPath}`);
  return matrix.passed;
}

do {
  try {
    if (!writeMatrix() && once) process.exitCode = 1;
  } catch (error) {
    console.error(`TERMFLEET_PANE_HEALTH_FAIL ${error instanceof Error ? error.message : String(error)}`);
    if (once) process.exitCode = 1;
  }
  if (!once) await new Promise((resolve) => setTimeout(resolve, intervalMs));
} while (!once);
