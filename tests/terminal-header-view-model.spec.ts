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
  expect(header.taskDescription.source).toBe("user-task");
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
  expect(header.title.text).toBe("Editing the sidecar writer");
  expect(header.now.text).toBe("Editing the sidecar writer");
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

test("polishes short make-all-high prompts into readable task and activity text", () => {
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

  expect(header.taskDescription.text).toBe("Raise quality across the current work");
  expect(header.title.text).toBe("Thinking through quality improvements");
  expect(header.title.text).not.toContain("making all high");
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

test("uses stored quality task as useful activity when no live activity is available", () => {
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

  expect(header.taskDescription.text).toBe("Raise quality across the current work");
  expect(header.title.text).toBe("Improving quality");
  expect(header.title.text).not.toBe("Awaiting next action");
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
  expect(header.title.text).toBe("Awaiting next action");
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
  expect(header.taskDescription.source).toBe("user-task");
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
  expect(header.taskDescription.source).toBe("task-list");
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

  expect(header.now.text).toBe("Activity not captured");
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
  expect(header.title.text).toBe("Activity not captured");
  expect(header.now.text).toBe("Activity not captured");
  expect(header.title.text).not.toContain("VPS has");
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
  expect(header.taskDescription.source).toBe("task-list");
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
  expect(header.taskDescription.source).toBe("task-list");
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

  expect(header.title.text).toBe("Installing the updated scripts into the user systemd services now");
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

  expect(header.title.text).toBe("Installed the plasma dock recovery scripts so they survive restarts");
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
