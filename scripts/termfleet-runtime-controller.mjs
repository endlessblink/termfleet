#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

export const RUNTIME_CONTROLLER_SCHEMA_VERSION = 1;

const sleepSync = (milliseconds) => {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
};

export function decideRecovery({
  paneId,
  expectedCwd,
  provider,
  providerSessionId,
  explicitlyKilled = false,
  liveProviderOwners = [],
  identityMismatch = false,
  providerWriterLocked = false,
  providerTombstoned = false,
  duplicateOwner = false,
}) {
  if (explicitlyKilled) return "manual-restore-only";
  if (!provider || !providerSessionId) return "hold-missing-provider-identity";
  if (duplicateOwner || liveProviderOwners.length > 1) return "hold-duplicate-provider-owner";
  if (identityMismatch) return "hold-identity-mismatch";
  if (providerTombstoned) return "hold-provider-tombstone";

  const owner = liveProviderOwners[0] ?? null;
  if (owner) {
    if (owner.sessionId === paneId) return "already-running";
    if (owner.cwd && expectedCwd && owner.cwd !== expectedCwd) return "hold-identity-mismatch";
    return "already-owned-elsewhere";
  }
  if (providerWriterLocked) return "hold-provider-writer-lock";
  return "restore-exact";
}

export function createRuntimeRegistry(now = Date.now()) {
  return {
    schemaVersion: RUNTIME_CONTROLLER_SCHEMA_VERSION,
    generation: 0,
    updatedAt: now,
    panes: {},
  };
}

export function transitionRuntimeRegistry(registry, event, now = Date.now()) {
  const current = registry && registry.schemaVersion === RUNTIME_CONTROLLER_SCHEMA_VERSION
    ? registry
    : createRuntimeRegistry(now);
  const paneId = String(event?.paneId ?? "").trim();
  if (!paneId) throw new Error("runtime controller event requires paneId");

  const previous = current.panes[paneId] ?? { paneId };
  const eventAt = Number.isFinite(Number(event?.atMs)) ? Number(event.atMs) : now;
  if (Number.isFinite(Number(previous.updatedAt)) && Number(previous.updatedAt) > eventAt) {
    return current;
  }
  const next = {
    ...previous,
    paneId,
    updatedAt: eventAt,
    provider: event.provider ?? previous.provider ?? null,
    providerSessionId: event.providerSessionId ?? previous.providerSessionId ?? null,
    cwd: event.cwd ?? previous.cwd ?? null,
    daemonSessionId: event.daemonSessionId ?? previous.daemonSessionId ?? null,
    lastEvent: event.kind ?? "observed",
  };

  const duplicateOwner = Object.values(current.panes).find((pane) => {
    if (!pane || pane.paneId === paneId) return false;
    const sameProviderSession = next.providerSessionId && pane.providerSessionId === next.providerSessionId;
    const sameDaemonSession = next.daemonSessionId && pane.daemonSessionId === next.daemonSessionId;
    return sameProviderSession || sameDaemonSession;
  });
  if (duplicateOwner) {
    next.lifecycle = "held";
    next.restoreEligible = false;
    next.holdReason = "duplicate-runtime-owner";
    next.liveOwner = null;
  }

  if (!duplicateOwner) switch (event.kind) {
    case "user-close":
      next.lifecycle = "intentional-kill";
      next.restoreEligible = false;
      next.closedAt = eventAt;
      break;
    case "user-restore":
      next.lifecycle = "recoverable";
      next.restoreEligible = true;
      next.closedAt = null;
      break;
    case "live-owner":
      next.lifecycle = "alive";
      next.restoreEligible = false;
      next.liveOwner = event.daemonSessionId ?? paneId;
      break;
    case "provider-exit":
      next.lifecycle = "recoverable";
      next.restoreEligible = true;
      next.liveOwner = null;
      break;
    case "restore-held":
      next.lifecycle = "held";
      next.restoreEligible = false;
      next.holdReason = event.reason ?? "ambiguous-runtime-state";
      break;
    case "restore-exact":
      next.lifecycle = "alive";
      next.restoreEligible = false;
      next.liveOwner = event.daemonSessionId ?? paneId;
      next.holdReason = null;
      break;
    default:
      next.lifecycle = previous.lifecycle ?? "unknown";
      next.restoreEligible = previous.restoreEligible ?? false;
      break;
  }

  return {
    ...current,
    generation: current.generation + 1,
    updatedAt: eventAt,
    panes: { ...current.panes, [paneId]: next },
  };
}

function readRegistry(registryPath) {
  try {
    return JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch {
    return createRuntimeRegistry();
  }
}

function withExclusiveLock(lockPath, callback) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      sleepSync(5);
    }
  }
  if (descriptor === null) throw new Error(`runtime controller lock timeout: ${lockPath}`);
  try {
    return callback();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

export function updateRuntimeRegistry(registryPath, event, now = Date.now()) {
  const lockPath = `${registryPath}.lock`;
  return withExclusiveLock(lockPath, () => {
    const next = transitionRuntimeRegistry(readRegistry(registryPath), event, now);
    fs.mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${registryPath}.tmp-${process.pid}-${now}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, registryPath);
    return next;
  });
}

export function loadRuntimeRegistry(registryPath) {
  return readRegistry(registryPath);
}
