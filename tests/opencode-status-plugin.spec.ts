import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyEvent,
  createStatusWriter,
  mainTaskFromSessionTitle,
  normalizeTodoStatus,
  opencodeActivityFromTool,
  shouldClaimPane,
  todosFromEvent,
} from "../scripts/termfleet-opencode-status-plugin.js";
import { paneSidecarPath } from "../scripts/lib/agent-status-paths.mjs";

function writerInTemp() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-status-"));
  return createStatusWriter({
    paneId: "terminal-tab-1-pane-1",
    filePath: join(dir, "pane.json"),
    cwd: "/repo",
  });
}

function read(writer: ReturnType<typeof createStatusWriter>) {
  return JSON.parse(readFileSync(writer.filePath, "utf8"));
}

// The plugin computes sidecar paths itself (it must stay dependency-free so OpenCode
// can load it standalone), so the scheme has to match the shared helper exactly or
// the app reads a different file than the plugin writes.
test("pane sidecar paths match the shared path helper", () => {
  const writer = createStatusWriter({ paneId: "terminal-tab-9-pane-3" });
  expect(writer.filePath).toBe(paneSidecarPath("terminal-tab-9-pane-3"));
});

test("a todo list becomes the pane's task list and current task", () => {
  const writer = writerInTemp();
  applyEvent(writer, {
    type: "todo.updated",
    properties: {
      sessionID: "ses_abc",
      todos: [
        { id: "1", content: "Read the failing test", status: "completed" },
        { id: "2", content: "Fix the redirect loop", status: "in_progress" },
        { id: "3", content: "Run the suite", status: "pending" },
      ],
    },
  });
  writer.write(1000);

  const sidecar = read(writer);
  expect(sidecar.provider).toBe("opencode");
  expect(sidecar.sessionId).toBe("ses_abc");
  expect(sidecar.todos.map((todo: { status: string }) => todo.status)).toEqual([
    "completed",
    "in_progress",
    "pending",
  ]);
  // The in-progress item is what the cockpit's activity line shows.
  expect(sidecar.now).toBe("Fix the redirect loop");
});

test("session status and permission events drive the Running/Waiting/Idle badge", () => {
  const writer = writerInTemp();

  applyEvent(writer, {
    type: "session.status",
    properties: { status: { type: "busy" } },
  });
  expect(writer.state.turn).toBe("working");

  applyEvent(writer, {
    type: "permission.updated",
    properties: { title: "Allow editing src/main.ts?" },
  });
  expect(writer.state.turn).toBe("waiting");
  expect(writer.state.now).toBe("Allow editing src/main.ts?");

  applyEvent(writer, { type: "session.idle", properties: {} });
  expect(writer.state.turn).toBe("idle");
});

test("the session title becomes the plain-language main task, placeholders do not", () => {
  const writer = writerInTemp();
  applyEvent(writer, {
    type: "session.updated",
    properties: { info: { id: "ses_1", title: "Fix the login redirect loop" } },
  });
  writer.write(1000);
  expect(read(writer).mainTask).toBe("Fix the login redirect loop");
  expect(read(writer).mainTaskSource).toBe("goal-task");

  expect(mainTaskFromSessionTitle("New session")).toBe("");
  expect(mainTaskFromSessionTitle("x".repeat(120))).toBe("");
});

test("tool activity reads as plain language, and noise tools stay silent", () => {
  expect(
    opencodeActivityFromTool("bash", { command: "npm test -- --watch=false" }),
  ).toBe("Running: npm test -- --watch=false");
  expect(
    opencodeActivityFromTool("bash", { command: "cd /repo && cargo check" }),
  ).toBe("Running: cargo check");
  expect(opencodeActivityFromTool("bash", { command: "ls -la" })).toBe("");
  expect(
    opencodeActivityFromTool("edit", { filePath: "/repo/src/main.ts" }),
  ).toBe("Editing main.ts");
  expect(
    opencodeActivityFromTool("read", { filePath: "/repo/README.md" }),
  ).toBe("Reading README.md");
  // The todo tools already show up as the task list; narrating them twice is noise.
  expect(opencodeActivityFromTool("todowrite", {})).toBe("");
});

test("OpenCode's cancelled todos are not left looking open", () => {
  expect(normalizeTodoStatus("cancelled")).toBe("completed");
  expect(normalizeTodoStatus("in_progress")).toBe("in_progress");
  expect(normalizeTodoStatus("nonsense")).toBe("pending");
  expect(todosFromEvent([{ content: "  ", status: "pending" }])).toEqual([]);
});

// OpenCode instantiates a plugin more than once per process. The later instance must
// not wipe the task list the live one is reporting — but a leftover record from a
// session that already ended must not be inherited either.
test("a startup claim never clobbers a live sibling, but does replace a stale record", () => {
  const now = 10_000_000;
  expect(shouldClaimPane(null, now)).toBe(true);
  expect(
    shouldClaimPane({ provider: "opencode", updatedAt: now - 5_000 }, now),
  ).toBe(false);
  expect(
    shouldClaimPane(
      { provider: "opencode", updatedAt: now - 10 * 60 * 1000 },
      now,
    ),
  ).toBe(true);
  // Another agent's leftover record is always replaced.
  expect(
    shouldClaimPane({ provider: "claude", updatedAt: now - 5_000 }, now),
  ).toBe(true);
});

test("a write with no todos keeps the task list a previous event captured", () => {
  const writer = writerInTemp();
  writeFileSync(
    writer.filePath,
    JSON.stringify({
      provider: "opencode",
      updatedAt: 500,
      todos: [{ content: "Fix the redirect loop", status: "in_progress" }],
    }),
  );
  writer.state.now = "Running: npm test";
  writer.write(1000);
  expect(read(writer).todos).toHaveLength(1);

  // ...unless it is the fresh startup claim, which deliberately starts clean.
  writer.write(2000, { fresh: true });
  expect(read(writer).todos).toEqual([]);
});
