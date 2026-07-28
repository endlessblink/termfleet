// The Task line's PLUMBING, not its wording.
//
// The ladder was right and the records were right; the line still never reached the
// screen (operator report 2026-07-27). Every hole was a piece of plumbing: a return path
// that omitted the line, the one loop that visits every pane discarding it, a change
// detector that could not see it, and a persisted snapshot that dropped it so the first
// paint after a relaunch had nothing. Each of those is pinned here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import {
  summarizeAgentStatus,
  type SessionTranscriptReader,
} from "../src/lib/agentStatusSummarizer";
import { preferPaneTaskLine, resolvePaneTaskLine } from "../src/lib/taskLine";
import { statusPollProjectionChanged } from "../src/lib/statusPollProjection";
import {
  buildTerminalHeaderState,
  resetKnownTaskLines,
} from "../src/lib/terminalHeaderState";
import {
  parseClaudeOpeningRequest,
  parseClaudeTranscript,
} from "../src/lib/sessionTranscript";
import type { AgentStatusSummaryInput } from "../src/lib/agentStatusSummary";
import type { TerminalState } from "../src/lib/types";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const REAL_LINE = {
  text: "Fix course page sections not displaying",
  source: "session-title" as const,
  capturedAt: 1,
  expiresAt: null,
};
const FILLER_LINE = {
  text: "No task declared",
  source: "shell-state" as const,
  capturedAt: 2,
  expiresAt: null,
};

test("filler never replaces a line that named the work", () => {
  expect(preferPaneTaskLine(REAL_LINE, FILLER_LINE)).toEqual(REAL_LINE);
  expect(preferPaneTaskLine(FILLER_LINE, REAL_LINE)).toEqual(REAL_LINE);
  expect(preferPaneTaskLine(undefined, FILLER_LINE)).toEqual(FILLER_LINE);
  expect(preferPaneTaskLine(REAL_LINE, undefined)).toEqual(REAL_LINE);
});

test("a task-line-only change is a change the poll must write", () => {
  const terminal = { id: "t", paneId: "p", cols: 80, rows: 24 } as TerminalState;
  expect(statusPollProjectionChanged(terminal, { taskLine: REAL_LINE })).toBe(
    true,
  );
  expect(
    statusPollProjectionChanged(
      { ...terminal, taskLine: REAL_LINE },
      { taskLine: REAL_LINE },
    ),
  ).toBe(false);
});

test("the central poll loop applies the line for every pane, trusted or not", () => {
  const source = readFileSync(
    path.join(REPO,"src", "lib", "statusPollLoop.ts"),
    "utf8",
  );
  // This loop is the ONLY one that visits panes whose runtime is off screen.
  expect(source).toContain("preferPaneTaskLine");
  const untrusted = source.slice(source.indexOf("if (!trusted)"));
  expect(untrusted).toContain("taskLine");
});

test("the persisted workspace snapshot keeps the last known line", () => {
  const source = readFileSync(
    path.join(REPO,"src", "stores", "workspace.ts"),
    "utf8",
  );
  const snapshot = source.slice(
    source.indexOf("function persistedTerminalSnapshot"),
  );
  expect(snapshot.slice(0, 1200)).toContain("taskLine: terminal.taskLine");
});

test("every header route reads both places the line is stored", () => {
  for (const file of ["MagicCanvas.tsx", "SplitPane.tsx"]) {
    const source = readFileSync(
      path.join(REPO,"src", "components", file),
      "utf8",
    );
    // Agent-kind tabs store it on the workstream, shell tabs on the terminal.
    expect(source, `${file} must read the workstream line too`).toMatch(
      /[\w?.]*\.taskLine \?\? [\w?.]*\.taskLine/,
    );
  }
});

function summaryInput(): AgentStatusSummaryInput {
  return {
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo",
    paneId: "terminal-tab-pane",
  } as AgentStatusSummaryInput;
}

const sidecarWithSession = async () =>
  JSON.stringify({
    cwd: "/repo",
    sessionId: "a0ee2b7f-eb7e-4849-9b32-1cfd04adac1e",
    updatedAt: Date.now(),
    todos: [],
    userTask: "/done",
  });

const transcriptReader: SessionTranscriptReader = async () =>
  [
    JSON.stringify({
      type: "ai-title",
      aiTitle: "Fix course page sections not displaying",
    }),
  ].join("\n");

