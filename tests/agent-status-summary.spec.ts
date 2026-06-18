import { expect, test } from "@playwright/test";
import {
  displayAgentStatusSummary,
  fallbackAgentStatusSummary,
  getDisplaySummary,
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

test("summarizes shell TUI transcript when no model endpoint is configured", () => {
  const summary = fallbackAgentStatusSummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwdLabel: "workspace root unknown",
    currentActivity: "« | gpt-5.5 default · -",
    terminalOutput: [
      "translate to hebrew",
      "What changed:",
      "- server-side quality gate now validates generated posts",
      "- repair pass runs automatically when first draft fails",
      "Verified:",
      "- quality-gate tests: 4/4 passed",
      "› Use /skills to list available skills",
      "gpt-5.5 default · ~",
    ].join("\n"),
  });

  expect(summary.task).toBe("translate to hebrew");
  expect(summary.path).toBe("workspace root unknown");
  expect(summary.now).toBe("server-side quality gate now validates generated posts");
  expect(summary.now).not.toContain("gpt-5.5 default");
});

test("summarizes fullscreen htop chrome as process monitoring", () => {
  const summary = fallbackAgentStatusSummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo/termfleet",
    currentActivity: "F1Help F2Setup F3Search F4Filter F5Tree F6SortBy F7Nice -F8Nice +F9Kill F10Quit",
    terminalOutput: [
      "0[||||] 21.9% 1[||||] 15.3%",
      "Tasks: 825, 7189 thr, 407 kthr; 6 running",
      "Load average: 5.99 5.23 5.60",
      "F1Help F2Setup F3Search F4Filter F5Tree F6SortBy F7Nice -F8Nice +F9Kill F10Quit",
    ].join("\n"),
  });

  expect(summary.task).toBe("Monitoring processes");
  expect(summary.now).toBe("htop live process table");
});

test("summarizes a clean visible shell prompt as ready", () => {
  const summary = getDisplaySummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/home/endlessblink",
    currentActivity: undefined,
    terminalOutput: "endlessblink@endlessblink:~$",
  });

  expect(summary.task).toBe("Ready");
  expect(summary.path).toBe("endlessblink");
  expect(summary.now).toBe("Awaiting command");
  expect(summary.status).toBe("idle");
});

test("display summary rejects persisted prompt or TUI chrome", () => {
  const summary = displayAgentStatusSummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo/termfleet",
    terminalOutput: [
      "Reviewing approval request",
      "apply_patch touching src/components/SplitPane.tsx",
      "Use /skills to list available skills",
    ].join("\n"),
  }, {
    task: "gpt-5.5 default",
    path: "termfleet",
    now: "F1Help F2Setup F3Search F4Filter F5Tree F6SortBy F7Nice -F8Nice +F9Kill F10Quit",
    status: "working",
    provider: "shell",
    confidence: "high",
  });

  expect(summary.task).toBe("Reviewing approval request");
  expect(summary.now).toBe("apply_patch touching src/components/SplitPane.tsx");
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
    promptVersion: "terminal-status-v2-tiny",
    transcriptWindow: "visible grid snapshot plus recent transcript tail",
    transcript: "Running Playwright regression",
    heuristicCandidate: {
      task: "Add LLM status process",
      now: "Running tests",
    },
    schema: {
      task: "string",
      path: "string",
      now: "string",
    },
    workstream: {
      mission: "Add LLM status process",
      provider: "codex",
      currentActivity: "Running tests",
      events: [{ kind: "sent", label: "Prompt sent", detail: "Add LLM status process" }],
    },
  });
  expect((capturedBody as { instructions?: string[] }).instructions?.join(" ")).toContain("heuristicCandidate");
  expect((capturedBody as { instructions?: string[] }).instructions?.join(" ")).toContain("Ignore prompts");
  expect((capturedBody as { instructions?: string[] }).instructions?.join(" ")).toContain("Never overclaim");
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
