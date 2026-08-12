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
import { buildTerminalHeaderState } from "../src/lib/terminalHeaderState";
import { resolvePaneTaskLine } from "../src/lib/taskLine";
import {
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckNowLabel,
  qualityCheckUserAskLabel,
} from "../src/lib/terminalHeaderQuality";
import { opensAsRequest } from "../src/lib/sessionTranscript";

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

// Now Active only. Stated positively (see ACTIVITY_IN_PROGRESS in terminalHeaderQuality):
// an activity line is an action in progress or a stated outcome. Anything else is an
// instruction ("Locate the master frame reference and asset") or a report ("TH is on the
// board and verified.") — both reached live panes on 2026-07-25.
const NON_ACTIVITY_SHAPE =
  /^(?!(?:[A-Z][a-z]+ing\b|[A-Z][a-z]+(?:ed|d)\b|Ran\b|Built\b|Wrote\b|Made\b|Sent\b|Found\b|Set\b|Kept\b|Left\b|Got\b|Took\b|Put\b|Cut\b|Split\b|Read\b|Rebuilt\b|Began\b|Broke\b|Chose\b|Drew\b|Grew\b|Held\b|Knew\b|Lost\b|Met\b|Paid\b|Said\b|Saw\b|Sold\b|Spent\b|Told\b|Won\b))/;

function corpusDir() {
  const dataHome =
    process.env.XDG_DATA_HOME ??
    path.join(process.env.HOME ?? "", ".local", "share");
  return path.join(dataHome, "terminal-workspace", "agent-status");
}

/**
 * Render a pane the way the APP renders it.
 *
 * The first version of this audit called `buildShellTerminalHeaderViewModel` with no
 * stored task line — a path `SplitPane`/`MagicCanvas` never take. It therefore reported
 * 240/240 clean while the live cockpit showed "Working in termfleet" on four panes at
 * once. The app's entry point is `buildTerminalHeaderState`, and `Terminal.tsx` feeds it
 * a task line it re-stores on every poll, so BOTH cases have to be rendered.
 */
function headerFor(
  sidecar: Record<string, unknown>,
  mode: "with-stored-line" | "no-stored-line",
) {
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
    // `||`, not `??` — the hooks write `activeForm: ""` and `??` keeps the empty string,
    // which silently blanked every item on records written that way.
    content: String(todo.activeForm || todo.content || ""),
    status: (todo.status ?? "pending") as
      | "pending"
      | "in_progress"
      | "completed",
    source: "todo-write" as const,
    updatedAt: Number(sidecar.updatedAt ?? 0),
  }));
  // What `Terminal.tsx` stores after a poll: the resolver's line, folder-only inputs —
  // exactly the shape that produced the filler on screen.
  const storedTaskLine =
    mode === "with-stored-line"
      ? resolvePaneTaskLine({
          now: Date.now(),
          mainGoal:
            typeof sidecar.mainTask === "string" ? sidecar.mainTask : null,
          mainGoalSource:
            sidecar.mainTaskSource === "opening-request" ||
            sidecar.mainTaskSource === "goal-task" ||
            sidecar.mainTaskSource === "plan-explanation"
              ? sidecar.mainTaskSource
              : null,
          currentStep:
            todos.find((todo) => todo.status === "in_progress")?.content ??
            null,
          facts:
            typeof sidecar.userTask === "string" && sidecar.userTask.trim()
              ? { operatorRequest: sidecar.userTask.trim() }
              : null,
          lastCompletedTask:
            [...todos].reverse().find((todo) => todo.status === "completed")
              ?.content ?? null,
          folder: path.basename(cwd),
        })
      : undefined;

  // The app stores the operator's ask on the terminal (Terminal.tsx keeps `mainUserAsk`
  // from the same record), so the audit has to supply it in BOTH modes. Omitting it made
  // the first-draw case report 21 panes as broken that the app renders correctly — an
  // audit that lies in the pessimistic direction still wastes the session.
  const mainUserAsk =
    typeof sidecar.userTask === "string" && sidecar.userTask.trim()
      ? {
          text: sidecar.userTask.trim(),
          source: "status-sidecar" as const,
          updatedAt: Number(sidecar.updatedAt ?? 0),
        }
      : undefined;

  const header = buildTerminalHeaderState({
    paneId: `pane-${path.basename(cwd)}`,
    terminalId: `pty-${path.basename(cwd)}`,
    project: { id: "g", name: path.basename(cwd), projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup,
    mainUserAsk,
    statusSummary: summary,
    taskLine: storedTaskLine,
  });
  // The chosen SOURCE is in every row: "No task declared" from the last rung and the
  // same words from the operator's ask look identical in a table, and only the source
  // says which layer to fix.
  return {
    task: header.goalLabel,
    now: header.currentActivity,
    goalSource: header.sources.goal,
  };
}

