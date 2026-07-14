import { expect, test } from "@playwright/test";
import { summaryFromDurableActivity, terminalActivityFromVisibleText, terminalPurposeFromContext, terminalPurposeFromOperatorPrompt, terminalPurposeFromSubmittedInput, terminalPurposeFromVisiblePrompt } from "../src/lib/terminalHeaderDisplay";
import { buildShellTerminalHeaderViewModel } from "../src/lib/terminalHeaderViewModel";
import { mainUserAskFromTerminalPurpose } from "../src/lib/terminalMainUserAsk";

const flowStatePath = "/media/endlessblink/data/my-projects/ai-development/productivity/flow-state";

test("uses project root folder instead of parent category workspace", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "productivity", projectRoot: flowStatePath },
    liveCwd: flowStatePath,
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Verify the working tree is clean and nothing's left uncommitted.",
      path: flowStatePath,
      now: "Verify the working tree is clean and nothing's left uncommitted.",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.workspace.text).toBe("flow-state");
  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Idle");
  expect(header.now.text).toBe("Idle");
  expect(header.title.text).not.toContain("Verify the working tree");
});

test("uses real task list for the Task row and distinct activity for the title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-art", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-question",
      content: "Answering authentication question",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Asking clarifying questions",
      path: "/repo/arthouse",
      now: "Using AskUserQuestion",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.workspace.text).toBe("arthouse");
  expect(header.taskDescription.text).toBe("Answering authentication question");
  // Title = the agent's declared current activity, NOT the momentary tool name.
  expect(header.title.text).toBe("Asking clarifying questions");
  expect(header.now.text).toBe("Using AskUserQuestion");
});

test("does not show a near-duplicate long task as the big title", () => {
  const cwd = "/media/endlessblink/data/my-projects/ai-development/freelance/bina-meatzevet-courses";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup: [{
      id: "task-production-audit",
      content: "Run fresh production audit and charge approved candidates one by one",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Run fresh production audit and charge approved candidates",
      path: cwd,
      now: "Run fresh production audit and charge approved candidates",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe(
    "Run fresh production audit and charge approved candidates one by one",
  );
  expect(header.title.text).toBe("Charging approved candidates one by one");
  expect(header.debug.duplicatedLongLabels).toBe(false);
});

test("now active uses a readable active form when the captured task is the only current step", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-labels",
      content: "Locate header label rendering and quality gates",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Locate header label rendering and quality gates",
      path: "/repo/termfleet",
      now: "Locate header label rendering and quality gates",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Locate header label rendering and quality gates");
  expect(header.title.text).toBe("Locating header label rendering and quality gates");
  expect(header.title.text).not.toBe("Activity not captured");
});

test("completion prose cannot replace the current task title", () => {
  const cwd = "/media/endlessblink/data/my-projects/ai-development/freelance/bina-meatzevet-courses";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup: [{
      id: "task-answer",
      content: "Answering latest prompt",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Task Complete: Files shipped: - - - - - - - profile invoice access",
      path: cwd,
      now: "Task Complete: Files shipped: - - - - - - - profile invoice access",
      status: "done",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Idle");
  expect(header.title.text).not.toContain("Task Complete");
  expect(header.now.text).not.toContain("Files shipped");
});

test("shows the main user ask in Task while current activity stays in title and now", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Fix terminal headers so Task shows the user ask and activity shows current work",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Tracing header data flow",
      userTask: "Fix terminal headers so Task shows the user ask and activity shows current work",
      path: "/repo/termfleet",
      now: "Reading terminalHeaderViewModel.ts",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe(
    "Fix terminal headers so Task shows the user ask and activity shows current work",
  );
  expect(header.taskDescription.source).toBe("sidecar-todo");
  // Contract: with no distinct current step the title is the task's ACTIVE FORM
  // (conjugation). The render layer (activityAddsInfo) hides it on cards when it
  // adds nothing beyond the Task row — dedup lives at render, not here.
  expect(header.title.text).toBe(
    "Fixing terminal headers so Task shows the user ask and activity shows current work",
  );
  expect(header.title.text).not.toContain("terminalHeaderViewModel.ts");
});

test("compacts raw checklist task text for the visible Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-bina",
      content:
        "Finish bilingual coverage for 4 shared components in the bina-ve-ze React site that the page-level passes missed. The i18n infra is done and proven. FIRST read (the rules – follow EXACTLY): 1. /tmp/claude-1000/-media-end",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Frontend build failed",
      path: "/repo/bina-ve-ze",
      now: "Frontend build failed",
      status: "blocked",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe(
    "Finish bilingual coverage for 4 shared components in the bina-ve-ze React site that the page-...",
  );
  expect(header.taskDescription.text.length).toBeLessThanOrEqual(96);
  expect(header.taskDescription.text).not.toContain("FIRST read");
  expect(header.taskDescription.text).not.toContain("/tmp/claude");
});

test("uses only an explicit purpose as current activity over stale build results", () => {
  const explicitPurpose = terminalPurposeFromSubmittedInput(
    "promote to production and smoke-test the live domain",
  );
  const summary = summaryFromDurableActivity(
    {
      title: "Building frontend",
      subtitle: "TypeScript and Vite production build",
      status: "error",
      command: "npm run build",
      source: "command",
      updatedAt: 1000,
    },
    "/repo/bina-ve-ze",
    {
      task: "Frontend build failed",
      path: "/repo/bina-ve-ze",
      now: "Frontend build failed",
      status: "blocked",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    explicitPurpose,
  );
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-bina",
      content: "Finish bilingual coverage for 4 shared components in the bina-ve-ze React site",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    summary,
    trustedActivitySummary: true,
  });

  expect(explicitPurpose?.title).toBe("Promoting to production and smoke-testing the live domain");
  expect(header.title.text).toBe("Promoting to production and smoke-testing the live domain");
  expect(header.title.text).not.toBe("Frontend build failed");
});

