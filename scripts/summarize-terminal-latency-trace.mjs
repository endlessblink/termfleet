#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultTraceDir = "/tmp";

export function defaultTraceFiles() {
  return fs.readdirSync(defaultTraceDir)
    .filter((name) => /^terminal-workspace-latency-trace-\d+(?:-[A-Za-z0-9]+)?\.jsonl$/.test(name))
    .map((name) => path.join(defaultTraceDir, name));
}

const intervals = [
  ["canvas_keydown_to_input_send_start", "frontend.canvas.keydown", "frontend.daemon.input.send.start", 250],
  ["canvas_keydown_to_diff_receive", "frontend.canvas.keydown", "frontend.canvas.diff.receive", 500],
  ["canvas_keydown_to_render", "frontend.canvas.keydown", "frontend.canvas.render", 500],
  ["canvas_keydown_to_render_raf", "frontend.canvas.keydown", "frontend.canvas.render.raf", 500],
  ["canvas_keydown_to_after_paint", "frontend.canvas.keydown", "frontend.canvas.after_paint", 500],
  ["canvas_diff_receive_to_render", "frontend.canvas.diff.receive", "frontend.canvas.render", 250, true],
  ["canvas_render_to_raf", "frontend.canvas.render", "frontend.canvas.render.raf", 250, true],
  ["canvas_render_to_after_paint", "frontend.canvas.render", "frontend.canvas.after_paint", 250, true],
  ["keydown_to_ondata", "frontend.xterm.keydown", "frontend.xterm.onData", 250],
  ["ondata_to_input_send_start", "frontend.xterm.onData", "frontend.daemon.input.send.start", 250],
  ["input_send_start_to_tauri_receive", "frontend.daemon.input.send.start", "tauri.daemon.input.event.receive", 250],
  ["tauri_receive_to_worker_start", "tauri.daemon.input.event.receive", "tauri.daemon.input.worker.write.start", 250],
  ["worker_start_to_stream_open", "tauri.daemon.input.worker.write.start", "tauri.daemon.input.stream.open", 250],
  ["worker_start_to_daemon_stream_receive", "tauri.daemon.input.worker.write.start", "daemon.input_stream.receive", 250],
  ["worker_start_to_worker_end", "tauri.daemon.input.worker.write.start", "tauri.daemon.input.worker.write.end", 250],
  ["worker_start_to_daemon_receive_fallback", "tauri.daemon.input.worker.write.start", "daemon.write.receive", 250],
  ["daemon_stream_receive_to_pty_write_start", "daemon.input_stream.receive", "pty.write.start", 250],
  ["daemon_receive_to_pty_write_start", "daemon.write.receive", "pty.write.start", 250],
  ["pty_write_start_to_end", "pty.write.start", "pty.write.end", 250],
  ["pty_write_end_to_output_read", "pty.write.end", "pty.output.read", 500],
  ["output_read_to_daemon_emit", "pty.output.read", "daemon.subscribe.emit", 500],
  ["channel_receive_to_write_call", "frontend.daemon.channel.data", "frontend.xterm.write.call", 250],
  ["write_call_to_callback", "frontend.xterm.write.call", "frontend.xterm.write.callback", 250],
  ["write_call_to_raf", "frontend.xterm.write.call", "frontend.xterm.write.raf", 250],
  ["write_call_to_render", "frontend.xterm.write.call", "frontend.xterm.render", 250],
  ["ondata_to_write_call", "frontend.xterm.onData", "frontend.xterm.write.call", 500],
  ["keydown_to_write_raf", "frontend.xterm.keydown", "frontend.xterm.write.raf", 500],
];

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function fmt(value) {
  return value === null ? "n/a" : value.toFixed(1);
}

function eventIdentity(event) {
  for (const key of ["id", "sessionId", "terminalId", "paneId"]) {
    const value = String(event?.[key] ?? "").trim();
    if (value) return value;
  }
  return null;
}

function eventSequenceIds(event) {
  const values = [];
  if (Number.isFinite(Number(event?.seqId))) values.push(Number(event.seqId));
  if (Array.isArray(event?.seqIds)) {
    for (const value of event.seqIds) {
      if (Number.isFinite(Number(value))) values.push(Number(value));
    }
  }
  return new Set(values);
}

