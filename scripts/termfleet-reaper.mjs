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

function findDaemonCgroupProcs() {
  // termfleet-daemon-<pid>.service (new) or termfleet-rescue.service (keepalive).
  const roots = sh("bash", [
    "-lc",
    "find /sys/fs/cgroup -type d \\( -name 'termfleet-daemon-*.service' -o -name 'termfleet-rescue.service' \\) 2>/dev/null",
  ])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const pids = new Set();
  for (const root of roots) {
    for (const p of sh("cat", [`${root}/cgroup.procs`]).split(/\s+/).filter(Boolean)) pids.add(p);
  }
  return [...pids];
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const idleArg = argv.find((a) => a.startsWith("--idle="));
  const idleThresholdSeconds = idleArg ? Number(idleArg.split("=")[1]) : 900;

  const now = Date.now();
  const allPids = findDaemonCgroupProcs();
  if (!allPids.length) {
    console.log("reaper: no termfleet daemon cgroup found (is the app running?)");
    return;
  }

  // Session-leader shells = one session each.
  const sessions = allPids.filter((p) => {
    const c = comm(p);
    if (c !== "bash" && c !== "sh") return false;
    const stat = sh("ps", ["-o", "stat=", "-p", p]).trim();
    return stat.includes("s"); // session leader
  });

  let planned = 0;
  let procsToKill = 0;
  for (const shell of sessions) {
    const tree = descendants(shell);
    const hasLiveAgent = tree.some((p) => AGENT_COMMS.has(comm(p)));
    const toolPids = tree.filter((p) => REAPABLE_TOOL.test(comm(p)));
    // Idle proxy: newest activity across the tree (mtime of /proc/<pid> ~ start;
    // fall back to conservative "not idle" if unknown so we never over-reap).
    let idleSeconds = Number.POSITIVE_INFINITY;
    try {
      // youngest descendant age; a session spawning new procs is NOT idle.
      const ages = [shell, ...tree]
        .map((p) => Number(sh("ps", ["-o", "etimes=", "-p", p]).trim()))
        .filter((n) => Number.isFinite(n));
      if (ages.length) idleSeconds = Math.min(...ages);
    } catch {
      idleSeconds = 0;
    }
    const cwd = (() => {
      try {
        return sh("readlink", [`/proc/${shell}/cwd`]).trim();
      } catch {
        return "";
      }
    })();

    const decision = reapDecision({ hasLiveAgent, idleSeconds, toolProcCount: toolPids.length }, { idleThresholdSeconds });
    const proj = cwd.split("ai-development/").pop() || cwd || "(unknown)";
    const tag = decision.reap ? "REAP" : "keep";
    console.log(`  [${tag}] session ${shell} ${proj} — ${decision.reason}`);
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
      : `reaper DRY-RUN: would reap ${procsToKill} leftover tool proc(s) across ${planned} idle exited-agent session(s). Re-run with --apply to act.`,
  );
}

// Only run the scan when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