test("the line rides on the endpoint path too", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: sidecarWithSession,
    transcriptReader,
    endpoint: "http://127.0.0.1:1/summary",
    fetcher: (async () =>
      new Response(JSON.stringify({ task: "whatever" }), {
        status: 200,
      })) as typeof fetch,
  });
  expect(result.source).toBe("process");
  expect(result.taskLine?.source).toBe("session-title");
});

test("the line survives an endpoint failure", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: sidecarWithSession,
    transcriptReader,
    endpoint: "http://127.0.0.1:1/summary",
    fetcher: (async () => {
      throw new Error("connection refused");
    }) as typeof fetch,
  });
  expect(result.error).toContain("connection refused");
  expect(result.taskLine?.text).toBe("Fix course page sections not displaying");
});

test("a pending question becomes the line, and stops being it once answered", () => {
  const asked = parseClaudeTranscript(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question:
                    "How should the blur over the pixelation be controlled?",
                  header: "Blur control",
                },
              ],
            },
          },
        ],
      },
    }),
  );
  expect(asked.pendingQuestion?.header).toBe("Blur control");
  const line = resolvePaneTaskLine({ now: 1, facts: asked });
  expect(line.source).toBe("pending-question");
  expect(line.text).toBe(
    "Waiting on your answer: how should the blur over the pixelation be controlled",
  );

  const answered = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              input: { questions: [{ question: "Which one wins?" }] },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/a/b.ts" } },
          ],
        },
      }),
    ].join("\n"),
  );
  expect(answered.pendingQuestion).toBeUndefined();
});

test("a long question falls back to its short subject", () => {
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      pendingQuestion: {
        question:
          "The map file still holds another agent session's unfinished work, so committing my toolbar would commit theirs too — how do you want to handle that before I push anything?",
        header: "Shared file",
      },
    },
  });
  expect(line.source).toBe("pending-question");
  expect(line.text).toBe("Waiting on your answer about shared file");
});

test("the agent's own newest note beats admitting nothing is known", () => {
  const line = resolvePaneTaskLine({
    now: 1,
    recentActivity: "Checking the admin layout width constraints",
  });
  expect(line.source).toBe("recent-activity");
  expect(line.text).toBe("Checking the admin layout width constraints");
});

test("a pasted document is not the operator's request", () => {
  // The live pane that rendered a Hebrew spec sheet as its Task row (2026-07-28). The
  // hooks cap the recorded ask at 220 characters, so text at that scale was pasted.
  const pasted = "לפני חודש (1) עודכן אין עדיין עוקבים מסוף טסטים לביצוע בדיקות מערכת אישורית זהב פרופיל נמוך: על מנת לבדוק את הממשקים קיים מסוף בדיקות מיוחד התומך בכל סוגי הממשקים. מספר המסוף = TerminalNumber = 1000 משתמש ממשקים";
  const line = resolvePaneTaskLine({
    now: 1,
    facts: { operatorRequest: pasted },
  });
  expect(line.source).toBe("shell-state");
  expect(line.rejected).toBe(pasted);
});

test("a genuinely long request is still fitted to the row", () => {
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      // Longer than the two-line box (150), shorter than the paste ceiling (200).
      operatorRequest:
        "I want to be able to switch codex sessions without being logged out, because last time I did that every running service stopped and I had to start them again by hand",
    },
  });
  expect(line.source).toBe("operator-request");
  expect(line.text.endsWith("…")).toBe(true);
  expect(line.text.length).toBeLessThanOrEqual(150);
});

test("harness plumbing in the prompt field is never a task", () => {
  for (const text of [
    "<task-notification> <task-id>bpaut11e6</task-id> <tool-use-id>toolu_01UJ</tool-use-id> <output-file>/tmp/x.log</output-file>",
    "<system-reminder> the task tools have not been used recently </system-reminder>",
  ]) {
    const line = resolvePaneTaskLine({ now: 1, facts: { operatorRequest: text } });
    expect(line.source, text.slice(0, 30)).toBe("shell-state");
  }
});