test("turns placeholder prompt chrome into a readable task and plan activity", () => {
  const visibleText = [
    "› Write tests for @filename",
    "● Planning implementation…",
    "gpt-5.5 medium · /media/endlessblink/data/my-projects/ai-development/web-dev/bina-ve-ze Plan mode",
  ].join("\n");

  expect(terminalPurposeFromVisiblePrompt(visibleText)?.title).toBe("Writing tests for selected file");
  expect(terminalActivityFromVisibleText(visibleText)).toBe("Planning");
});

test("uses recent completed visible prompt as terminal purpose", () => {
  const visibleText = [
    "› so if someone reported it as spam, is there a way to appeal on that?",
    "• Yes, but usually the appeal is the review that is already pending.",
    "› Summarize recent commits",
    "gpt-5.5 default · /repo/bina",
  ].join("\n");

  expect(terminalPurposeFromContext({ terminalOutput: visibleText })?.title).toBe("Summarizing recent commits");
});

test("uses completed WhatsApp appeal answer as terminal purpose", () => {
  const visibleText = [
    "moderate spam unless asked for technical details.",
    "Expected impact: it may help you reach a person faster, but the",
    "actual decision likely still sits with WhatsApp's internal review/",
    "integrity system. So I'd try it as a parallel escalation, not as the",
    "main path.",
  ].join("\n");

  expect(terminalPurposeFromContext({ terminalOutput: visibleText })?.title).toBe("Checking WhatsApp spam appeal path");
});

test("uses spam-rule answer context instead of vague follow-up prompt", () => {
  const visibleText = [
    "So time-in-group matters for new-member link spam.",
    "After the latest change, a bare WhatsApp/Telegram invite link is",
    "review-only; removal needs extra spam context like investment/",
    "finance/VIP/wallet signals, or the user being newly joined.",
    "› should we add that?",
    "• Working (2s • esc to interrupt)",
  ].join("\n");

  expect(terminalPurposeFromContext({ terminalOutput: visibleText })?.title).toBe("Reviewing group spam moderation rules");
});

test("uses slash review prompt and Yahav scraper prompt as concrete purposes", () => {
  expect(terminalPurposeFromContext({
    terminalOutput: [
      "› go",
      "• Working (0s • esc to interrupt)",
      "› Run /review on my current changes",
    ].join("\n"),
  })?.title).toBe("Reviewing current changes");
  expect(terminalPurposeFromContext({
    terminalOutput: [
      "> income-zen-scrapers@0.1.0 scrape:yahav",
      "> ./run-yahav.sh",
      "Yahav username:",
    ].join("\n"),
  })?.title).toBe("Running Yahav scrape");
});

test("keeps the user goal separate from a readable current activity and full path", () => {
  const cwd = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Make terminal task descriptions stable and readable",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Ready",
      userTask: "Make terminal task descriptions stable and readable",
      path: "devops/termfleet",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Make terminal task descriptions stable and readable");
  // Active-form conjugation is the title contract; render-layer dedup hides echoes.
  expect(header.title.text).toBe("Making terminal task descriptions stable and readable");
  expect(header.now.text).toBe("Awaiting next action");
  expect(header.path.text).toBe(cwd);
});

test("does not duplicate userTask as the activity title when now has current work", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Build a way to see what every terminal is showing",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Build a way to see what every terminal is showing",
      userTask: "Build a way to see what every terminal is showing",
      path: "/repo/termfleet",
      now: "List running procs and daemon socket (read-only)",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Build a way to see what every terminal is showing");
  expect(header.title.text).toBe("List running procs and daemon socket (read-only)");
  expect(header.now.text).toBe("List running procs and daemon socket (read-only)");
  expect(header.debug.titleDuplicatedUserTask).toBe(true);
});

test("does not duplicate userTask as the activity title when the terminal is idle", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Explaining this codebase",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Explaining this codebase",
      userTask: "Explaining this codebase",
      path: "/repo/termfleet",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Explaining this codebase");
  expect(header.title.text).toBe("Awaiting next action");
  expect(header.now.text).toBe("Awaiting next action");
});

test("ignores moving summary userTask unless it has been stored as the main user ask", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Explaining this codebase",
      userTask: "Explaining this codebase",
      path: "/repo/termfleet",
      now: "Reading terminal output",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.taskDescription.source).toBe("missing");
  expect(header.title.text).toBe("Working");
  expect(header.title.source).toBe("missing");
  expect(header.now.text).toBe("Activity not captured");
});

test("rejects trusted visible activity when it is still generic", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [],
    trustedActivitySummary: true,
    summary: {
      task: "Ready",
      path: "/repo/bina-ve-ze",
      now: "Thinking",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  // Generic trusted activity ("Ready"/"Thinking") is rejected; the now line falls
  // back to an honest status word, never the raw generic text.
  expect(["Idle", "Working", "Awaiting next action", "Activity not captured"]).toContain(header.now.text);
});

test("rejects broken markdown path fragments as pane titles", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: flowStatePath },
    liveCwd: `${flowStatePath}/watchpost`,
    terminalStatus: "running",
    taskLineup: [],
    trustedActivitySummary: true,
    summary: {
      task: "Ready",
      path: `${flowStatePath}/watchpost`,
      now: "Md](/home/endlessblink/.",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.workspace.text).toBe("flow-state");
  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.title.text).not.toContain("/home");
});

test("rejects assistant critique text as pane activity", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Improve pane header task and title quality",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Improve pane header task and title quality",
      userTask: "Improve pane header task and title quality",
      path: "/repo/termfleet",
      now: "This failure is clear: Task row is too vague because it says nothing about the work",
      narration: "This failure is clear: Task row is too vague because it says nothing about the work",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Improve pane header task and title quality");
  expect(header.title.text).not.toContain("This failure is clear");
  expect(header.title.text).toBe("Improving pane header task and title quality");
});

test("does not use cited content text as the activity title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-build",
      content: "Run build, lint, focused tests, and visual checks",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Run build, lint, focused tests, and visual checks",
      path: "/repo/bina-ve-ze",
      now: "Stanford credibility guidelines say credibility improves when a site shows trust proof",
      narration: "Stanford credibility guidelines say credibility improves when a site shows trust proof",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Run build, lint, focused tests, and visual checks");
  expect(header.title.text).toBe("Running build and visual checks");
  expect(header.title.text).not.toContain("Stanford credibility guidelines");
});

