import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  cwdSidecarFileName,
  paneSidecarFileName,
  readLocalSidecarStatus,
  readLocalSidecarSummary,
  sidecarCandidateFileNames,
  sidecarFresh,
  summaryFromSidecar,
} from "../src/lib/agentStatusSidecar";
import { summaryFromSidecar as summaryFromNodeSidecar } from "../scripts/agent-status-summary-sidecar.mjs";
import { summarizeAgentStatus } from "../src/lib/agentStatusSummarizer";
import { fallbackAgentStatusSummary } from "../src/lib/agentStatusSummary";
import {
  paneSidecarPath,
  sidecarPath,
} from "../scripts/lib/agent-status-paths.mjs";

// TC-035 follow-up: the app reads the agent-status sidecar files DIRECTLY (via a
// Tauri command) instead of depending on the launcher-lifetime HTTP status server.
// The TS port here must key files identically to the node hook/worker
// (scripts/lib/agent-status-paths.mjs) or the app silently reads nothing.

const PANE_IDS = [
  "terminal-e65f75e6-c14a-4096-bce3-8ae1015a0ac0-42616e9d-02d9-432f-af58-b6f15927f24b",
  "terminal-abc-def",
  "",
];

const CWDS = [
  "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
  "/repo/project/",
  "/a//b/./c",
  "/a/b/../c",
];

test("pane sidecar file names match the node hook/worker path scheme", () => {
  for (const paneId of PANE_IDS) {
    expect(paneSidecarFileName(paneId)).toBe(path.basename(paneSidecarPath(paneId)));
  }
});

test("cwd sidecar file names match the node hook/worker path scheme", () => {
  for (const cwd of CWDS) {
    expect(cwdSidecarFileName(cwd)).toBe(path.basename(sidecarPath(cwd)));
  }
});

test("sidecar freshness honors the 30 minute TTL", () => {
  const now = 1_782_987_000_000;
  expect(sidecarFresh({ updatedAt: now - 60_000 }, undefined, now)).toBe(true);
  expect(sidecarFresh({ updatedAt: now - 31 * 60 * 1000 }, undefined, now)).toBe(false);
  expect(sidecarFresh(null, undefined, now)).toBe(false);
  expect(sidecarFresh({}, undefined, now)).toBe(false);
});

function fallbackFor(cwd: string) {
  return fallbackAgentStatusSummary({ provider: "shell", cwd });
}

test("summaryFromSidecar prefers the current task's activeForm as the title", () => {
  const summary = summaryFromSidecar(
    {
      updatedAt: Date.now(),
      now: "Editing agentStatusSidecar.ts",
      todos: [
        { id: "1", content: "Find the bug", status: "completed", activeForm: "Finding the bug" },
        { id: "2", content: "Fix titles for good", status: "in_progress", activeForm: "Fixing titles for good" },
      ],
    },
    fallbackFor("/repo/x"),
  );
  expect(summary.task).toBe("Fixing titles for good");
  expect(summary.now).toBe("Editing agentStatusSidecar.ts");
  expect(summary.status).toBe("working");
  expect(summary.tasksFromTodoWrite).toBe(true);
  const texts = (summary.tasks as Array<{ text: string }>).map((item) => item.text);
  expect(texts).toEqual(["done: Find the bug", "in-progress: Fix titles for good"]);
});

test("summaryFromSidecar keeps the pane provider instead of calling every hand-started agent a shell", () => {
  const summary = summaryFromSidecar(
    { provider: "codex", updatedAt: Date.now(), userTask: "Continue the current task" },
    {
      task: "Terminal",
      path: "/repo",
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "low",
    },
  );

  expect(summary.provider).toBe("codex");
});

test("summaryFromSidecar exposes the durable main task instead of the latest message", () => {
  const sidecar = {
    provider: "codex" as const,
    updatedAt: Date.now(),
    mainTask: "Improving the live-events landing page and routes",
    mainTaskSource: "plan-explanation" as const,
    userTask: "you will inform me when you are done and give me a count",
    now: "Reviewing the landing page on mobile",
    todos: [{
      content: "Reviewing the landing page on mobile",
      status: "in_progress",
      activeForm: "Reviewing the landing page on mobile",
    }],
  };

  const browserSummary = summaryFromSidecar(sidecar, fallbackFor("/repo/x"));
  const nodeSummary = summaryFromNodeSidecar(sidecar, {
    projectId: "/repo/x",
    workstream: { path: "/repo/x", provider: "shell" },
  });

  expect(browserSummary.userTask).toBe(sidecar.mainTask);
  expect(nodeSummary.userTask).toBe(sidecar.mainTask);
  expect(browserSummary.task).toBe(sidecar.mainTask);
  expect(nodeSummary.task).toBe(sidecar.mainTask);
  expect(browserSummary.now).toBe("Reviewing the landing page on mobile");
});

