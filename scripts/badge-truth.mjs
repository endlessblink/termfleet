#!/usr/bin/env node
// Badge ground truth (TF-044): for every pane an agent has reported from, print what is
// REALLY happening — is the agent process alive in that pane, and what did its last hook
// event say — next to the badge the app should therefore show. Compare this table with a
// screenshot of the running app (`npm run cockpit:capture`) to prove the badges visually.
//
//   node scripts/badge-truth.mjs [--all]   (default: only panes whose agent is alive or
//                                          reported in the last 12 hours)
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATUS_DIR = path.join(os.homedir(), ".local", "share", "terminal-workspace", "agent-status");
const SIDECAR_TTL_MS = 30 * 60 * 1000;
const WAITING_TTL_MS = 12 * 60 * 60 * 1000;
const showAll = process.argv.includes("--all");
const AGENT = /(?:^|\/)(claude|codex|opencode)(?:\s|$)|\/(claude|codex|opencode)(?:\.js|\.mjs)?(?:\s|$)/;

// The agent's OWN live session log, independent of TermFleet's hooks: Codex keeps its
// rollout file open. Its last entry says whether the turn finished; its age says
// whether anything is happening.
function openSessionLog(pid) {
  try {
    // A long-lived Codex can hold several rollouts open; the newest is the live one.
    let newest = null;
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      let target = "";
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (!/\/\.codex\/sessions\/.*\.jsonl$/.test(target)) continue;
      const mtimeMs = statSync(target).mtimeMs;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { target, mtimeMs };
    }
    if (!newest) return null;
    const text = readFileSync(newest.target, "utf8").trimEnd();
    const last = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
    const kind = last?.payload?.type ?? last?.type ?? "?";
    return { kind, ageS: Math.round((Date.now() - newest.mtimeMs) / 1000) };
  } catch {
    // unreadable
  }
  return null;
}

function agentProcessesByPane() {
  const byPane = new Map();
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
      const match = cmd.match(AGENT);
      if (!match) continue;
      const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      const paneId = env.find((entry) => entry.startsWith("TERMFLEET_PANE_ID="))?.slice(18);
      if (!paneId) continue;
      const list = byPane.get(paneId) ?? [];
      list.push({ pid, provider: match[1] ?? match[2], session: openSessionLog(pid) });
      byPane.set(paneId, list);
    } catch {
      // process exited or not ours
    }
  }
  return byPane;
}

function expectedBadge({ alive, turn, updatedAt, now }) {
  if (!alive) return "Idle (agent not running)";
  const age = now - updatedAt;
  if (turn === "waiting") return age <= WAITING_TTL_MS ? "Waiting" : "Unavailable";
  if (turn === "working") return "Running (unless the screen shows it was interrupted)";
  if (turn === "idle") return age <= SIDECAR_TTL_MS ? "Idle" : "Idle / Unavailable";
  return "Idle";
}

const now = Date.now();
const alive = agentProcessesByPane();
const rows = [];
const seen = new Set();
for (const name of readdirSync(STATUS_DIR).filter((file) => /^pane-.*\.json$/.test(file))) {
  let record;
  try {
    record = JSON.parse(readFileSync(path.join(STATUS_DIR, name), "utf8"));
  } catch {
    continue;
  }
  if (!record?.paneId || seen.has(record.paneId)) continue;
  seen.add(record.paneId);
  const updatedAt = Number(record.updatedAt ?? statSync(path.join(STATUS_DIR, name)).mtimeMs);
  const procs = alive.get(record.paneId) ?? [];
  if (!showAll && procs.length === 0 && now - updatedAt > WAITING_TTL_MS) continue;
  rows.push({
    folder: path.basename(record.cwd ?? "?"),
    goal: String(record.mainTask ?? record.userTask ?? "").replace(/\s+/g, " ").slice(0, 60),
    provider: procs[0]?.provider ?? record.provider ?? "?",
    alive: procs.length > 0,
    turn: record.turn ?? "?",
    ageMin: Math.round((now - updatedAt) / 60000),
    expected: expectedBadge({ alive: procs.length > 0, turn: record.turn, updatedAt, now }),
    sessionLog: procs.find((proc) => proc.session)?.session
      ? `${procs.find((proc) => proc.session).session.kind} ${procs.find((proc) => proc.session).session.ageS}s ago`
      : "",
    pane: record.paneId.slice(-8),
  });
}
rows.sort((a, b) => Number(b.alive) - Number(a.alive) || a.ageMin - b.ageMin);
console.table(rows);
