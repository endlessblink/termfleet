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

const MEMORY_HIGH = process.env.TERMFLEET_DAEMON_MEMORY_HIGH || "40G";
const TASKS_MAX = process.env.TERMFLEET_DAEMON_TASKS_MAX || "20000";

/**
 * A running daemon that predates the guardrail reports `MemoryHigh=infinity` (or
 * nothing). Those need the ceiling applied. A finite value means it's already set
 * (by us or a deliberate override) — leave it (idempotent, respects manual tuning).
 */
export function needsGuardrail(currentMemoryHigh) {
  const value = (currentMemoryHigh ?? "").toString().trim();
  return value === "" || value === "infinity";
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
  sh("systemctl", [
    "--user",
    "set-property",
    unit,
    `MemoryHigh=${MEMORY_HIGH}`,
    `TasksMax=${TASKS_MAX}`,
  ]);
  console.log(
    `guardrail-ensure: applied MemoryHigh=${MEMORY_HIGH} TasksMax=${TASKS_MAX} to ${unit} (live, no restart).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