const usableAsk = (value: string) => {
  const asked = opensAsRequest(value.trim());
  // Same two gates the resolver applies: it must read as a request, and it must survive
  // the operator-ask check (a request that is mostly a file reference is not a goal).
  return Boolean(asked) && qualityCheckUserAskLabel(asked, { maxLength: 150 }).ok;
};

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
    const ageMin = Math.round(
      (Date.now() - Number(sidecar.updatedAt ?? 0)) / 60000,
    );

    // Both cases: the pane as first drawn, and the pane after a poll has stored a line.
    for (const mode of ["no-stored-line", "with-stored-line"] as const) {
      let task: string;
      let now: string;
      let goalSource = "?";
      try {
        ({ task, now, goalSource } = headerFor(sidecar, mode));
      } catch (error) {
        offenders.push(`${id} [${mode}]: threw ${(error as Error).message}`);
        continue;
      }

      rows.push(
        `${id} | ${ageMin}m | ${path.basename(String(sidecar.cwd ?? "?"))} | ${mode} | goal=${goalSource} | TASK=${task} | NOW=${now}`,
      );

      // The invariant that would have caught the 2026-07-26 report: this pane had a
      // fresh request and 8 finished tasks, and still rendered "No task declared". A
      // placeholder is only honest when the record genuinely holds nothing to say, so
      // it is an OFFENCE whenever the sidecar carries a goal, a request or a list.
      // "Knows something" means something SAYABLE. A record whose only content is
      // "/dropoff", "$done", "continue" or "make all high" genuinely has no task to
      // state, and the placeholder is the honest answer there — demanding otherwise
      // would push the header back into inventing text.
      const sayable = (value: unknown, source?: unknown) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        (source === "opening-request"
          ? qualityCheckUserAskLabel(value.trim(), { maxLength: 150 }).ok
          : qualityCheckAuthoritativeTaskLabel(value.trim()).ok);
      // The Task row is the GOAL row (operator's layout, 2026-07-28: goal on top, what
      // the pane is doing under it). So only goal-shaped content obliges it to speak: a
      // request that names work, or an explicitly declared main task. A task list is a
      // list of STEPS — those are the second row's job, and treating one as the goal is
      // what produced changing, vague headlines like "Updating the plan".
      const sidecarKnowsSomething =
        usableAsk(String(sidecar.userTask ?? "")) ||
        sayable(sidecar.mainTask, sidecar.mainTaskSource);
      // The goal row may honestly say nothing when the record holds only steps and
      // reactions — the pane's moment is stated on the second row instead. It is only an
      // offence when the record holds a real REQUEST or a declared goal.
      if (
        sidecarKnowsSomething &&
        /^(?:No task declared|Task not captured)$/i.test(task)
      ) {
        offenders.push(
          `${id} [${mode}]: placeholder Task while the record holds a goal/request/list -> ${task}`,
        );
      }
      // A slug is a name for a machine. "exercise-demo-gif-pipeline" told the operator
      // nothing a week later (report 2026-07-28), so it may never reach the row — the
      // ladder de-slugs it into words before it gets here.
      if (/^[a-z0-9]+(?:[-_][a-z0-9]+){1,}$/.test(task.trim())) {
        offenders.push(`${id} [${mode}]: slug as the Task row -> ${task}`);
      }
      if (
        !HONEST_FALLBACKS.has(now) &&
        NON_ACTIVITY_SHAPE.test(now) &&
        !qualityCheckNowLabel(now).ok
      ) {
        offenders.push(
          `${id} [${mode}]: non-activity-shape as Now Active -> ${now}`,
        );
      }
      for (const check of CHECKS) {
        if (!HONEST_FALLBACKS.has(now) && check.test.test(now)) {
          offenders.push(
            `${id} [${mode}]: ${check.name} as Now Active -> ${now}`,
          );
        }
        if (
          check.appliesToTask &&
          !HONEST_FALLBACKS.has(task) &&
          check.test.test(task)
        ) {
          offenders.push(`${id} [${mode}]: ${check.name} as Task -> ${task}`);
        }
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