test("live-page check task keeps a concrete activity instead of awaiting action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Check the live page before answering",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Supervised agent run",
      path: "/repo/bina-ve-ze",
      now: "Content issue identified as a core problem: the board sells…",
      narration: "Content issue identified as a core problem: the board sells…",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Check the live page before answering");
  expect(header.title.text).not.toBe("Awaiting next action");
  expect(header.title.text.split(/\s+/).length).toBeGreaterThanOrEqual(4);
});

test("detects visible approval prompts as current activity", () => {
  expect(terminalActivityFromVisibleText([
    "Bash command",
    "This command requires approval",
    "Do you want to proceed?",
    "❯ 1. Yes",
  ].join("\n"))).toBe("Waiting for approval");
});

test("treats Claude-style prompt arrows as visible user tasks", () => {
  const purpose = terminalPurposeFromVisiblePrompt([
    "✻ Cooked for 10m 39s · 1 shell still running",
    "❯ run the e2e loader spec",
    "● Reading 1 file…",
    "[OMC] | thinking | session:2m | ctx:21% | Opus 4.8",
  ].join("\n"));

  expect(purpose?.title).toBe("Running the e2e loader spec");
});

test("does not treat editable prompt text as the terminal task", () => {
  expect(terminalPurposeFromVisiblePrompt([
    "* Coalescing… (6m 3s · thinking some more with medium effort)",
    "❯ fghdfgh",
    "[OMC] | thinking | session:2m | ctx:26% | Opus 4.8",
    "⏵⏵ auto mode on",
  ].join("\n"))).toBeUndefined();

  expect(terminalPurposeFromVisiblePrompt([
    "❯ should we use a hamburger menu instead of the nav bar?",
    "[OMC] | thinking | session:2m | ctx:26% | Opus 4.8",
  ].join("\n"))).toBeUndefined();
});

test("captures submitted human prompts but rejects commands and TUI chrome", () => {
  expect(terminalPurposeFromSubmittedInput("I want to add sfx and ambience to the homepage experience")?.title)
    .toBe("I want to add sfx and ambience to the homepage experience");
  expect(terminalPurposeFromSubmittedInput("run the e2e loader spec")?.title)
    .toBe("Running the e2e loader spec");

  expect(terminalPurposeFromSubmittedInput("npm test")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("terminal-workspace-tauri@0.1.0 cockpit:snapshot")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput('for i in $(seq 1 160); do printf "TF_TASK_SCROLL_HISTORY_%03d\\n" "$i"; done')).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("printf 'Header verifier idle terminal\\n'; echo TF_HDR_IDLE_DONE")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("echo TF_HDR_PROMPT_DONE")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("pwd; printf 'Header verifier long path terminal\\n'")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("Press up to edit queued messages")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("Enter to select")).toBeUndefined();
  expect(terminalPurposeFromSubmittedInput("1. Yes")).toBeUndefined();
});

test("does not infer package script output as a task", () => {
  expect(terminalPurposeFromVisiblePrompt([
    "terminal-workspace-tauri@0.1.0 cockpit:snapshot",
    "No flagged terminal headers in the latest snapshot.",
  ].join("\n"))).toBeUndefined();

  expect(terminalPurposeFromContext({
    terminalOutput: [
      "terminal-workspace-tauri@0.1.0 cockpit:snapshot",
      "No flagged terminal headers in the latest snapshot.",
    ].join("\n"),
  })).toBeUndefined();
});

test("paused agent goals produce a resumable task instead of idle", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: [
      "› Implement {feature}",
      "gpt-5.5 default · /repo/arthouse · Goal paused (/goal resume)",
    ].join("\n"),
  });
  expect(purpose?.title).toBe("Resume paused agent goal");

  const mainUserAsk = mainUserAskFromTerminalPurpose(purpose, {
    runId: "run-paused",
    now: 1000,
  });
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-art", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "reconnected",
    activeRunId: "run-paused",
    mainUserAsk,
    statusSummary: {
      task: "Ready",
      path: "/repo/arthouse",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Resume paused agent goal");
  expect(header.title.text).toBe("Resuming paused agent goal");
});

