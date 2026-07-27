// How many ACTIVE terminals can the Task row speak for, and why not the rest.
//
// `task-line-live-records.spec.ts` proves the resolver never wastes a readable session
// record. This one is the coverage report the operator actually asks for — "it still
// happens on some terminals" — over every record inside the freshness window, including
// the ones with no conversation id at all. It prints the reason per pane and fails only
// when a pane that HAS something sayable still resolves to the placeholder.
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
import { qualityCheckAuthoritativeTaskLabel } from "../src/lib/terminalHeaderQuality";
import type { AgentStatusSummaryInput } from "../src/lib/agentStatusSummary";

const TAIL_BYTES = 262_144;
const FRESH_MS = 30 * 60 * 1000;

function statusDir() {
  const dataHome =
    process.env.XDG_DATA_HOME ??
    path.join(process.env.HOME ?? "", ".local", "share");
  return path.join(dataHome, "terminal-workspace", "agent-status");
}

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

const home = process.env.HOME ?? "";
const readTranscript = async (
  provider: "claude" | "codex",
  sessionId: string,
) => {
  const file =
    provider === "claude"
      ? findFileNamed(
          path.join(home, ".claude", "projects"),
          2,
          (name) => name === `${sessionId}.jsonl`,
        )
      : findFileNamed(
          path.join(home, ".codex", "sessions"),
          4,
          (name) =>
            name.startsWith("rollout-") && name.endsWith(`-${sessionId}.jsonl`),
        );
  return file ? readTail(file) : null;
};

test("every ACTIVE terminal that has something sayable gets a task line", async () => {
  const dir = statusDir();
  const names = existsSync(dir)
    ? readdirSync(dir).filter(
        (name) => name.startsWith("pane-") && name.endsWith(".json"),
      )
    : [];
  test.skip(names.length === 0, `no status files at ${dir}`);

  const sidecarReader = async (fileName: string) => {
    try {
      return readFileSync(path.join(dir, fileName), "utf8");
    } catch {
      return null;
    }
  };

  const byRung = new Map<string, number>();
  const silent: string[] = [];
  const offenders: string[] = [];
  let active = 0;

  for (const name of names) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (Date.now() - Number(record.updatedAt ?? 0) > FRESH_MS) continue;
    const paneId = typeof record.paneId === "string" ? record.paneId : "";
    if (!paneId) continue;
    active += 1;

    const result = await summarizeAgentStatus(
      {
        mission: "Terminal",
        provider: "shell",
        status: "running",
        cwd: typeof record.cwd === "string" ? record.cwd : undefined,
        paneId,
      } as AgentStatusSummaryInput,
      { sidecarReader, transcriptReader: readTranscript, endpoint: "" },
    );
    const rung = result.taskLine?.source ?? "none";
    byRung.set(rung, (byRung.get(rung) ?? 0) + 1);
    if (rung !== "shell-state") continue;

    // Nothing sayable is an honest silence: no session record, no goal, no request that
    // survives the plain-language gate, no task list, no note.
    const sayable = (value: unknown) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      qualityCheckAuthoritativeTaskLabel(value.trim()).ok;
    const knows =
      sayable(record.userTask) ||
      sayable(record.mainTask) ||
      sayable(record.narration) ||
      (Array.isArray(record.todos) &&
        (record.todos as Record<string, unknown>[]).some(
          (todo) => sayable(todo.activeForm) || sayable(todo.content),
        ));
    silent.push(
      `${name} (sessionId=${record.sessionId ? "yes" : "no"}, rejected="${result.taskLine?.rejected ?? ""}")`,
    );
    if (knows) {
      offenders.push(
        `${name}: says nothing although its own record holds sayable text (rejected="${result.taskLine?.rejected ?? ""}")`,
      );
    }
  }

  console.log(
    `active terminals: ${active} | ${[...byRung.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rung, count]) => `${rung}=${count}`)
      .join(" ")}`,
  );
  if (silent.length) console.log(`silent panes:\n${silent.join("\n")}`);
  expect(offenders, offenders.join("\n")).toEqual([]);
});
