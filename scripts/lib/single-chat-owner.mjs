// One chat, one terminal. When a Claude or Codex conversation is opened (or
// resumed by hand) in a TermFleet terminal, any OTHER TermFleet terminal still
// running that same conversation is stopped. Two live copies append to the same
// conversation file, which corrupts it, and the operator cannot tell which copy
// is the real one (live repro 2026-09-24: one chat in three terminals, each
// reopened by hand because the older copy looked stuck).
//
// Newest wins: the copy whose hook is firing is the one the operator is typing
// into. Only interactive copies inside TermFleet terminals are touched, and only
// the agent process is stopped; the terminal and its shell stay open.
import { readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MOVED_NOTE =
  "\r\n[TermFleet] This chat was opened in another terminal, so it was closed here to keep one copy.\r\n";

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function argv(procRoot, pid) {
  return readText(join(procRoot, String(pid), "cmdline")).split("\0").filter(Boolean);
}

export function paneOf(procRoot, pid) {
  const env = readText(join(procRoot, String(pid), "environ"));
  const hit = env.split("\0").find((entry) => entry.startsWith("TERMFLEET_PANE_ID="));
  return hit ? hit.slice("TERMFLEET_PANE_ID=".length) : "";
}

function parentOf(procRoot, pid) {
  const stat = readText(join(procRoot, String(pid), "stat"));
  // Field 4 follows the ")" that closes the command name, which may itself hold spaces.
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(rest[1]);
  return Number.isInteger(ppid) ? ppid : 0;
}

export function terminalOf(procRoot, pid) {
  try {
    const target = readlinkSync(join(procRoot, String(pid), "fd", "0"));
    return target.startsWith("/dev/pts/") ? target : "";
  } catch {
    return "";
  }
}

/** Is this process the agent program itself (not a node wrapper or a shell)? */
export function isProviderProcess(provider, args) {
  const program = basename(args[0] ?? "");
  if (provider === "claude") return program === "claude";
  // The native Codex binary; its `node .../bin/codex` launcher exits with it.
  if (provider === "codex") return program === "codex";
  return false;
}

function holdsConversation(provider, procRoot, pid, conversationId, claudeSessionsDir) {
  if (provider === "claude") {
    try {
      const record = JSON.parse(readText(join(claudeSessionsDir, `${pid}.json`)));
      return record?.sessionId === conversationId;
    } catch {
      return false;
    }
  }
  // Codex keeps its conversation file (named after the conversation id) open.
  try {
    const fdDir = join(procRoot, String(pid), "fd");
    return readdirSync(fdDir).some((fd) => {
      try {
        return readlinkSync(join(fdDir, fd)).includes(conversationId);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function ancestors(procRoot, pid) {
  const seen = new Set();
  let current = pid;
  while (current > 1 && !seen.has(current) && seen.size < 64) {
    seen.add(current);
    current = parentOf(procRoot, current);
  }
  return seen;
}

/** Other interactive copies of this conversation running in other TermFleet terminals. */
export function findOtherCopies({
  provider,
  conversationId,
  paneId,
  selfPid = process.pid,
  procRoot = "/proc",
  claudeSessionsDir = join(homedir(), ".claude", "sessions"),
}) {
  if (!conversationId || !paneId) return [];
  const mine = ancestors(procRoot, selfPid);
  // Only act for an interactive copy the operator is using, never for a
  // scripted/headless run that happens to share the conversation id.
  const owner = [...mine].find((pid) => isProviderProcess(provider, argv(procRoot, pid)));
  if (!owner || !terminalOf(procRoot, owner)) return [];

  let entries = [];
  try {
    entries = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const copies = [];
  for (const name of entries) {
    const pid = Number(name);
    if (mine.has(pid)) continue;
    const otherPane = paneOf(procRoot, pid);
    if (!otherPane || otherPane === paneId) continue;
    if (!isProviderProcess(provider, argv(procRoot, pid))) continue;
    const terminal = terminalOf(procRoot, pid);
    if (!terminal) continue;
    if (!holdsConversation(provider, procRoot, pid, conversationId, claudeSessionsDir)) continue;
    copies.push({ pid, paneId: otherPane, terminal });
  }
  return copies;
}

function alive(procRoot, pid) {
  const state = readText(join(procRoot, String(pid), "stat"));
  if (!state) return false;
  return state.slice(state.lastIndexOf(")") + 2, state.lastIndexOf(")") + 3) !== "Z";
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Stop the other copies and leave a one-line note in each terminal they ran in. */
export function closeOtherCopies(
  options,
  {
    kill = process.kill.bind(process),
    waitMs = 2000,
    writeNote = (terminal) => writeFileSync(terminal, MOVED_NOTE),
  } = {},
) {
  const procRoot = options.procRoot ?? "/proc";
  const copies = findOtherCopies(options);
  for (const copy of copies) {
    try {
      kill(copy.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + waitMs;
  while (copies.some((copy) => alive(procRoot, copy.pid)) && Date.now() < deadline) pause(50);
  for (const copy of copies) {
    try {
      writeNote(copy.terminal);
    } catch {
      /* the terminal is gone; nothing to tell */
    }
  }
  return copies;
}
