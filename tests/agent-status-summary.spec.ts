import { expect, test } from "@playwright/test";
import {
  fallbackAgentStatusSummary,
  parseAgentStatusSummaryResponse,
} from "../src/lib/agentStatusSummary";
import { summarizeAgentStatus } from "../src/lib/agentStatusSummarizer";

test("parses strict LLM status JSON into visible agent status", () => {
  const fallback = fallbackAgentStatusSummary({
    mission: "Fix TC-016i header",
    provider: "codex",
    status: "running",
    phase: "active",
    cwd: "/workspace/termfleet",
    currentActivity: "Running tests",
  });

  const summary = parseAgentStatusSummaryResponse(JSON.stringify({
    task: "Redesign the agent map header",
    path: "src/components/MagicCanvas.tsx",
    now: "Adding Working on, Path, and Now rows",
    status: "working",
    provider: "codex",
    confidence: "high",
  }), fallback);

  expect(summary).toEqual({
    task: "Redesign the agent map header",
    path: "src/components/MagicCanvas.tsx",
    now: "Adding Working on, Path, and Now rows",
    status: "working",
    provider: "codex",
    confidence: "high",
    blocker: undefined,
    proof: undefined,
  });
});

test("falls back to mission and path when LLM output is malformed", () => {
  const fallback = fallbackAgentStatusSummary({
    mission: "Add visible task/path status",
    provider: "claude",
    status: "running",
    phase: "active",
    cwd: "/workspace/termfleet",
    gitBranch: "tc-016i",
    currentActivity: "/clear",
    nextAction: "Update map card header",
  });

  const summary = parseAgentStatusSummaryResponse("{not json", fallback);

  expect(summary.task).toBe("Add visible task/path status");
  expect(summary.path).toBe("termfleet · tc-016i");
  expect(summary.now).toBe("Update map card header");
  expect(summary.provider).toBe("claude");
  expect(summary.status).toBe("working");
});

test("does not promote noisy terminal output to the primary task or now text", () => {
  const summary = fallbackAgentStatusSummary({
    mission: "Implement LLM status summarizer",
    provider: "codex",
    status: "running",
    phase: "active",
    cwd: "/repo/termfleet",
    currentActivity: "codex: command is not available in browser preview. Use the Tauri app for real shell commands.",
    terminalOutput: "/clear\nhi\nweb$ npm run build",
  });

  expect(summary.task).toBe("Implement LLM status summarizer");
  expect(summary.now).toBe("Working on Implement LLM status summarizer");
  expect(summary.now).not.toContain("command is not available");
  expect(summary.now).not.toBe("/clear");
  expect(summary.now).not.toBe("hi");
});

test("posts transcript and workstream context to a configured status process", async () => {
  let capturedBody: unknown;
  const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      task: "Wire the real status process",
      path: "src/components/Terminal.tsx",
      now: "Posting debounced transcript context",
      status: "working",
      provider: "codex",
      confidence: "high",
    }), { status: 200 });
  };

  const result = await summarizeAgentStatus({
    mission: "Add LLM status process",
    provider: "codex",
    status: "running",
    phase: "active",
    cwd: "/repo/termfleet",
    terminalOutput: "Running Playwright regression",
    currentActivity: "Running tests",
    events: [{ kind: "sent", label: "Prompt sent", detail: "Add LLM status process" }],
  }, {
    endpoint: "http://127.0.0.1:4567/status",
    fetcher,
  });

  expect(result.source).toBe("process");
  expect(result.summary.task).toBe("Wire the real status process");
  expect(result.summary.path).toBe("src/components/Terminal.tsx");
  expect(result.summary.now).toBe("Posting debounced transcript context");
  expect(capturedBody).toMatchObject({
    type: "agent-workstream-status",
    transcript: "Running Playwright regression",
    workstream: {
      mission: "Add LLM status process",
      provider: "codex",
      currentActivity: "Running tests",
      events: [{ kind: "sent", label: "Prompt sent", detail: "Add LLM status process" }],
    },
  });
});

test("falls back when the configured status process fails", async () => {
  const result = await summarizeAgentStatus({
    mission: "Keep visible fallback status",
    provider: "claude",
    status: "waiting",
    phase: "needs-input",
    cwd: "/repo/termfleet",
    currentActivity: "/clear",
    nextAction: "Ask operator for credentials",
  }, {
    endpoint: "http://127.0.0.1:4567/status",
    fetcher: async () => {
      throw new Error("connection refused");
    },
  });

  expect(result.source).toBe("fallback");
  expect(result.error).toContain("connection refused");
  expect(result.summary.task).toBe("Keep visible fallback status");
  expect(result.summary.now).toBe("Ask operator for credentials");
  expect(result.summary.status).toBe("waiting");
});
