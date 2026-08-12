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
import {
  preferPaneTaskLine,
  resolvePaneNowLine,
  resolvePaneTaskLine,
} from "../src/lib/taskLine";
import { statusPollProjectionChanged } from "../src/lib/statusPollProjection";
import {
  buildTerminalHeaderState,
  resetKnownTaskLines,
} from "../src/lib/terminalHeaderState";
import {
  parseClaudeOpeningRequest,
  parseClaudeTranscript,
  parseCodexOpeningRequest,
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
  const untrusted = source.slice(
    source.indexOf("if (!trusted)"),
    source.indexOf("// Never clobber a live declared task list"),
  );
  expect(untrusted).toContain("taskLine");
  expect(untrusted).toContain("const inferredProvider = stableAgentProvider");
  expect(untrusted).toContain("agentProvider: inferredProvider");
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
  expect(snapshot.slice(0, 1200)).toContain(
    "agentProvider: terminal.agentProvider",
  );
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

test("the split header shows the durable task instead of bare Working state", () => {
  const source = readFileSync(
    path.join(REPO, "src", "components", "SplitPane.tsx"),
    "utf8",
  );
  const header = source.slice(
    source.indexOf("const stabilizedHeader = stableHeader("),
    source.indexOf("const headerNow = stabilizedHeader.now"),
  );

  expect(header).toContain("paneTaskLine?.text");
  expect(header).toContain("shellHeader?.goalLabel");
  expect(header).not.toContain("shellHeader?.currentActivity) ??");
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

test("a workstream session id recovers the Task when its pane sidecar is missing", async () => {
  const result = await summarizeAgentStatus(
    {
      ...summaryInput(),
      sessionId: "a0ee2b7f-eb7e-4849-9b32-1cfd04adac1e",
    },
    {
      sidecarReader: async () => null,
      transcriptReader: async () =>
        JSON.stringify({
          type: "ai-title",
          aiTitle: "Keep the course landing page reliable",
        }),
      endpoint: "",
    },
  );

  expect(result.taskLine).toMatchObject({
    source: "session-title",
    text: "Keep the course landing page reliable",
  });
});

test("an idle pane keeps the model-authored purpose instead of promoting the latest rationale", async () => {
  const rationale =
    "because we dont have all the content in local dev we need to push this for proper verification by me";
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/bina-meatzevet-courses",
        sessionId: "019fb770-2450-7603-8d86-d62c3e3e5655",
        updatedAt: Date.now() - 60 * 60 * 1000,
        turn: "idle",
        userTask: rationale,
        todos: [
          { content: "Inspecting mobile event feed behavior", status: "completed" },
          { content: "Redesigning the reusable mobile event feed", status: "completed" },
          { content: "Waiting for remote checks and content-backed mobile review", status: "in_progress" },
        ],
      }),
    transcriptReader: async (_provider, _sessionId, part) =>
      part === "tail"
        ? JSON.stringify({
            type: "event_msg",
            payload: { type: "user_message", message: rationale },
          })
        : null,
    endpoint: "",
  });

  expect(result.taskLine).toMatchObject({
    source: "plan-purpose",
    text: "Redesigning the reusable mobile event feed",
  });
});

test("a pane with a thin follow-up retains its model-authored purpose", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/flow-state",
        updatedAt: Date.now() - 60 * 60 * 1000,
        turn: "idle",
        userTask: "go",
        todos: [
          { content: "Writing failing tests for inherited task dates", status: "completed" },
          { content: "Updating grouped task creation to keep dates", status: "completed" },
          { content: "Running tests and desktop verification", status: "in_progress" },
        ],
      }),
    endpoint: "",
  });

  expect(result.taskLine).toMatchObject({
    source: "plan-purpose",
    text: "Updating grouped task creation to keep dates",
  });
});

