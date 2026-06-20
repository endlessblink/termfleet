import { expect, test } from "@playwright/test";
import {
  displayAgentStatusSummary,
  fallbackAgentStatusSummary,
  getDisplaySummary,
  parseAgentStatusSummaryResponse,
} from "../src/lib/agentStatusSummary";
import { deriveTerminalActivity } from "../src/lib/terminalActivity";
import { normalizePersistedShellSummary, summaryFromDurableActivity, terminalPurposeFromContext } from "../src/lib/terminalHeaderDisplay";
import {
  cleanTaskLineupContent,
  completeOpenTaskLineup,
  completeOpenTaskLineupForRun,
  normalizeTaskLineupItems,
  taskLineupForVisibleRun,
  terminalOutputClosesTaskLineup,
} from "../src/lib/taskLineup";
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
    // No sidecar todo-write flag in this strict LLM JSON → coerced to false.
    tasksFromTodoWrite: false,
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

test("durable terminal activity explains Playwright spec files without command fragments", () => {
  const summary = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/map-terminal-rendering.spec.ts",
      "Running 1 test using 1 worker",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(summary.title).toBe("Checking terminal cards on the map");
  expect(summary.subtitle).toBe("map card rendering contract · 1 test · 1 worker · map-terminal-rendering.spec.ts");
  expect(summary.title).not.toContain("Map Terminal Rendering");
});

test("durable terminal activity ignores unterminated grep fragments", () => {
  const summary = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/map-terminal-rendering.spec.ts -g \"map",
      "Running 1 test using 1 worker",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(summary.title).toBe("Checking terminal cards on the map");
  expect(summary.title).not.toContain("\"map");
});

test("durable terminal activity keeps checked intent after Playwright passes", () => {
  const summary = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/map-terminal-rendering.spec.ts",
      "Running 5 tests using 1 worker",
      "5 passed (12.6s)",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(summary.title).toBe("Map terminal card checks passed");
  expect(summary.subtitle).toBe("map card rendering contract · 5 passed · 12.6s · map-terminal-rendering.spec.ts");
  expect(summary.title).not.toBe("Playwright tests passed");
});

test("task lineup content removes literal placeholder tokens", () => {
  expect(cleanTaskLineupContent("Find and fix a bug in @filename")).toBe("Find and fix a bug in the selected file");
});

test("task lineup marks explicitly done items as completed", () => {
  const items = normalizeTaskLineupItems([
    { text: "1. [x] Preserve durable header state", status: "pending" },
    { text: "2. Done: Render completed tasks crossed and muted", status: "pending" },
    { text: "✓ Verify task sidebar screenshot", status: "pending" },
    { text: "4. Keep reviewing visible output", status: "pending" },
  ], "operator", 1000);

  expect(items).toEqual([
    expect.objectContaining({ content: "Keep reviewing visible output", status: "pending" }),
    expect.objectContaining({ content: "Preserve durable header state", status: "completed" }),
    expect.objectContaining({ content: "Render completed tasks crossed and muted", status: "completed" }),
    expect.objectContaining({ content: "Verify task sidebar screenshot", status: "completed" }),
  ]);
});

test("task lineup closes when terminal output reports the run worked to completion", () => {
  const output = [
    "- npm run build passed",
    "- npm run verify:map-terminals passed",
    "- git diff --check passed",
    "Worked for 2m 23s",
  ].join("\n");

  expect(terminalOutputClosesTaskLineup(output)).toBe(true);
  expect(completeOpenTaskLineup([
    { id: "task-1", content: "Summarize recent commits", status: "in_progress", source: "operator", updatedAt: 1 },
  ], 2000)).toEqual([
    { id: "task-1", content: "Summarize recent commits", status: "completed", source: "operator", updatedAt: 2000 },
  ]);
});

test("task lineup is scoped to the current terminal run", () => {
  const previousRun = completeOpenTaskLineupForRun(
    normalizeTaskLineupItems([
      { text: "Summarize recent commits", status: "in_progress" },
    ], "todo-write", 1000, "run-1"),
    "run-1",
    2000
  );
  const currentRun = normalizeTaskLineupItems([
    { text: "Find and fix a bug in @filename", status: "in_progress" },
  ], "todo-write", 3000, "run-2");
  const visible = taskLineupForVisibleRun([...previousRun, ...currentRun], "run-2");

  expect(previousRun).toEqual([
    expect.objectContaining({ content: "Summarize recent commits", runId: "run-1", status: "completed" }),
  ]);
  expect(visible).toEqual([
    expect.objectContaining({
      content: "Find and fix a bug in the selected file",
      runId: "run-2",
      status: "in_progress",
    }),
  ]);
});

