// Shared sidecar path scheme for the Claude/agent status hook (writer) and the
// sidecar status worker (reader). Both must compute identical paths from a cwd.
// TC-033: free, accurate task list + activity from the agent's own TodoWrite,
// written to a file termfleet's status worker reads (no model/CLI calls).
import os from "node:os";
import path from "node:path";

export function fnv(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function statusDir() {
  const base =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "terminal-workspace", "agent-status");
}

/** Normalize a cwd so writer and reader agree (resolve + strip trailing slash). */
export function normalizeCwd(cwd) {
  if (!cwd) return "";
  const resolved = path.resolve(String(cwd));
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

export function sidecarPath(cwd) {
  return path.join(statusDir(), `${fnv(normalizeCwd(cwd))}.json`);
}

/**
 * Per-terminal sidecar path, keyed by a stable pane id rather than the cwd. Lets two
 * terminals open in the SAME directory keep independent status (title + task list)
 * instead of sharing one cwd-keyed file. The writer (status hook) uses this when the
 * pane id is injected into the PTY env (`TERMFLEET_PANE_ID`); the reader (worker) uses
 * it when the status request carries the pane's id. Both fall back to the cwd path when
 * no pane id is present, so non-termfleet shells and not-yet-injected sessions keep
 * working exactly as before. (TC-035)
 */
export function paneSidecarPath(paneId) {
  return path.join(statusDir(), `pane-${fnv(String(paneId ?? ""))}.json`);
}

export function sidecarFresh(
  sidecar,
  ttlMs = Number(process.env.TERMFLEET_SIDECAR_TTL_MS || 30 * 60 * 1000),
) {
  if (!sidecar || typeof sidecar.updatedAt !== "number") return false;
  return Date.now() - sidecar.updatedAt <= ttlMs;
}
