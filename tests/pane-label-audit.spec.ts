import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { summaryFromSidecar } from "../src/lib/agentStatusSidecar";
import { buildShellTerminalHeaderViewModel } from "../src/lib/terminalHeaderViewModel";

/**
 * Read what EVERY pane on this machine actually renders — Task row and Now Active —
 * and fail on the shapes a non-developer cannot read.
 *
 * `cockpit-sidecar-corpus.spec.ts` also runs over the live sidecars, but with four
 * narrow heuristics (slash command, numbered fragment, placeholder, truncated prose),
 * so it passed green while a live sweep on 2026-07-25 found 146 of 239 panes rendering
 * junk: operator hand-off checklists ("Steps - Log out and back in."), instructions
 * rather than activity ("Confirm Tailscale is actually running"), raw tool identifiers
 * and env-var command lines, and text mangled by inline-code stripping ("no , no , no .").
 *
 * The full table is written to `.audit/pane-labels.txt` so the rendered lines can be
 * READ, not guessed at — the failure list alone is what let the junk accumulate.
 */

const HONEST_FALLBACKS = new Set([
  "Task not captured",
  "Activity not captured",
  "Awaiting next action",
  "No active work",
  "Ready for next task",
  "Status unavailable",
  "Idle",
  "Working",
  "Ready",
]);

const CHECKS: { name: string; test: RegExp; appliesToTask?: boolean }[] = [
  // An operator hand-off checklist is what the human may do next, not pane activity.
  {
    name: "operator-checklist",
    test: /^(?:Next\s+steps|Steps)\b\s*[-:—]/i,
    appliesToTask: true,
  },
  // Text mangled by stripping inline code: a space can never precede a comma/full stop.
  { name: "mangled-by-stripping", test: /\s[,.](?:\s|$)/, appliesToTask: true },
  // Raw developer detail: tool identifiers, env-var command lines, urls, absolute paths.
  {
    name: "tool-identifier",
    test: /\b[a-z][a-z0-9]*__[a-z0-9_]+/,
    appliesToTask: true,
  },
  {
    name: "env-var-command",
    test: /\b[A-Z][A-Z0-9_]{2,}=/,
    appliesToTask: true,
  },
  {
    name: "url-or-abs-path",
    test: /:\/\/|\/(?:home|media|usr|etc|var|tmp|opt|root)\//,
    appliesToTask: true,
  },
  // A line that starts mid-sentence — the "0.07s" decimal-split class.
  {
    name: "starts-mid-sentence",
    test: /^\d|^(?:and|but|or|so|also|both|plus|then|because|however|which|too)\b/i,
  },
  // A markdown label the agent wrote for a human reader, or a punctuation fragment.
  {
    name: "label-or-fragment",
    test: /^(?:md|note|tldr|summary|result|status|evidence)\s*:\s|^[^\p{L}\p{N}"'(]/iu,
  },
  // Class A1 in docs/cockpit-label-quality-matrix.md — the class this audit missed on
  // its first pass, because the text is well-formed English that says nothing. A pane
  // rendering a template over its own folder name has told the operator nothing they
  // could not read off the path already.
  {
    name: "contentless-folder-template",
    test: /^(?:Sitting at a command prompt|Working|Busy|Active)\b(?:\s+in\b|$)/i,
    appliesToTask: true,
  },
];

function corpusDir() {
  const dataHome =
    process.env.XDG_DATA_HOME ??
    path.join(process.env.HOME ?? "", ".local", "share");
  return path.join(dataHome, "terminal-workspace", "agent-status");
}

function headerFor(sidecar: Record<string, unknown>) {
  const cwd = typeof sidecar.cwd === "string" ? sidecar.cwd : "/repo";
  const fallback = {
    task: "Ready",
    path: cwd,
    now: "Awaiting command",
    status: "idle" as const,
    provider: "shell" as const,
    confidence: "low" as const,
    tasksFromTodoWrite: false,
  };
  const summary = summaryFromSidecar(sidecar as never, fallback as never);
  const todos = Array.isArray(sidecar.todos)
    ? (sidecar.todos as Record<string, unknown>[])
    : [];
  const taskLineup = todos.map((todo, index) => ({
    id: String(todo.id ?? index),
    content: String(todo.activeForm ?? todo.content ?? ""),
    status: (todo.status ?? "pending") as
      | "pending"
      | "in_progress"
      | "completed",
    source: "todo-write" as const,
    updatedAt: Number(sidecar.updatedAt ?? 0),
  }));
  return buildShellTerminalHeaderViewModel({
    project: { id: "g", name: path.basename(cwd), projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup,
    statusSummary: summary,
  });
}

test("every pane on this machine renders a readable Task row and Now Active line", () => {
  const dir = corpusDir();
  const names = existsSync(dir)
    ? readdirSync(dir).filter(
        (name) => name.startsWith("pane-") && name.endsWith(".json"),
      )
    : [];
  test.skip(names.length === 0, `no sidecars at ${dir}`);

  const rows: string[] = [];
  const offenders: string[] = [];

  for (const name of names) {
    const id = name.replace(/^pane-|\.json$/g, "");
    let sidecar: Record<string, unknown>;
    try {
      sidecar = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    let task: string;
    let now: string;
    try {
      const header = headerFor(sidecar);
      task = header.taskDescription.text;
      now = header.title.text;
    } catch (error) {
      offenders.push(`${id}: threw ${(error as Error).message}`);
      continue;
    }

    const ageMin = Math.round(
      (Date.now() - Number(sidecar.updatedAt ?? 0)) / 60000,
    );
    rows.push(
      `${id} | ${ageMin}m | ${path.basename(String(sidecar.cwd ?? "?"))} | TASK=${task} | NOW=${now}`,
    );

    for (const check of CHECKS) {
      if (!HONEST_FALLBACKS.has(now) && check.test.test(now)) {
        offenders.push(`${id}: ${check.name} as Now Active -> ${now}`);
      }
      if (
        check.appliesToTask &&
        !HONEST_FALLBACKS.has(task) &&
        check.test.test(task)
      ) {
        offenders.push(`${id}: ${check.name} as Task -> ${task}`);
      }
    }
  }

  const outDir = path.join(process.cwd(), ".audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "pane-labels.txt"),
    `${rows.sort().join("\n")}\n`,
  );

  expect(
    offenders,
    `${rows.length} panes rendered; full table in .audit/pane-labels.txt`,
  ).toEqual([]);
});
