#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { decideRecovery } from "./termfleet-runtime-controller.mjs";
import { loadRuntimeRegistry } from "./termfleet-runtime-controller.mjs";

const dataRoot = process.env.TERMFLEET_DATA_ROOT ?? path.join(process.env.XDG_DATA_HOME ?? path.join(process.env.HOME, ".local", "share"), "terminal-workspace");
const statusRoot = path.join(dataRoot, "agent-status");
const lifecyclePath = path.join(dataRoot, "sessions", "terminal-lifecycle.jsonl");
const workspacePath = path.join(dataRoot, "workspace.json");
const runtimeRegistryPath = path.join(dataRoot, "runtime-registry.json");

function providerSessionIdFromCommand(command) {
  const match = String(command ?? "").match(/(?:^|\s)(?:resume|--resume)\s+['"]?([A-Za-z0-9-]{12,})/i);
  return match?.[1] ?? null;
}

const daemonSessions = process.env.TERMFLEET_RECOVERY_DAEMON_SESSIONS_JSON
  ? new Map(JSON.parse(process.env.TERMFLEET_RECOVERY_DAEMON_SESSIONS_JSON).map((session) => [session.id, { cwd: session.cwd ?? session.initialCwd ?? null, command: session.command ?? null, pid: session.pid ?? null, live: session.pid === undefined || (Number.isInteger(session.pid) && session.pid > 0), providerSessionId: providerSessionIdFromCommand(session.command) }]))
  : process.env.TERMFLEET_RECOVERY_SKIP_DAEMON_IDENTITY === "1"
  ? null
  : (() => {
      try {
        const raw = execFileSync("node", [path.join(process.cwd(), "scripts", "termfleetctl.mjs"), "sessions", "list", "--json"], { encoding: "utf8" });
        return new Map((JSON.parse(raw).sessions ?? []).map((session) => [session.id, { cwd: session.cwd ?? session.initialCwd ?? null, command: session.command ?? null, pid: session.pid ?? null, live: session.pid !== null && Number.isInteger(session.pid) && session.pid > 0, providerSessionId: providerSessionIdFromCommand(session.command) }]));
      } catch {
        return null;
      }
    })();
// Workspace aliases are operator-supplied, e.g.
//   TERMFLEET_RECOVERY_PROJECTS_JSON='[["notes","/srv/notes"]]'
const projects = new Map(JSON.parse(process.env.TERMFLEET_RECOVERY_PROJECTS_JSON ?? "[]"));
const codexLockRoot = process.env.TERMFLEET_CODEX_LOCK_ROOT ?? path.join(process.env.HOME ?? "", ".codex", "thread-writer-locks");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writerLockPath(provider, providerSessionId) {
  if (provider !== "codex" || !providerSessionId) return null;
  return path.join(codexLockRoot, `${providerSessionId}.lock`);
}

function writerLockIsHeld(lockPath) {
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const fdRoot = path.join("/proc", entry, "fd");
      for (const fd of fs.readdirSync(fdRoot)) {
        try {
          if (fs.readlinkSync(path.join(fdRoot, fd)) === lockPath) return true;
        } catch {}
      }
    }
  } catch {}
  return false;
}

function writerLockIsStale(lockPath) {
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    return ageMs > 30_000 && !writerLockIsHeld(lockPath);
  } catch {
    return false;
  }
}

function exactResumeCommand(provider, providerSessionId) {
  if (!provider || !providerSessionId) return null;
  return provider === "claude"
    ? `claude --resume ${providerSessionId}`
    : `${provider} resume ${providerSessionId}`;
}

function providerFromCommand(command) {
  const value = String(command ?? "").toLowerCase();
  if (/\bclaude(?:\s|$)/.test(value)) return "claude";
  if (/\bcodex(?:\s|$)/.test(value)) return "codex";
  return null;
}

