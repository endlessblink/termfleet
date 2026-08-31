#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultDataRoot, defaultDaemonSocket, requestDaemon } from "./termfleetctl.mjs";

const dataRoot = defaultDataRoot();
const workspacePath = path.join(dataRoot, "workspace.json");
const workspace = JSON.parse(fs.readFileSync(workspacePath, "utf8"));
const response = await requestDaemon({ type: "listSessions" }, defaultDaemonSocket());
if (!response.ok || response.value?.type !== "listSessions") {
  throw new Error(`TermFleet daemon is unavailable: ${response.error ?? "unexpected response"}`);
}

const closed = new Set(Array.isArray(workspace.closedSessionIds) ? workspace.closedSessionIds : []);
const closedProviders = new Set(Array.isArray(workspace.closedProviderSessionIds) ? workspace.closedProviderSessionIds : []);
const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
const groups = Array.isArray(workspace.groups) ? workspace.groups : [];
const liveSessions = (response.value.sessions ?? []).map((session) => ({
  id: session.id,
  cwd: session.initialCwd ?? null,
  providerSessionId: session.providerSessionId ?? providerSessionIdFromCommand(session.command),
  command: session.command ?? "",
}));

function providerSessionIdFromCommand(command) {
  return command?.match(/(?:codex\s+(?:resume)|claude\s+(?:--resume|resume))\s+([0-9a-f-]{36})/i)?.[1] ?? null;
}

function leaves(node) {
  return node?.type === "split" ? (node.children ?? []).flatMap(leaves) : node?.id ? [node.id] : [];
}

function splitTree(node, targetId, paneId, cwd) {
  if (node?.id === targetId && node.type !== "split") {
    return {
      id: randomUUID(),
      type: "split",
      direction: "horizontal",
      children: [node, { id: paneId, type: "terminal", cwd }],
      sizes: [50, 50],
    };
  }
  if (node?.children) return { ...node, children: node.children.map((child) => splitTree(child, targetId, paneId, cwd)) };
  return node;
}

function terminalFor(session) {
  const parts = canonicalParts(session.id);
  return {
    id: session.id,
    paneId: parts?.paneId ?? `recovered-pane-${session.id}`,
    cols: 80,
    rows: 24,
    status: "starting",
    reused: true,
  };
}

function canonicalParts(id) {
  const match = /^terminal-([0-9a-f-]{36})-([0-9a-f-]{36})$/i.exec(id);
  return match ? { tabId: match[1], paneId: match[2] } : null;
}

function groupForCwd(cwd) {
  return groups
    .filter((group) => typeof group.projectRoot === "string" && cwd?.startsWith(`${group.projectRoot}/`))
    .sort((a, b) => b.projectRoot.length - a.projectRoot.length)[0]?.id ?? null;
}

let restored = 0;
const skipped = [];
for (const session of liveSessions) {
  if (closed.has(session.id)) continue;
  if (session.providerSessionId && closedProviders.has(session.providerSessionId)) continue;
  if (tabs.some((tab) => (tab.terminals ?? []).some((terminal) => terminal.id === session.id))) continue;
  const parts = canonicalParts(session.id);
  if (!session.cwd) {
    skipped.push(session.id);
    continue;
  }

  if (!parts) {
    const tabId = `recovered-tab-${session.id}`;
    const paneId = `recovered-pane-${session.id}`;
    tabs.push({
      id: tabId,
      title: path.basename(session.cwd) || "Recovered terminal",
      emoji: "⬛",
      color: "#7aa2f7",
      groupId: groupForCwd(session.cwd),
      initialCwd: session.cwd,
      terminals: [{ ...terminalFor(session), paneId }],
      splitLayout: { id: paneId, type: "terminal", cwd: session.cwd },
      activePaneId: paneId,
    });
    restored += 1;
    continue;
  }

  let tab = tabs.find((candidate) => candidate.id === parts.tabId);
  if (!tab) {
    const terminal = terminalFor(session);
    tab = {
      id: parts.tabId,
      title: path.basename(session.cwd) || "Terminal",
      emoji: "⬛",
      color: "#7aa2f7",
      groupId: groupForCwd(session.cwd),
      initialCwd: session.cwd,
      terminals: [terminal],
      splitLayout: { id: parts.paneId, type: "terminal", cwd: session.cwd },
      activePaneId: parts.paneId,
    };
    tabs.push(tab);
    restored += 1;
    continue;
  }

  const currentLeaves = leaves(tab.splitLayout);
  const existingTerminal = (tab.terminals ?? []).find((terminal) => terminal.paneId === parts.paneId);
  if (existingTerminal) {
    existingTerminal.id = session.id;
  } else {
    if (!currentLeaves.includes(parts.paneId)) {
      const target = currentLeaves.includes(tab.activePaneId) ? tab.activePaneId : currentLeaves[0];
      if (!target) continue;
      tab.splitLayout = splitTree(tab.splitLayout, target, parts.paneId, session.cwd);
    }
    tab.terminals = [...(tab.terminals ?? []).filter((terminal) => leaves(tab.splitLayout).includes(terminal.paneId)), terminalFor(session)];
  }
  restored += 1;
}

const backupPath = `${workspacePath}.before-live-restore-${Date.now()}`;
fs.copyFileSync(workspacePath, backupPath);
const tempPath = `${workspacePath}.restore-tmp-${process.pid}`;
fs.writeFileSync(tempPath, `${JSON.stringify({ ...workspace, tabs }, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tempPath, workspacePath);
console.log(JSON.stringify({ restored, skipped: skipped.length, backupPath, tabs: tabs.length, terminals: tabs.reduce((total, tab) => total + (tab.terminals?.length ?? 0), 0) }));
