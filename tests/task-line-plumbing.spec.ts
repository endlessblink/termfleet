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
import { parseClaudeTranscript } from "../src/lib/sessionTranscript";
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
      operatorRequest:
        "I want to be able to switch codex sessions without being logged out - last time when I did that all services that were running stopped",
    },
  });
  expect(line.source).toBe("operator-request");
  expect(line.text.endsWith("…")).toBe(true);
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
