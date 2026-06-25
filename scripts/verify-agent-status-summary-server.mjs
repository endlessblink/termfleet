#!/usr/bin/env node
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const serverPath = join(root, "scripts", "agent-status-summary-server.mjs");
const ollamaAdapterPath = join(root, "scripts", "agent-status-summary-ollama.mjs");
const packagePath = join(root, "package.json");
const tauriDevWrapperPath = join(root, "scripts", "tauri-dev-with-status.sh");
const runDevPath = join(root, "run-dev.sh");
const runNativeDevPath = join(root, "run-native-vte-dev.sh");
const splitPanePath = join(root, "src", "components", "SplitPane.tsx");
const cockpitSnapshotPath = join(root, "src", "lib", "cockpitSnapshot.ts");

const [packageJson, tauriDevWrapper, ollamaAdapterSource, runDev, runNativeDev, splitPaneSource, cockpitSnapshotSource] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(tauriDevWrapperPath, "utf8"),
  readFile(ollamaAdapterPath, "utf8"),
  readFile(runDevPath, "utf8"),
  readFile(runNativeDevPath, "utf8"),
  readFile(splitPanePath, "utf8"),
  readFile(cockpitSnapshotPath, "utf8"),
]);

assert.match(packageJson, /"tauri:dev": "scripts\/tauri-dev-with-status\.sh"/);
assert.match(tauriDevWrapper, /STATUS_WORKER="\$\{TERMFLEET_AGENT_STATUS_WORKER:-node scripts\/agent-status-summary-sidecar\.mjs\}"/);
assert.match(tauriDevWrapper, /agent-status-summary-server\.mjs \$\{STATUS_WORKER\}/);
assert.match(tauriDevWrapper, /VITE_AGENT_STATUS_SUMMARY_ENDPOINT/);
assert.match(tauriDevWrapper, /TERMFLEET_AGENT_STATUS_DISABLE/);
assert.match(tauriDevWrapper, /TERMFLEET_AGENT_STATUS_MODEL:-qwen3:4b/);
assert.match(ollamaAdapterSource, /TERMFLEET_AGENT_STATUS_MODEL \|\| "qwen3:4b"/);
assert.match(runDev, /npm run tauri:dev/);
assert.match(runNativeDev, /npm run tauri:dev/);
assert.match(tauriDevWrapper, /kill_app_vite\(\)/);
assert.match(tauriDevWrapper, /index\(\$0, root_dir "\/node_modules\/\.bin\/vite"\)/);
assert.match(tauriDevWrapper, /index\(\$0, "--port 1420"\)/);
assert.doesNotMatch(tauriDevWrapper, /kill_if_running "\$ROOT_DIR\/node_modules\/\.bin\/vite --host 127\.0\.0\.1 --port 1420"/);
for (const launcherSource of [runDev, runNativeDev]) {
  assert.match(launcherSource, /kill_app_vite\(\)/);
  assert.match(launcherSource, /index\(\$0, app_dir "\/node_modules\/\.bin\/vite"\)/);
  assert.match(launcherSource, /index\(\$0, "--port 1420"\)/);
  assert.doesNotMatch(launcherSource, /kill_if_running "\$APP_DIR\/node_modules\/\.bin\/vite --host 127\.0\.0\.1 --port 1420"/);
}
assert.match(splitPaneSource, /<CockpitSnapshotProbe/);
assert.match(splitPaneSource, /title: headerTitle/);
assert.match(splitPaneSource, /now: headerNow/);
assert.match(splitPaneSource, /taskLineup: visibleTaskLineup\.map/);
assert.match(cockpitSnapshotSource, /VITE_COCKPIT_SNAPSHOT/);
assert.match(cockpitSnapshotSource, /\/cockpit-snapshot/);

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

async function withServerArgs(env, args, callback) {
  const child = spawn(process.execPath, [serverPath, ...args], {
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

async function postCockpitSnapshot(endpoint, body) {
  const snapshotEndpoint = endpoint.replace(/\/status\/?$/, "") + "/cockpit-snapshot";
  const response = await fetch(snapshotEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function withFakeOllama(callback, responseSummary = {
  task: "Summarize terminal",
  path: "src/components",
  now: "Parsed by fake Gemma adapter",
  status: "working",
  provider: "shell",
  confidence: "high",
}) {
  return new Promise((resolve, reject) => {
    let capturedPayload = null;
    const server = http.createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/api/generate") {
        response.writeHead(404).end();
        return;
      }
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        capturedPayload = JSON.parse(raw);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          response: typeof responseSummary === "string" ? responseSummary : JSON.stringify(responseSummary),
        }));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      try {
        if (!address || typeof address === "string") throw new Error("fake ollama port unavailable");
        await callback(`http://127.0.0.1:${address.port}`, () => capturedPayload);
        server.close(() => resolve());
      } catch (error) {
        server.close(() => reject(error));
      }
    });
  });
}