test("task lineup falls back to the newest run when the active run id drifts", () => {
  const items = [
    ...completeOpenTaskLineupForRun(
      normalizeTaskLineupItems([
        { text: "Summarize recent commits", status: "in_progress" },
      ], "todo-write", 1000, "run-1"),
      "run-1",
      2000
    ),
    ...normalizeTaskLineupItems([
      { text: "Verify completed task sidebar", status: "in_progress" },
    ], "todo-write", 3000, "run-created-before-command-id-set"),
  ];
  const completed = completeOpenTaskLineupForRun(items, "command-derived-run-id", 4000);
  const visible = taskLineupForVisibleRun(completed, "command-derived-run-id");

  expect(visible).toEqual([
    expect.objectContaining({
      content: "Verify completed task sidebar",
      runId: "run-created-before-command-id-set",
      status: "completed",
      updatedAt: 4000,
    }),
  ]);
  expect(visible).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ content: "Summarize recent commits" }),
  ]));
});

test("task lineup completion markers are explicit and do not match incidental words", () => {
  expect(terminalOutputClosesTaskLineup("Goal achieved (8m)")).toBe(true);
  expect(terminalOutputClosesTaskLineup("• Task complete")).toBe(true);
  expect(terminalOutputClosesTaskLineup("Worked for 11s")).toBe(true);
  expect(terminalOutputClosesTaskLineup("Goal: achieved better summaries next")).toBe(false);
  expect(terminalOutputClosesTaskLineup("The task completion parser is being edited")).toBe(false);
  expect(terminalOutputClosesTaskLineup("Worked for the app, still running")).toBe(false);
});

