#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { formatLatencySummary, summarizeTraceFiles } from "./summarize-terminal-latency-trace.mjs";

export const MAP_TERMINAL_LATENCY_BUDGETS = [
  ["canvas_keydown_to_input_send_start", 15],
  ["canvas_keydown_to_diff_receive", 100],
  ["canvas_diff_receive_to_render", 50],
  ["canvas_render_to_after_paint", 50],
  ["canvas_keydown_to_after_paint", 150],
];

export function verifyMapTerminalLatency(tracePaths) {
  if (tracePaths.length === 0 || tracePaths.some((file) => !fs.existsSync(file))) {
    return { ok: false, missing: true, failures: [], summary: null };
  }

  const summary = summarizeTraceFiles(tracePaths);
  const failures = [];
  for (const [bucket, p95Budget] of MAP_TERMINAL_LATENCY_BUDGETS) {
    const row = summary.rows.get(bucket);
    if (!row || row.count === 0 || !Number.isFinite(row.p95)) {
      failures.push(`${bucket}:missing`);
      continue;
    }
    if (row.p95 > p95Budget) {
      failures.push(`${bucket}:p95=${row.p95.toFixed(1)}ms>${p95Budget}ms`);
    }
  }
  return { ok: failures.length === 0, missing: false, failures, summary };
}

export function runMapTerminalLatencyCli(tracePaths, output = {}) {
  const writeStdout = output.stdout ?? ((value) => process.stdout.write(`${value}\n`));
  const writeStderr = output.stderr ?? ((value) => process.stderr.write(`${value}\n`));
  const result = verifyMapTerminalLatency(tracePaths);
  if (result.missing) {
    writeStderr("MAP_TERMINAL_LATENCY_TRACE_MISSING");
    writeStderr("Run a map terminal session with TERMINAL_WORKSPACE_TRACE_LATENCY=1, then pass the trace path to this verifier.");
    return 1;
  }

  writeStdout(formatLatencySummary(result.summary).trimEnd());
  if (!result.ok) {
    writeStderr(`MAP_TERMINAL_LATENCY_BUDGET_FAILED ${result.failures.join(" ")}`);
    return 1;
  }
  writeStdout("MAP_TERMINAL_LATENCY_OK");
  return 0;
}

function requestedTracePaths() {
  const tracePathArgs = process.argv.slice(2);
  const envTracePaths = process.env.TERMFLEET_LATENCY_TRACE
    ? process.env.TERMFLEET_LATENCY_TRACE.split(path.delimiter).filter(Boolean)
    : [];
  if (tracePathArgs.length > 0) return tracePathArgs;
  if (envTracePaths.length > 0) return envTracePaths;
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runMapTerminalLatencyCli(requestedTracePaths());
}