test("summaryFromSidecar rejects an unproven raw main task", () => {
  const summary = summaryFromSidecar(
    {
      updatedAt: Date.now(),
      mainTask: "do the same review for all bots and topics and then suggest a plan to all of them based on each needs",
      userTask: "do the same review for all bots and topics and then suggest a plan to all of them based on each needs",
      todos: [{ content: "Mapping what each bot and topic is meant to do", status: "in_progress" }],
    },
    fallbackFor("/repo/x"),
  );
  expect(summary.userTask).toBeUndefined();
});

test("summaryFromSidecar recovers a specific legacy Goal task as the durable work area", () => {
  const sidecar = {
    provider: "claude" as const,
    updatedAt: Date.now(),
    mainTask: "ok sending to queue works",
    now: "Commit and push the handoff",
    todos: [
      { content: "Goal: make the personal assistant fast and dependable", activeForm: "Making the assistant fast and dependable", status: "completed" },
      { content: "Goal: finish all safe remaining assistant work", activeForm: "Finishing safe remaining assistant work", status: "completed" },
      { content: "Verify the speed settings are live in real chats", activeForm: "Verifying speed settings are live", status: "pending" },
    ],
  };

  expect(summaryFromSidecar(sidecar, fallbackFor("/repo/hermes")).userTask)
    .toBe("make the personal assistant fast and dependable");
  expect(summaryFromNodeSidecar(sidecar, {
    projectId: "/repo/hermes",
    workstream: { path: "/repo/hermes", provider: "shell" },
  }).userTask).toBe("make the personal assistant fast and dependable");
});

test("summaryFromSidecar rejects an overlong plan explanation", () => {
  const summary = summaryFromSidecar(
    {
      updatedAt: Date.now(),
      mainTaskSource: "plan-explanation",
      mainTask: "The evidence review and per-bot plans are complete; the remaining work depends on the user's topic-ownership decisions.",
      todos: [{ content: "Waiting for your decisions about unclear topic ownership", status: "in_progress" }],
    },
    fallbackFor("/repo/x"),
  );
  expect(summary.userTask).toBeUndefined();
  expect(summary.task).toBe("Waiting for your decisions about unclear topic ownership");
});

test("summaryFromSidecar falls back to the last completed task when nothing is live", () => {
  const summary = summaryFromSidecar(
    {
      updatedAt: Date.now(),
      now: "Running: git status",
      todos: [
        { id: "1", content: "Ship the fix", status: "completed", activeForm: "Shipping the fix" },
      ],
    },
    fallbackFor("/repo/x"),
  );
  expect(summary.task).toBe("Ship the fix");
  expect(summary.status).toBe("idle");
});

test("a resumed turn turns the completed assistant check into current contextual work", () => {
  const sidecar = {
    updatedAt: Date.now(),
    turn: "working" as const,
    now: "Continuing after your answer",
    todos: [
      { content: "Confirming the assistant repair is safely completed", status: "completed", activeForm: "" },
    ],
  };
  const browserSummary = summaryFromSidecar(sidecar, fallbackFor("/repo/hermes"));
  const nodeSummary = summaryFromNodeSidecar(sidecar, {
    projectId: "/repo/hermes",
    workstream: { path: "/repo/hermes", provider: "shell" },
  });
  expect(browserSummary.task).toBe("Repairing the Hermes personal assistant safely");
  expect(browserSummary.now).toBe("Applying your answer to the Hermes personal-assistant repair");
  expect(nodeSummary.task).toBe(browserSummary.task);
  expect(nodeSummary.now).toBe(browserSummary.now);
});

test("a Bina consent audit explains the mandatory signup outcome", () => {
  const sidecar = {
    cwd: "/repo/bina-meatzevet-courses",
    updatedAt: Date.now(),
    turn: "working" as const,
    userTask: "you didnt make the sign up to emails mandatory. it must be mandatory everywhere all the time.",
    now: "Auditing newsletter consent across forms, data, and tests",
    todos: [{ content: "Auditing newsletter consent across forms, data, and tests", status: "in_progress" }],
  };
  const browserSummary = summaryFromSidecar(sidecar, fallbackFor("/repo/bina-meatzevet-courses"));
  const nodeSummary = summaryFromNodeSidecar(sidecar, {
    projectId: "/repo/bina-meatzevet-courses",
    workstream: { path: "/repo/bina-meatzevet-courses", provider: "shell" },
  });

  expect(browserSummary.task).toBe("Making email signup mandatory across every Bina registration flow");
  expect(browserSummary.now).toBe("Auditing newsletter consent across forms, data, and tests");
  expect(nodeSummary.task).toBe(browserSummary.task);
});