function eventsCorrelate(previous, current) {
  const previousIdentity = eventIdentity(previous);
  const currentIdentity = eventIdentity(current);
  if (!previousIdentity || previousIdentity !== currentIdentity) return false;

  const previousSequences = eventSequenceIds(previous);
  const currentSequences = eventSequenceIds(current);
  if (previousSequences.size > 0 && currentSequences.size > 0) {
    return [...previousSequences].some((sequence) => currentSequences.has(sequence));
  }
  return true;
}

export function readTraceEvents(traceFiles) {
  return traceFiles.flatMap((file) => fs.readFileSync(file, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        const event = JSON.parse(line);
        const time = Number(event.epochMs ?? event.rustEpochMs);
        return Number.isFinite(time) ? { ...event, time } : null;
      } catch (error) {
        console.error(`Could not parse trace line ${index + 1}: ${error}`);
        return null;
      }
    })
    .filter(Boolean))
    .sort((a, b) => a.time - b.time);
}

export function summarizeTraceFiles(traceFiles) {
  const events = readTraceEvents(traceFiles);
  const latestByLabelAndIdentity = new Map();
  const buckets = new Map(intervals.map(([name]) => [name, []]));

  for (const event of events) {
    const identity = eventIdentity(event);
    if (!identity) continue;
    for (const [name, from, to, maxDelta, interactiveOnly = false] of intervals) {
      if (event.label !== to) continue;
      const previous = latestByLabelAndIdentity.get(`${from}\0${identity}`);
      if (!previous || !eventsCorrelate(previous, event)) continue;
      if (interactiveOnly && (previous.interactive !== true || event.interactive !== true)) continue;
      const delta = event.time - previous.time;
      if (delta >= 0 && delta <= maxDelta) {
        buckets.get(name).push(delta);
      }
    }
    latestByLabelAndIdentity.set(`${event.label}\0${identity}`, event);
  }

  const rows = new Map();
  for (const [name, values] of buckets) {
    rows.set(name, {
      count: values.length,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      max: values.length ? Math.max(...values) : null,
    });
  }

  const activeListenerSamples = events
    .map((event) => Number(event.activeInputListeners))
    .filter(Number.isFinite);
  const maxActiveInputListeners = activeListenerSamples.length
    ? Math.max(...activeListenerSamples)
    : null;
  const finalActiveInputListeners = activeListenerSamples.length
    ? activeListenerSamples.at(-1)
    : null;

  const seqCounts = new Map();
  for (const event of events) {
    const identity = eventIdentity(event);
    if (!identity) continue;
    for (const seqId of eventSequenceIds(event)) {
      const key = `${identity}:${seqId}`;
      seqCounts.set(key, (seqCounts.get(key) ?? 0) + 1);
    }
  }
  const duplicateSeqIds = Array.from(seqCounts.entries())
    .filter(([, count]) => count > 4)
    .map(([key, count]) => `${key}:${count}`);

  return {
    traceFiles,
    events,
    rows,
    diagnostics: {
      maxActiveInputListeners,
      finalActiveInputListeners,
      uniqueSeqIds: seqCounts.size,
      duplicateSeqIds,
    },
  };
}

export function formatLatencySummary(summary) {
  const lines = [
    `Latency trace files: ${summary.traceFiles.join(", ")}`,
    `Events: ${summary.events.length}`,
    "bucket,count,p50_ms,p95_ms,p99_ms,max_ms",
  ];

  for (const [name, row] of summary.rows) {
    lines.push([
      name,
      row.count,
      fmt(row.p50),
      fmt(row.p95),
      fmt(row.p99),
      fmt(row.max),
    ].join(","));
  }

  lines.push("diagnostic,value");
  lines.push(`max_active_input_listeners,${fmt(summary.diagnostics.maxActiveInputListeners)}`);
  lines.push(`final_active_input_listeners,${fmt(summary.diagnostics.finalActiveInputListeners)}`);
  lines.push(`unique_seq_ids,${summary.diagnostics.uniqueSeqIds}`);
  lines.push(`duplicate_seq_ids_over_4_stages,${summary.diagnostics.duplicateSeqIds.slice(0, 20).join("|") || "none"}`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tracePaths = process.argv.slice(2);
  const traceFiles = tracePaths.length > 0 ? tracePaths : defaultTraceFiles();

  if (traceFiles.length === 0 || traceFiles.some((file) => !fs.existsSync(file))) {
    console.error(`Missing latency trace file(s): ${tracePaths.join(", ") || "/tmp/terminal-workspace-latency-trace-*.jsonl"}`);
    process.exit(1);
  }

  process.stdout.write(formatLatencySummary(summarizeTraceFiles(traceFiles)));
}
