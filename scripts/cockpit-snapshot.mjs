#!/usr/bin/env node
// Read the dev-only cockpit-state snapshot (written by the status server's /cockpit-snapshot
// route) and print, for every rendered terminal, the displayed title + which source produced
// it, next to the agent's REAL task from its sidecar. Flags panes whose title is a command
// scrape / not the real task — i.e. "what you see vs what it's working on", all at once.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  paneSidecarPath,
  sidecarFresh,
  sidecarPath,
  statusDir,
} from "./lib/agent-status-paths.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Classify which source the rendered title came from, using the raw fields the probe
// recorded. (The component stays dumb; classification lives here.)
function classifyTitleSource(entry) {
  const title = clean(entry.title);
  if (!title) return "empty";
  if (/^(Working|Ready|Idle|Needs attention)$/i.test(title)) return "neutral";
  if (entry.tasksFromTodoWrite) return "real-task";
  if (entry.narration && clean(entry.narration) === title) return "narration";
  if (entry.durableActivityTitle && clean(entry.durableActivityTitle) === title) {
    return "durable-activity";
  }
  return "other-scrape";
}

function realTaskFromSidecar(entry) {
  for (const p of [entry.paneId ? paneSidecarPath(entry.paneId) : null, entry.cwd ? sidecarPath(entry.cwd) : null]) {
    if (!p) continue;
    try {
      const sc = JSON.parse(readFileSync(p, "utf8"));
      if (!sidecarFresh(sc)) continue;
      const todos = Array.isArray(sc.todos) ? sc.todos : [];
      const active = todos.find((t) => t.status === "in_progress");
      const open = todos.find((t) => t.status !== "completed");
      const task = clean((active ?? open)?.activeForm || (active ?? open)?.content);
      return { task: task || "(none)", keyed: p.includes("/pane-") ? "pane" : "cwd", count: todos.length };
    } catch {
      // try next
    }
  }
  return { task: "(no sidecar)", keyed: "-", count: 0 };
}

function main() {
  const file = path.join(statusDir(), "cockpit-snapshot.json");
  let snap;
  try {
    snap = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`No cockpit snapshot at ${file}. Is the app running with the snapshot enabled (dev / VITE_COCKPIT_SNAPSHOT=1)?`);
    process.exit(1);
  }
  const terminals = Array.isArray(snap.terminals) ? snap.terminals : [];
  const ageS = Math.round((Date.now() - (snap.updatedAt || 0)) / 1000);
  console.log(`cockpit snapshot · ${terminals.length} terminals · ${ageS}s old\n`);
  for (const t of terminals) {
    const src = classifyTitleSource(t);
    const real = realTaskFromSidecar(t);
    const shown = clean(t.title) || "(empty)";
    // Mismatch = the title is a scrape (not the real task and not a clean neutral word).
    const isScrape = src === "durable-activity" || src === "other-scrape";
    const flag = isScrape ? " ⚠ MISMATCH" : "";
    console.log(`▸ ${clean(t.cwd).split("/").slice(-2).join("/") || t.paneId}  [${t.kind}]`);
    console.log(`    shown:  "${shown}"   (source: ${src})${flag}`);
    console.log(`    real:   "${real.task}"   (sidecar: ${real.keyed}-keyed, ${real.count} task${real.count === 1 ? "" : "s"})`);
    console.log(`    list:   ${(t.taskLineup || []).map((i) => `${i.status[0]}:${clean(i.content)}`).join(" | ") || "(none)"}`);
  }
}

main();
