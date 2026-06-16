#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";

const host = process.env.TERMFLEET_AGENT_STATUS_HOST || "127.0.0.1";
const port = Number(process.env.TERMFLEET_AGENT_STATUS_PORT || 37819);
const command = process.env.TERMFLEET_AGENT_STATUS_COMMAND;
const commandArgs = (() => {
  const raw = process.env.TERMFLEET_AGENT_STATUS_ARGS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(/\s+/).filter(Boolean);
  }
})();

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function lifecycleFrom(workstream = {}) {
  if (workstream.status === "done" || workstream.phase === "complete" || workstream.phase === "reviewed") return "done";
  if (workstream.status === "failed" || workstream.phase === "blocked") return "blocked";
  if (workstream.status === "waiting" || workstream.phase === "needs-input") return "waiting";
  if (workstream.status === "stopped" || workstream.phase === "interrupted") return "stopped";
  if (workstream.status === "running" || workstream.phase === "active" || workstream.phase === "launching" || workstream.phase === "queued") return "working";
  return "idle";
}

function isNoisy(value) {
  const text = cleanText(value);
  if (!text) return true;
  return [
    /^\/clear$/i,
    /^hi[!.]?$/i,
    /^hello[!.]?$/i,
    /^web\$ /i,
    /^bash[$#]?\s*/i,
    /^codex: command is not available/i,
    /^claude: command is not available/i,
    /^opencode: command is not available/i,
    /command is not available in browser preview/i,
    /^provider (acknowledged cancellation|process exited)/i,
  ].some((pattern) => pattern.test(text));
}

function fallbackSummary(payload) {
  const workstream = payload?.workstream ?? {};
  const task = cleanText(workstream.mission) || cleanText(workstream.prompt) || "Supervised agent run";
  const path = cleanText(workstream.path) || cleanText(payload?.projectId) || "workspace path unknown";
  const status = lifecycleFrom(workstream);
  const now =
    (!isNoisy(workstream.currentActivity) && cleanText(workstream.currentActivity)) ||
    (!isNoisy(workstream.nextAction) && cleanText(workstream.nextAction)) ||
    (!isNoisy(workstream.lastSummary) && cleanText(workstream.lastSummary)) ||
    (status === "blocked" ? "Needs operator attention" :
      status === "done" ? "Ready for review" :
        status === "waiting" ? "Waiting for input" :
          status === "stopped" ? "Stopped by operator" :
            status === "idle" ? "Idle until the next prompt" :
              `Working on ${task}`);

  return {
    task,
    path,
    now,
    status,
    provider: workstream.provider || "codex",
    confidence: cleanText(workstream.currentActivity) && !isNoisy(workstream.currentActivity) ? "medium" : "low",
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function runCommand(payload) {
  return new Promise((resolve, reject) => {
    if (!command) {
      resolve(null);
      return;
    }

    const child = spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("status command timed out"));
    }, Number(process.env.TERMFLEET_AGENT_STATUS_TIMEOUT_MS || 8000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`status command exited ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }
  if (request.method !== "POST" || request.url !== "/status") {
    sendJson(response, 404, { error: "Use POST /status" });
    return;
  }

  try {
    const raw = await readRequestBody(request);
    const payload = raw ? JSON.parse(raw) : {};
    const commandOutput = await runCommand(payload);
    if (commandOutput) {
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(commandOutput.trim());
      return;
    }
    sendJson(response, 200, fallbackSummary(payload));
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
      ...fallbackSummary({}),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`TERMFLEET_AGENT_STATUS_SUMMARY_ENDPOINT=http://${host}:${port}/status\n`);
});