test("the Bina reservation pane gets one whole-conversation task title", async () => {
  const originalRequest =
    "Continue the Bina paid-reservation E2E work. First preserve the passing reservation regression. Add isolated mock or sandbox coverage for deposit checkout, Cardcom webhook settlement, balance payment, cutoff behavior, Bina-cancelled full refunds, and queued-refund execution. Never claim real money movement unless a sandbox provider confirms it.";
  let receivedContext:
    | {
        workspace?: string;
        openingRequest?: string;
        plan: string[];
      }
    | undefined;
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/bina-meatzevet-courses",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5a2",
        updatedAt: Date.now(),
        turn: "idle",
        userTask: "ran it",
        todos: [
          { content: "Reading the rules and reservation handoff", status: "completed" },
          { content: "Running the required reservation regression", status: "completed" },
          { content: "Adding isolated sandbox reservation coverage", status: "completed" },
          { content: "Running focused checks and documenting boundaries", status: "completed" },
        ],
      }),
    transcriptReader: async (_provider, _sessionId, part) => {
      if (part === "head") {
        return JSON.stringify({
          type: "user",
          message: { content: originalRequest },
        });
      }
      return JSON.stringify({
        type: "assistant",
        message: { content: "The isolated reservation checks are complete." },
      });
    },
    contextTaskSummarizer: async (context) => {
      receivedContext = context;
      return "Making Bina course reservations and refunds safe end to end";
    },
    endpoint: "",
  });

  expect(receivedContext).toMatchObject({
    workspace: "bina-meatzevet-courses",
    openingRequest: originalRequest,
    plan: [
      "Reading the rules and reservation handoff",
      "Running the required reservation regression",
      "Adding isolated sandbox reservation coverage",
      "Running focused checks and documenting boundaries",
    ],
  });
  expect(result.taskLine).toMatchObject({
    source: "context-summary",
    text: "Making Bina course reservations and refunds safe end to end",
  });
});

test("a whole-conversation title is cached across changing activity", async () => {
  let calls = 0;
  let narration = "Reading the grouped task behavior";
  const options = {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/flow-state",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5b",
        updatedAt: Date.now(),
        narration,
        todos: [
          { content: "Keeping grouped task creation dates", status: "in_progress" },
        ],
      }),
    transcriptReader: async (_provider: "claude" | "codex", _sessionId: string, part?: "head" | "tail" | "context") =>
      part === "head"
        ? JSON.stringify({
            type: "user",
            message: { content: "Keep grouped Flow State task dates correct when creating tasks" },
          })
        : JSON.stringify({ type: "assistant", message: { content: narration } }),
    contextTaskSummarizer: async () => {
      calls += 1;
      return "Keeping grouped Flow State task dates correct";
    },
    endpoint: "",
  };

  await summarizeAgentStatus(summaryInput(), options);
  narration = "Checking the finished grouped task behavior";
  const second = await summarizeAgentStatus(summaryInput(), options);

  expect(calls).toBe(1);
  expect(second.taskLine).toMatchObject({
    source: "context-summary",
    text: "Keeping grouped Flow State task dates correct",
  });
});

test("a local model title with joined words is normalized instead of discarded", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/flow-state",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5e",
        updatedAt: Date.now(),
        todos: [
          { content: "Keeping Calendar Inbox tasks visible", status: "completed" },
        ],
      }),
    transcriptReader: async (provider, _sessionId, part) =>
      provider === "codex" && part === "head"
        ? JSON.stringify({
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Keep Flow State Calendar Inbox tasks visible until their due date",
                },
              ],
            },
          })
        : provider === "codex"
          ? JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })
          : null,
    contextTaskSummarizer: async () => "KeepingFlowStateCalendarInboxTasksVisible",
    endpoint: "",
  });

  expect(result.taskLine).toMatchObject({
    source: "context-summary",
    text: "Keeping Flow State Calendar Inbox Tasks Visible",
  });
});

test("a model title may use ordinary derived words from the real request", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/rough-cut-mvp",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5f",
        updatedAt: Date.now(),
        mainTask:
          "why cant we edit it e2e if its code and open source? cant we just map it e2e?",
        todos: [],
      }),
    transcriptReader: async (provider, _sessionId, part) =>
      provider === "codex" && part === "head"
        ? JSON.stringify({
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    "is this even possible in regards to freecut? is the fact that freecut is a library - makes it hard to edit and customize?",
                },
              ],
            },
          })
        : provider === "codex"
          ? JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })
          : null,
    contextTaskSummarizer: async () =>
      "Keeping RoughCutMVP Interface Editable And Customizable",
    endpoint: "",
  });

  expect(result.taskLine).toMatchObject({
    source: "context-summary",
    text: "Keeping Rough Cut MVP Interface Editable And Customizable",
  });
});

