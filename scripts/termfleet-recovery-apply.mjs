#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { defaultDataRoot, defaultDaemonSocket, requestDaemon } from "./termfleetctl.mjs";
import { updateRuntimeRegistry } from "./termfleet-runtime-controller.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const dataRoot = defaultDataRoot();
const lockPath = path.join(dataRoot, "recovery-controller.lock");
const coordinator = path.join(root, "scripts", "termfleet-recovery-coordinator.mjs");
const apply = process.argv.includes("--apply");

function freshPlan() {
  const raw = execFileSync(process.execPath, [coordinator], { encoding: "utf8", cwd: root });
  return JSON.parse(raw);
}

function selected(plan) {
  return plan.plan
    .map((project) => ({ project: project.project, cwd: project.cwd, selected: project.selected }))
    .filter(({ selected: item }) => item);
}

function runningDesktopPids() {
  if (process.env.TERMFLEET_RECOVERY_ALLOW_LIVE_DOCK === "1") return [];
  let entries = [];
  try {
    entries = fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry));
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const pid = Number(entry);
    if (pid === process.pid) return [];
    try {
      const command = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ").trim();
      if (!/\/termfleet(?:\s|$)/.test(command) || command.includes("--terminal-workspace-daemon")) return [];
      return [pid];
    } catch {
      return [];
    }
  });
}

