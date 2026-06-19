import { expect, test } from "@playwright/test";
import {
  displayAgentStatusSummary,
  fallbackAgentStatusSummary,
  getDisplaySummary,
  parseAgentStatusSummaryResponse,
} from "../src/lib/agentStatusSummary";
import { deriveTerminalActivity } from "../src/lib/terminalActivity";
import { summarizeAgentStatus } from "../src/lib/agentStatusSummarizer";
import { mergeCockpitObjectsFromExtractedItems } from "../src/lib/workstreamExtraction";

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
    tasks: expect.arrayContaining([
      expect.objectContaining({ text: "Fix TC-016i header", provenance: "summary", at: 0 }),
    ]),
    blockers: [],
    evidence: [],
    nextActions: [],
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

test("does not promote tool-log labels or code query fragments into shell summaries", () => {
  const summary = getDisplaySummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo/termfleet",
    currentActivity: "Search",
    terminalOutput: [
      "I’m going to wire the real sidebar into the terminal body now. The key change is: the terminal output area becomes a two-column layout only when task rows exist; otherwise it stays unchanged.",
      "Explored",
      "Read MagicCanvas.tsx",
      "Search",
      "terminalTaskPanel|canvas-terminal-task-sidebar|agentTaskPanel|TerminalComponent|nodeBody|terminalBody|liveTerminalBody|node.type === \"terminal\" ? in MagicCanvas.tsx",
      "Read MagicCanvas.tsx",
    ].join("\n"),
  }, {
    task: "Search",
    path: "devops/termfleet",
    now: "terminalBody|liveTerminalBody|node.type ...",
    status: "working",
    provider: "shell",
    confidence: "low",
  });

  expect(summary.task).toBe("Ready");
  expect(summary.now).toBe("Awaiting terminal output");
  expect(summary.task).not.toBe("Search");
  expect(summary.now).not.toContain("terminalBody|liveTerminalBody");
});

test("keeps Playwright shell summaries stable on the test identity", () => {
  const summary = getDisplaySummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo/termfleet",
    currentActivity: "Running 2 tests using 1 worker",
    terminalOutput: [
      "npx playwright test tests/map-terminal-rendering.spec.ts -g \"map shell header prefers summarized task path and now\" --reporter=line",
      "Running 2 tests using 1 worker",
      "… +35 lines (ctrl + t to view transcript)",
      "1 passed (10.5s)",
      "Working (10m 52s • esc to interrupt)",
    ].join("\n"),
  }, {
    task: "Running 2 tests using 1 worker",
    path: "devops/termfleet",
    now: "stale. That is exactly the old changing behavior.",
    status: "working",
    provider: "shell",
    confidence: "medium",
  });

  expect(summary.task).toBe("Playwright test");
  expect(summary.now).toBe("map-terminal-rendering.spec.ts · grep: map shell header prefers summarized task path and now");
  expect(summary.confidence).toBe("high");
  expect(summary.task).not.toContain("Running 2 tests");
  expect(summary.now).not.toContain("stale");
});

