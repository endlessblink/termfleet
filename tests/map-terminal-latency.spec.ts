import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { summarizeTraceFiles } from "../scripts/summarize-terminal-latency-trace.mjs";
import { runMapTerminalLatencyCli } from "../scripts/verify-map-terminal-latency.mjs";

type TraceEvent = Record<string, unknown> & {
  label: string;
  epochMs: number;
};

function writeTrace(directory: string, name: string, events: TraceEvent[]) {
  const file = path.join(directory, name);
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return file;
}

function validSequence(id = "terminal-a", seqId = 1, start = 100): TraceEvent[] {
  return [
    { label: "frontend.canvas.keydown", epochMs: start, id, seqId },
    { label: "frontend.daemon.input.send.start", epochMs: start + 4, id, seqIds: [seqId] },
    { label: "frontend.canvas.diff.receive", epochMs: start + 20, id, interactive: true },
    { label: "frontend.canvas.render", epochMs: start + 25, id, interactive: true },
    { label: "frontend.canvas.after_paint", epochMs: start + 30, id, interactive: true },
  ];
}

test("latency trace correlation never crosses terminal or sequence identity", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "termfleet-latency-correlation-"));
  try {
    const trace = writeTrace(directory, "mixed.jsonl", [
      { label: "frontend.canvas.keydown", epochMs: 100, id: "terminal-a", seqId: 1 },
      { label: "frontend.daemon.input.send.start", epochMs: 104, id: "terminal-a", seqIds: [2] },
      { label: "frontend.daemon.input.send.start", epochMs: 105, id: "terminal-b", seqIds: [1] },
      { label: "frontend.canvas.diff.receive", epochMs: 110, id: "terminal-b", interactive: true },
      ...validSequence("terminal-a", 3, 200),
    ]);

    const summary = summarizeTraceFiles([trace]);
    expect(summary.rows.get("canvas_keydown_to_input_send_start")?.count).toBe(1);
    expect(summary.rows.get("canvas_keydown_to_diff_receive")?.count).toBe(1);
    expect(summary.rows.get("canvas_diff_receive_to_render")?.count).toBe(1);
    expect(summary.diagnostics.uniqueSeqIds).toBe(4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interactive render budgets exclude intentionally throttled idle projection frames", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "termfleet-latency-idle-"));
  try {
    const trace = writeTrace(directory, "idle.jsonl", [
      ...validSequence("terminal-a", 1, 100),
      { label: "frontend.canvas.diff.receive", epochMs: 300, id: "terminal-a", interactive: false },
      { label: "frontend.canvas.render", epochMs: 420, id: "terminal-a", interactive: false },
      { label: "frontend.canvas.after_paint", epochMs: 436, id: "terminal-a", interactive: false },
    ]);

    const summary = summarizeTraceFiles([trace]);
    expect(summary.rows.get("canvas_diff_receive_to_render")).toMatchObject({ count: 1, p95: 5 });
    expect(summary.rows.get("canvas_render_to_after_paint")).toMatchObject({ count: 1, p95: 5 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("map latency CLI reports a missing explicit trace", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const status = runMapTerminalLatencyCli(
    [path.join(tmpdir(), "termfleet-trace-that-does-not-exist.jsonl")],
    { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
  );

  expect(status).toBe(1);
  expect(stderr.join("\n")).toContain("MAP_TERMINAL_LATENCY_TRACE_MISSING");
});

test("map latency CLI rejects mixed traces with missing causal buckets", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "termfleet-latency-mixed-"));
  try {
    const trace = writeTrace(directory, "mixed.jsonl", [
      { label: "frontend.canvas.keydown", epochMs: 100, id: "terminal-a", seqId: 1 },
      { label: "frontend.daemon.input.send.start", epochMs: 104, id: "terminal-b", seqIds: [1] },
      { label: "frontend.canvas.diff.receive", epochMs: 110, id: "terminal-b", interactive: true },
      { label: "frontend.canvas.render", epochMs: 115, id: "terminal-b", interactive: true },
      { label: "frontend.canvas.after_paint", epochMs: 120, id: "terminal-b", interactive: true },
    ]);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = runMapTerminalLatencyCli([trace], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(status).toBe(1);
    expect(stderr.join("\n")).toContain("MAP_TERMINAL_LATENCY_BUDGET_FAILED");
    expect(stderr.join("\n")).toContain("canvas_keydown_to_input_send_start:missing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("map latency CLI accepts a complete trace within every budget", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "termfleet-latency-valid-"));
  try {
    const trace = writeTrace(directory, "valid.jsonl", [
      ...validSequence("terminal-a", 1, 100),
      ...validSequence("terminal-a", 2, 200),
    ]);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = runMapTerminalLatencyCli([trace], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(status).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("MAP_TERMINAL_LATENCY_OK");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("map latency CLI rejects a complete trace that exceeds a named budget", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "termfleet-latency-slow-"));
  try {
    const events = validSequence("terminal-a", 1, 100);
    events[1].epochMs = 120;
    events[2].epochMs = 220;
    events[3].epochMs = 225;
    events[4].epochMs = 230;
    const trace = writeTrace(directory, "slow.jsonl", events);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = runMapTerminalLatencyCli([trace], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(status).toBe(1);
    expect(stderr.join("\n")).toContain("canvas_keydown_to_input_send_start:p95=20.0ms>15ms");
    expect(stderr.join("\n")).toContain("canvas_keydown_to_diff_receive:p95=120.0ms>100ms");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live latency harness isolates traces and preserves a caller build cache", () => {
  const source = readFileSync("scripts/verify-map-terminal-latency-live.sh", "utf8");

  expect(source).toContain('OUT_DIR="${MAP_LATENCY_RUN_DIR:-$OUT_ROOT/$RUN_ID}"');
  expect(source).toContain('TRACE_DIR="$OUT_DIR/traces"');
  expect(source).toContain('CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$OUT_ROOT/target}"');
  expect(source).toContain('TMPDIR="$TRACE_DIR"');
  expect(source).toContain('find "$TRACE_DIR"');
  expect(source).not.toContain('find /tmp');
  expect(source).not.toContain('rm -rf "$CARGO_TARGET_DIR"');
});
