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
  // New contract: the title never restates the Task row — with no distinct
  // current step it shows an honest status word.
  expect(header.title.text).toBe("Awaiting next action");
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
  expect(header.title.text).toBe("Awaiting next action");
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
  expect(header.title.text).toBe("Activity not captured");
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
  expect(header.title.text).toBe("Activity not captured");
  expect(header.now.text).toBe("Activity not captured");
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
  expect(header.title.text).toBe("Activity not captured");
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

test("rewrites raw unclear GPT Image search prompt into a concrete task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-rough", name: "rough-cut-mvp", projectRoot: "/repo/rough-cut-mvp" },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    mainUserAsk: {
      text: "still looking unclear what this is... serach the system for how to prompt gpt image 2 based on this",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "non-interlaced",
      path: "/repo/rough-cut-mvp",
      now: "Old SVG source has been replaced with a clearer PNG version",
      narration: "Old SVG source has been replaced with a clearer PNG version",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Improve GPT Image prompting for the Rough Cut icon");
  expect(header.title.text).toBe("Old SVG source has been replaced with a clearer PNG version");
  expect(header.taskDescription.text).not.toContain("serach");
  expect(header.taskDescription.text).not.toContain("unclear what this is");
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
  expect(header.title.text).toBe("Activity not captured");
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
  expect(header.title.text).toBe("Activity not captured");
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

test("polishes raw page-quality prompt into short task and activity labels", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    activeRunId: "run-services-page",
    taskLineup: [],
    mainUserAsk: {
      text: "the services page is sub par ask me questions to understand what's really there",
      source: "terminal-prompt",
      updatedAt: 1000,
      runId: "run-services-page",
    },
    statusSummary: {
      task: "the services page is sub par ask me questions to understand what's really there",
      userTask: "the services page is sub par ask me questions to understand what's really there",
      path: "/repo/bina-ve-ze",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Improve the services page");
  expect(header.title.text).toBe("Improving the services page");
  expect(header.now.text).toBe("Awaiting next action");
  expect(header.title.text).not.toContain("ask me questions");
  expect(header.title.text.length).toBeLessThanOrEqual(40);
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

  expect(header.now.text).toBe("Awaiting next action");
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
  // Operator contract (2026-07-04): a high-confidence narration statement is
  // MORE informative than "Activity not captured" — show it.
  expect(header.title.text).toContain("VPS has the 12 tracking events");
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
  expect(header.title.text).toBe("Activity not captured");
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
  expect(header.title.text).toBe("Activity not captured");
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

test("idle pane with a user ask still reads 'Awaiting next action' (not working)", () => {
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
  expect(header.title.text).toBe("Awaiting next action");
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

test("generic stale prompts fall back to the status-summary task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "fix it",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    activelyWorking: false,
    statusSummary: {
      task: "Fix the sandbox test blocker by running Vitest with a temporary config",
      path: "/repo/hermes",
      now: "Vitest completed successfully with the temporary config",
      narration: "Vitest completed successfully with the temporary config",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Fix the sandbox test blocker by running Vitest with a temporary config");
  expect(header.taskDescription.source).toBe("status-summary");
  expect(header.title.text).toBe("Vitest completed successfully with the temporary config");
  expect(header.taskDescription.text).not.toBe("fix it");
});

test("stale scoped todo-write summary does not own a newer run", () => {
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

test("new low-quality screenshot complaint replaces stale unscoped task text", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "old-sidecar-task",
      content: "Skipping model calls for clear task sidecars",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    mainUserAsk: {
      text: "[Image #1] low quality... what now? do you understand what is low quality here?",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Skipping model calls for clear task sidecars",
      path: "/repo/termfleet",
      now: "Continue the task or process to continue with the next steps.",
      narration: "Continue the task or process to continue with the next steps.",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Improve pane header task and title quality");
  expect(header.title.text).toBe("Improving pane header task and title quality");
  expect(header.title.text).not.toContain("Continue the task");
  expect(header.taskDescription.text).not.toBe("Skipping model calls for clear task sidecars");
});

test("screenshot resource complaint becomes a concrete Watchpost task and title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-watchpost", name: "watchpost", projectRoot: "/repo/flow-state/watchpost" },
    liveCwd: "/repo/flow-state/watchpost",
    terminalStatus: "running",
    mainUserAsk: {
      text: "[Image #1] why is this resource not being followed?",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "[Image #1] why is this resource not being followed?",
      path: "/repo/flow-state/watchpost",
      now: "The bad part was not the layout alone; it was the data model.",
      narration: "The bad part was not the layout alone; it was the data model.",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Improve resource-following design for Watchpost");
  expect(header.title.text).toBe("Improving resource-following design for Watchpost");
  expect(header.taskDescription.text).not.toContain("[Image");
  expect(header.title.text).not.toContain("The bad part");
});

test("question-shaped Hermes sidecar task becomes a concrete investigation title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "any leads on why this is happening?",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "any leads on why this is happening?",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Investigate why the Hermes issue is happening");
  expect(header.title.text).toBe("Investigating why the Hermes issue is happening");
  expect(header.title.text).not.toBe("Working");
});

test("long Hermes dropoff prompt becomes a short concrete task and title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "I dont want to need to start a new conversation - why not have the chat create a dropoff with the context?",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "I dont want to need to start a new conversation - why not have the chat create a dropoff with the context?",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Add dropoff creation for long Hermes chats");
  expect(header.title.text).toBe("Adding dropoff creation for long Hermes chats");
});

test("terse make-high prompt becomes a concrete Hermes task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "make high",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "make high",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Improve Hermes chat quality");
  expect(header.title.text).toBe("Improving Hermes chat quality");
});