test("the Bina mandatory-consent purpose survives later attendee-list verification", () => {
  const summary = summaryFromSidecar({
    cwd: "/repo/bina-meatzevet-courses",
    updatedAt: Date.now(),
    turn: "working",
    userTask: "because you did not make it mandatory",
    mainTask: "Expanded the fix to include clear promotional-email status in every attendee list while preserving honest status for historical records.",
    mainTaskSource: "plan-explanation",
    now: "Running focused verification",
    todos: [
      { content: "Writing regression tests for admin email-consent visibility", status: "completed" },
      { content: "Showing and exporting status in attendee lists", status: "completed" },
      { content: "Running focused verification", status: "in_progress" },
    ],
  }, fallbackFor("/repo/bina-meatzevet-courses"));

  expect(summary.task).toBe("Making promotional email consent mandatory in every Bina signup and visible in attendee lists");
  expect(summary.now).toBe("Running focused verification");
});

test("the Bina billing repair purpose survives deployment", () => {
  const summary = summaryFromSidecar({
    cwd: "/repo/bina-meatzevet-courses",
    updatedAt: Date.now(),
    turn: "working",
    userTask: "dont skip anything; fix it end to end and give Levana the rest of July free",
    mainTask: "Independent review found unsafe callback-order and concurrent-checkout cases.",
    mainTaskSource: "plan-explanation",
    now: "Deploying the fix and checking production",
    todos: [
      { content: "Writing safety tests for renewal failures", status: "completed" },
      { content: "Fixing callback order and parallel checkout safety", status: "completed" },
      { content: "Refunding Lee and granting Levana the rest of July", status: "completed" },
      { content: "Deploying the fix and checking production", status: "in_progress" },
    ],
  }, fallbackFor("/repo/bina-meatzevet-courses"));

  expect(summary.task).toBe("Making renewals and checkout safe while refunding Lee and granting Levana free July access");
  expect(summary.now).toBe("Deploying the fix and checking production");
});

test("candidate file names try the pane sidecar first, then cwd keys", () => {
  const names = sidecarCandidateFileNames({
    paneId: "terminal-abc-def",
    gitRoot: "/repo/project",
    cwd: "/repo/project/sub",
  });
  expect(names[0]).toBe(paneSidecarFileName("terminal-abc-def"));
  expect(names).toContain(cwdSidecarFileName("/repo/project"));
  expect(names).toContain(cwdSidecarFileName("/repo/project/sub"));
  // No duplicates.
  expect(new Set(names).size).toBe(names.length);
});

test("readLocalSidecarSummary reads the pane file and shapes the summary", async () => {
  const paneId = "terminal-abc-def";
  const files = new Map<string, string>([
    [
      paneSidecarFileName(paneId),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Wiring the sidecar",
        todos: [{ id: "1", content: "Fix it", status: "in_progress", activeForm: "Fixing it" }],
      }),
    ],
  ]);
  const summary = await readLocalSidecarSummary(
    { provider: "shell", cwd: "/repo/x", paneId },
    fallbackFor("/repo/x"),
    async (name) => files.get(name) ?? null,
  );
  expect(summary).not.toBeNull();
  expect(summary?.task).toBe("Fixing it");
});

test("readLocalSidecarSummary falls back to a cwd sidecar and rejects stale files", async () => {
  const cwd = "/repo/project";
  const files = new Map<string, string>([
    [
      cwdSidecarFileName(cwd),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "cwd keyed",
        todos: [{ id: "1", content: "Cwd task", status: "in_progress", activeForm: "Doing cwd task" }],
      }),
    ],
  ]);
  const fromCwd = await readLocalSidecarSummary(
    { provider: "shell", cwd, paneId: "terminal-without-sidecar" },
    fallbackFor(cwd),
    async (name) => files.get(name) ?? null,
  );
  expect(fromCwd?.task).toBe("Doing cwd task");

  const stale = new Map<string, string>([
    [
      cwdSidecarFileName(cwd),
      JSON.stringify({ updatedAt: Date.now() - 60 * 60 * 1000, todos: [] }),
    ],
  ]);
  const rejected = await readLocalSidecarSummary(
    { provider: "shell", cwd },
    fallbackFor(cwd),
    async (name) => stale.get(name) ?? null,
  );
  expect(rejected).toBeNull();
});

