// A timeline of agent sessions starting and ending in TermFleet terminals, so "why did my
// agent die?" can be answered afterwards instead of guessed (TF-069).
//
// Written by the status hooks:
//   session-start  with how it started (startup / resume / clear)
//   session-end    with the reason Claude itself reports (clear, logout, prompt_input_exit, other)
// Written by the single-chat rule (chat-closures.jsonl): our own kills of an older copy.
// An agent that vanished with NEITHER a session-end NOR a closure line was killed from
// outside (a signal, the kernel, or its terminal being closed); scripts/why-did-it-die.mjs
// says so.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ancestors, argv, isProviderProcess } from "./single-chat-owner.mjs";

export function stateDir(env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "termfleet");
}

export function agentExitLogPath(env = process.env) {
  return join(stateDir(env), "agent-exits.jsonl");
}

/** PID of the agent program that fired this hook, if it can be found. */
export function agentPid(provider, procRoot = "/proc", selfPid = process.pid) {
  return [...ancestors(procRoot, selfPid)].find((pid) => isProviderProcess(provider, argv(procRoot, pid)));
}

export function logAgentEvent(entry, logPath = agentExitLogPath()) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* logging must never break a hook */
  }
}