function runOllamaAdapter(body, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ollamaAdapterPath], {
      env: {
        ...process.env,
        TERMFLEET_OLLAMA_URL: "http://127.0.0.1:9",
        TERMFLEET_AGENT_STATUS_MODEL: "gemma4:e2b-it",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ollama adapter exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify(body));
  });
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

{
  const dataHome = await mkdtemp(join(tmpdir(), "termfleet-cockpit-snapshot-"));
  await withServer({
    XDG_DATA_HOME: dataHome,
    TERMFLEET_AGENT_STATUS_PORT: "37986",
  }, async (endpoint) => {
    const body = {
      updatedAt: 1710000000000,
      terminals: [
        {
          paneId: "terminal-tab-a-pane-b",
          tabId: "tab-a",
          cwd: "/workspace/termfleet",
          kind: "shell",
          title: "Running map projection checks",
          now: "Keeping alternate-screen agent panes readable",
          status: "running",
          tasksFromTodoWrite: true,
          taskLineup: [{ content: "Checking selected map terminal", status: "in_progress" }],
          updatedAt: 1710000000001,
        },
      ],
    };

    const result = await postCockpitSnapshot(endpoint, body);
    assert.equal(result.ok, true);
    const snapshotFile = join(dataHome, "terminal-workspace", "agent-status", "cockpit-snapshot.json");
    await stat(snapshotFile);
    assert.deepEqual(JSON.parse(await readFile(snapshotFile, "utf8")), body);
  });
}

await withServer({ TERMFLEET_AGENT_STATUS_PORT: "37983" }, async (endpoint) => {
  const summary = await postStatus(endpoint, {
    type: "agent-workstream-status",
    projectId: "workspace root unknown",
    transcript: [
      "translate to hebrew",
      "What changed:",
      "- server-side quality gate now validates generated posts",
      "- repair pass runs automatically when first draft fails",
      "Verified:",
      "- quality-gate tests: 4/4 passed",
      "› Use /skills to list available skills",
      "gpt-5.5 default · ~",
    ].join("\n"),
    workstream: {
      mission: "Terminal",
      provider: "shell",
      status: "running",
      path: "workspace root unknown",
      currentActivity: "« | gpt-5.5 default · -",
    },
  });
  assert.equal(summary.task, "translate to hebrew");
  assert.equal(summary.path, "workspace root unknown");
  assert.equal(summary.now, "server-side quality gate now validates generated posts");
  assert.equal(summary.provider, "shell");
});

await withServer({ TERMFLEET_AGENT_STATUS_PORT: "37985" }, async (endpoint) => {
  const summary = await postStatus(endpoint, {
    type: "agent-workstream-status",
    projectId: "termfleet",
    transcript: [
      "gpt-5.5 default",
      "Use /skills to list available skills",
      "Reviewing approval request",
      "apply_patch touching src/lib/terminalMouse.ts",
      "Working (32s • esc to interrupt)",
    ].join("\n"),
    workstream: {
      mission: "Terminal",
      provider: "shell",
      status: "running",
      path: "termfleet",
      currentActivity: "gpt-5.5 default",
    },
  });
  assert.equal(summary.task, "Reviewing approval request");
  assert.equal(summary.path, "termfleet");
  assert.equal(summary.now, "apply_patch touching src/lib/terminalMouse.ts");
  assert.equal(summary.provider, "shell");
});