test("the model receives the agent's processed outcome when the user request was an image", async () => {
  let receivedContext:
    | { recentActivity?: string; conversationSummary?: string }
    | undefined;
  const agentOutcome =
    "Catalog completion no longer fails during a brief refresh race.";
  await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/flow-state",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5f",
        updatedAt: Date.now(),
        narration: "Checking the shipped fix and final worktree",
        todos: [
          { content: "Checking the shipped fix and final worktree", status: "completed" },
        ],
      }),
    transcriptReader: async (provider, _sessionId, part) =>
      provider === "codex" && part !== "head"
        ? JSON.stringify({
            type: "event_msg",
            payload: { type: "agent_message", message: agentOutcome },
          })
        : null,
    contextTaskSummarizer: async (context) => {
      receivedContext = context;
      return "Keeping Flow State Catalog completion reliable";
    },
    endpoint: "",
  });

  expect(receivedContext?.recentActivity).toBe(agentOutcome);
  expect(receivedContext?.conversationSummary).toBe(agentOutcome);
});

test("a product-grounded title with an invented subject is rewritten", async () => {
  const drafts: Array<string | undefined> = [];
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/flow-state",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e60",
        updatedAt: Date.now(),
        todos: [{ content: "Checking the shipped fix", status: "completed" }],
      }),
    transcriptReader: async (provider, _sessionId, part) =>
      provider === "codex" && part !== "head"
        ? JSON.stringify({
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "Catalog completion now survives a brief refresh race.",
            },
          })
        : null,
    contextTaskSummarizer: async (_context, rejectedTitle) => {
      drafts.push(rejectedTitle);
      return rejectedTitle
        ? "Keeping Flow State catalog completion reliable"
        : "Keeping Flow State transaction clear and reliable";
    },
    endpoint: "",
  });

  expect(drafts).toEqual([
    undefined,
    "Keeping Flow State transaction clear and reliable",
  ]);
  expect(result.taskLine).toMatchObject({
    source: "context-summary",
    text: "Keeping Flow State catalog completion reliable",
  });
});

test("an overclaiming draft is corrected with the whole Bina context", async () => {
  const drafts: Array<string | undefined> = [];
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/bina-meatzevet-courses",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5d",
        updatedAt: Date.now(),
        todos: [
          { content: "Verifying deposit and balance settlement", status: "pending" },
          { content: "Verifying webhook and refund execution", status: "pending" },
        ],
      }),
    transcriptReader: async (_provider, _sessionId, part) =>
      part === "head"
        ? JSON.stringify({
            type: "user",
            message: {
              content:
                "Make Bina paid reservations and refunds safe without claiming real money movement unless Cardcom sandbox confirms it",
            },
          })
        : JSON.stringify({ type: "assistant", message: { content: "Checking boundaries" } }),
    contextTaskSummarizer: async (_context, rejectedTitle) => {
      drafts.push(rejectedTitle);
      return rejectedTitle
        ? "Ensuring Cardcom sandbox tests cover the payment flow"
        : "Verifying real transactions and production readiness for Cardcom integration";
    },
    endpoint: "",
  });

  expect(drafts).toEqual([
    undefined,
    "Verifying real transactions and production readiness for Cardcom integration",
  ]);
  expect(result.taskLine).toMatchObject({
    source: "context-summary",
    text: "Making Bina reservations and refunds safe end to end",
  });
});

test("implementation-heavy model output falls back to the proven ladder", async () => {
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo/bina-meatzevet-courses",
        sessionId: "019fc26d-587e-7643-b9f2-f45b9109e5c",
        updatedAt: Date.now(),
        todos: [
          { content: "Adding isolated sandbox reservation coverage", status: "completed" },
        ],
      }),
    transcriptReader: async (_provider, _sessionId, part) =>
      part === "head"
        ? JSON.stringify({
            type: "user",
            message: { content: "Make Bina reservations and refunds safe for course customers" },
          })
        : JSON.stringify({ type: "assistant", message: { content: "Done" } }),
    contextTaskSummarizer: async () =>
      "Adding isolated sandbox reservation coverage",
    endpoint: "",
  });

  expect(result.taskLine?.source).not.toBe("context-summary");
});

