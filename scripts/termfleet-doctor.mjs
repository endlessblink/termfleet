#!/usr/bin/env node
// termfleet doctor — read-only live check of the title/TASKS status pipeline wiring.
//
// Unit tests guard code; this guards the RUNTIME class of failures that killed the
// feature repeatedly (regression-matrix rows 5.7–5.11): dead helper processes, stale
// binaries, missing env injection, runaway logs. Run it FIRST whenever the cockpit
// titles or TASKS panel "break again", before touching code.
//
// Usage: npm run doctor   (safe: reads files/process list only, changes nothing)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paneSidecarPath, sidecarFresh, statusDir } from "./lib/agent-status-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function report(level, name, detail) {
  results.push({ level, name, detail });
}

function fmtAge(ms) {
  if (ms < 90_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fileContains(filePath, needle) {
  // grep handles large/binary files without loading them into node memory.
  const out = spawnSync("grep", ["-alc", "--", needle, filePath], { encoding: "utf8" });
  return out.status === 0;
}

// 1. Claude status hook registered and pointing at a real file.
try {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const settings = readFileSync(settingsPath, "utf8");
  const match = settings.match(/node ([^"]*termfleet-claude-status-hook\.mjs)/);
  if (!match) {
    report("fail", "Claude status hook", `not registered in ${settingsPath} — agents can't publish their task lists`);
  } else if (!existsSync(match[1])) {
    report("fail", "Claude status hook", `registered but the hook file is missing: ${match[1]}`);
  } else {
    report("ok", "Claude status hook", `registered → ${match[1]}`);
  }
} catch (error) {
  report("warn", "Claude status hook", `could not read ~/.claude/settings.json (${error.message})`);
}

// 2. Sidecar files: the hook's output. Fresh pane files prove the whole write side.
const dir = statusDir();
let paneFiles = [];
try {
  paneFiles = readdirSync(dir).filter((name) => /^pane-[0-9a-f]{8}\.json$/.test(name));
} catch {
  // handled below
}
if (!existsSync(dir)) {
  report("fail", "Status files", `${dir} does not exist — the hook has never written anything`);
} else if (paneFiles.length === 0) {
  report("warn", "Status files", "no per-terminal status files yet (fine if no agent ran since the daemon was replaced)");
} else {
  const newest = paneFiles
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  const age = Date.now() - newest.mtime;
  const level = age <= 30 * 60 * 1000 ? "ok" : "info";
  report(level, "Status files", `${paneFiles.length} per-terminal file(s); newest written ${fmtAge(age)}${level === "info" ? " (stale is fine if no agent is running)" : ""}`);
}

// 3. Pane id injection (only checkable from inside a cockpit terminal).
const paneId = process.env.TERMFLEET_PANE_ID;
if (paneId) {
  report("ok", "Per-terminal id", `this terminal has TERMFLEET_PANE_ID=${paneId.slice(0, 24)}…`);
  try {
    const sidecar = JSON.parse(readFileSync(paneSidecarPath(paneId), "utf8"));
    report(
      sidecarFresh(sidecar) ? "ok" : "info",
      "This terminal's status",
      sidecarFresh(sidecar)
        ? `fresh — current task: ${sidecar.todos?.find((t) => t.status === "in_progress")?.activeForm ?? sidecar.userTask ?? "(none in progress)"}`
        : "exists but stale (fine if no agent is running here)",
    );
  } catch {
    report("info", "This terminal's status", "no status file yet for this terminal (appears once an agent runs here)");
  }
} else if (process.env.TERMFLEET) {
  report("fail", "Per-terminal id", "inside a cockpit terminal but TERMFLEET_PANE_ID is missing — the PTY daemon predates the injection; relaunch with ./run-native-vte-dev.sh --fresh-daemon (kills running terminal processes; content restores)");
} else {
  report("info", "Per-terminal id", "not running inside a cockpit terminal (run `npm run doctor` in a cockpit pane to check injection)");
}

// 4. Built frontend contains the local sidecar-read fix (regression-matrix 5.7).
const distAssets = path.join(ROOT, "dist", "assets");
let distHasFix = false;
let newestDistJs = null;
try {
  for (const name of readdirSync(distAssets).filter((n) => n.endsWith(".js"))) {
    const full = path.join(distAssets, name);
    const mtime = statSync(full).mtimeMs;
    if (!newestDistJs || mtime > newestDistJs.mtime) newestDistJs = { full, mtime };
    if (!distHasFix && fileContains(full, "agent_status_read_sidecar")) distHasFix = true;
  }
  report(
    distHasFix ? "ok" : "fail",
    "Built frontend",
    distHasFix
      ? "dist bundle reads status files directly (no helper server needed)"
      : "dist bundle LACKS the direct status read — run `npm run build`",
  );
} catch {
  report("warn", "Built frontend", "no dist/ build found — run `npm run build` (dev launcher builds its own)");
}

// 5. Release binary: contains the Rust command, and its embed is not older than dist.
const binaryPath = path.join(ROOT, "src-tauri", "target", "release", "terminal-workspace");
let binaryMtime = null;
if (!existsSync(binaryPath)) {
  report("info", "Desktop binary", "no release binary built (fine if you only use the dev launcher)");
} else {
  binaryMtime = statSync(binaryPath).mtimeMs;
  if (!fileContains(binaryPath, "agent_status_read_sidecar")) {
    report("fail", "Desktop binary", "release binary predates the status fix — rebuild: cd src-tauri && cargo build --release");
  } else if (newestDistJs && binaryMtime < newestDistJs.mtime) {
    report("warn", "Desktop binary", `binary (built ${fmtAge(Date.now() - binaryMtime)}) is OLDER than the frontend build — its embedded UI is stale; rebuild: cd src-tauri && cargo build --release`);
  } else {
    report("ok", "Desktop binary", `contains the status fix (built ${fmtAge(Date.now() - binaryMtime)})`);
  }
}

// 6. Running app process vs binary: a rebuilt binary changes nothing until relaunch.
try {
  const ps = spawnSync("ps", ["-eo", "pid=,etimes=,args="], { encoding: "utf8" }).stdout;
  const appProcs = ps
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("target/release/terminal-workspace") && !line.includes("--terminal-workspace-daemon"))
    .map((line) => {
      const [pid, etimes] = line.split(/\s+/);
      return { pid, startedAt: Date.now() - Number(etimes) * 1000 };
    });
  if (appProcs.length === 0) {
    report("info", "Running app", "desktop app is not currently running");
  } else if (binaryMtime && appProcs.some((proc) => proc.startedAt < binaryMtime)) {
    report("warn", "Running app", "the running app was started BEFORE the current binary was built — relaunch the app to pick up fixes (terminals survive; the daemon owns them)");
  } else {
    report("ok", "Running app", `running and newer than the binary build (pid ${appProcs[0].pid})`);
  }
} catch (error) {
  report("warn", "Running app", `could not inspect processes (${error.message})`);
}

// 6b. Daemon cgroup parenting — the "terminals die on relaunch" check.
// A daemon in its OWN termfleet-daemon-* unit survives an app relaunch; one still
// parented under the app's termfleet-desktop-* unit is killed with the app, taking
// every shell and agent with it. Reads /proc directly so it is honest about the
// live daemon even before it is rebuilt with the self-report.
try {
  const ps = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout;
  const daemonPids = ps
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("--terminal-workspace-daemon"))
    .map((line) => line.split(/\s+/)[0]);
  if (daemonPids.length === 0) {
    report("info", "Daemon safety", "no terminal daemon running (nothing to protect yet)");
  } else {
    const cgroupOf = (pid) => {
      try {
        const raw = readFileSync(`/proc/${pid}/cgroup`, "utf8");
        const unified = raw.split("\n").find((l) => l.startsWith("0::"));
        return (unified ? unified.slice(3) : raw.split("\n")[0].split(":").pop() || "").trim();
      } catch {
        return "";
      }
    };
    const cg = cgroupOf(daemonPids[0]);
    if (cg.includes("/termfleet-daemon-")) {
      report("ok", "Daemon safety", "the terminal keeper has its own slot — terminals survive an app relaunch");
    } else if (cg.includes("/termfleet-desktop-")) {
      report("fail", "Daemon safety", "the terminal keeper is filed under the app — the next app relaunch will kill every terminal; relaunch once with --fresh-daemon to move it (stops running commands once; text restores from disk)");
    } else if (cg.includes("/termfleet-rescue")) {
      report("warn", "Daemon safety", "the terminal keeper is in the temporary rescue slot — safe now, but it vanishes on reboot; land the permanent fix and relaunch once with --fresh-daemon");
    } else {
      report("info", "Daemon safety", `terminal keeper cgroup: ${cg || "unknown"}`);
    }
  }
} catch (error) {
  report("warn", "Daemon safety", `could not inspect the terminal keeper's slot (${error.message})`);
}

// 7. Trace log growth (regression-matrix 5.11 — once reached 8 GB).
try {
  const traceSize = statSync(path.join(dir, "cockpit-header-trace.jsonl")).size;
  if (traceSize > 100 * 1024 * 1024) {
    report("warn", "Trace log", `cockpit-header-trace.jsonl is ${(traceSize / 1024 / 1024 / 1024).toFixed(1)} GB — rotation is broken or the status server predates the 25 MB cap`);
  } else {
    report("ok", "Trace log", `cockpit-header-trace.jsonl is ${(traceSize / 1024 / 1024).toFixed(1)} MB (capped at 25 MB per generation)`);
  }
} catch {
  report("ok", "Trace log", "no trace log (only written when the optional status server runs)");
}

// 8. Optional HTTP status server — informational only since the app reads files directly.
const probe = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
const serverUp = probe.stdout?.includes(":37819");
report("info", "Helper server", serverUp
  ? "optional status server is running on 127.0.0.1:37819 (used by browser preview / opt-in Ollama)"
  : "optional status server not running — NOT required; the desktop app reads status files directly");

const icon = { ok: "✔", warn: "⚠", fail: "✘", info: "·" };
// 9. Snapshot task-source vocabulary. Task identity must be bounded; old
// `status-summary`/model/scrape ownership is a regression even if the text reads well.
try {
  const snapshot = JSON.parse(readFileSync(path.join(dir, "cockpit-snapshot.json"), "utf8"));
  const allowed = new Set(["manual", "task-tool", "user-prompt", "plan-binding", "sidecar-todo", "workstream", "missing", "agent-status"]);
  const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
  const snapshotAge = Date.now() - Number(snapshot.updatedAt || 0);
  const unsupported = terminals
    .map((entry) => String(entry.taskSource ?? "").trim())
    .filter((source) => source && !allowed.has(source));
  if (unsupported.length) {
    report(
      snapshotAge <= 30_000 ? "fail" : "info",
      "Task identity sources",
      `unsupported task source(s) in ${snapshotAge <= 30_000 ? "fresh" : "stale"} snapshot: ${Array.from(new Set(unsupported)).join(", ")}`,
    );
  } else if (terminals.length) {
    report("ok", "Task identity sources", "snapshot uses bounded task sources only");
  } else {
    report("info", "Task identity sources", "snapshot has no terminals to inspect");
  }
} catch {
  report("info", "Task identity sources", "no cockpit snapshot to inspect (enable VITE_COCKPIT_SNAPSHOT=1 for live source checks)");
}
// 8. TC-054: agent auto-resume readiness. Every map node that ran an agent must be
//    able to cold-restore ITS OWN conversation (per-pane), not the folder's newest.
try {
  // a) the daemon must carry the sidecar-recovery path. Dev builds strip symbols, so
  //    grep the SOURCE for the fix and flag any built binary older than that source
  //    (a stale binary silently downgrades hand-started agents to bare shells).
  const ptySrc = path.join(ROOT, "src-tauri", "src", "pty.rs");
  const srcHasFix = existsSync(ptySrc) && fileContains(ptySrc, "read_pane_sidecar_recovery");
  if (!srcHasFix) {
    report("fail", "Agent auto-resume (TC-054)", "source is missing the sidecar-recovery path (pty.rs) — the fix was reverted");
  } else {
    const srcMtime = statSync(ptySrc).mtimeMs;
    const bins = ["debug", "release"]
      .map((p) => path.join(ROOT, "src-tauri", "target", p, "terminal-workspace"))
      .filter((b) => existsSync(b));
    const fresh = bins.filter((b) => statSync(b).mtimeMs >= srcMtime);
    if (!bins.length) {
      report("info", "Agent auto-resume (TC-054)", "fix is in source; no daemon binary built yet (dev launcher rebuilds on next launch)");
    } else if (fresh.length) {
      report("ok", "Agent auto-resume (TC-054)", "daemon binary carries the sidecar cold-restore fix (hand-started agents auto-resume)");
    } else {
      report("warn", "Agent auto-resume (TC-054)", "fix is in source but every built daemon binary is OLDER than it — restart via the launcher (rebuilds) so it takes effect");
    }
  }
  // b) how many current map nodes have a recoverable conversation on disk.
  const wjPath = path.join(statusDir(), "..", "workspace.json");
  if (existsSync(wjPath)) {
    const wj = JSON.parse(readFileSync(wjPath, "utf8"));
    let nodes = 0;
    let recoverable = 0;
    for (const tab of wj.tabs ?? []) {
      for (const term of tab.terminals ?? []) {
        nodes += 1;
        const rt = `terminal-${tab.id}-${term.paneId}`;
        try {
          const sc = JSON.parse(readFileSync(paneSidecarPath(rt), "utf8"));
          if (sc && typeof sc.sessionId === "string" && sc.sessionId.trim()) recoverable += 1;
        } catch {
          /* no sidecar → this node never ran an agent; a plain shell is correct */
        }
      }
    }
    report(
      "info",
      "Map node recovery",
      `${recoverable}/${nodes} map node(s) have a resumable agent conversation; each restores its own chat on restart (the rest are plain shells)`,
    );
  }
} catch (error) {
  report("warn", "Agent auto-resume (TC-054)", `could not evaluate recovery readiness (${error.message})`);
}

// 9. TC-055 load guardrail: the daemon's SOFT memory ceiling and current headroom.
//    Soft = when exceeded the kernel throttles the daemon (agents slow), it never
//    kills them. This surfaces pressure BEFORE it bites, so it's never invisible.
try {
  const gib = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  const list =
    spawnSync("systemctl", ["--user", "list-units", "termfleet-daemon-*.service", "--no-legend", "--plain"], {
      encoding: "utf8",
    }).stdout || "";
  const unit = list.split("\n").map((l) => l.trim().split(/\s+/)[0]).find((u) => u && u.endsWith(".service"));
  if (!unit) {
    report("info", "Load guardrail (TC-055)", "no running daemon unit to inspect");
  } else {
    const show =
      spawnSync("systemctl", ["--user", "show", unit, "-p", "MemoryHigh", "-p", "MemoryCurrent"], {
        encoding: "utf8",
      }).stdout || "";
    const high = (show.match(/MemoryHigh=(\S+)/) || [])[1];
    const cur = Number((show.match(/MemoryCurrent=(\d+)/) || [])[1]);
    if (!high || high === "infinity") {
      report(
        "warn",
        "Load guardrail (TC-055)",
        "running daemon has NO soft memory ceiling — it predates the guardrail; relaunch via the launcher to apply it",
      );
    } else {
      const highBytes = Number(high);
      const pct = Number.isFinite(cur) && highBytes ? Math.round((cur / highBytes) * 100) : null;
      const detail = `daemon memory ${gib(cur)}G / ${gib(highBytes)}G soft ceiling${pct !== null ? ` (${pct}%)` : ""} — over the ceiling the daemon throttles, agents are never killed`;
      report(pct !== null && pct >= 85 ? "warn" : "ok", "Load guardrail (TC-055)", detail);
    }
  }
} catch (error) {
  report("info", "Load guardrail (TC-055)", `could not read daemon memory limits (${error.message})`);
}

let failed = 0;
let warned = 0;
for (const { level, name, detail } of results) {
  if (level === "fail") failed += 1;
  if (level === "warn") warned += 1;
  process.stdout.write(`${icon[level]} ${name}: ${detail}\n`);
}
process.stdout.write(
  failed ? `\nDOCTOR_FAIL (${failed} failure(s), ${warned} warning(s))\n`
  : warned ? `\nDOCTOR_WARN (${warned} warning(s) — titles/tasks may look stale until addressed)\n`
  : "\nDOCTOR_OK — status pipeline wiring is healthy\n",
);
process.exit(failed ? 1 : 0);
