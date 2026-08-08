// The Task row, resolved the way the RUNNING APP resolves it — including the vendor's
// own session record.
//
// `pane-label-audit.spec.ts` replays the ladder from the status file alone, so every
// transcript rung (the session's own title, the agent's last message, the pending
// question) is dark in it. That is why it reported a clean sweep while live panes showed
// "No task declared" on records whose session title read "Fix course page sections not
// displaying". This spec closes that hole: it drives `summarizeAgentStatus` with real
// readers for BOTH on-disk sources and asserts the rendered row.
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { summarizeAgentStatus } from "../src/lib/agentStatusSummarizer";
import { opensAsRequest, parseTranscript } from "../src/lib/sessionTranscript";
import {
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckUserAskLabel,
} from "../src/lib/terminalHeaderQuality";
import { buildTerminalHeaderState } from "../src/lib/terminalHeaderState";
import type { AgentStatusSummaryInput } from "../src/lib/agentStatusSummary";

const TAIL_BYTES = 262_144; // must match commands.rs TRANSCRIPT_TAIL_BYTES

function statusDir() {
  const dataHome =
    process.env.XDG_DATA_HOME ??
    path.join(process.env.HOME ?? "", ".local", "share");
  return path.join(dataHome, "terminal-workspace", "agent-status");
}

function homeDir() {
  return process.env.HOME ?? "";
}

/** The Rust reader's search, in JS: files first, then directories, depth-limited. */
function findFileNamed(
  root: string,
  depth: number,
  matches: (name: string) => boolean,
): string | null {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(path.join(root, entry.name));
    else if (matches(entry.name)) return path.join(root, entry.name);
  }
  if (depth === 0) return null;
  for (const dir of dirs) {
    const found = findFileNamed(dir, depth - 1, matches);
    if (found) return found;
  }
  return null;
}

function readHead(file: string) {
  const size = statSync(file).size;
  const take = Math.min(65_536, size); // matches commands.rs TRANSCRIPT_HEAD_BYTES
  const buffer = Buffer.alloc(take);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, take, 0);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

function readTail(file: string) {
  const size = statSync(file).size;
  const take = Math.min(TAIL_BYTES, size);
  const buffer = Buffer.alloc(take);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, take, size - take);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

/** Same directories and name shapes as `commands.rs session_transcript_path_in`. */
function liveTranscriptReader() {
  return async (
    provider: "claude" | "codex",
    sessionId: string,
    part: "head" | "tail" = "tail",
  ) => {
    const file =
      provider === "claude"
        ? findFileNamed(
            path.join(homeDir(), ".claude", "projects"),
            2,
            (name) => name === `${sessionId}.jsonl`,
          )
        : findFileNamed(
            path.join(homeDir(), ".codex", "sessions"),
            4,
            (name) =>
              name.startsWith("rollout-") && name.endsWith(`-${sessionId}.jsonl`),
          );
    if (!file) return null;
  // The app reads the START for the operator's opening request and the END for what is
  // happening now; the audit has to do both or it cannot see the row the app renders.
  return part === "head" ? readHead(file) : readTail(file);
  };
}

function liveSidecarReader() {
  const dir = statusDir();
  return async (fileName: string) => {
    try {
      return readFileSync(path.join(dir, fileName), "utf8");
    } catch {
      return null;
    }
  };
}

function inputFor(paneId: string, cwd: string): AgentStatusSummaryInput {
  return {
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd,
    paneId,
  } as AgentStatusSummaryInput;
}

test("a pane whose vendor session record names the work never renders the placeholder", async () => {
  const dir = statusDir();
  const names = existsSync(dir)
    ? readdirSync(dir).filter(
        (name) => name.startsWith("pane-") && name.endsWith(".json"),
      )
    : [];
  test.skip(names.length === 0, `no status files at ${dir}`);

  const readTranscript = liveTranscriptReader();
  const sidecarReader = liveSidecarReader();
  const rows: string[] = [];
  const offenders: string[] = [];

  for (const name of names) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const paneId = typeof record.paneId === "string" ? record.paneId : "";
    const cwd = typeof record.cwd === "string" ? record.cwd : "";
    const sessionId =
      typeof record.sessionId === "string" ? record.sessionId : "";
    if (!paneId || !cwd || !sessionId) continue;
    // Only panes whose record the app can still read: an ancient session whose
    // transcript was deleted has genuinely nothing to say.
    const transcript =
      (await readTranscript("claude", sessionId)) ??
      (await readTranscript("codex", sessionId));
    if (!transcript) continue;

    const result = await summarizeAgentStatus(inputFor(paneId, cwd), {
      sidecarReader,
      transcriptReader: readTranscript,
      endpoint: "",
    });

    // 1. The resolver itself must find something in the records. `shell-state` here
    //    means every on-disk source came up empty for a pane whose session record is
    //    readable — the failure the operator kept reporting.
    // A readable record is not automatically a record with something to SAY: a session
    // where the operator typed "gl" and the agent never spoke carries no title, no
    // request and no step, and the honest answer there is the placeholder.
    const facts = parseTranscript(
      transcript.includes('"ai-title"') || transcript.includes('"last-prompt"')
        ? "claude"
        : "codex",
      transcript,
    );
    // Goal-shaped facts only, judged the way the app judges them: a session title the
    // vendor wrote, or a message that reads as a REQUEST and fits the row. The agent's
    // sentence and its current tool describe the MOMENT and belong to the second row;
    // a vague line, a pasted quote or a reaction is nobody's goal.
    const request = facts.operatorRequest ?? "";
    const usableRequest =
      Boolean(opensAsRequest(request)) &&
      request.length <= 200 &&
      qualityCheckUserAskLabel(request, { maxLength: 150 }).ok;
    const hasSomethingToSay = Boolean(facts.title) || usableRequest;
    if (!hasSomethingToSay) continue;

    if (!result.taskLine || result.taskLine.source === "shell-state") {
      offenders.push(
        `${name}: resolver found nothing while the session record is readable (rejected="${result.taskLine?.rejected ?? ""}")`,
      );
      continue;
    }

    // 2. The header must render that line. Panes always HAVE a line in the app now (the
    //    central poll applies it and the workspace snapshot persists it), so this is the
    //    draw that matters.
    const header = buildTerminalHeaderState({
      paneId,
      terminalId: paneId,
      project: { id: "g", name: path.basename(cwd), projectRoot: cwd },
      liveCwd: cwd,
      terminalStatus: "running",
      statusSummary: result.summary,
      taskLine: result.taskLine,
    });
    rows.push(
      `${name} | rung=${result.taskLine.source} | goal=${header.sources.goal} | TASK=${header.goalLabel}`,
    );
    if (
      /^(?:No task declared|Task not captured)$/i.test(header.goalLabel) &&
      qualityCheckAuthoritativeTaskLabel(result.taskLine.text).ok
    ) {
      offenders.push(
        `${name}: placeholder rendered although the line said "${result.taskLine.text}" (rung=${result.taskLine.source})`,
      );
    }
  }

  console.log(rows.slice(0, 40).join("\n"));
  console.log(`panes checked: ${rows.length}`);
  expect(offenders, offenders.slice(0, 20).join("\n")).toEqual([]);
});
