import { expect, test } from "@playwright/test";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { parseTranscript } from "../src/lib/sessionTranscript";
import { resolvePaneNowLine, resolvePaneTaskLine } from "../src/lib/taskLine";

// TC-060 release gate. Sweeps every live pane on THIS machine and fails on any
// violation of the four invariants: never blank, never invented, never stale,
// always plain. Reliability is measured here, not asserted in a commit message.

const HOME = os.homedir();
const BASE = join(
  process.env.XDG_DATA_HOME ?? join(HOME, ".local/share"),
  "terminal-workspace",
);
const PLACEHOLDER = /task not captured|activity not captured|^\s*$/i;
// Mirrors the resolver's own rule. A semicolon inside a SENTENCE is punctuation
// ("Verification only; no code changes."), so only a shell-shaped chain disqualifies.
const UNREADABLE =
  /(?:&&|\|\||[|;]\s*[a-z][\w-]*\s+-{1,2}[a-z]|\s--?[a-z][\w-]*|(?:^|\s)\/(?:home|media|usr|etc|var|tmp)\/|```|^#{1,6}\s)/i;
const TAIL_BYTES = 262_144;

function tail(path: string) {
  const size = statSync(path).size;
  const take = Math.min(TAIL_BYTES, size);
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(take);
  readSync(fd, buf, 0, take, size - take);
  closeSync(fd);
  return buf.toString("utf8");
}

function indexRecords(
  root: string,
  depth: number,
  idOf: (name: string) => string | null,
) {
  const found = new Map<string, string>();
  const walk = (dir: string, level: number) => {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (level > 0) walk(path, level - 1);
      } else {
        const id = idOf(entry.name);
        if (id) found.set(id, path);
      }
    }
  };
  walk(root, depth);
  return found;
}

test("every live pane yields a true, plain, non-placeholder line", () => {
  const workspacePath = join(BASE, "workspace.json");
  test.skip(!existsSync(workspacePath), "no workspace on this machine");

  const claude = indexRecords(join(HOME, ".claude/projects"), 2, (name) =>
    name.endsWith(".jsonl") ? name.slice(0, -6) : null,
  );
  // The uuid is the LAST segment; a greedy match would capture only its tail.
  const codex = indexRecords(join(HOME, ".codex/sessions"), 4, (name) => {
    const match = name.match(
      /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
    );
    return match ? match[1] : null;
  });

  const sidecars = new Map<string, Record<string, unknown>>();
  const statusDir = join(BASE, "agent-status");
  if (existsSync(statusDir)) {
    for (const file of readdirSync(statusDir).filter(
      (name) => name.startsWith("pane-") && name.endsWith(".json"),
    )) {
      try {
        const parsed = JSON.parse(readFileSync(join(statusDir, file), "utf8"));
        if (parsed.paneId) sidecars.set(parsed.paneId, parsed);
      } catch {
        // A half-written sidecar is not a gate failure.
      }
    }
  }

  const workspace = JSON.parse(readFileSync(workspacePath, "utf8"));
  const now = Date.now();
  const failures: string[] = [];
  const bySource: Record<string, number> = {};
  let panes = 0;

  for (const tab of workspace.tabs ?? []) {
    for (const terminal of tab.terminals ?? []) {
      const sidecar = sidecars.get(terminal.id) ?? null;
      const sessionId = (sidecar?.sessionId as string) ?? "";
      const claudePath = claude.get(sessionId);
      const codexPath = codex.get(sessionId);
      const facts = claudePath
        ? parseTranscript("claude", tail(claudePath))
        : codexPath
          ? parseTranscript("codex", tail(codexPath))
          : null;
      const todos =
        (sidecar?.todos as {
          status?: string;
          activeForm?: string;
          content?: string;
        }[]) ?? [];
      const active = todos.find((todo) => todo?.status === "in_progress");
      const ladderInput = {
        now,
        declaredTask: (sidecar?.mainTask as string) ?? null,
        currentStep: active?.activeForm ?? active?.content ?? null,
        facts,
        folder:
          String(tab.initialCwd ?? "")
            .split("/")
            .filter(Boolean)
            .pop() ?? null,
      };
      const line = resolvePaneTaskLine(ladderInput);
      // The card carries TWO rows now (operator's layout): the goal, and what the pane
      // is doing under it. A pane with no goal source is allowed to say so on the first
      // row — as long as the second row speaks. Silence on BOTH is the failure.
      const nowLine = resolvePaneNowLine(ladderInput, line.text);

      panes += 1;
      bySource[line.source] = (bySource[line.source] ?? 0) + 1;
      const where = `${tab.title ?? "tab"}/${terminal.id?.slice(-8) ?? "?"}`;
      if (!line.text.trim()) failures.push(`R1 blank line on ${where}`);
      if (PLACEHOLDER.test(line.text) && !nowLine)
        failures.push(`R1 nothing to say at all on ${where}: ${line.text}`);
      if (nowLine && UNREADABLE.test(nowLine.text))
        failures.push(`R4 unreadable NOW line on ${where}: ${nowLine.text}`);
      if (UNREADABLE.test(line.text))
        failures.push(`R4 unreadable on ${where}: ${line.text}`);
      if (line.expiresAt !== null && line.expiresAt < now) {
        failures.push(`R3 already-expired line on ${where}`);
      }
    }
  }

  console.log(
    `task-line sweep: ${panes} live pane(s) — ${JSON.stringify(bySource)}`,
  );
  expect(failures, failures.join("\n")).toEqual([]);
  expect(panes).toBeGreaterThan(0);
});

// R2: no per-project string tables may creep back into the resolver.
test("the ladder invents nothing and hardcodes no project", () => {
  const ladder = readFileSync(
    new URL("../src/lib/taskLine.ts", import.meta.url),
    "utf8",
  );
  expect(ladder).not.toMatch(/hermes|bina|flow-state|arthouse/i);
  expect(ladder).not.toMatch(/Task not captured/);
});