const tmp = await mkdtemp(join(tmpdir(), "termfleet-status-summary-"));
const fakeCommand = join(tmp, "fake-llm.mjs");
await writeFile(fakeCommand, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (payload.workstream.mission !== "Add local status summary process") process.exit(2);
  if (payload.heuristicCandidate?.now !== "Wire the endpoint into the app") process.exit(3);
  process.stdout.write(JSON.stringify({
    task: "Summarize with configured local command",
    path: "scripts/agent-status-summary-server.mjs",
    now: "Returning strict JSON from the fake model command",
    status: "working",
    provider: "codex",
    confidence: "high",
    tasks: ["Summarize with configured local command"],
    blockers: [],
    evidence: ["fake model command returned strict JSON"],
    nextActions: ["Review configured local command output"]
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
  assert.equal(summary.tasks[0], "Summarize with configured local command");
  assert.equal(summary.evidence[0], "fake model command returned strict JSON");
  assert.equal(summary.nextActions[0], "Review configured local command output");
});

await withServerArgs({
  TERMFLEET_AGENT_STATUS_PORT: "37984",
}, [process.execPath, fakeCommand], async (endpoint) => {
  const summary = await postStatus(endpoint, payload);
  assert.equal(summary.task, "Summarize with configured local command");
  assert.equal(summary.path, "scripts/agent-status-summary-server.mjs");
  assert.equal(summary.now, "Returning strict JSON from the fake model command");
  assert.equal(summary.confidence, "high");
  assert.equal(summary.tasks[0], "Summarize with configured local command");
});

{
  const summary = await runOllamaAdapter({
    projectId: "termfleet",
    transcript: "gpt-5.5 default · ~\n› Use /skills to list available skills",
    heuristicCandidate: {
      task: "Shell ready",
      path: "termfleet",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
    },
  });
  assert.equal(summary.task, "Shell ready");
  assert.equal(summary.path, "termfleet");
  assert.equal(summary.now, "Awaiting command");
  assert.equal(summary.confidence, "low");
}

await withFakeOllama(async (endpoint, capturedPayload) => {
  const summary = await runOllamaAdapter({
    projectId: "termfleet",
    transcript: "Running tests\n10 passed",
    workstream: { provider: "shell" },
    heuristicCandidate: {
      task: "Running tests",
      path: "termfleet",
      now: "10 tests passed",
      status: "done",
      provider: "shell",
      confidence: "medium",
    },
  }, {
    TERMFLEET_OLLAMA_URL: endpoint,
    TERMFLEET_AGENT_STATUS_MODEL: "gemma4:e2b-it",
  });
  assert.equal(summary.task, "Summarize terminal");
  assert.equal(summary.path, "src/components");
  assert.equal(summary.now, "Parsed by fake Gemma adapter");
  assert.equal(summary.confidence, "high");

  const request = capturedPayload();
  assert.equal(request.model, "gemma4:e2b-it");
  assert.equal(request.stream, false);
  assert.equal(request.format, "json");
  assert.equal(request.options.temperature, 0);
  assert.equal(request.options.num_ctx, 2048);
  assert.equal(request.options.num_predict, 120);
  assert.match(request.prompt, /Use heuristicCandidate/);
  assert.match(request.prompt, /Never overclaim/);
});

await withFakeOllama(async (endpoint) => {
  const summary = await runOllamaAdapter({
    projectId: "termfleet",
    transcript: "Running tests\n10 passed",
    workstream: { provider: "shell" },
    heuristicCandidate: {
      task: "Running tests",
      path: "termfleet",
      now: "10 tests passed",
      status: "done",
      provider: "shell",
      confidence: "medium",
    },
  }, {
    TERMFLEET_OLLAMA_URL: endpoint,
    TERMFLEET_AGENT_STATUS_MODEL: "gemma4:e2b-it",
  });
  assert.equal(summary.task, "Running tests");
  assert.equal(summary.path, "termfleet");
  assert.equal(summary.now, "10 tests passed");
  assert.equal(summary.evidence[0].text, "10 tests passed");
}, {
  task: "gpt-5.5 default · -",
  path: "termfleet",
  now: "- 10 tests passed",
  status: "done",
  provider: "shell",
  confidence: "high",
  evidence: ["10 tests passed"],
});

await withFakeOllama(async (endpoint) => {
  const summary = await runOllamaAdapter({
    projectId: "termfleet",
    transcript: "cargo test\n10 passed",
    heuristicCandidate: {
      task: "Running tests",
      path: "termfleet",
      now: "10 tests passed",
      status: "done",
      provider: "shell",
      confidence: "medium",
    },
  }, {
    TERMFLEET_OLLAMA_URL: endpoint,
    TERMFLEET_AGENT_STATUS_MODEL: "gemma4:e2b-it",
  });
  assert.equal(summary.task, "Running tests");
  assert.equal(summary.now, "cargo test complete");
}, "```json\n{\"task\":\"Running tests\",\"path\":\"termfleet\",\"now\":\"cargo test complete\",\"status\":\"done\",\"provider\":\"shell\",\"confidence\":\"high\"}\n```");

process.stdout.write("TERMFLEET_AGENT_STATUS_SUMMARY_SERVER_OK\n");
