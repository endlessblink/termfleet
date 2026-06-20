import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeAgentStatus } from "../src/lib/agentStatusSummarizer";
import { taskLineupFromExtractedItems, visibleTaskLineup } from "../src/lib/taskLineup";

// TC-033 — the WHOLE live chain, headless: the Claude TodoWrite hook writes a
// sidecar, the status server (spawning the sidecar worker) reads it, the REAL
// frontend summarizer fetches it over HTTP, and the REAL taskLineup functions turn
// it into the panel-visible list. This is the proof the per-unit specs can't give:
// it runs the actual production code paths end-to-end (only the React paint and the
// Tauri /proc live-cwd lookup are out of scope).

const ROOT = process.cwd();
const HOOK = path.join(ROOT, "scripts", "termfleet-claude-status-hook.mjs");
const WORKER = path.join(ROOT, "scripts", "agent-status-summary-sidecar.mjs");
const SERVER = path.join(ROOT, "scripts", "agent-status-summary-server.mjs");
const PORT = 38217; // fixed, away from the app's default 37819

function startServer(env: Record<string, string>) {
  const child = spawn("node", [SERVER, "node", WORKER], {
    env: { ...process.env, ...env, TERMFLEET_AGENT_STATUS_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const endpoint = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not announce an endpoint")), 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      const match = chunk.toString("utf8").match(/TERMFLEET_AGENT_STATUS_SUMMARY_ENDPOINT=(\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", reject);
  });
  return { child, endpoint };
}

test("hook → status server → real summarizer → real lineup yields the agent's todo-write list", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-e2e-"));
  const projectDir = "/tmp/tf-e2e-project";
  const env = { XDG_DATA_HOME: dataHome };

  // 1. Claude emits a TodoWrite → the hook writes the sidecar for this cwd.
  const hook = spawnSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      session_id: "e2e",
      cwd: projectDir,
      tool_input: {
        todos: [
          { content: "Wire the panel to the sidecar", status: "in_progress", activeForm: "Wiring the panel" },
          { content: "Add the regression test", status: "pending", activeForm: "Adding the test" },
          { content: "Read the worker contract", status: "completed", activeForm: "Reading the contract" },
        ],
      },
    }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  expect(hook.status).toBe(0);

  // 2. The status server (spawning the sidecar worker) is up.
  const { child, endpoint } = startServer(env);
  try {
    const url = await endpoint;

    // 3. The REAL frontend summarizer fetches it — exactly as a shell terminal pane
    //    does, sending the live cwd as `cwd` (RC-A: live cwd is the join key).
    const result = await summarizeAgentStatus(
      { mission: "demo", provider: "shell", status: "running", cwd: projectDir },
      { endpoint: url }
    );

    expect(result.source).toBe("process");
    expect(result.summary.tasksFromTodoWrite).toBe(true);
    expect(result.summary.now).toBe("Wiring the panel");
    expect(result.summary.tasks?.length).toBe(3);

    // 4. The REAL lineup path the shell consumer runs (RC-B: authoritative source).
    const source = result.summary.tasksFromTodoWrite ? "todo-write" : "operator";
    const lineup = taskLineupFromExtractedItems(result.summary.tasks, source, "pending");
    const visible = visibleTaskLineup(lineup, undefined);

    // The panel shows the agent's real todos, as the authoritative todo-write source.
    expect(visible.length).toBe(3);
    expect(visible.every((item) => item.source === "todo-write")).toBe(true);
    const byContent = (c: string) => visible.find((item) => item.content === c);
    expect(byContent("Wire the panel to the sidecar")?.status).toBe("in_progress");
    expect(byContent("Add the regression test")?.status).toBe("pending");
    expect(byContent("Read the worker contract")?.status).toBe("completed");
  } finally {
    child.kill("SIGTERM");
  }
});

test("no sidecar for the cwd → summarizer falls back and the panel stays empty (no junk)", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-e2e-"));
  const env = { XDG_DATA_HOME: dataHome };
  const { child, endpoint } = startServer(env);
  try {
    const url = await endpoint;
    const result = await summarizeAgentStatus(
      { mission: "demo", provider: "shell", status: "running", cwd: "/tmp/tf-e2e-absent" },
      { endpoint: url }
    );
    expect(result.summary.tasksFromTodoWrite).toBeFalsy();
    const source = result.summary.tasksFromTodoWrite ? "todo-write" : "operator";
    const lineup = taskLineupFromExtractedItems(result.summary.tasks ?? [], source, "pending");
    const visible = visibleTaskLineup(lineup, undefined);
    // No authoritative todo-write list is fabricated when no sidecar exists.
    expect(visible.every((item) => item.source !== "todo-write")).toBe(true);
  } finally {
    child.kill("SIGTERM");
  }
});
