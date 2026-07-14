#!/usr/bin/env node
// termfleet reaper (TC-055) — safely reclaim leftover tool servers that agents
// leave running after `/exit` (dev servers, Playwright browsers, language servers,
// esbuild watchers, node_repl), WITHOUT ever killing a live conversation.
//
// Safety gate (see reapDecision): a session is only reaped when NO agent exists
// ANYWHERE in its process tree (deep scan — a shallow child check gave false
// positives during the 2026-07-13 outage because agents nest under wrappers) AND
// it has been idle past the window. Ships dry-run first.
//
// Usage:
//   node scripts/termfleet-reaper.mjs            # dry-run: print what it WOULD reap
//   node scripts/termfleet-reaper.mjs --apply    # actually kill (TERM then KILL)
//   node scripts/termfleet-reaper.mjs --idle=1800
import { execFileSync } from "node:child_process";
import { readFileSync as read } from "node:fs";
import { requestDaemon } from "./termfleetctl.mjs";
import { paneSidecarPath } from "./lib/agent-status-paths.mjs";

const AGENT_COMMS = new Set(["claude", "codex", "codex-code-mode"]);
const REAPABLE_TOOL = /(esbuild|vite|playwright|chrome|chromium|pyright|tsserver|typescript|rust-analyz|gopls|pylsp|basedpyright|node_repl|uv-real)/i;

/**
 * Pure safety decision for one session tree. Inputs are already-computed facts:
 *   hasLiveAgent  — is a claude/codex process anywhere in the DEEP tree?
 *   idleSeconds   — how long the session has been idle (no agent activity)
 *   toolProcCount — leftover reapable tool processes under the session
 */
export function reapDecision(session, opts = {}) {
  const idleThreshold = opts.idleThresholdSeconds ?? 900;
  if (session.hasLiveAgent) {
    return { reap: false, reason: "live agent in tree — never reap" };
  }
  const idle = session.idleSeconds ?? 0;
  if (idle < idleThreshold) {
    return { reap: false, reason: `active within idle window (${idle}s < ${idleThreshold}s)` };
  }
  if ((session.toolProcCount ?? 0) === 0) {
    return { reap: false, reason: "no leftover tool servers to reclaim" };
  }
  return {
    reap: true,
    reason: `idle exited-agent session with ${session.toolProcCount} leftover tool proc(s)`,
  };
}

/**
 * Classify a session tree from the comm names of ALL its processes — the root
 * pid INCLUDED (2026-07-13: agents often run as the session's own root process,
 * which a descendants-only scan misses and mislabels a bare shell).
 */
export function summarizeTree(comms) {
  return {
    hasLiveAgent: comms.some((c) => AGENT_COMMS.has(c)),
    toolProcCount: comms.filter((c) => REAPABLE_TOOL.test(c)).length,
  };
}

/** Seconds since the session's last agent activity, from its sidecar `updatedAt`. */
export function idleSecondsFromSidecar(sidecar, now = Date.now()) {
  if (!sidecar || typeof sidecar.updatedAt !== "number") return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - sidecar.updatedAt) / 1000);
}

// --------------------------------------------------------------------------- //
// Scanner (only runs when invoked directly, never on import).
// --------------------------------------------------------------------------- //

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function comm(pid) {
  try {
    return read(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

function children(pid) {
  return sh("pgrep", ["-P", String(pid)]).split(/\s+/).filter(Boolean);
}

function descendants(pid) {
  const out = [];
  for (const kid of children(pid)) {
    out.push(kid, ...descendants(kid));
  }
  return out;
}

function readSidecar(sessionId) {
  try {
    return JSON.parse(read(paneSidecarPath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const idleArg = argv.find((a) => a.startsWith("--idle="));
  const idleThresholdSeconds = idleArg ? Number(idleArg.split("=")[1]) : 900;
  const now = Date.now();

  // Authoritative session list straight from the daemon — not cgroup guesswork.
  const resp = await requestDaemon({ type: "listSessions" });
  if (!resp?.ok || resp.value?.type !== "listSessions") {
    console.log("reaper: daemon not reachable (is the app running?)");
    return;
  }
  const sessions = resp.value.sessions ?? [];
  if (!sessions.length) {
    console.log("reaper: daemon reports no sessions.");
    return;
  }

  let planned = 0;
  let procsToKill = 0;
  for (const s of sessions) {
    const rootPid = s.pid;
    if (!rootPid) continue;
    // The whole tree INCLUDING the root pid (agents often ARE the session root).
    const tree = [String(rootPid), ...descendants(rootPid)];
    const { hasLiveAgent, toolProcCount } = summarizeTree(tree.map(comm));
    const toolPids = tree.filter((p) => REAPABLE_TOOL.test(comm(p)));
    const idleSeconds = idleSecondsFromSidecar(readSidecar(s.id), now);

    const decision = reapDecision({ hasLiveAgent, idleSeconds, toolProcCount }, { idleThresholdSeconds });
    const cwd = s.initialCwd ?? s.cwd ?? "";
    const proj = String(cwd).split("ai-development/").pop() || cwd || "(unknown)";
    const tag = decision.reap ? "REAP" : "keep";
    const idleStr = Number.isFinite(idleSeconds) ? `${Math.round(idleSeconds)}s idle` : "no sidecar";
    console.log(`  [${tag}] ${String(s.id).slice(0, 26)} ${proj} (${idleStr}) — ${decision.reason}`);
    if (decision.reap) {
      planned += 1;
      procsToKill += toolPids.length;
      if (apply) {
        for (const p of toolPids) sh("kill", ["-TERM", p]);
        sh("sleep", ["2"]);
        for (const p of toolPids) sh("kill", ["-KILL", p]);
      }
    }
  }

  console.log(
    apply
      ? `reaper: reaped ${procsToKill} leftover tool proc(s) across ${planned} idle exited-agent session(s).`
      : `reaper DRY-RUN: would reap ${procsToKill} leftover tool proc(s) across ${planned} idle exited-agent session(s). Live agents are never touched — use --apply to act.`,
  );
}

// Only run the scan when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`reaper error: ${error.message}`);
    process.exitCode = 1;
  });
}