test("durable terminal activity summarizes build and cargo checks as operator intent", () => {
  const build = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npm run build",
      "> termfleet@0.0.0 build",
      "> tsc && vite build",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(build.title).toBe("Building frontend");
  expect(build.subtitle).toBe("TypeScript and Vite production build");

  const cargo = deriveTerminalActivity({
    now: 2000,
    transcript: [
      "cargo check --manifest-path src-tauri/Cargo.toml",
      "Checking terminal-workspace v0.1.0",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(cargo.title).toBe("Checking Rust backend");
  expect(cargo.subtitle).toBe("src-tauri/Cargo.toml");
});

test("durable terminal activity remains stable while prompt fragments scroll", () => {
  const running = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npm run build",
      "> termfleet@0.0.0 build",
      "> tsc && vite build",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  const afterPromptScroll = deriveTerminalActivity({
    now: 7000,
    previous: running,
    transcript: [
      "npm run build",
      "> termfleet@0.0.0 build",
      "> tsc && vite build",
      "Working (28s • esc to interrupt)",
      "web$ npm run unfinished prompt text",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(afterPromptScroll).toBe(running);
  expect(afterPromptScroll.title).toBe("Building frontend");
  expect(afterPromptScroll.subtitle).toBe("TypeScript and Vite production build");
});

test("durable terminal activity updates when the real command changes", () => {
  const build = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npm run build",
      "> termfleet@0.0.0 build",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  const verify = deriveTerminalActivity({
    now: 5000,
    previous: build,
    transcript: [
      "npm run build",
      "> termfleet@0.0.0 build",
      "npm run verify:map-terminals",
      "> termfleet@0.0.0 verify:map-terminals",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  expect(verify.title).toBe("Checking map terminal source contract");
  expect(verify.subtitle).toBe("live map terminal source checks");
});

test("durable shell header prefers command target over stale extracted path", () => {
  const activity = deriveTerminalActivity({
    now: 1000,
    transcript: [
      "npx playwright test tests/agent-status-summary.spec.ts",
      "Running 1 test using 1 worker",
    ].join("\n"),
    runtimeStatus: "running",
    cwd: "/repo/termfleet",
  });

  const header = summaryFromDurableActivity(activity, "termfleet", {
    task: "Search",
    path: "stale/project",
    now: "stale prompt text",
    status: "working",
    provider: "shell",
    confidence: "high",
  }, {
    title: "Improve activity summary wording",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(header.task).toBe("Improve activity summary wording");
  expect(header.path).toBe("tests/agent-status-summary.spec.ts");
  expect(header.now).toBe("terminal status summary contract · 1 test · 1 worker · agent-status-summary.spec.ts");
  expect(header.now).not.toContain("stale");
});

test("durable shell header turns generic Playwright completion into contextual activity", () => {
  const header = summaryFromDurableActivity({
    title: "Playwright tests passed",
    subtitle: "map card rendering contract · 5 passed · 12.6s",
    targetPath: "tests/map-terminal-rendering.spec.ts",
    status: "success",
    command: "npx playwright test tests/map-terminal-rendering.spec.ts",
    source: "command",
    updatedAt: 1000,
  }, "termfleet", {
    task: "Playwright tests passed",
    path: "stale/project",
    now: "stale runner outcome",
    status: "working",
    provider: "shell",
    confidence: "high",
  }, {
    title: "Validate map terminal rendering behavior",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(header.task).toBe("Validate map terminal rendering behavior");
  expect(header.path).toBe("tests/map-terminal-rendering.spec.ts");
  expect(header.now).toBe("map card rendering contract · 5 passed · 12.6s");
});

test("durable shell header combines higher-level goal with verifier result", () => {
  const header = summaryFromDurableActivity({
    title: "Verifying map terminals",
    subtitle: "map terminal source checks passed",
    status: "success",
    command: "npm run verify:map-terminals",
    source: "command",
    updatedAt: 1000,
  }, "termfleet", {
    task: "Make terminal summaries operator-useful",
    path: "devops/termfleet",
    now: "stale runner outcome",
    status: "working",
    provider: "shell",
    confidence: "high",
  }, {
    title: "Make terminal summaries operator-useful",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(header.task).toBe("Make terminal summaries operator-useful");
  expect(header.path).toBe("termfleet");
  expect(header.now).toBe("map terminal source checks passed");
});

test("durable shell header does not promote noisy extracted task prose into the title", () => {
  const noisyTask =
    "The visual app surface now reports the intended hierarchy in the split header: title Validating terminal-summary behavior on map cards, path devops/termfleet, and Now map terminal source checks passed.";

  const header = summaryFromDurableActivity({
    title: "Building frontend",
    subtitle: "TypeScript and Vite production build",
    status: "success",
    command: "npm run build",
    source: "command",
    updatedAt: 1000,
  }, "devops/termfleet", {
    task: noisyTask,
    path: "devops/termfleet",
    now: "frontend build passed",
    status: "done",
    provider: "shell",
    confidence: "high",
    tasks: [{ id: "1", text: noisyTask, status: "done" }],
  }, {
    title: "Improving terminal summary headers",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(header.task).toBe("Improving terminal summary headers");
  expect(header.task).not.toContain("The visual app surface");
  expect(header.task.length).toBeLessThanOrEqual(64);
  expect(header.path).toBe("devops/termfleet");
  expect(header.now).toBe("frontend build passed");
});

test("durable shell header keeps visual verifier result out of the title", () => {
  const header = summaryFromDurableActivity({
    title: "Terminal summary visual checks passed",
    subtitle: "headed app terminal summary visual contract",
    status: "success",
    command: "npm run verify:terminal-summary-visual",
    source: "command",
    updatedAt: 1000,
  }, "devops/termfleet", {
    task: "Search",
    path: "devops/termfleet",
    now: "npm run verify:terminal-summary-visual",
    status: "done",
    provider: "shell",
    confidence: "high",
  }, {
    title: "Improving terminal summary headers",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(header.task).toBe("Improving terminal summary headers");
  expect(header.now).toBe("terminal summary visual checks passed");
  expect(header.now).not.toBe("npm run verify:terminal-summary-visual");
});

test("durable shell header exposes missing task context instead of inventing build purpose", () => {
  const header = summaryFromDurableActivity({
    title: "Building frontend",
    subtitle: "TypeScript and Vite production build",
    status: "success",
    command: "npm run build",
    source: "command",
    updatedAt: 1000,
  }, "devops/termfleet", {
    task: "Search",
    path: "devops/termfleet",
    now: "npm run build",
    status: "done",
    provider: "shell",
    confidence: "high",
  });

  expect(header.task).toBe("Checking frontend build");
  expect(header.now).toBe("frontend build passed");
});

test("persisted shell summaries are normalized for already-running terminals", () => {
  const summary = normalizePersistedShellSummary({
    task: "Map terminal card checks passed",
    path: "tests/map-terminal-rendering.spec.ts",
    now: "map card rendering contract · 5 passed",
    status: "done",
    provider: "shell",
    confidence: "high",
  }, "devops/termfleet", {
    title: "Validate map terminal rendering behavior",
    source: "task-binding",
    updatedAt: 1000,
  });

  expect(summary.task).toBe("Validate map terminal rendering behavior");
  expect(summary.now).toBe("map card rendering contract passed");
  expect(summary.path).toBe("tests/map-terminal-rendering.spec.ts");
});

test("persisted shell summaries without purpose expose missing task context", () => {
  const summary = normalizePersistedShellSummary({
    task: "Frontend build passed",
    path: "devops/termfleet",
    now: "npm run build",
    status: "done",
    provider: "shell",
    confidence: "high",
  }, "devops/termfleet");

  expect(summary.task).toBe("Checking frontend build");
  expect(summary.now).toBe("frontend build passed");
});

test("terminal purpose follows the current active agent prompt", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: [
      "Auto-reviewer approved codex to run xclip this time",
      "the user's X11 clipboard with a test PNG to drive the requested headed image-paste verification in the local app, a reversible local GUI side effect with no evident exfiltration or irreversible damage.",
      "Ran xclip -selection clipboard -t image/png -i /tmp/termfleet-image-paste-proof.png",
      "Working (11m 36s • esc to interrupt)",
      "› Write tests for @filename",
    ].join("\n"),
    now: 1000,
  });

  expect(purpose).toEqual({
    title: "Writing tests for selected file",
    source: "inferred",
    updatedAt: 1000,
  });
});

test("terminal purpose follows a worked-for agent prompt over stale command output", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: [
      "I verified the current focused contract with npm run verify:keymap: 3 passed.",
      "Worked for 1m 12s",
      "› pick up the copy and pasting task and load it to memory",
      "reverse-i-search:",
    ].join("\n"),
    now: 1000,
  });

  expect(purpose).toEqual({
    title: "Saving copy/paste task to memory",
    source: "inferred",
    updatedAt: 1000,
  });
});

test("terminal purpose ignores pre-working stale transcript lines", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: [
      "Visually verify headed text paste and image paste",
      "Explored",
      "Search class GridBuffer|rows in gridBuffer.ts",
      "I’m making the split stricter now: image-only paste uses negotiated bracketed mode.",
      "Working (13m 23s • esc to interrupt)",
    ].join("\n"),
    now: 1000,
  });

  expect(purpose).toBeUndefined();
});

test("durable shell header keeps current verifier title without stale transcript purpose", () => {
  const header = summaryFromDurableActivity({
    title: "Terminal summary visual checks failed",
    subtitle: "headed app terminal summary visual contract",
    status: "error",
    command: "npm run verify:terminal-summary-visual",
    source: "command",
    updatedAt: 1000,
  }, "devops/termfleet", {
    task: "Search",
    path: "devops/termfleet",
    now: "terminal summary visual checks failed",
    status: "blocked",
    provider: "shell",
    confidence: "high",
  });

  expect(header.task).not.toBe("Checking bracketed paste");
  expect(header.task).toBe("Improving terminal-summary visual headers");
  expect(header.now).toBe("terminal summary visual checks failed");
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

test("shell transcript prompts and menus do not become task objects", () => {
  const summary = fallbackAgentStatusSummary({
    mission: "Terminal",
    provider: "shell",
    status: "running",
    cwd: "/repo/termfleet",
    terminalOutput: [
      "Working (48s • esc to interrupt)",
      "› Find and fix a bug in @filename",
      "Implement this plan?",
      "1. Yes, implement this plan",
      "2. No, stay in Plan mode",
      "TERM",
    ].join("\n"),
  });

  expect(summary.tasks ?? []).toEqual([]);
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