test("the sidecar lookup distinguishes expiry from a missing or unreadable file", async () => {
  const cwd = "/repo/project";
  const staleName = cwdSidecarFileName(cwd);
  const stale = await readLocalSidecarStatus(
    { provider: "shell", cwd },
    fallbackFor(cwd),
    async (name) => name === staleName
      ? JSON.stringify({ updatedAt: Date.now() - 60 * 60 * 1000, todos: [] })
      : null,
  );
  const missing = await readLocalSidecarStatus(
    { provider: "shell", cwd },
    fallbackFor(cwd),
    async () => null,
  );
  const unreadable = await readLocalSidecarStatus(
    { provider: "shell", cwd },
    fallbackFor(cwd),
    async () => { throw new Error("temporary read failure"); },
  );

  expect(stale.state).toBe("stale");
  expect(missing.state).toBe("missing");
  expect(unreadable.state).toBe("error");
});

test("readLocalSidecarSummary prefers concrete cwd task over generic pane task", async () => {
  const cwd = "/repo/project";
  const paneId = "terminal-generic-pane";
  const files = new Map<string, string>([
    [
      paneSidecarFileName(paneId),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Answering latest prompt",
        todos: [{ id: "1", content: "Answering latest prompt", status: "in_progress" }],
      }),
    ],
    [
      cwdSidecarFileName(cwd),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Checking map order",
        todos: [{ id: "2", content: "Fix sidebar order", status: "in_progress", activeForm: "Fixing the sidebar map order rule" }],
      }),
    ],
  ]);

  const summary = await readLocalSidecarSummary(
    { provider: "shell", cwd, paneId },
    fallbackFor(cwd),
    async (name) => files.get(name) ?? null,
  );

  expect(summary?.task).toBe("Fixing the sidebar map order rule");
});

test("readLocalSidecarSummary does not invent a task from a vague prompt and narration", async () => {
  const cwd = "/repo/bot";
  const paneId = "terminal-bot";
  const files = new Map<string, string>([
    [
      paneSidecarFileName(paneId),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Answering user question",
        userTask: "should we add that?",
        narration: "A safe version is: stricter, removal allowed; review-first for borderline cases",
        recent: [{ text: "The bot records join events, then checks each group message" }],
        todos: [{ id: "1", content: "Answering user question", status: "in_progress" }],
      }),
    ],
  ]);

  const summary = await readLocalSidecarSummary(
    { provider: "shell", cwd, paneId },
    fallbackFor(cwd),
    async (name) => files.get(name) ?? null,
  );

  expect(summary?.task).toBe(fallbackFor(cwd).task);
  expect(summary?.task).not.toContain("spam moderation");
  expect(summary?.tasksFromTodoWrite).toBe(false);
});

test("browser and node sidecar readers share placeholder, provider, and turn semantics", () => {
  const fallback = fallbackFor("/repo/project");
  const sidecar = {
    provider: "codex" as const,
    updatedAt: Date.now(),
    turn: "idle" as const,
    now: "Waiting for the next prompt",
    todos: [
      { id: "placeholder", content: "Answering latest prompt", status: "in_progress" },
      { id: "real", content: "Check map ordering", activeForm: "Checking map ordering", status: "pending" },
    ],
  };

  const browserSummary = summaryFromSidecar(sidecar, fallback);
  const nodeSummary = summaryFromNodeSidecar(sidecar, { heuristicCandidate: fallback });

  for (const summary of [browserSummary, nodeSummary]) {
    expect(summary.task).toBe("Checking map ordering");
    expect(summary.provider).toBe("codex");
    expect(summary.status).toBe("idle");
    expect(summary.tasksFromTodoWrite).toBe(true);
    expect(summary.tasks.map((task: { text: string }) => task.text)).toEqual(["Check map ordering"]);
  }
});

