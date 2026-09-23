#!/usr/bin/env node
// TF-044 proof: for every map card, compare the Running/Waiting/Idle badge the RUNNING
// app renders (read from its own cockpit trace) with the truth, derived independently:
//   - Codex: its live session log (turn finished? tool call awaiting its result?) plus
//     the process table (did an approved command start after the call?);
//   - Claude: the status hook record (its hooks are verified by `npm run doctor`);
//   - plain shells: not judged.
// Exit code 1 when any judged card disagrees.   node scripts/verify-badge-truth.mjs
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATUS_DIR = path.join(os.homedir(), ".local", "share", "terminal-workspace", "agent-status");
const TRACE = path.join(STATUS_DIR, "cockpit-header-trace.jsonl");
const HZ = 100;

function readTail(file, bytes) {
  const buf = readFileSync(file);
  return buf.subarray(Math.max(0, buf.length - bytes)).toString("utf8");
}

// ---- what the app shows ----------------------------------------------------
function latestRenderedCards() {
  const cards = new Map();
  const lines = readTail(TRACE, 8_000_000).split("\n").filter(Boolean);
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const walk = (value) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.paneId === "string" && typeof value.attention === "string" && value.tabId) {
        cards.set(`terminal-${value.tabId}-${value.paneId}`, value);
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(record);
  }
  return cards;
}

// ---- the truth -------------------------------------------------------------
const bootS = Number(readFileSync("/proc/stat", "utf8").match(/^btime (\d+)/m)?.[1] ?? 0);
function procStat(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { ppid: Number(fields[1]), startMs: bootS * 1000 + (Number(fields[19]) * 1000) / HZ };
  } catch {
    return null;
  }
}
const pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
const childrenOf = new Map();
for (const pid of pids) {
  const stat = procStat(pid);
  if (!stat) continue;
  childrenOf.set(stat.ppid, [...(childrenOf.get(stat.ppid) ?? []), pid]);
}
function descendants(root) {
  const out = [];
  const stack = [root];
  while (stack.length) for (const child of childrenOf.get(stack.pop()) ?? []) out.push(child), stack.push(child);
  return out;
}
function agentForPane(paneKey) {
  const found = [];
  for (const pid of pids) {
    try {
      const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      const provider = comm === "claude" || /\/claude(?:\0|$)/.test(cmd) ? "claude"
        : comm === "codex" || /codex(?:\.js)?\0/.test(cmd) ? "codex" : null;
      if (!provider) continue;
      const env = readFileSync(`/proc/${pid}/environ`, "utf8");
      if (!env.includes(`TERMFLEET_PANE_ID=${paneKey}\0`)) continue;
      found.push({ pid, provider });
    } catch {}
  }
  const set = new Set(found.map((entry) => entry.pid));
  return found.find((entry) => !set.has(procStat(entry.pid)?.ppid)) ?? null;
}
function codexTruth(rootPid) {
  const family = [rootPid, ...descendants(rootPid)];
  let newest = null;
  for (const pid of family) {
    let fds = [];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let target = "";
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (!/\/\.codex\/sessions\/.*\.jsonl$/.test(target)) continue;
      const mtime = statSync(target).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { target, mtime };
    }
  }
  if (!newest) return null;
  let idle = false;
  const pending = new Map();
  for (const line of readTail(newest.target, 512 * 1024).split("\n")) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = record.payload?.type;
    if (record.type === "event_msg" && (kind === "task_complete" || kind === "turn_aborted")) idle = true, pending.clear();
    else if (record.type === "event_msg" && kind === "task_started") idle = false, pending.clear();
    else if (record.type === "response_item" && /^(function_call|custom_tool_call|local_shell_call)$/.test(kind)) {
      idle = false;
      pending.set(record.payload.call_id, { name: record.payload.name, at: Date.parse(record.timestamp) });
    } else if (record.type === "response_item" && /_output$/.test(kind)) pending.delete(record.payload.call_id);
    else if (record.type === "response_item" && /^(reasoning|message|agent_message)$/.test(kind)) idle = false;
  }
  if (idle) return "idle";
  const call = [...pending.values()].pop();
  if (!call) return "running";
  if (call.name === "request_user_input") return "waiting";
  const started = descendants(rootPid).some((pid) => (procStat(pid)?.startMs ?? 0) >= call.at - 1000);
  return started ? "running" : "pending";
}

// The terminal keeper's own saved screen for the pane (independent of the app): the
// newest of "approval question" vs "live spinner" settles a call with no new process.
function savedScreenMarker(paneKey) {
  const file = path.join(os.homedir(), ".local", "share", "terminal-workspace", "sessions",
    `${Buffer.from(paneKey).toString("hex")}.scrollback`);
  let text = "";
  try {
    text = readTail(file, 20_000).replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "\n");
  } catch {
    return null;
  }
  const question = Math.max(text.lastIndexOf("Press enter to confirm or esc to cancel"), text.lastIndexOf("enter to submit answer"));
  const spinner = text.lastIndexOf("esc to interrupt");
  if (question < 0 && spinner < 0) return null;
  return question > spinner ? "waiting" : "running";
}
function claudeTruth(paneKey) {
  for (const name of readdirSync(STATUS_DIR).filter((file) => file.startsWith("pane-"))) {
    try {
      const record = JSON.parse(readFileSync(path.join(STATUS_DIR, name), "utf8"));
      if (record.paneId !== paneKey) continue;
      return record.turn === "working" ? "running" : record.turn === "waiting" ? "waiting" : "idle";
    } catch {}
  }
  return null;
}

// ---- compare ---------------------------------------------------------------
const cards = latestRenderedCards();
const rows = [];
let mismatches = 0;
for (const [paneKey, card] of cards) {
  const agent = agentForPane(paneKey);
  let truth = !agent ? null : agent.provider === "codex" ? codexTruth(agent.pid) : claudeTruth(paneKey);
  // A tool call with no new process: approval question on screen → waiting; live
  // spinner → running; neither visible → the log's reading (waiting).
  if (truth === "pending") truth = savedScreenMarker(paneKey) ?? "waiting";
  const shown = card.attention;
  const ok = truth === null ? "n/a" : truth === shown ? "OK" : "MISMATCH";
  if (ok === "MISMATCH") mismatches += 1;
  rows.push({
    card: (card.workspace || card.previewTitle || "?").slice(0, 24),
    agent: agent?.provider ?? "shell",
    shown,
    truth: truth ?? "-",
    verdict: ok,
    traced: new Date(card.updatedAt ?? 0).toTimeString().slice(0, 8),
    pane: paneKey.slice(-8),
  });
}
rows.sort((a, b) => (a.verdict === b.verdict ? a.card.localeCompare(b.card) : a.verdict === "MISMATCH" ? -1 : 1));
console.table(rows);
console.log(`checked at ${new Date().toTimeString().slice(0, 8)}: ${rows.filter((row) => row.verdict === "OK").length} match, ${mismatches} mismatch, ${rows.filter((row) => row.verdict === "n/a").length} shells not judged`);
process.exit(mismatches ? 1 : 0);