const explicitKills = new Map();
const explicitProviderKills = new Set();
if (fs.existsSync(lifecyclePath)) {
  for (const line of fs.readFileSync(lifecyclePath, "utf8").split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.kind === "recovery-held-review" && event.reason === "intentional-kill" && event.userRequested === true) {
        explicitKills.set(event.id, Math.max(explicitKills.get(event.id) ?? 0, event.atMs ?? 0));
        if (event.providerSessionId) explicitProviderKills.add(event.providerSessionId);
      }
    } catch {}
  }
}

const workspace = readJson(workspacePath) ?? {};
const runtimeRegistry = loadRuntimeRegistry(runtimeRegistryPath);
// Raw provider tombstones are a legacy cache and may have been written by a
// broad cleanup. Only an explicit user-close lifecycle event is authoritative.
const closedProviders = explicitProviderKills;
const candidates = [];
for (const file of fs.readdirSync(statusRoot).filter((name) => name.startsWith("pane-") && name.endsWith(".json"))) {
  const item = readJson(path.join(statusRoot, file));
  if (!item) continue;
  const project = [...projects.entries()].find(([, cwd]) => item.cwd === cwd)?.[0];
  if (!project) continue;
  const activeAt = Math.max(item.updatedAt ?? 0, item.turnEventAt ?? 0);
  const killedAt = explicitKills.get(item.paneId) ?? 0;
  const daemonIdentity = daemonSessions?.get(item.paneId) ?? null;
  const daemonCwd = daemonIdentity?.cwd ?? null;
  const daemonCommand = daemonIdentity?.command ?? null;
  const daemonProvider = providerFromCommand(daemonCommand);
  const provider = item.provider === "claude" || item.provider === "codex" ? item.provider : null;
  const providerSessionId = item.providerSessionId ?? item.sessionId ?? null;
  const controllerRecord = runtimeRegistry.panes?.[item.paneId] ?? null;
  const daemonLive = daemonIdentity?.live === true;
  const conversationOwners = daemonSessions === null || !providerSessionId
    ? []
    : [...daemonSessions.entries()]
      .filter(([, identity]) => identity.live && identity.providerSessionId === providerSessionId)
      .map(([sessionId, identity]) => ({ sessionId, ...identity }));
  // The daemon command can omit the provider conversation id while the pane
  // itself is still the exact owner. Trust that binding only when the daemon
  // pane, cwd, and provider all agree; never infer it from cwd alone.
  const paneOwner = daemonIdentity?.live === true
    && daemonCwd === item.cwd
    && daemonCommand !== null
    && (!daemonProvider || daemonProvider === provider)
    ? [{ sessionId: item.paneId, ...daemonIdentity }]
    : [];
  const registryDaemonOwner = controllerRecord?.liveOwner
    ? daemonSessions?.get(controllerRecord.liveOwner) ?? null
    : null;
  const registryOwner = controllerRecord?.lifecycle === "alive"
    && controllerRecord.providerSessionId === providerSessionId
    && registryDaemonOwner?.live === true
    && controllerRecord.liveOwner
    ? [{ sessionId: controllerRecord.liveOwner, ...registryDaemonOwner, source: "runtime-controller" }]
    : [];
  const liveProviderOwners = [...conversationOwners, ...paneOwner, ...registryOwner]
    .filter((owner, index, owners) => owners.findIndex((candidate) => candidate.sessionId === owner.sessionId) === index);
  const sameLiveProviderOwner = liveProviderOwners.length === 1
    && liveProviderOwners[0].sessionId === item.paneId
    && daemonProvider === provider;
  const writerLock = writerLockPath(provider, providerSessionId);
  candidates.push({
    project,
    paneId: item.paneId,
    provider,
    providerSessionId,
    providerWriterLocked: Boolean(writerLock && fs.existsSync(writerLock) && !sameLiveProviderOwner && !writerLockIsStale(writerLock)),
    activeAt,
    killedAt,
    daemonCwd,
    daemonLive,
    daemonCommand,
    daemonProvider,
    daemonPid: daemonIdentity?.pid ?? null,
    liveProviderOwners,
    identityMismatch: daemonLive && (daemonCwd !== item.cwd || Boolean(daemonProvider && provider && daemonProvider !== provider)),
    explicitlyKilled:
      killedAt >= activeAt ||
      (controllerRecord?.lifecycle === "intentional-kill" && controllerRecord.restoreEligible === false),
    controllerRecord,
  });
}

