#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const socketPath =
  process.env.TERMINAL_WORKSPACE_DAEMON_SOCKET ??
  path.join(process.env.XDG_RUNTIME_DIR ?? os.tmpdir(), "terminal-workspace", "daemon.sock");
const sessionId = `latency-${process.pid}-${Date.now()}`;
const text = `lat_${Math.floor(Math.random() * 1_000)}_abcdefghi`;
const p95LimitMs = Number(process.env.TERMINAL_WORKSPACE_DAEMON_P95_LIMIT_MS ?? 80);
const maxLimitMs = Number(process.env.TERMINAL_WORKSPACE_DAEMON_MAX_LIMIT_MS ?? 250);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function fmt(value) {
  return value.toFixed(1);
}

function normalizeTerminalText(value) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r/g, "");
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function request(payload) {
  const socket = await connectSocket();
  return new Promise((resolve, reject) => {
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("error", reject);
    socket.once("end", () => {
      try {
        resolve(JSON.parse(response.trim()));
      } catch (error) {
        reject(new Error(`Could not parse daemon response ${JSON.stringify(response)}: ${error}`));
      }
    });
    socket.end(JSON.stringify(payload));
  });
}

async function openInputStream(id) {
  const socket = await connectSocket();
  socket.write(`${JSON.stringify({ type: "inputStream", id })}\n`);
  return socket;
}

async function openSubscription(id) {
  const socket = await connectSocket();
  socket.setEncoding("utf8");
  socket.write(JSON.stringify({ type: "subscribeSession", id, subscriber_id: `latency-sub-${process.pid}` }));
  return socket;
}

function waitForEcho(received, expected, startMs, timeoutMs = 1_500) {
  return new Promise((resolve, reject) => {
    const deadline = startMs + timeoutMs;
    const check = () => {
      if (normalizeTerminalText(received.text).includes(expected)) {
        resolve(performance.now() - startMs);
        return;
      }
      if (performance.now() > deadline) {
        reject(new Error(`Timed out waiting for echo ${JSON.stringify(expected)} in ${JSON.stringify(received.text.slice(-200))}`));
        return;
      }
      setTimeout(check, 1);
    };
    check();
  });
}

function attachSubscriptionReader(socket, received) {
  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline === -1) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "sessionData" || event.type === "snapshotSession") {
          received.text += event.data ?? "";
        }
      } catch {
        // Ignore malformed debug noise; the benchmark fails if expected data is absent.
      }
    }
  });
}

async function main() {
  if (!fs.existsSync(socketPath)) {
    throw new Error(`Missing terminal workspace daemon socket: ${socketPath}`);
  }

  const status = await request({ type: "status" });
  if (status.mode !== "externalDaemon") {
    throw new Error(`Expected external daemon, got ${JSON.stringify(status)}`);
  }

  await request({
    type: "ensureSession",
    id: sessionId,
    cwd: os.tmpdir(),
    command: null,
  });

  const received = { text: "" };
  const subscription = await openSubscription(sessionId);
  attachSubscriptionReader(subscription, received);
  const input = await openInputStream(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  input.write("\u0015");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const latencies = [];
  let expected = "";
  for (const char of text) {
    const startMs = performance.now();
    input.write(char);
    expected += char;
    latencies.push(await waitForEcho(received, expected, startMs));
  }

  const newlineStartMs = performance.now();
  input.write("\r");
  await waitForEcho(received, `${expected}\r\n`, newlineStartMs).catch(() =>
    waitForEcho(received, `${expected}\n`, newlineStartMs)
  );

  input.end();
  subscription.destroy();
  await request({ type: "killSession", id: sessionId }).catch(() => null);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const max = Math.max(...latencies);

  console.log(`Daemon socket: ${socketPath}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Chars: ${latencies.length}`);
  console.log(`p50_ms=${fmt(p50)}`);
  console.log(`p95_ms=${fmt(p95)}`);
  console.log(`p99_ms=${fmt(p99)}`);
  console.log(`max_ms=${fmt(max)}`);

  if (p95 > p95LimitMs || max > maxLimitMs) {
    throw new Error(
      `Daemon latency threshold failed: p95=${fmt(p95)}ms limit=${p95LimitMs}ms, max=${fmt(max)}ms limit=${maxLimitMs}ms`
    );
  }
}

main().catch(async (error) => {
  await request({ type: "killSession", id: sessionId }).catch(() => null);
  console.error(error.message);
  process.exit(1);
});