test("the row never flips back to the placeholder once a pane has spoken", () => {
  resetKnownTaskLines();
  const base = {
    paneId: "pane-flap",
    terminalId: "pty-flap",
    project: { id: "g", name: "bina", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running" as const,
  };
  const withLine = buildTerminalHeaderState({
    ...base,
    taskLine: {
      text: "push to production safely",
      source: "operator-request" as const,
      capturedAt: 1,
      expiresAt: null,
    },
  });
  expect(withLine.goalLabel).toBe("push to production safely");

  // The same pane re-rendered by a route holding nothing: a reattach, a store rebuild,
  // a map pane-id switch. This is what made the row flap every few seconds.
  const withoutLine = buildTerminalHeaderState({ ...base });
  expect(withoutLine.goalLabel).toBe("push to production safely");

  // A different pane must not inherit it.
  const otherPane = buildTerminalHeaderState({
    ...base,
    paneId: "pane-other",
    terminalId: "pty-other",
  });
  expect(otherPane.goalLabel).toBe("No task declared");
});

test("the operator's opening ask leads, and a slug never reaches the row", () => {
  // Verbatim from the operator's screenshot: this pane read "exercise-demo-gif-pipeline".
  const opening = "Make the exercise bot generate its own demo animations";
  expect(
    resolvePaneTaskLine({
      now: 1,
      facts: { openingRequest: opening, title: "exercise-demo-gif-pipeline" },
    }),
  ).toMatchObject({ source: "opening-request", text: opening });

  // With no opening ask, the slug is spaced into words rather than printed raw.
  expect(
    resolvePaneTaskLine({ now: 1, facts: { title: "fix-cockpit-task-display" } }),
  ).toMatchObject({ source: "session-title", text: "Fix cockpit task display" });
});

test("the clearest session title wins, not the newest", () => {
  // The exercise session carried BOTH: the readable one first, the slug later. The app
  // took the last and showed the slug.
  const facts = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "ai-title",
        aiTitle: "Find free exercise visualization tool for fitness bot",
      }),
      JSON.stringify({ type: "ai-title", aiTitle: "exercise-demo-gif-pipeline" }),
    ].join("\n"),
  );
  expect(facts.title).toBe("Find free exercise visualization tool for fitness bot");
});

test("the opening ask is the first REAL request, not plumbing", () => {
  const head = [
    JSON.stringify({ type: "user", message: { content: "/dropoff" } }),
    JSON.stringify({
      type: "user",
      message: { content: "<task-notification> <task-id>bx1</task-id> </task-notification>" },
    }),
    JSON.stringify({
      type: "user",
      isSidechain: true,
      message: { content: "You are a subagent. Investigate the failing test." },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "text", text: "I need a way to censor parts of the screen while zoomed" },
        ],
      },
    }),
  ].join("\n");
  expect(parseClaudeOpeningRequest(head)).toBe(
    "I need a way to censor parts of the screen while zoomed",
  );
});

test("a two-line goal is kept whole; a document is still refused", () => {
  const long =
    "I want to be able to switch codex sessions without being logged out, because last time every service that was running stopped and I had to start them all again by hand";
  const line = resolvePaneTaskLine({ now: 1, facts: { openingRequest: long } });
  expect(line.source).toBe("opening-request");
  expect(line.text.length).toBeGreaterThan(96);
  expect(line.text.length).toBeLessThanOrEqual(150);
  expect(
    resolvePaneTaskLine({
      now: 1,
      facts: { openingRequest: "x".repeat(205) },
    }).source,
  ).toBe("shell-state");
});

test("the operator's own typing is not judged like a scrape", () => {
  // Both verbatim from live records that rendered the agent's session slug instead: the
  // strict gate rejected the first for the typo "dont" and the second for its opener.
  for (const ask of [
    "tasks still dont appear properly - do a super deep dive",
    "is there a completly free excersize visualization tool I can use for my fitness bot?",
  ]) {
    const line = resolvePaneTaskLine({
      now: 1,
      facts: { openingRequest: ask, title: "exercise-demo-gif-pipeline" },
    });
    expect(line, ask).toMatchObject({ source: "opening-request", text: ask });
  }
});

test("leniency for the operator stops at readability", () => {
  // A command, a path or a bare acknowledgement is still not a goal, however it arrived.
  for (const ask of [
    "npm run build",
    "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    "sure",
  ]) {
    expect(
      resolvePaneTaskLine({ now: 1, facts: { openingRequest: ask } }).source,
      ask,
    ).toBe("shell-state");
  }
});