test("durable terminal activity ignores prompt typing and sticky-noisy output", () => {
  const first = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/auth/login.spec.ts -g \"should login successfully\" --project=chromium",
      "Running 12 tests using 1 worker",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(first.title).toBe("Checking login flow");
  expect(first.subtitle).toBe("login successfully · 12 tests · 1 worker · chromium · login.spec.ts");
  expect(first.status).toBe("running");

  const typedPrompt = deriveTerminalActivity({
    now: 1300,
    previous: first,
    transcript: [
      "npx playwright test tests/auth/login.spec.ts -g \"should login successfully\" --project=chromium",
      "Running 12 tests using 1 worker",
      "web$ npm run totally unrelated partial input",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(typedPrompt).toBe(first);
  expect(typedPrompt.title).toBe("Checking login flow");

  const completed = deriveTerminalActivity({
    now: 5000,
    previous: typedPrompt,
    transcript: [
      "npx playwright test tests/auth/login.spec.ts -g \"should login successfully\" --project=chromium",
      "Running 12 tests using 1 worker",
      "12 passed (24s)",
      "\u001b]133;D;0\u0007",
    ].join("\n"),
    runtimeStatus: "exited",
    cwd: "/repo/termfleet",
  });

  expect(completed.title).toBe("Checking login flow completed");
  expect(completed.status).toBe("success");
  expect(completed.exitCode).toBe(0);
});

test("durable terminal activity explains focused Playwright header regressions", () => {
  const summary = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/map-terminal-rendering.spec.ts -g \\\"map shell header uses durable activity instead of stale transcript summary\\\" --reporter=line",
      "Running 1 test using 1 worker",
      "[1/1] tests/map-terminal-rendering.spec.ts:1809:1 › map shell header uses durable activity instead of stale transcript summary",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(summary.title).toBe("Verifying map card header stability");
  expect(summary.subtitle).toBe("ignores stale transcript summaries · 1 test · 1 worker · map-terminal-rendering.spec.ts");
  expect(summary.title).not.toContain("Map Terminal Rendering");
  expect(summary.title).not.toContain("Testing \"map");
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

test("extracts reviewable cockpit objects from noisy terminal output without promoting prompt chrome", () => {
  const summary = fallbackAgentStatusSummary({
    mission: "Stabilize checkout retry lane",
    provider: "codex",
    status: "failed",
    phase: "blocked",
    cwd: "/repo/termfleet",
    currentActivity: "gpt-5.5 default · -",
    nextAction: "Next: rerun checkout-flow.spec with retry trace",
    evidence: "Verified: npm test -- checkout-flow.spec passed before retry slice",
    risk: "Blocked: auth fixture token expired",
    terminalOutput: [
      "gpt-5.5 default · ~",
      "› Use /skills to list available skills",
      "Task: persist retry evidence on the checkout report",
      "Blocked: auth fixture token expired",
      "Evidence: npm test -- checkout-flow.spec passed before retry slice",
      "Next: rerun checkout-flow.spec with retry trace",
    ].join("\n"),
  });

  expect(summary.task).toBe("Stabilize checkout retry lane");
  expect(summary.status).toBe("blocked");
  expect(summary.tasks?.map((item) => item.text)).toContain("Stabilize checkout retry lane");
  expect(summary.tasks?.map((item) => item.text)).toContain("persist retry evidence on the checkout report");
  expect(summary.blockers?.map((item) => item.text)).toContain("Blocked: auth fixture token expired");
  expect(summary.evidence?.map((item) => item.text)).toContain("Verified: npm test -- checkout-flow.spec passed before retry slice");
  expect(summary.nextActions?.map((item) => item.text)).toContain("Next: rerun checkout-flow.spec with retry trace");
  expect(summary.tasks?.map((item) => item.text).join(" ")).not.toContain("gpt-5.5 default");
  expect(summary.tasks?.[0]).toMatchObject({
    provenance: "summary",
    at: 0,
    excerpt: expect.stringContaining("Task: persist retry evidence"),
  });
  expect(summary.tasks?.[0].sourceHash).toMatch(/^[0-9a-f]{8}$/);
});

test("deduplicates extracted cockpit objects while preserving review state", () => {
  const first = mergeCockpitObjectsFromExtractedItems([], "tab-agent", {
    task: [{
      id: "summary:task-1",
      text: "Persist retry evidence on the checkout report",
      provenance: "summary",
      at: 100,
      excerpt: "Task: persist retry evidence on the checkout report",
      sourceHash: "task-1",
    }],
  }, 100);
  const accepted = [{ ...first[0], reviewState: "accepted" as const, status: "accepted" as const, resolvedAt: 125 }];
  const merged = mergeCockpitObjectsFromExtractedItems(accepted, "tab-agent", {
    task: [{
      id: "summary:task-1",
      text: "Persist retry evidence on the checkout report",
      provenance: "summary",
      at: 200,
      excerpt: "Updated excerpt after another summary refresh",
      sourceHash: "task-1",
    }],
  }, 200);

  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    id: "task:summary:task-1",
    ownerTabId: "tab-agent",
    kind: "task",
    reviewState: "accepted",
    status: "accepted",
    resolvedAt: 125,
    sourceExcerpt: "Updated excerpt after another summary refresh",
    updatedAt: 200,
  });
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
      tasks: "array of extracted task strings or { text, excerpt }",
      blockers: "array of extracted blocker strings or { text, excerpt }",
      evidence: "array of extracted proof/evidence strings or { text, excerpt }",
      nextActions: "array of extracted next-action strings or { text, excerpt }",
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
  expect((capturedBody as { instructions?: string[] }).instructions?.join(" ")).toContain("extracted array item");
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
