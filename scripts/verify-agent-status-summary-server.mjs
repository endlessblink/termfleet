#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const serverPath = join(root, "scripts", "agent-status-summary-server.mjs");

function waitForEndpoint(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not print endpoint")), 5000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const match = text.match(/TERMFLEET_AGENT_STATUS_SUMMARY_ENDPOINT=(\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`server exited early with ${code}`));
      }
    });
  });
}

async function withServer(env, callback) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const endpoint = await waitForEndpoint(child);
    await callback(endpoint);
  } finally {
    child.kill("SIGTERM");
  }
}

async function postStatus(endpoint, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

const payload = {
  type: "agent-workstream-status",
  projectId: "/workspace/termfleet",
  transcript: "/clear\nhi\nRunning Playwright regression",
  workstream: {
    mission: "Add local status summary process",
    provider: "codex",
    status: "running",
    phase: "active",
    path: "src/components/Terminal.tsx",
    currentActivity: "codex: command is not available in browser preview. Use the Tauri app for real shell commands.",
    nextAction: "Wire the endpoint into the app",
    events: [
      { kind: "sent", label: "Prompt sent", detail: "Add local status summary process" },
    ],
  },
};

await withServer({ TERMFLEET_AGENT_STATUS_PORT: "37981" }, async (endpoint) => {
  const summary = await postStatus(endpoint, payload);
  assert.equal(summary.task, "Add local status summary process");
  assert.equal(summary.path, "src/components/Terminal.tsx");
  assert.equal(summary.now, "Wire the endpoint into the app");
  assert.equal(summary.status, "working");
  assert.equal(summary.provider, "codex");
});

const tmp = await mkdtemp(join(tmpdir(), "termfleet-status-summary-"));
const fakeCommand = join(tmp, "fake-llm.mjs");
await writeFile(fakeCommand, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (payload.workstream.mission !== "Add local status summary process") process.exit(2);
  process.stdout.write(JSON.stringify({
    task: "Summarize with configured local command",
    path: "scripts/agent-status-summary-server.mjs",
    now: "Returning strict JSON from the fake model command",
    status: "working",
    provider: "codex",
    confidence: "high"
  }));
});
`, { mode: 0o755 });

await withServer({
  TERMFLEET_AGENT_STATUS_PORT: "37982",
  TERMFLEET_AGENT_STATUS_COMMAND: process.execPath,
  TERMFLEET_AGENT_STATUS_ARGS: JSON.stringify([fakeCommand]),
}, async (endpoint) => {
  const summary = await postStatus(endpoint, payload);
  assert.equal(summary.task, "Summarize with configured local command");
  assert.equal(summary.path, "scripts/agent-status-summary-server.mjs");
  assert.equal(summary.now, "Returning strict JSON from the fake model command");
  assert.equal(summary.confidence, "high");
});

process.stdout.write("TERMFLEET_AGENT_STATUS_SUMMARY_SERVER_OK\n");