const providerCounts = new Map();
for (const candidate of candidates) {
  if (candidate.providerSessionId && candidate.daemonLive) {
    const key = `${candidate.provider ?? "unknown"}:${candidate.providerSessionId}`;
    const panes = providerCounts.get(key) ?? new Set();
    panes.add(candidate.paneId);
    providerCounts.set(key, panes);
  }
}

const daemonCounts = new Map();
for (const candidate of candidates) {
  const daemonSessionId = candidate.controllerRecord?.daemonSessionId;
  if (!daemonSessionId) continue;
  const panes = daemonCounts.get(daemonSessionId) ?? new Set();
  panes.add(candidate.paneId);
  daemonCounts.set(daemonSessionId, panes);
}

const plan = [...projects].map(([project, cwd]) => {
  const rows = candidates.filter((candidate) => candidate.project === project).sort((a, b) => b.activeAt - a.activeAt);
  const decisions = rows.map((candidate) => {
    const ownerCount = providerCounts.get(`${candidate.provider ?? "unknown"}:${candidate.providerSessionId}`)?.size ?? 0;
    const daemonOwnerCount = daemonCounts.get(candidate.controllerRecord?.daemonSessionId)?.size ?? 0;
    const duplicateOwner = candidate.liveProviderOwners.length > 1
      || ownerCount > 1
      || daemonOwnerCount > 1;
    const controllerDecision = decideRecovery({
      paneId: candidate.paneId,
      expectedCwd: cwd,
      provider: candidate.provider,
      providerSessionId: candidate.providerSessionId,
      explicitlyKilled: candidate.explicitlyKilled,
      liveProviderOwners: candidate.liveProviderOwners,
      identityMismatch: candidate.identityMismatch,
      providerWriterLocked: candidate.providerWriterLocked,
      providerTombstoned: closedProviders.has(candidate.providerSessionId),
      duplicateOwner,
    });
    const decision = controllerDecision === "already-running" || controllerDecision === "already-owned-elsewhere"
      ? "restore-exact"
      : controllerDecision;
    return {
      ...candidate,
      duplicateOwner,
      providerOwner: candidate.liveProviderOwners[0] ?? null,
      decision,
      exactResume: exactResumeCommand(candidate.provider, candidate.providerSessionId),
    };
  });
  // A newer non-killed pane that is ambiguous is an authority conflict, not a
  // reason to fall back to an older conversation from the same project.
  const latestNonKilled = decisions.find((candidate) => !candidate.explicitlyKilled) ?? null;
  const exactLiveOwner = decisions.find((candidate) =>
    candidate.decision === "restore-exact" &&
    candidate.providerOwner?.cwd === cwd,
  ) ?? null;
  const selected = exactLiveOwner ?? (latestNonKilled?.decision === "restore-exact" ? latestNonKilled : null);
  const ownerTransfers = [...new Map(decisions
    .filter((candidate) => candidate.decision === "hold-identity-mismatch" && candidate.daemonLive && candidate.daemonCwd)
    .map((candidate) => [candidate.paneId, {
        paneId: candidate.paneId,
        provider: candidate.provider,
        providerSessionId: candidate.providerSessionId,
        currentOwnerCwd: candidate.daemonCwd,
        targetCwd: cwd,
        reason: "exact provider conversation is live under a different daemon project identity",
      }])).values()];
  return {
    project,
    cwd,
    selected,
    ownerTransfers,
    decisions,
    candidates: rows.length,
    ambiguous: decisions.filter((candidate) => candidate.decision.startsWith("hold-")).length,
    manualRestoreAvailable: decisions.filter((candidate) => candidate.decision === "manual-restore-only"),
  };
});

console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply-not-supported" : "dry-run", workspacePath, plan }, null, 2));
if (process.argv.includes("--apply")) {
  console.error("Refusing --apply: recovery decisions must be reviewed before any state mutation.");
  process.exitCode = 2;
}
