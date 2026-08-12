#!/usr/bin/env node
// termfleet guardrail ensure (TC-055) — apply the SOFT memory ceiling to whatever
// daemon is currently running, LIVE via `systemctl --user set-property` (no restart,
// no killed agents). Idempotent: a no-op once a finite ceiling is set. This makes the
// guardrail self-healing — a daemon that predates the Rust default gets it on the
// next maintenance-timer tick.
//
// SOFT only: MemoryHigh throttles + reclaims the daemon's own memory when exceeded;
// it never OOM-kills. No hard MemoryMax is ever set (that would kill agents silently).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function memoryHighBytes(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)([KMG]?)$/i);
  if (!match) return null;
  const units = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
  return Number(match[1]) * units[match[2].toLowerCase()];
}

/**
 * The safe ceiling is HALF OF INSTALLED RAM (floored at 8G), not a fixed 12G.
 *
 * The old fixed 12G was actively harmful on a large workstation. On 2026-08-11
 * this box ran ~22 panes whose cgroup legitimately held 32G; pinning MemoryHigh
 * at 12G does not "protect" anything — it makes the kernel reclaim ~20G
 * continuously and push live agent sessions onto the swapfile, which is exactly
 * the freeze the guardrail exists to prevent. It also fought the memory-guard
 * timer, which re-raises the ceiling every 2 minutes: the two flipped the ceiling
 * back and forth on 2- and 15-minute cycles, and that — not the installer alone —
 * is why a raised ceiling kept "reverting" on its own.
 */
export function safeMemoryHighBytes(memTotalBytes = readMemTotalBytes()) {
  const half = Math.floor(memTotalBytes / 2);
  return Math.max(half, 8 * 1024 ** 3);
}

function readMemTotalBytes() {
  try {
    const line = readFileSync("/proc/meminfo", "utf8")
      .split("\n")
      .find((l) => l.startsWith("MemTotal:"));
    return Number(line.split(/\s+/)[1]) * 1024;
  } catch {
    return 16 * 1024 ** 3;
  }
}

const MEMORY_HIGH =
  process.env.TERMFLEET_DAEMON_MEMORY_HIGH || String(safeMemoryHighBytes());
const TASKS_MAX = process.env.TERMFLEET_DAEMON_TASKS_MAX || "20000";

/**
 * Apply the ceiling when the daemon has none (`infinity`/empty — it predates the
 * guardrail) or when its ceiling is ABOVE what this machine can safely give it.
 *
 * Deliberately does NOT lower a ceiling that merely exceeds some fixed constant:
 * a ceiling below the safe value is not a safety win, it is the freeze mechanism.
 */
export function needsGuardrail(currentMemoryHigh, safeBytes = safeMemoryHighBytes()) {
  const value = (currentMemoryHigh ?? "").toString().trim();
  if (value === "" || value === "infinity") return true;
  const bytes = memoryHighBytes(value);
  return bytes == null || bytes > safeBytes;
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function runningDaemonUnit() {
  const out = sh("systemctl", [
    "--user",
    "list-units",
    "termfleet-daemon-*.service",
    "--no-legend",
    "--plain",
  ]);
  return (
    out
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .find((unit) => unit && unit.endsWith(".service")) || null
  );
}

function main() {
  const unit = runningDaemonUnit();
  if (!unit) {
    console.log("guardrail-ensure: no running termfleet daemon unit — nothing to do.");
    return;
  }
  const show = sh("systemctl", ["--user", "show", unit, "-p", "MemoryHigh"]);
  const current = (show.match(/MemoryHigh=(\S+)/) || [])[1];
  if (!needsGuardrail(current)) {
    console.log(`guardrail-ensure: ${unit} already has MemoryHigh=${current} — no change.`);
    return;
  }
  try {
    execFileSync("systemctl", [
      "--user",
      "set-property",
      unit,
      `MemoryHigh=${MEMORY_HIGH}`,
      `TasksMax=${TASKS_MAX}`,
    ], { stdio: "ignore" });
  } catch {
    console.error(`guardrail-ensure: failed to apply MemoryHigh=${MEMORY_HIGH} to ${unit}.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `guardrail-ensure: applied MemoryHigh=${MEMORY_HIGH} TasksMax=${TASKS_MAX} to ${unit} (live, no restart).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