test("a restored pane recovers its concrete goal from the transcript middle", async () => {
  const concrete =
    "add the game lane and postpone the global leaderboard for later down the line. regarding the gmae it needs massive redesign because it doesnt look good or plays well. do we need to find new skills for this?";
  const requestedParts: string[] = [];
  const reader: SessionTranscriptReader = async (_provider, _sessionId, part) => {
    requestedParts.push(part ?? "tail");
    if ((part as string) === "context") {
      return [
        JSON.stringify({
          type: "user",
          message: { content: "lets continue from where we left off" },
        }),
        JSON.stringify({
          type: "user",
          message: { content: concrete },
        }),
        JSON.stringify({
          type: "user",
          message: { content: "lets stat on the first task" },
        }),
      ].join("\n");
    }
    if (part === "head") {
      return JSON.stringify({
        type: "user",
        message: { content: "lets continue from where we left off" },
      });
    }
    return [
      JSON.stringify({
        type: "ai-title",
        aiTitle: "Continue previous coding session",
      }),
      JSON.stringify({
        type: "user",
        message: { content: "lets stat on the first task" },
      }),
    ].join("\n");
  };
  const result = await summarizeAgentStatus(summaryInput(), {
    sidecarReader: async () =>
      JSON.stringify({
        cwd: "/repo",
        sessionId: "5d08990f-f461-4a4b-84ce-7626b3614267",
        updatedAt: Date.now(),
        todos: [],
        mainTask: "lets continue from where we left off",
        mainTaskSource: "opening-request",
      }),
    transcriptReader: reader,
    endpoint: "",
  });

  expect(requestedParts).toContain("context");
  expect(result.taskLine).toMatchObject({
    source: "operator-request",
    text: "add the game lane and postpone the global leaderboard for later down the line. regarding the gmae it needs massive redesign because it doesnt look…",
  });
  expect(result.summary.provider).toBe("claude");
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

test("the agent's own newest note is the NOW line, under the goal", () => {
  const input = {
    now: 1,
    recentActivity: "Checking the admin layout width constraints",
  };
  // A note about the moment is not a goal: it belongs to the second row.
  expect(resolvePaneTaskLine(input).source).toBe("shell-state");
  const now = resolvePaneNowLine(input);
  expect(now?.source).toBe("recent-activity");
  expect(now?.text).toBe("Checking the admin layout width constraints");
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

  expect(
    resolvePaneTaskLine({ now: 1, facts: { operatorRequest: "a-meatzevet-courses" } }),
  ).toMatchObject({ source: "shell-state", text: "No task declared" });
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

test("a completion report becomes a clear purpose instead of the task label", () => {
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      title:
        "The redesign is committed on a clean branch and pull request 462 is open; local unit, type, and build checks passed",
      openingRequest: "Make the Bina course redesign ready for review",
    },
  });

  expect(line).toMatchObject({
    source: "opening-request",
    text: "Make the Bina course redesign ready for review",
  });
});

test("a completion report still has a clear fallback when no request was captured", () => {
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      title:
        "The redesign is committed on a clean branch and pull request 462 is open; local unit, type, and build checks passed",
    },
  });

  expect(line).toMatchObject({
    source: "session-title",
    text: "Reviewing the redesign pull request",
  });
});

test("the original user goal outranks a later generated progress report", () => {
  const opening = "Fix the editor host-display failure and verify its first screen";
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      openingRequest: opening,
      title:
        "The existing smoke reproduced an Electron host-display failure; the editor fix is now in place",
    },
  });

  expect(line).toMatchObject({ source: "opening-request", text: opening });
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

test("the opening ask is recovered from a Codex response item", () => {
  const head = JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Continue the Bina paid-reservation work with full refunds",
        },
      ],
    },
  });

  expect(parseCodexOpeningRequest(head)).toBe(
    "Continue the Bina paid-reservation work with full refunds",
  );
});

test("Codex startup instructions cannot replace the pane's real opening request", () => {
  const head = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "# AGENTS.md instructions for /repo/flow-state\n<INSTRUCTIONS>\nKeep exactly one task active.\n</INSTRUCTIONS>\n<environment_context><cwd>/repo/flow-state</cwd></environment_context>",
          },
        ],
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Keep calendar inbox tasks visible until their due date",
          },
        ],
      },
    }),
  ].join("\n");

  expect(parseCodexOpeningRequest(head)).toBe(
    "Keep calendar inbox tasks visible until their due date",
  );
});