test("polishes restoration prompt fragments into readable task and activity text", () => {
  const mainUserAsk = mainUserAskFromTerminalPurpose(
    terminalPurposeFromSubmittedInput("so we can create it? everything can be restored exactly like tmux"),
    {
      runId: "run-recovery",
      now: 1000,
      preferTerminalPrompt: true,
    },
  );

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    activeRunId: "run-recovery",
    taskLineup: [],
    mainUserAsk,
    statusSummary: {
      task: "Create exact terminal session recovery",
      userTask: "Create exact terminal session recovery",
      path: "/repo/bina-ve-ze",
      now: "Working on create exact terminal session recovery",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(header.taskDescription.text).toBe("Create exact terminal session recovery");
  expect(header.title.text).toBe("Building terminal recovery");
  expect(header.title.text).not.toContain("so we can create it");
});

test("does not turn vague make-all-high prompts into a fake task", () => {
  const mainUserAsk = mainUserAskFromTerminalPurpose(
    terminalPurposeFromSubmittedInput("make all high"),
    {
      runId: "run-quality",
      now: 1000,
      preferTerminalPrompt: true,
    },
  );

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    activeRunId: "run-quality",
    taskLineup: [],
    mainUserAsk,
    statusSummary: {
      task: "Raise quality across the current work",
      userTask: "Raise quality across the current work",
      path: "/repo/bina-ve-ze",
      now: "Thinking about raise quality across the current work",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(mainUserAsk).toBeUndefined();
  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.title.text).not.toContain("making all high");
});

test("keeps concrete pane-header quality prompts specific", () => {
  const mainUserAsk = mainUserAskFromTerminalPurpose(
    terminalPurposeFromSubmittedInput("make pane headers high quality"),
    {
      runId: "run-pane-quality",
      now: 1000,
      preferTerminalPrompt: true,
    },
  );

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    activeRunId: "run-pane-quality",
    taskLineup: [],
    mainUserAsk,
    statusSummary: {
      task: "Improve pane header descriptions",
      userTask: "Improve pane header descriptions",
      path: "/repo/termfleet",
      now: "Inspecting header quality rules",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(mainUserAsk?.text).toBe("Improve pane header descriptions");
  expect(header.taskDescription.text).toBe("Improve pane header descriptions");
  expect(header.title.text).toBe("Inspecting header quality rules");
});

test("polishes high-quality-description prompt into separate task and activity", () => {
  const mainUserAsk = mainUserAskFromTerminalPurpose(
    terminalPurposeFromSubmittedInput("what now? we still dont ahve high quality descriptions"),
    {
      runId: "run-description-quality",
      now: 1000,
      preferTerminalPrompt: true,
    },
  );

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    activeRunId: "run-description-quality",
    taskLineup: [],
    mainUserAsk,
    statusSummary: {
      task: "Improve cockpit header descriptions",
      userTask: "Improve cockpit header descriptions",
      path: "/repo/termfleet",
      now: "Inspecting header quality rules",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(header.taskDescription.text).toBe("Improve cockpit header descriptions");
  expect(header.title.text).toBe("Inspecting header quality rules");
  expect(header.title.text).not.toContain("what now");
});

test("rejects low-quality structured labels instead of rendering them", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "bad-task",
      content: "what now? we still dont ahve high quality descriptions",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "what now? we still dont ahve high quality descriptions",
      path: "/repo/termfleet",
      now: "Thinking about what now? we still dont ahve high quality descriptions",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.taskDescription.source).toBe("missing");
  expect(header.title.text).toBe("Working");
  expect(header.title.source).toBe("missing");
  expect(header.now.text).toBe("Activity not captured");
});

test("rejects stored generic quality task when no live activity is available", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    activeRunId: "run-quality",
    taskLineup: [],
    mainUserAsk: {
      text: "Raise quality across the current work",
      source: "terminal-prompt",
      updatedAt: 1000,
      runId: "run-quality",
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-ve-ze",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Idle");
  expect(header.title.text).not.toBe("Improving quality");
});

test("turns visible operator-selection prompts into task context", () => {
  expect(terminalPurposeFromOperatorPrompt([
    "Where to go:",
    "Next step",
    "The GI-lightmap pipeline is proven end-to-end. How do you want to proceed?",
    "1. Commit + pause here",
    "Enter to select - Up/Down to navigate - Esc to cancel",
  ].join("\n"))?.title).toBe("Choosing next step for GI-lightmap pipeline");

  expect(terminalPurposeFromOperatorPrompt([
    "This branch has unrelated uncommitted work.",
    "How should I commit the delete fix?",
    "1. Only my 2 files",
    "Enter to select",
  ].join("\n"))?.title).toBe("Choosing commit scope for the delete fix");

  expect(terminalPurposeFromOperatorPrompt([
    "Implement this plan?",
    "1. Yes, implement this plan Switch to Default and start coding.",
    "2. No, stay in Plan mode Continue planning with the model.",
    "Press enter to confirm or esc to go back",
  ].join("\n"))?.title).toBe("Choose whether to implement current plan");
  expect(terminalPurposeFromContext({
    terminalOutput: [
      "Implement this plan?",
      "1. Yes, implement this plan Switch to Default and start coding.",
      "2. No, stay in Plan mode Continue planning with the model.",
      "Press enter to confirm or esc to go back",
    ].join("\n"),
  })?.title).toBe("Choose whether to implement current plan");
});

test("stores a main user ask from submitted input before rendering Task", () => {
  const purpose = terminalPurposeFromSubmittedInput(
    "fix the terminal task description",
  );
  const mainUserAsk = mainUserAskFromTerminalPurpose(purpose, {
    runId: "run-current",
    now: 1000,
  });

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    activeRunId: "run-current",
    taskLineup: [],
    mainUserAsk,
    statusSummary: {
      task: "Ready",
      path: "/repo/termfleet",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(mainUserAsk).toEqual({
    text: "Fixing the terminal task description",
    source: "terminal-prompt",
    updatedAt: 1000,
    runId: "run-current",
  });
  expect(header.taskDescription.text).toBe(
    "Fixing the terminal task description",
  );
  expect(header.taskDescription.source).toBe("user-prompt");
  expect(header.taskDescription.text).not.toBe("Idle");
});

test("submitted prompt task can replace stale sidecar task text", () => {
  const submittedPromptAsk = mainUserAskFromTerminalPurpose(
    terminalPurposeFromSubmittedInput("the intro sfx still aren't audible on refresh"),
    {
      previous: {
        text: "Press up to edit queued messages",
        source: "status-sidecar",
        updatedAt: 1000,
        runId: "run-visible",
      },
      runId: "run-visible",
      now: 2000,
      preferTerminalPrompt: true,
    },
  );

  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [],
    activeRunId: "run-visible",
    mainUserAsk: submittedPromptAsk,
    statusSummary: {
      task: "window.studioAudio.play('introStinger'); window.studioAudio.play('introTick')",
      userTask: "window.studioAudio.play('introStinger'); window.studioAudio.play('introTick')",
      path: "/repo/bina-ve-ze",
      now: "Thinking about the intro sfx still aren't audible on refresh",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(header.taskDescription.text).toBe("the intro sfx still aren't audible on refresh");
  expect(header.title.text).toBe("Thinking about the intro sfx still aren't audible on refresh");
});

test("does not show a stored main user ask from a different terminal run", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    activeRunId: "run-current",
    taskLineup: [],
    mainUserAsk: {
      text: "Fix terminal headers from the previous run",
      source: "status-sidecar",
      updatedAt: 1000,
      runId: "run-old",
    },
    statusSummary: {
      task: "Running tests",
      path: "/repo/termfleet",
      now: "Running tests",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.taskDescription.source).toBe("missing");
  expect(header.debug.mainUserAskRunMatches).toBe(false);
});

test("task-tool state outranks userTask for the Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-1",
      content: "Editing the sidecar writer",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    mainUserAsk: {
      text: "Fix terminal headers so Task shows the user ask",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Editing the sidecar writer",
      userTask: "Fix terminal headers so Task shows the user ask",
      path: "/repo/termfleet",
      now: "Editing scripts/termfleet-claude-status-hook.mjs",
      status: "working",
      provider: "claude",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Editing the sidecar writer");
  expect(header.taskDescription.source).toBe("task-tool");
  expect(header.title.text.toLowerCase()).not.toBe(header.taskDescription.text.toLowerCase());
});

test("replaces bare source-file activity with a readable task-derived activity", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-36",
      content: "#36 Bottom-sheet pull-up + clearer launcher button",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "#36 Bottom-sheet pull-up + clearer launcher button",
      path: "/repo/bina-ve-ze",
      now: "Editing ModelScene.tsx",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("#36 Bottom-sheet pull-up + clearer launcher button");
  // New contract: no distinct current step is known (declared text merely
  // restates the task, the momentary now is a bare file name) — show a status
  // word instead of restating the Task row.
  expect(header.title.text).not.toContain("ModelScene.tsx");
  expect(header.title.text.toLowerCase()).not.toContain("bottom-sheet");
  expect(header.now.text).not.toContain("ModelScene.tsx");
});