test("inline screenshot send failure becomes a concrete Hermes task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "nothing happens here [Image #1] after I send this",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "nothing happens here [Image #1] after I send this",
      path: "/repo/hermes",
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Investigate Hermes send action failure");
  expect(header.title.text).toBe("Investigating Hermes send action failure");
  expect(header.taskDescription.text).not.toContain("[Image");
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

test("Botson schedule question gets a decision task instead of awaiting action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-botson", name: "botson", projectRoot: "/repo/botson" },
    liveCwd: "/repo/botson",
    terminalStatus: "running",
    mainUserAsk: {
      text: "should we create a daily or once in sevral days for you that",
      source: "terminal-prompt",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/botson",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Decide Botson check-in schedule");
  expect(header.title.text).toBe("Choosing Botson check-in schedule");
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
  expect(header.title.text).toBe("Activity not captured");
  expect(header.debug.hasUserTask).toBe(false);
});

test("typo close-gap prompt becomes a concrete task and title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-botson", name: "botson", projectRoot: "/repo/botson" },
    liveCwd: "/repo/botson",
    terminalStatus: "running",
    mainUserAsk: {
      text: "do all tasks to glose the gap +",
      source: "terminal-prompt",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/botson",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Close remaining task gap");
  expect(header.title.text).toBe("Closing remaining task gap");
  expect(header.title.text).not.toBe("Awaiting next action");
});

test("commit-and-verify prompt fragment becomes a concrete task and title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-rough", name: "rough-cut-mvp", projectRoot: "/repo/rough-cut-mvp" },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    mainUserAsk: {
      text: "after that do a run commiting and pushing everything that is left safely removing dead branches and verifying that you dint break anything",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/rough-cut-mvp",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Commit and verify remaining changes");
  expect(header.title.text).toBe("Committing and verifying remaining changes");
  expect(header.title.text).not.toBe("Working");
});

test("bare package test command becomes a project-specific task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: {
      id: "g-rough-cut",
      name: "rough-cut-mvp",
      projectRoot: "/repo/rough-cut-mvp",
    },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: "/repo/rough-cut-mvp",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Run Rough Cut MVP test suite");
  expect(header.taskDescription.source).toBe("status-summary");
  expect(header.title.text).toBe("Running Rough Cut MVP test suite");
  expect(header.title.source).toBe("status-summary");
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

