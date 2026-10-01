#!/usr/bin/env node
// Answers "why did this agent die?" from the TermFleet timelines (TF-069).
//
//   node scripts/why-did-it-die.mjs [text]     text = part of a folder, pane id or chat id
//
// Reads agent-exits.jsonl (session starts/ends with Claude's own reason) and
// chat-closures.jsonl (older copies TermFleet itself closed). A session that started
// and has neither an end nor a closure, and whose process is gone, was killed from
// outside TermFleet (a signal, the kernel, or its terminal being closed).
import { existsSync, readFileSync } from "node:fs";
import { agentExitLogPath, stateDir } from "./lib/agent-exit-log.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** One verdict per session that matches `text`, newest last. */
export function explain({ exits, closures, text = "", isAlive = (pid) => existsSync(`/proc/${pid}`) }) {
  const wants = (entry) => !text || JSON.stringify(entry).includes(text);
  const sessions = new Map();
  for (const entry of exits.filter(wants)) {
    const key = entry.sessionId || entry.paneId || "?";
    const row = sessions.get(key) ?? { sessionId: entry.sessionId, paneId: entry.paneId, cwd: entry.cwd, starts: [], end: null, agentPid: undefined };
    if (entry.event === "session-start") {
      row.starts.push(entry);
      row.agentPid = entry.agentPid ?? row.agentPid;
      row.paneId = entry.paneId || row.paneId;
      row.cwd = entry.cwd || row.cwd;
    }
    if (entry.event === "session-end") row.end = entry;
    sessions.set(key, row);
  }
  const verdicts = [];
  for (const row of sessions.values()) {
    const closure = closures.filter(wants).find((c) => c.closedPane === row.paneId && (!c.conversationId || c.conversationId === row.sessionId));
    const last = row.starts[row.starts.length - 1];
    let verdict;
    if (closure) {
      verdict = `closed by TermFleet at ${closure.at}: the same chat was opened in card ${String(closure.openedByPane).slice(0, 18)}`;
    } else if (row.end) {
      verdict = `ended by itself at ${row.end.at}, reason "${row.end.reason || "unknown"}"`;
    } else if (last && row.agentPid && !isAlive(row.agentPid)) {
      verdict = `vanished without ending (process ${row.agentPid} is gone, no end and no TermFleet closure): killed from outside, such as a signal, the kernel, or its terminal being closed`;
    } else if (last) {
      verdict = "still running";
    } else {
      verdict = "no start recorded";
    }
    verdicts.push({ sessionId: row.sessionId, paneId: row.paneId, cwd: row.cwd, startedAs: last?.source || undefined, startedAt: last?.at, verdict });
  }
  return verdicts.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const text = process.argv[2] ?? "";
  const exits = readLines(agentExitLogPath());
  const closures = readLines(join(stateDir(), "chat-closures.jsonl"));
  const verdicts = explain({ exits, closures, text }).slice(-12);
  if (verdicts.length === 0) {
    console.log(exits.length === 0 ? "No agent sessions recorded yet (the timeline starts once the end hook is connected)." : `Nothing recorded for "${text}".`);
  }
  for (const v of verdicts) {
    console.log(`${v.startedAt ?? "?"}  ${v.cwd ?? v.paneId ?? v.sessionId}  [${v.startedAs || "start"}]\n    -> ${v.verdict}`);
  }
}