function bindWorkspace(targets, workspacePath) {
  const workspace = JSON.parse(fs.readFileSync(workspacePath, "utf8"));
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs.map((tab) => ({ ...tab, terminals: [...(tab.terminals ?? [])] })) : [];
  for (const { project, cwd, selected: item } of targets) {
    const targetSessionId = item.providerOwner?.sessionId ?? item.paneId;
    let tab = tabs.find((candidate) => candidate.terminals.some((terminal) => terminal.providerSessionId === item.providerSessionId));
    tab ??= tabs.find((candidate) => candidate.initialCwd === cwd && candidate.terminals.some((terminal) => terminal.agentProvider === item.provider && !terminal.providerSessionId));
    tab ??= tabs.find((candidate) => candidate.initialCwd === cwd);
    if (!tab) {
      const paneId = randomUUID();
      tab = {
        id: `recovered-tab-${targetSessionId}`,
        title: project,
        emoji: "⬛",
        color: "#7aa2f7",
        groupId: null,
        initialCwd: cwd,
        terminals: [{ id: targetSessionId, paneId, cols: 118, rows: 33, status: "starting", reused: true, recoveryLifecycle: "alive", agentProvider: item.provider, providerSessionId: item.providerSessionId }],
        splitLayout: { id: paneId, type: "terminal", cwd },
        activePaneId: paneId,
      };
      tabs.push(tab);
      continue;
    }
    let terminal = tab.terminals.find((candidate) => candidate.providerSessionId === item.providerSessionId);
    terminal ??= tab.terminals.find((candidate) => candidate.agentProvider === item.provider && !candidate.providerSessionId);
    terminal ??= tab.terminals[0];
    if (!terminal) {
      const paneId = randomUUID();
      terminal = { id: targetSessionId, paneId, cols: 118, rows: 33, status: "starting", reused: true, recoveryLifecycle: "alive", agentProvider: item.provider, providerSessionId: item.providerSessionId };
      tab.terminals.push(terminal);
      tab.splitLayout = { id: paneId, type: "terminal", cwd };
      tab.activePaneId = paneId;
    } else {
      Object.assign(terminal, { id: targetSessionId, status: "starting", reused: true, recoveryLifecycle: "alive", agentProvider: item.provider, providerSessionId: item.providerSessionId, lastError: undefined, manualStopRequested: false });
    }
    tab.initialCwd = cwd;
  }
  // A previous recovery pass can leave two UI records for one provider
  // conversation. Keep the exact daemon owner (or the first durable record)
  // and remove only duplicate single-pane tabs; this never kills the daemon
  // session or its provider writer.
  for (const { selected: item } of targets) {
    const targetSessionId = item.providerOwner?.sessionId ?? item.paneId;
    const matches = [];
    tabs.forEach((tab, tabIndex) => {
      tab.terminals.forEach((terminal, terminalIndex) => {
        if (terminal.providerSessionId === item.providerSessionId) matches.push({ tabIndex, terminalIndex, terminal });
      });
    });
    const keeper = matches.find((match) => match.terminal.id === targetSessionId) ?? matches[0];
    if (!keeper) continue;
    const duplicateTabIndexes = new Set(
      matches
        .filter((match) => match !== keeper && tabs[match.tabIndex].terminals.length === 1)
        .map((match) => match.tabIndex),
    );
    for (let index = tabs.length - 1; index >= 0; index -= 1) {
      if (duplicateTabIndexes.has(index)) tabs.splice(index, 1);
    }
  }
  const backupPath = `${workspacePath}.before-recovery-bind-${Date.now()}`;
  fs.copyFileSync(workspacePath, backupPath);
  const tempPath = `${workspacePath}.recovery-bind-${process.pid}.tmp`;
  const restoredProviderIds = new Set(targets.map(({ selected: item }) => item.providerSessionId));
  const closedProviderSessionIds = (workspace.closedProviderSessionIds ?? [])
    .filter((providerSessionId) => !restoredProviderIds.has(providerSessionId));
  fs.writeFileSync(tempPath, `${JSON.stringify({ ...workspace, tabs, closedProviderSessionIds }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, workspacePath);
  return { backupPath, tabs: tabs.length };
}

const initial = freshPlan();
const targets = selected(initial);
const summary = { mode: apply ? "apply" : "plan", targets: targets.map(({ project, selected: item }) => ({
  project,
  provider: item.provider,
  providerSessionId: item.providerSessionId,
  paneId: item.paneId,
  liveOwner: item.providerOwner?.sessionId ?? null,
  decision: item.decision,
})) };
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (!apply) process.exit(0);

let lock;
try {
  const desktopPids = runningDesktopPids();
  if (desktopPids.length > 0) {
    throw new Error(`TermFleet dock is running (pid ${desktopPids.join(", ")}); close the dock before applying recovery`);
  }
  lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }));
} catch (error) {
  console.error(`BLOCKED: recovery controller is already running (${error.message})`);
  process.exit(2);
}

try {
  const plan = freshPlan();
  const currentTargets = selected(plan);
  if (currentTargets.length !== targets.length || currentTargets.some(({ project, selected: item }) => {
    const before = targets.find((candidate) => candidate.project === project)?.selected;
    return !before || before.provider !== item.provider || before.providerSessionId !== item.providerSessionId || item.decision !== "restore-exact" || item.explicitlyKilled;
  })) {
    throw new Error("recovery plan changed or is no longer exact/eligible; refusing apply");
  }

  const socket = defaultDaemonSocket();
  const results = [];
  for (const { project, selected: item } of currentTargets) {
    const owner = item.providerOwner;
    if (owner) {
      const live = await requestDaemon({ type: "listSessions" }, socket);
      const session = live.ok ? live.value?.sessions?.find((candidate) => candidate.id === owner.sessionId && candidate.pid) : null;
      if (!session) throw new Error(`${project}: unique provider owner disappeared before attach`);
      results.push({ project, action: "attach-existing", sessionId: owner.sessionId, provider: item.provider, providerSessionId: item.providerSessionId });
      continue;
    }
    const command = item.exactResume;
    if (!command) throw new Error(`${project}: exact resume command is missing`);
    const response = await requestDaemon({
      type: "ensureSession",
      id: item.paneId,
      cwd: item.daemonCwd ?? undefined,
      command,
      cols: 118,
      rows: 33,
    }, socket);
    if (!response.ok || response.value?.id !== item.paneId) {
      throw new Error(`${project}: exact provider session was not started: ${response.error ?? JSON.stringify(response.value)}`);
    }
    results.push({ project, action: "resume-exact", sessionId: item.paneId, provider: item.provider, providerSessionId: item.providerSessionId });
  }
  const binding = bindWorkspace(currentTargets, path.join(dataRoot, "workspace.json"));
  for (const result of results) {
    const target = currentTargets.find(({ project }) => project === result.project)?.selected;
    if (!target) continue;
    updateRuntimeRegistry(path.join(dataRoot, "runtime-registry.json"), {
      kind: "restore-exact",
      paneId: target.paneId,
      provider: target.provider,
      providerSessionId: target.providerSessionId,
      cwd: target.daemonCwd ?? null,
      daemonSessionId: result.sessionId,
    });
  }
  process.stdout.write(`${JSON.stringify({ applied: results, binding })}\n`);
} finally {
  if (lock !== undefined) {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}
