import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  cwdSidecarFileName,
  paneSidecarFileName,
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