test("rejects foreign project slugs from final now text", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: flowStatePath },
    liveCwd: flowStatePath,
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: "productivity/flow-state",
      now: "income-zen",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  // Intent: a foreign project slug must never surface. The exact fallback word is
  // secondary — any honest status word is acceptable.
  expect(["Awaiting next action", "Activity not captured", "Working", "Idle"]).toContain(header.now.text);
  expect(header.now.text).not.toContain("income-zen");
});

test("does not promote no-task-list narration into the main title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: {
      id: "g-art",
      name: "arthouse",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/content-creation/arthouse",
    },
    liveCwd: "/media/endlessblink/data/my-projects/ai-development/content-creation/arthouse",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "VPS has the 12 tracking events and the matching machine id.",
      path: "content-creation/arthouse",
      now: "Run publish-once on VPS with doppler token sourced",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
      narration: "VPS has the 12 tracking events and the matching machine id.",
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  // Operator contract (2026-07-09, supersedes 2026-07-04): on a WORKING pane the
  // title must name an action in progress. A high-confidence statement of fact
  // ("VPS has the 12 tracking events") is a report, not work — it does not qualify,
  // however confident the model was. A finished pane may still state its outcome.
  expect(header.title.text).not.toContain("VPS has the 12 tracking events");
  expect(header.title.text).toBe("Working");
  expect(header.now.text).not.toContain("publish-once");
});

test("does not promote durable activity summaries when there is no task list", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: {
      id: "g-termfleet",
      name: "termfleet",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    },
    liveCwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    terminalStatus: "reconnected",
    taskLineup: [],
    statusSummary: null,
    summary: {
      task: "Checking frontend build",
      path: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    neutralTitle: null,
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.now.text).toBe("Activity not captured");
  expect(header.title.text).not.toContain("frontend build");
  expect(header.now.text).not.toContain("TypeScript");
});

test("trusted activity without a captured task makes the missing task explicit", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "failed",
    taskLineup: [],
    statusSummary: null,
    summary: {
      task: "Terminal summary visual checks failed",
      path: "/repo/termfleet",
      now: "headed app terminal summary visual contract",
      status: "blocked",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    trustedActivitySummary: true,
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.debug.missingActiveTask).toBe(true);
  expect(header.title.text).toBe("headed app terminal summary visual contract");
  expect(header.now.text).toBe("headed app terminal summary visual contract");
});

test("active terminal without a structured activity reports activity capture failure", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: "/repo/termfleet",
      now: "Awaiting command",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.taskDescription.source).toBe("missing");
  expect(header.title.text).toBe("Working");
  expect(header.title.source).toBe("missing");
  expect(header.now.text).toBe("Activity not captured");
});

test("ready prompt neutral state renders idle instead of activity capture failure", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: "/repo/termfleet",
      now: "Awaiting command",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
    neutralTitle: "Idle",
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Idle");
  expect(header.now.text).toBe("Idle");
});

test("real task list items that mention 'broken' still drive the Task row and title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-broken",
      content: "Check why the terminal titles and task list are still broken",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Checking why titles and tasks are still broken",
      path: "/repo/termfleet",
      now: "Checking why titles and tasks are still broken",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe(
    "Check why the terminal titles and task list are still broken",
  );
  expect(header.taskDescription.source).toBe("task-tool");
  expect(header.title.text).not.toBe("Idle");
  expect(header.title.text).not.toBe("Activity not captured");
  expect(header.title.text).not.toBe("Task not captured");
});

test("authoritative task list text survives command-like wording in the Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-cmd",
      content: "Run cargo test for the daemon restore path",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Running backend tests",
      path: "/repo/termfleet",
      now: "Running backend tests",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Run cargo test for the daemon restore path");
  expect(header.taskDescription.source).toBe("task-tool");
});


test("big title uses the task activeForm, never the momentary tool activity", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-live",
      content: "Prove the task list shows up in the app",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Testing if tasks reach the app screen",
      path: "/repo/termfleet",
      now: "Using Skill",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Prove the task list shows up in the app");
  expect(header.title.text).toBe("Testing if tasks reach the app screen");
  expect(header.title.text).not.toBe("Using Skill");
  expect(header.now.text).toBe("Using Skill");
});

test("real task active form beats a generic working title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "reconnected",
    taskLineup: [{
      id: "task-runtime-gap",
      content: "Fix the runtime source gap",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    mainUserAsk: {
      text: "and nothing got better... why cant you verify yourself in a loop?",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Fix the runtime source gap",
      userTask: "and nothing got better... why cant you verify yourself in a loop?",
      path: "/repo/termfleet",
      now: "Fixing the runtime source gap",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
      narration: "Fixing the runtime source gap",
    },
    neutralTitle: null,
    activelyWorking: true,
  });

  expect(header.taskDescription.text).toBe("Fix the runtime source gap");
  expect(header.title.text).toBe("Fixing the runtime source gap");
  expect(header.title.text).not.toBe("Working");
});