test("placeholder-only sidecars preserve lifecycle without promoting the placeholder to a task", () => {
  const fallback = fallbackFor("/repo/project");
  const sidecar = {
    provider: "claude" as const,
    updatedAt: Date.now(),
    turn: "working" as const,
    now: "Answering user question",
    todos: [{ id: "placeholder", content: "Answering user question", status: "in_progress" }],
  };

  const browserSummary = summaryFromSidecar(sidecar, fallback);
  const nodeSummary = summaryFromNodeSidecar(sidecar, { heuristicCandidate: fallback });

  for (const summary of [browserSummary, nodeSummary]) {
    expect(summary.task).toBe(fallback.task);
    expect(summary.provider).toBe("claude");
    expect(summary.status).toBe("working");
    expect(summary.tasks).toEqual([]);
    expect(summary.tasksFromTodoWrite).toBe(false);
  }
});

test("summarizeAgentStatus uses an available local sidecar before any endpoint", async () => {
  const paneId = "terminal-abc-def";
  const files = new Map<string, string>([
    [
      paneSidecarFileName(paneId),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Reading local file",
        todos: [{ id: "1", content: "Fix it", status: "in_progress", activeForm: "Fixing it" }],
      }),
    ],
  ]);
  const result = await summarizeAgentStatus(
    { provider: "shell", cwd: "/repo/x", paneId },
    {
      endpoint: "",
      sidecarReader: async (name) => files.get(name) ?? null,
    },
  );
  expect(result.source).toBe("sidecar");
  expect(result.summary.task).toBe("Fixing it");
  expect(result.summary.tasksFromTodoWrite).toBe(true);
});

test("summarizeAgentStatus keeps sidecar tasks authoritative over endpoint rewrites", async () => {
  const paneId = "terminal-authoritative-sidecar";
  const files = new Map<string, string>([
    [
      paneSidecarFileName(paneId),
      JSON.stringify({
        updatedAt: Date.now(),
        now: "Verifying the running cockpit",
        userTask: "go",
        todos: [
          { content: "Verifying the running cockpit", status: "in_progress", activeForm: "Verifying the running cockpit" },
        ],
      }),
    ],
  ]);

  const result = await summarizeAgentStatus(
    { provider: "shell", cwd: "/repo/x", paneId },
    {
      endpoint: "http://status.test/status",
      sidecarReader: async (name) => files.get(name) ?? null,
      fetcher: async () =>
        new Response(JSON.stringify({
          task: "Verify TermFleet the running cockpit",
          userTask: "go",
          path: "/repo/x",
          now: "Verify TermFleet the running cockpit",
          status: "working",
          provider: "shell",
          confidence: "high",
          tasksFromTodoWrite: true,
          tasks: [{ text: "in-progress: Verify TermFleet the running cockpit" }],
        }), { status: 200 }),
    },
  );

  expect(result.source).toBe("process");
  expect(result.summary.task).toBe("Verifying the running cockpit");
  expect(result.summary.now).toBe("Verifying the running cockpit");
  expect(result.summary.tasks.map((task) => task.text)).toContain("in-progress: Verifying the running cockpit");
});

test("summarizeAgentStatus falls back when no local sidecar exists and no endpoint is set", async () => {
  const result = await summarizeAgentStatus(
    { provider: "shell", cwd: "/repo/x", paneId: "terminal-nope" },
    {
      endpoint: "",
      sidecarReader: async () => null,
    },
  );
  expect(result.source).toBe("fallback");
  expect(result.sidecarState).toBe("missing");
});

test("summarizeAgentStatus reports an expired sidecar without trusting its old task", async () => {
  const result = await summarizeAgentStatus(
    { provider: "shell", cwd: "/repo/x", paneId: "terminal-stale" },
    {
      endpoint: "",
      sidecarReader: async (name) => name === paneSidecarFileName("terminal-stale")
        ? JSON.stringify({
            updatedAt: Date.now() - 60 * 60 * 1000,
            todos: [{ content: "Old task", status: "in_progress" }],
          })
        : null,
    },
  );

  expect(result.source).toBe("fallback");
  expect(result.sidecarState).toBe("stale");
  expect(result.summary.task).not.toBe("Old task");
});

test("summarizeAgentStatus does not infer the localhost worker endpoint in desktop dev", async () => {
  const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globalWithWindow.window;
  let fetchCount = 0;
  globalWithWindow.window = { location: { port: "1420" } };
  try {
    const result = await summarizeAgentStatus(
      { provider: "shell", cwd: "/repo/x", paneId: "terminal-no-implicit-http", currentActivity: "Reading sidecar" },
      {
        sidecarReader: async () => null,
        fetcher: async () => {
          fetchCount += 1;
          return new Response("{}", { status: 200 });
        },
      },
    );
    expect(result.source).toBe("fallback");
    expect(fetchCount).toBe(0);
  } finally {
    if (previousWindow === undefined) {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = previousWindow;
    }
  }
});