test("the generic local title prompt contains no pane-specific answer", () => {
  const commands = readFileSync(
    path.join(REPO, "src-tauri/src/commands.rs"),
    "utf8",
  );
  const prompt = commands.slice(
    commands.indexOf('let prompt = format!('),
    commands.indexOf('let body = serde_json::json!({'),
  );

  expect(prompt).not.toMatch(/Bina|reservations and refunds|Cardcom/i);
  expect(prompt).toContain("preserve that subject verbatim");
  expect(commands).toContain("most specific named feature or object");
  expect(prompt).toContain("fix, task, work, issue, change, process, or outcome");
  expect(commands).not.toContain('"format": "json"');
  expect(commands).toContain('"required": ["title"]');
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

test("the newest real request wins, a reaction to it does not", () => {
  const opening = "is there a completly free excersize visualization tool for my fitness bot?";
  const newest =
    "why cant I ask for multiple excersizes so it can generate many for later usage?";
  // The OPENING ask is the overarching one — reading the live table showed the newest
  // message is usually a reply inside a conversation, useless to a bystander.
  expect(
    resolvePaneTaskLine({
      now: 1,
      facts: { openingRequest: opening, operatorRequest: newest },
    }),
  ).toMatchObject({ source: "opening-request", text: opening });
  // With no opening ask, a real newer request takes the row.
  expect(
    resolvePaneTaskLine({ now: 1, facts: { operatorRequest: newest } }),
  ).toMatchObject({ source: "operator-request", text: newest });

  // ...but a reaction ("this keeps reseting", "still seeing only this") names no work,
  // so the opening request keeps the row.
  for (const reaction of [
    "this keeps reseting",
    "still seeing only this",
    "make all high",
  ]) {
    const facts = parseClaudeTranscript(
      JSON.stringify({ type: "last-prompt", lastPrompt: reaction }),
    );
    expect(facts.operatorRequest, reaction).toBeUndefined();
    expect(
      resolvePaneTaskLine({ now: 1, facts: { ...facts, openingRequest: opening } }),
      reaction,
    ).toMatchObject({ source: "opening-request" });
  }
});

test("a momentary line never takes the row from a known goal", () => {
  // "still jumpy even without me typing anything" (2026-07-28): the row swapped between
  // the goal and whatever the agent happened to be doing that second.
  const goal = {
    text: "why cant I ask multiple excersizes so it can generate many for later usage?",
    source: "operator-request" as const,
    capturedAt: 1,
    expiresAt: null,
  };
  // The session title is NOT in this list: it is the overarching description of the
  // pane, as steady as the request itself, so it may take the row.
  for (const weaker of [
    "current-tool",
    "agent-said",
    "recent-activity",
    "completed-task",
  ] as const) {
    const line = { text: "Running git status", source: weaker, capturedAt: 2, expiresAt: null };
    expect(preferPaneTaskLine(goal, line), weaker).toEqual(goal);
  }
  const structuredStep = {
    text: "Checking the task labels",
    source: "current-step" as const,
    capturedAt: 2,
    expiresAt: null,
  };
  expect(preferPaneTaskLine(goal, structuredStep)).toEqual(structuredStep);

  // A NEW request of the same rank still lands, and a declared goal outranks everything.
  const newer = { ...goal, text: "now make it export webp", capturedAt: 3 };
  expect(preferPaneTaskLine(goal, newer)).toEqual(newer);
  const declared = {
    text: "Ship the exercise animation pipeline",
    source: "declared" as const,
    capturedAt: 4,
    expiresAt: null,
  };
  expect(preferPaneTaskLine(goal, declared)).toEqual(declared);
});

test("a model-authored purpose cannot be replaced by a checklist fallback", () => {
  const contextual = {
    text: "Keeping Rough Cut MVP editing clear and reliable",
    source: "context-summary" as const,
    capturedAt: 1,
    expiresAt: null,
  };
  const fallback = {
    text: "Rebuilding the corrected packaged artifact and verifying its identity",
    source: "plan-purpose" as const,
    capturedAt: 2,
    expiresAt: null,
  };

  expect(preferPaneTaskLine(contextual, fallback)).toEqual(contextual);
});

test("the original user goal leads over generated descriptions and replies", () => {
  // Live rows read "add it yoyurself" and "how can I find this from the cms?" — the
  // operator's own words, but chatter to anyone who was not in the room. The vendor keeps
  // a session title that follows the work, so it answers "what is this pane about".
  const line = resolvePaneTaskLine({
    now: 1,
    facts: {
      title: "Add missing elements to events page",
      operatorRequest: "add it yoyurself",
      openingRequest: "the events page is missing the ticket link",
    },
  });
  expect(line).toMatchObject({
    source: "opening-request",
    text: "the events page is missing the ticket link",
  });

  // A slug title is not a description: the operator's own request keeps the row.
  expect(
    resolvePaneTaskLine({
      now: 1,
      facts: {
        title: "fix-cockpit-task-display",
        operatorRequest: "make the cards show what each terminal is working on",
      },
    }),
  ).toMatchObject({ source: "operator-request" });
});