test("title falls back to distinct activity only when activeForm duplicates the Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-dup",
      content: "Review the release checklist",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Review the release checklist",
      path: "/repo/termfleet",
      now: "Reading packaging docs",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Review the release checklist");
  expect(header.title.text).toBe("Reading packaging docs");
});

test("duplicated active task title still signals the main task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-header-approval",
      content: "Rechecking pane header wording approval",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Rechecking pane header wording approval",
      path: "/repo/termfleet",
      now: "Idle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Rechecking pane header wording approval");
  expect(header.title.text).toBe("Checking pane header wording");
  expect(header.title.text).not.toBe("Awaiting next action");
  expect(header.title.text).not.toBe("Idle");
});

test("junk momentary now does not drag a good declared title down", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-live",
      content: "Make the big title show the task in plain words, not tool noise",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Making the big title show the real task",
      path: "/repo/termfleet",
      now: "Editing Terminal.tsx",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.title.text).toBe("Making the big title show the real task");
  expect(header.now.text).not.toBe("Editing Terminal.tsx");
});

// ---- 2026-07-03 fallback-path junk regressions (shaped from real cockpit panes) ----

test("raw prompt statements never get an 'Improving' title synth", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-botson", name: "botson", projectRoot: "/repo/botson" },
    liveCwd: "/repo/botson",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: { text: "we are working from the vps", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "Improving we are working from the vps",
      path: "/repo/botson",
      now: "Improving we are working from the vps",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("we are working from the vps");
  expect(header.title.text).not.toContain("Improving");
  expect(header.now.text).not.toContain("Improving");
});

test("title never repeats the Task row prompt text", () => {
  const prompt = "this happens because of notifications, but we built a tool th";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cc", name: "cc-linux-enhancments", projectRoot: "/repo/cc" },
    liveCwd: "/repo/cc",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: { text: prompt, source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: prompt,
      path: "/repo/cc",
      now: prompt,
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.title.text.toLowerCase()).not.toBe(header.taskDescription.text.toLowerCase());
});

test("printed plan checkbox scrape loses its tree glyphs in the title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: { text: "restared the app", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "└ □ Checking the restarted app window",
      path: "/repo/termfleet",
      now: "└ □ Checking the restarted app window",
      status: "working",
      provider: "codex",
      confidence: "medium",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.title.text).not.toMatch(/[└├□■☐]/);
});

test("pasted code never becomes the Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina" },
    liveCwd: "/repo/bina",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "const c = document.querySelector('canvas'); function ev(type, x, y, buttons){ return new Poin",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "frontend lint checks",
      path: "/repo/bina",
      now: "frontend lint checks",
      status: "working",
      provider: "shell",
      confidence: "medium",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
});

test("informal typo'd asks still show on the Task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: flowStatePath },
    liveCwd: flowStatePath,
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "ok so go over everything, finish whatever need finising and get it all ready to merge",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Ready",
      path: flowStatePath,
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe(
    "go over everything, finish whatever need finising and get it all ready to merge",
  );
  expect(header.taskDescription.text).not.toBe("Task not captured");
});

test("deictic screenshot prompts do not render as task or active labels", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "and this",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "and this",
      userTask: "and this",
      path: "/repo/termfleet",
      now: "and this",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.taskDescription.text).not.toBe("and this");
  expect(header.title.text).not.toBe("and this");
});

test("long conversational requirement dumps do not render as task labels", () => {
  const raw =
    "I just need ready high quality calls. that are verifiable e2e. anything else is just adding more";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-art", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: raw,
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: raw,
      userTask: raw,
      path: "/repo/arthouse",
      now: "The production inbox says and explains the real gate: a call is required",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.taskDescription.text).not.toContain("I just need");
  expect(header.title.text).not.toContain("production inbox says");
});

test("$done prompt keeps a concrete active label", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bot", name: "bina-meatezvet-bot", projectRoot: "/repo/bot" },
    liveCwd: "/repo/bot",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "Close current agent task",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Answering latest prompt",
      userTask: "Close current agent task",
      path: "/repo/bot",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Close current agent task");
  expect(header.title.text).toBe("Closing current agent task");
  expect(header.title.text).not.toBe("Activity not captured");
});

test("task labels strip runtime token counters before rendering", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-ve-ze", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-explore",
      content: "Explore Explore zoom animation and break-after state 1m 36s · ↓ 49.8k tokens",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Explore Explore zoom animation and break-after state 1m 36s · ↓ 49.8k tokens",
      path: "/repo/bina-ve-ze",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Explore zoom animation and break-after state");
  expect(header.title.text).toBe("Exploring zoom animation and break-after state");
  expect(header.taskDescription.text).not.toContain("tokens");
});

test("watchdog task-tool steps get distinct active labels", () => {
  const cases = [
    ["Extending watchdog to selected terminal surface", "Checking selected terminal surface"],
    ["Normalizing final-answer prose and placeholder prompt labels", "Checking prose and placeholder labels"],
    ["Re-running live loop until clean", "Checking live loop results"],
  ] as const;

  for (const [task, title] of cases) {
    const header = buildShellTerminalHeaderViewModel({
      project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
      liveCwd: "/repo/termfleet",
      terminalStatus: "running",
      taskLineup: [{
        id: "task-watchdog",
        content: task,
        status: "in_progress",
        source: "todo-write",
        updatedAt: 1000,
      }],
      statusSummary: {
        task,
        path: "/repo/termfleet",
        now: task,
        status: "working",
        provider: "codex",
        confidence: "high",
        tasksFromTodoWrite: true,
      },
    });

    expect(header.taskDescription.text).toBe(task);
    expect(header.title.text).toBe(title);
    expect(header.title.text).not.toBe(task);
  }
});