test("long raw sidecar asks become specific plain-English tasks", () => {
  const hermes = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "your system should fix this no? Also should rag so that the system will be able to load data live from obsidian and write there all it needs over time so it will always have context?",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Working",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });
  const retroCharge = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "investigaate and plan with super powers on how to add it and just in case how to charge retro active customer invoices",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-meatzevet-courses",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });
  const invoiceSection = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    taskLineup: [],
    mainUserAsk: {
      text: "load the task of crating an inveoice sections for paying cutsomers",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-meatzevet-courses",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(hermes.taskDescription.text).toBe("Add Obsidian memory loading for Hermes");
  expect(hermes.title.text).toBe("Adding Obsidian memory loading for Hermes");
  expect(retroCharge.taskDescription.text).toBe("Plan retroactive customer invoice charging");
  expect(retroCharge.title.text).toBe("Planning retroactive customer invoice charging");
  expect(invoiceSection.taskDescription.text).toBe("Add invoice section for paying customers");
  expect(invoiceSection.title.text).toBe("Adding invoice section for paying customers");
});

test("generic focused-test task includes visible issue context", () => {
  const purpose = terminalPurposeFromContext({
    activeTaskTitle: "Run focused tests and typecheck",
    terminalOutput: [
      "• Working (9m 11s • esc to interrupt)",
      "Search onSessionError in use-message-stream",
      "The blocker is indeed a narrow test harness type",
    ].join("\n"),
  });
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-test",
      content: "Run focused tests and typecheck",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Run focused tests and typecheck",
      path: "/repo/hermes",
      now: "Run focused tests and typecheck",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
    contextPurposeTitle: purpose?.title,
  });

  expect(purpose?.title).toBe("Searching onSessionError in use-message-stream");
  expect(header.taskDescription.text).toBe("Run focused tests for Hermes onSessionError handling");
  expect(header.title.text).toBe("Running focused tests for Hermes onSessionError handling");
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

test("implementation sidecar task renders as the pane-header quality goal", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-termfleet", name: "termfleet", projectRoot: "/repo/termfleet" },
    liveCwd: "/repo/termfleet",
    terminalStatus: "running",
    taskLineup: [{
      id: "sidecar-task",
      content: "Skipping model calls for clear task sidecars",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Skipping model calls for clear task sidecars",
      path: "/repo/termfleet",
      now: "Assessing a low-quality image is the next step to address the issue",
      narration: "Assessing a low-quality image is the next step to address the issue",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Improve pane header task and title quality");
  expect(header.title.text).toBe("Improving pane header task and title quality");
  expect(header.title.text).not.toContain("next step");
  expect(header.taskDescription.text).not.toBe("Skipping model calls for clear task sidecars");
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

test("branch sync status produces a concrete task and title instead of Idle", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    statusSummary: {
      task: "Status: feat/sidebar-custom-folders is clean and synced with origin/feat/sidebar-custom-folders",
      path: "/repo/bina-ve-ze",
      now: "Task completed successfully and on time",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Verify sidebar custom folders branch sync");
  expect(header.title.text).toBe("Verifying sidebar custom folders branch sync");
  expect(header.title.text).not.toBe("Idle");
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

test("short user task still produces a concrete title instead of awaiting action", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-botson", name: "botson", projectRoot: "/repo/botson" },
    liveCwd: "/repo/botson",
    terminalStatus: "running",
    mainUserAsk: { text: "two people voted", source: "status-sidecar", updatedAt: 1000 },
    statusSummary: {
      task: "Ready",
      path: "/repo/botson",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("two people voted");
  expect(header.title.text).toBe("Reviewing two people voted");
  expect(header.title.text).not.toBe("Awaiting next action");
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

test("long outcome narration does not overflow the card title", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    mainUserAsk: {
      text: "use design skills to design these and implement it",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "All covers load (this also fixed the same broken Contractor image on ).",
      path: "/repo/bina-ve-ze",
      now: "building TypeScript and Vite production bundle",
      narration: "All covers load (this also fixed the same broken Contractor image on ).",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Design and implement project tiles");
  expect(header.title.text.length).toBeLessThanOrEqual(64);
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

test("implementation-confidence prompt becomes a concrete VPS verification task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    mainUserAsk: {
      text: "If Not HIGH Before implementation, I would verify: - on the VPS - existing timer state:",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/arthouse",
      now: "frontend lint checks",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Verify VPS timer state before implementation");
  expect(header.title.text).toBe("Verifying VPS timer state before implementation");
  expect(header.title.text).not.toBe("Working");
});

test("Arthouse missing-call question becomes a concrete investigation task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    mainUserAsk: {
      text: "why do I have only one call of a sudden? I had many more beforew",
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

  expect(header.taskDescription.text).toBe("Investigate missing Arthouse call records");
  expect(header.title.text).toBe("Investigating missing Arthouse call records");
  expect(header.title.text).not.toBe("Working");
});

test("Hermes RAG research prompt becomes a concrete research task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "reserach the best implemenation and if rag is needed or another solution and if its needed how",
      source: "status-sidecar",
      updatedAt: 2000,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Research Hermes memory-loading approach");
  expect(header.title.text).toBe("Researching Hermes memory-loading approach");
  expect(header.title.text).not.toBe("Working");
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

test("line-number audit fragment becomes a concrete Cardcom task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina-course", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Ts:75) - A read-only production audit comparing overdue rows against Cardcom financial row",
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

  expect(header.taskDescription.text).toBe("Audit Cardcom overdue production rows");
  expect(header.title.text).toBe("Auditing Cardcom overdue production rows");
  expect(header.title.text).not.toBe("Awaiting next action");
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

test("sandboxed Vitest blocker produces a goal when no task row was captured", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    statusSummary: {
      task: "Focused Vitest could not run in this sandbox because Vite needs to write under read-only node_modules/.vite-temp",
      path: "/repo/hermes",
      now: "Test process completed successfully",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Resolve focused Vitest sandbox write failure");
  expect(header.title.text).toBe("Resolving focused Vitest sandbox write failure");
  expect(header.title.text).not.toBe("Idle");
});

test("task completion with an object becomes a specific project-plan result", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    statusSummary: {
      task: "Supervised agent run",
      path: "/repo/hermes",
      now: "Task to update MASTER_PLAN completed successfully after reviewing the recovery notes",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Verify project plan update result");
  expect(header.title.text).toBe("Verifying project plan update result");
  expect(header.title.text).not.toContain("Task to update");
});

test("completed screenshot outcome produces a concrete task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-ve-ze",
      now: "Public screenshot and top crop completed successfully after 8m 12s",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Verify public screenshot and top crop result");
  expect(header.title.text).toBe("Verifying public screenshot and top crop result");
});

test("deployment recommendation outcome produces a concrete task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-designersai", name: "designersai", projectRoot: "/repo/designersai" },
    liveCwd: "/repo/designersai",
    terminalStatus: "running",
    summary: {
      task: "Netlify is a better option for free and quick deployment when comparing hosting choices",
      path: "/repo/designersai",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Choose Vercel or Netlify deployment option");
  expect(header.title.text).toBe("Choosing Vercel or Netlify deployment option");
});

test("fast-track waiting state produces a concrete task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    statusSummary: {
      task: "-fast-track state: the next meaningful work is not cleanly code-actionable without more information",
      path: "/repo/bina-ve-ze",
      now: "Waiting for additional information to proceed",
      status: "waiting",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Choose next fast-track work");
  expect(header.title.text).toBe("Waiting for additional information to proceed");
});

test("watchpost memory summary task survives file-name wording", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: flowStatePath },
    liveCwd: `${flowStatePath}/watchpost`,
    terminalStatus: "running",
    statusSummary: {
      task: "Rewrite or refresh memory_summary.md from finalized memory state and verify references",
      path: `${flowStatePath}/watchpost`,
      now: "Codex JSONL has been successfully integrated into the plan",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.workspace.text).toBe("flow-state");
  expect(header.taskDescription.text).toBe("Refresh memory summary and verify references");
  expect(header.title.text).toBe("Codex JSONL has been successfully integrated into the plan");
});

test("website content update outcome produces a concrete task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-designersai", name: "designersai", projectRoot: "/repo/designersai" },
    liveCwd: "/repo/designersai",
    terminalStatus: "running",
    statusSummary: {
      task: "You can test locally:",
      path: "/repo/designersai",
      now: "Website content updated successfully after testing and updating.",
      narration: "Website content updated successfully after testing and updating.",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Verify website content update result");
  expect(header.title.text).toBe("Website content updated successfully after testing and updating.");
});

test("live visual verification and memory routing tasks avoid generic or technical titles", () => {
  const arthouse = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-visual",
      content: "Visually verify live private and public flows in connected Chrome",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Visually verify live private and public flows in connected Chrome",
      path: "/repo/arthouse",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });
  const memory = buildShellTerminalHeaderViewModel({
    project: { id: "g-rough", name: "rough-cut-mvp", projectRoot: "/repo/rough-cut-mvp" },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-memory",
      content: "Refresh memory_summary.md routing and cross-task preferences to match final MEMORY.md",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Refresh memory_summary.md routing and cross-task preferences to match final MEMORY.md",
      path: "/repo/rough-cut-mvp",
      now: "You can test now with either the desktop shortcut",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(arthouse.taskDescription.text).toBe("Visually verify live private and public flows in connected Chrome");
  expect(arthouse.title.text).toBe("Verifying live Arthouse flows");
  expect(memory.taskDescription.text).toBe("Refresh memory routing rules");
  expect(memory.title.text).toBe("Refreshing memory routing rules");
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

test("Hermes backend diagnostics sidecar text becomes a concrete task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "[hermes] [hermes] [diagnostics] backend.exit: Primary backend exited[hermes] [hermes] [boot]...",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "[hermes] [hermes] [diagnostics] backend.exit: Primary backend exited[hermes] [hermes] [boot]...",
      path: "/repo/hermes",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Investigate Hermes backend exit diagnostics");
  expect(header.title.text).toBe("Investigating Hermes backend exit diagnostics");
});

test("long Hermes runtime-agent ask becomes a concrete Claude and Conquer task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cac", name: "claude-and-conquer", projectRoot: "/repo/claude-and-conquer" },
    liveCwd: "/repo/claude-and-conquer",
    terminalStatus: "running",
    mainUserAsk: {
      text: "I want to connect hermes to claude-and-conquer as the runtime agent instead of what we have now",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Working",
      path: "/repo/claude-and-conquer",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Connect Hermes to Claude and Conquer as runtime agent");
  expect(header.title.text).toBe("Connecting Hermes to Claude and Conquer as runtime agent");
});

test("typo follow-up-question ask becomes a concrete Bina additions task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-ve-ze", projectRoot: "/repo/bina-ve-ze" },
    liveCwd: "/repo/bina-ve-ze",
    terminalStatus: "running",
    mainUserAsk: {
      text: "ask questionsbout more things that we should add an I didnt think about",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "All covers load",
      path: "/repo/bina-ve-ze",
      now: "building TypeScript and Vite production bundle",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Ask follow-up questions for Bina Ve Ze additions");
  expect(header.title.text).toBe("Asking follow-up questions for Bina Ve Ze additions");
});

test("operator implement-plan prompt supplies task context when no sidecar task exists", () => {
  const purpose = terminalPurposeFromOperatorPrompt([
    "Implement this plan?",
    "1. Yes, implement this plan Switch to Default and start coding.",
    "2. No, stay in Plan mode Continue planning with the model.",
    "Press enter to confirm or esc to go back",
  ].join("\n"));
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cac", name: "claude-and-conquer", projectRoot: "/repo/claude-and-conquer" },
    liveCwd: "/repo/claude-and-conquer",
    terminalStatus: "running",
    contextPurposeTitle: purpose?.title,
    statusSummary: {
      task: "Working",
      path: "/repo/claude-and-conquer",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Choose whether to implement current plan");
  expect(header.title.text).toBe("Choosing whether to implement current plan");
});

test("Hermes service status output supplies task context when no sidecar task exists", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    contextPurposeTitle: "Check Hermes desktop service status",
    statusSummary: {
      task: "Ready",
      path: "/repo/hermes",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Check Hermes desktop service status");
  expect(header.title.text).toBe("Checking Hermes desktop service status");
});

test("paused Codex resume output supplies task context when no sidecar task exists", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-rough", name: "rough-cut-mvp", projectRoot: "/repo/rough-cut-mvp" },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    contextPurposeTitle: "Resume paused Codex session",
    statusSummary: {
      task: "Ready",
      path: "/repo/rough-cut-mvp",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Resume paused Codex session");
  expect(header.title.text).toBe("Resuming paused Codex session");
});

test("long Arthouse blocked-event prompt becomes an event-source task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-arthouse", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    mainUserAsk: {
      text: "One row is still intentionally blocked: New World AI Film Festival. I ran a targeted fresh recheck and cannot force-publish it. so how do we solve this? how do we find a wider array of types of events?",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Working",
      path: "/repo/arthouse",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Find wider AI film festival sources");
  expect(header.title.text).toBe("Finding wider AI film festival sources");
});

test("long Telegram bot E2E prompt becomes a conversion review task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-cac", name: "claude-and-conquer", projectRoot: "/repo/claude-and-conquer" },
    liveCwd: "/repo/claude-and-conquer",
    terminalStatus: "running",
    mainUserAsk: {
      text: "I am thinking of converting it e2e. the telegram bot had issues from the start",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Working",
      path: "/repo/claude-and-conquer",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Review end-to-end Telegram bot conversion");
  expect(header.title.text).toBe("Reviewing end-to-end Telegram bot conversion");
});

test("commit-push-branch cleanup prompt becomes a concrete Botson task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-botson", name: "botson", projectRoot: "/repo/botson" },
    liveCwd: "/repo/botson",
    terminalStatus: "running",
    mainUserAsk: {
      text: "lets commit, push, merge clean old branches etc safely",
      source: "terminal-prompt",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Awaiting next action",
      path: "/repo/botson",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Commit, push, merge, and clean old branches safely");
  expect(header.title.text).toBe("Committing and cleaning old branches safely");
});

test("restart and VPS question becomes a concrete persistence decision task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    mainUserAsk: {
      text: "will it survite restart too? should we add it to the vps?",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Awaiting next action",
      path: "/repo/flow-state",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Decide restart and VPS persistence");
  expect(header.title.text).toBe("Choosing restart and VPS persistence");
});

