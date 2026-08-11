#!/usr/bin/env node
// Isolated daemon stress gate.
// Starts a temporary daemon with private runtime/data roots, drives the real
// Unix-socket JSON protocol, and leaves a compact evidence bundle on failure.
import { mkdtempSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const valueFor = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? Number(match.slice(prefix.length)) : fallback;
};
const sessions = valueFor("sessions", Number(process.env.TERMFLEET_STRESS_SESSIONS || 100));
const waves = valueFor("waves", Number(process.env.TERMFLEET_STRESS_WAVES || 4));
const timeoutMs = valueFor("timeout-ms", 12_000);
const keep = args.has("--keep") || process.env.TERMFLEET_STRESS_KEEP === "1";
const binary = process.env.TERMFLEET_STRESS_BINARY || path.join(ROOT, "src-tauri", "target", "debug", "terminal-workspace");

if (!Number.isInteger(sessions) || sessions < 1 || sessions > 500) throw new Error("--sessions must be between 1 and 500");
if (!Number.isInteger(waves) || waves < 1 || waves > sessions) throw new Error("--waves must be between 1 and sessions");

// Unix sockets have a small platform limit; keep the temporary root short even
// when the repository itself lives under a long mounted path.
const stressRoot = process.env.TERMFLEET_STRESS_ROOT || os.tmpdir();
const runRoot = mkdtempSync(path.join(stressRoot, "tf-stress-"));
const runtime = path.join(runRoot, "runtime");
const data = path.join(runRoot, "data");
mkdirSync(runtime, { recursive: true });
mkdirSync(data, { recursive: true });
const socketPath = path.join(runtime, "terminal-workspace", "daemon.sock");
const logPath = path.join(runRoot, "daemon.log");
const evidencePath = path.join(runRoot, "evidence.json");
const log = [];
const startedAt = Date.now();
let daemon;
let failed = false;

function note(event, details = {}) {
  log.push({ at: new Date().toISOString(), event, ...details });
}

function request(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`daemon request timed out: ${payload.type}`));
    }, timeoutMs);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.on("connect", () => socket.end(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        try {
          const response = JSON.parse(buffer.slice(0, newline));
          finish(null, response);
        } catch (error) {
          finish(error);
        }
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (buffer.trim()) {
        try { finish(null, JSON.parse(buffer)); } catch (error) { finish(error); }
      }
    });
  });
}

async function waitForSocket() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request({ type: "status" });
      if (response?.type === "status") return response;
    } catch { /* daemon is still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("isolated daemon did not become ready");
}

async function ensure(id, command) {
  const response = await request({
    type: "ensureSession", id, cwd: runRoot, command, cols: 120, rows: 32,
  });
  if (response?.type !== "ensureSession" || response.id !== id) throw new Error(`ensure failed for ${id}: ${JSON.stringify(response)}`);
  return response;
}

async function runSession(index) {
  const id = `stress-${process.pid}-${index}`;
  const marker = `TERMFLEET_STRESS_${index}`;
  const command = `printf '${marker}\\n'`;
  await ensure(id, command);
  await request({ type: "writeSession", id, data: "\n" });
  await request({ type: "resizeSession", id, cols: 100 + (index % 40), rows: 24 + (index % 12) });
  const deadline = Date.now() + timeoutMs;
  let snapshot = "";
  while (Date.now() < deadline) {
    const response = await request({ type: "snapshotSession", id });
    snapshot = response?.data || "";
    if (snapshot.includes(marker)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!snapshot.includes(marker)) throw new Error(`marker missing for ${id}`);
  await request({ type: "killSession", id });
  return { id, marker, snapshotBytes: Buffer.byteLength(snapshot) };
}

async function main() {
  note("start", { binary, sessions, waves, socketPath });
  const output = openSync(logPath, "w");
  daemon = spawn(binary, ["--terminal-workspace-daemon"], {
    cwd: ROOT,
    env: { ...process.env, XDG_RUNTIME_DIR: runtime, XDG_DATA_HOME: data },
    stdio: ["ignore", output, output],
  });
  daemon.on("exit", (code, signal) => note("daemon-exit", { code, signal }));
  const status = await waitForSocket();
  note("ready", { status });
  const results = [];
  for (let offset = 0; offset < sessions; offset += waves) {
    const batch = Array.from({ length: Math.min(waves, sessions - offset) }, (_, i) => runSession(offset + i));
    results.push(...await Promise.all(batch));
    note("wave-complete", { completed: results.length });
  }
  const remaining = await request({ type: "listSessions" });
  const live = remaining?.sessions || [];
  const summary = {
    ok: live.length === 0,
    sessions,
    waves,
    completed: results.length,
    remainingSessions: live.length,
    elapsedMs: Date.now() - startedAt,
    status,
    log,
  };
  writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`);
  if (live.length !== 0) throw new Error(`session cleanup left ${live.length} live session(s)`);
  console.log(`ISOLATED_STRESS_OK sessions=${results.length} waves=${waves} elapsed_ms=${summary.elapsedMs}`);
  console.log(`evidence=${evidencePath}`);
}

try {
  await main();
} catch (error) {
  failed = true;
  note("failure", { message: error instanceof Error ? error.message : String(error) });
  writeFileSync(evidencePath, `${JSON.stringify({ ok: false, sessions, waves, elapsedMs: Date.now() - startedAt, log }, null, 2)}\n`);
  console.error(`ISOLATED_STRESS_FAILED evidence=${evidencePath}`);
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (daemon && !daemon.killed) daemon.kill("SIGTERM");
  if (!keep && !failed) setTimeout(() => rmSync(runRoot, { recursive: true, force: true }), 100);
  else console.log(`kept=${runRoot}`);
}