test("profile restore test-seam task gets a distinct active label", () => {
  const task = "Inspect exact state/test seams for profile restore";
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [{
      id: "profile-restore",
      content: task,
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task,
      path: "/repo/hermes",
      now: `Reviewing ${task}`,
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe(task);
  expect(header.title.text).toBe("Checking profile restore test seams");
});

test("idle panes without task context render explicit no-active-work labels", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-idle", name: "idle-project", projectRoot: "/repo/idle" },
    liveCwd: "/repo/idle",
    terminalStatus: "idle",
    taskLineup: [],
    statusSummary: {
      task: "Shell ready",
      path: "/repo/idle",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("No active work");
  expect(header.title.text).toBe("Ready for next task");
  expect(header.now.text).toBe("Ready for next task");
});

test("actively-working pane shows Working, not 'Awaiting next action'", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: true,
    mainUserAsk: { text: "› I want to do two main changes right now - I › I want to do two main changes right now - II", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "Ready",
      path: "/repo/hermes",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  // Task row is cleaned: no prompt markers, no duplicated fragment.
  expect(header.taskDescription.text).toBe("I want to do two main changes right now");
  expect(header.taskDescription.text).not.toContain("›");
  // Title reflects active work, not idle.
  expect(header.title.text).toBe("Working");
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("idle pane with a user ask still gets an actionable now-active line", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: false,
    mainUserAsk: { text: "fix the login flow", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "Ready", path: "/repo/hermes", now: "Awaiting command",
      status: "idle", provider: "shell", confidence: "low", tasksFromTodoWrite: false,
    },
  });
  expect(header.title.text).toBe("Fixing the login flow");
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("deploy task does not fall back to Awaiting next action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina" },
    liveCwd: "/repo/bina",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: false,
    mainUserAsk: { text: "deploy so I can test it live", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "Ready", path: "/repo/bina", now: "Awaiting command",
      status: "idle", provider: "shell", confidence: "low", tasksFromTodoWrite: false,
    },
  });
  expect(header.taskDescription.text).toBe("deploy so I can test it live");
  expect(header.title.text).toBe("Deploying so I can test it live");
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("live narration becomes the big title while actively working", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cc", name: "cc-linux-enhancments", projectRoot: "/repo/cc" },
    liveCwd: "/repo/cc",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: true,
    mainUserAsk: { text: "why did this break again? the fix needs to survive over restarts", source: "terminal-prompt", updatedAt: 1000 },
    statusSummary: {
      task: "Supervised agent run",
      path: "/repo/cc",
      now: "Installing the updated scripts into the user systemd services now",
      narration: "Installing the updated scripts into the user systemd services now",
      status: "working",
      provider: "shell",
      confidence: "medium",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.title.text).toContain("Installing the updated scripts");
  expect(header.title.text.length).toBeLessThanOrEqual(64);
  expect(header.title.text).not.toBe("Awaiting next action");
  expect(header.taskDescription.text).toContain("why did this break again");
});

test("idle pane shows the last outcome instead of 'Awaiting next action'", () => {
  // Operator rule (2026-07-04): a finished terminal must say what has been done.
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cc", name: "cc-linux-enhancments", projectRoot: "/repo/cc" },
    liveCwd: "/repo/cc",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: false,
    statusSummary: {
      task: "Supervised agent run",
      path: "/repo/cc",
      now: "Idle",
      narration: "Installed the plasma dock recovery scripts so they survive restarts",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.title.text).toContain("Installed the plasma dock recovery scripts");
  expect(header.title.text.length).toBeLessThanOrEqual(64);
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("junk persisted narration cannot title the pane", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cc", name: "cc", projectRoot: "/repo/cc" },
    liveCwd: "/repo/cc",
    terminalStatus: "running",
    taskLineup: [],
    activelyWorking: true,
    statusSummary: {
      task: "Supervised agent run",
      path: "/repo/cc",
      now: "Editing src/components/Terminal.tsx",
      narration: "Editing src/components/Terminal.tsx",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.title.text).not.toContain("Terminal.tsx");
});

test("fully-completed task list shows the outcome, not 'Awaiting next action'", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "t-done",
      content: "Show what each terminal is doing in the agent's own words",
      status: "completed",
      source: "todo-write",
      updatedAt: 1000,
    }],
    activelyWorking: false,
    statusSummary: {
      task: "Show what each terminal is doing in the agent's own words",
      path: "/repo/termfleet",
      now: "Idle",
      narration: "Wired contextual titles through the status server and pushed the commits",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.title.text).toContain("Wired contextual titles through the status server");
  expect(header.title.text.length).toBeLessThanOrEqual(64);
  expect(header.title.text).not.toBe("Awaiting next action");
});

// KNOWN GAP (tracked): a todo-write task scoped to an OLD run still outranks a newer
// run's ask because sidecar summaries are not run-scoped. Needs a run-scoping rule in
// resolveTaskIdentity, not an expectation tweak.
test.fixme("stale scoped todo-write summary does not own a newer run", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    activeRunId: "run-current",
    taskLineup: [{
      id: "old-sidecar-task",
      content: "Skipping model calls for clear task sidecars",
      status: "in_progress",
      source: "todo-write",
      runId: "run-old",
      updatedAt: 1000,
    }],
    mainUserAsk: {
      text: "Make pane headers reliable enough that the task and title explain the real work days later",
      source: "status-sidecar",
      runId: "run-current",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Skipping model calls for clear task sidecars",
      path: "/repo/termfleet",
      now: "Reducing model calls for clear tasks",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Make pane headers reliable enough that the task and title explain the real work days later");
  expect(header.taskDescription.text).not.toBe("Skipping model calls for clear task sidecars");
});

test("thin failed-test status falls back to the Services task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Find the newer Services page version",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Find the newer Services page version",
      path: "/repo/bina-ve-ze",
      now: "Test suite failed",
      narration: "Test suite failed",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Find the newer Services page version");
  expect(header.title.text).toBe("Finding the newer Services page version");
  expect(header.title.text).not.toBe("Test suite failed");
});

test("push to production prompt gets an action title instead of awaiting action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    mainUserAsk: {
      text: "push to production",
      source: "terminal-prompt",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-ve-ze",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("push to production");
  expect(header.title.text).toBe("Pushing to production");
});

test("thin acknowledgment sidecar text is not treated as a task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    mainUserAsk: {
      text: "sure",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-meatzevet-courses",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Idle");
  expect(header.debug.hasUserTask).toBe(false);
});