test("background terminal status output supplies task context when no sidecar task exists", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    contextPurposeTitle: "Check background terminal status",
    statusSummary: {
      task: "Ready",
      path: "/repo/bina-meatzevet-courses",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Check background terminal status");
  expect(header.title.text).toBe("Checking background terminal status");
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

test("test:e2e result title falls back to the background-terminal task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-bina", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    contextPurposeTitle: "Check background terminal status",
    statusSummary: {
      task: "Check background terminal status",
      path: "/repo/bina-meatzevet-courses",
      now: "test:e2e passed",
      narration: "test:e2e passed",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Check background terminal status");
  expect(header.title.text).toBe("Checking background terminal status");
});

test("done command with placeholder prompt gets a closeout task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    contextPurposeTitle: "Close current agent task",
    statusSummary: {
      task: "Working",
      path: "/repo/hermes",
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Close current agent task");
  expect(header.title.text).toBe("Closing current agent task");
});

test("Hermes to Flow State prompt gets a connection task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    contextPurposeTitle: "Connect Hermes to Flow State",
    statusSummary: {
      task: "Ready",
      path: "/repo/hermes",
      now: "Idle",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Connect Hermes to Flow State");
  expect(header.title.text).toBe("Connecting Hermes to Flow State");
});

test("Hermes Flow State toolset plan becomes a concrete configuration task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    mainUserAsk: {
      text: "The plan can keep UI work small: add Flow State as a configurable toolset with URL/token defaults and a first health check.",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "The plan can keep UI work small: add Flow State as a configurable toolset with URL/token defaults and a first health check.",
      path: "/repo/hermes",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Add Flow State toolset configuration to Hermes");
  expect(header.title.text).toBe("Adding Flow State toolset configuration to Hermes");
});

test("Hermes Flow State toolset status summary becomes a concrete configuration task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    statusSummary: {
      task: "The plan can keep UI work small: add Flow State as a configurable toolset with URL/token defaults and a first health check.",
      path: "/repo/hermes",
      now: "Awaiting next action",
      status: "idle",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe("Add Flow State toolset configuration to Hermes");
  expect(header.title.text).toBe("Adding Flow State toolset configuration to Hermes");
});