test("thin fix-this sidecar text is not treated as a task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    mainUserAsk: {
      text: "fix this too",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/arthouse",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Task not captured");
  expect(header.title.text).toBe("Working");
  expect(header.debug.hasUserTask).toBe(false);
});

test("final-answer scrape falls back to the active pane-header task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-header-quality",
      content: "Improve pane header task and title quality",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "What changed: - Fixed the Botson “should we create daily/once in several days” case",
      path: "/repo/termfleet",
      now: "What changed: - Fixed the Botson “should we create daily/once in several days” case",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Improve pane header task and title quality");
  expect(header.title.text).toBe("Improving pane header task and title quality");
});

test("thin browser-run fragments fall back to the declared verification task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-verify",
      content: "Run build, lint, focused tests, and visual checks",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "on chromium · studio-stations.spec.ts",
      path: "/repo/bina-ve-ze",
      now: "on chromium · studio-stations.spec.ts",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Run build, lint, focused tests, and visual checks");
  expect(header.title.text).toBe("Running build and visual checks");
});

test("prose answer titles fall back to the active task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-watchpost", name: "watchpost", projectRoot: "/repo/flow-state/watchpost" },
    liveCwd: "/repo/flow-state/watchpost",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-memory",
      content: "Refresh memory summary and verify references",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Yes: the current Flow surface still looks too much like an internal table/card system.",
      path: "/repo/flow-state/watchpost",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Refresh memory summary and verify references");
  expect(header.title.text).toBe("Refreshing memory summary and verify references");
  expect(header.title.text).not.toContain("Yes:");
});

test("final answer instructions cannot become pane titles", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-commit",
      content: "Committing and pushing TC-049",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "To test it yourself: open the Map with terminals from multiple projects and check the layout.",
      path: "/repo/termfleet",
      now: "To test it yourself: open the Map with terminals from multiple projects and check the layout.",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Committing and pushing TC-049");
  expect(header.title.text).toBe("Pushing TC-049 branch changes");
  expect(header.title.text).not.toContain("To test it yourself");
});

test("focused gate task derives a concrete activity instead of awaiting action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    taskLineup: [{
      id: "focused-gates",
      content: "Run focused tests and quality gates",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Run focused tests and quality gates",
      path: "/repo/flow-state",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Run focused tests and quality gates");
  expect(header.title.text).toBe("Running focused tests and quality gates");
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("sidecar find task produces a concrete title instead of Idle", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-services",
      content: "Find where to get the latest Services page",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-ve-ze",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Find where to get the latest Services page");
  expect(header.title.text).toBe("Finding where to get the latest Services page");
  expect(header.title.text).not.toBe("Idle");
});

test("refresh task produces a concrete title instead of Working", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-watchpost", name: "watchpost", projectRoot: "/repo/flow-state/watchpost" },
    liveCwd: "/repo/flow-state/watchpost",
    terminalStatus: "running",
    neutralTitle: "Working",
    taskLineup: [{
      id: "task-memory",
      content: "Refresh memory summary and verify references",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Refresh memory summary and verify references",
      path: "/repo/flow-state/watchpost",
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Refresh memory summary and verify references");
  expect(header.title.text).toBe("Refreshing memory summary and verify references");
  expect(header.title.text).not.toBe("Working");
});

test("frontend lint moment falls back to the broader task title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-build",
      content: "Run build, lint, focused tests, and visual checks",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Run build, lint, focused tests, and visual checks",
      path: "/repo/bina-ve-ze",
      now: "frontend lint checks",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.title.text).toBe("Running build and visual checks");
  expect(header.title.text).not.toBe("Linting frontend");
});

test("frontend build moment falls back to the broader verification task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-designersai", name: "designersai", projectRoot: "/repo/designersai" },
    liveCwd: "/repo/designersai",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-verify",
      content: "Run verification and summarize",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Checking frontend build",
      path: "/repo/designersai",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Run verification and summarize");
  expect(header.title.text).toBe("Running verification and summary checks");
  expect(header.title.text).not.toBe("Checking frontend build");
});

test("gerund command task gets a distinct title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-desktop",
      content: "Running desktop verification commands",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Running desktop verification commands",
      path: "/repo/termfleet",
      now: "Ready",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Running desktop verification commands");
  expect(header.title.text).toBe("Checking desktop verification results");
  expect(header.title.text).not.toBe(header.taskDescription.text);
});

test("tiny command title falls back to the active task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-summary",
      content: "Summarize verification and next steps",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Running: tr",
      path: "/repo/hermes",
      now: "Running: tr",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Summarize verification and next steps");
  expect(header.title.text).toBe("Summarizing verification and next steps");
  expect(header.title.text).not.toBe("Running: tr");
});

test("tiny command title with a flag falls back to the active task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-restore",
      content: "Restore previous work state",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Running: sed -n",
      path: "/repo/arthouse",
      now: "Running: sed -n",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Restore previous work state");
  expect(header.title.text).toBe("Restoring previous work state");
  expect(header.title.text).not.toBe("Running: sed -n");
});

test("debug-share sidecar task produces a concrete title instead of Working", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    neutralTitle: "Working",
    mainUserAsk: {
      text: "Included in debug-share bundles with the existing redaction path",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Included in debug-share bundles with the existing redaction path",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Included in debug-share bundles with the existing redaction path");
  expect(header.title.text).toBe("Checking debug-share bundle redaction path");
  expect(header.title.text).not.toBe("Working");
});

test("raw MCP tool activity cannot replace an Arthouse verification title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-visual",
      content: "Visually verify live private and public flows in connected Chrome",
      status: "in_progress",
      source: "todo-write",
      activeForm: "Using mcp__node_repl__js",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Using mcp__node_repl__js",
      path: "/repo/arthouse",
      now: "Using mcp__node_repl__js",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Visually verify live private and public flows in connected Chrome");
  expect(header.title.text).toBe("Verifying live Arthouse flows");
});

test("focused verification task gets a distinct four-word title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Checking focused verification",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Checking focused verification",
      path: "/repo/termfleet",
      now: "Checking focused verification",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Checking focused verification");
  expect(header.title.text).toBe("Running focused verification checks");
});
