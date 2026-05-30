#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const tracePath = process.argv[2];
const defaultTraceDir = "/tmp";
const traceFiles = tracePath
  ? [tracePath]
  : fs.readdirSync(defaultTraceDir)
    .filter((name) => /^terminal-workspace-latency-trace-\d+(?:-[A-Za-z0-9]+)?\.jsonl$/.test(name))
    .map((name) => path.join(defaultTraceDir, name));

if (traceFiles.length === 0 || traceFiles.some((file) => !fs.existsSync(file))) {
  console.error(`Missing latency trace file(s): ${tracePath ?? "/tmp/terminal-workspace-latency-trace-*.jsonl"}`);
  process.exit(1);
}

const events = traceFiles.flatMap((file) => fs.readFileSync(file, "utf8")
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

const intervals = [
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

const latestByLabel = new Map();
const buckets = new Map(intervals.map(([name]) => [name, []]));

for (const event of events) {
  for (const [name, from, to, maxDelta] of intervals) {
    if (event.label !== to) continue;
    const previous = latestByLabel.get(from);
    if (!previous) continue;
    const delta = event.time - previous.time;
    if (delta >= 0 && delta <= maxDelta) {
      buckets.get(name).push(delta);
    }
  }
  latestByLabel.set(event.label, event);
}

console.log(`Latency trace files: ${traceFiles.join(", ")}`);
console.log(`Events: ${events.length}`);
console.log("bucket,count,p50_ms,p95_ms,p99_ms,max_ms");

for (const [name, values] of buckets) {
  const max = values.length ? Math.max(...values) : null;
  console.log([
    name,
    values.length,
    fmt(percentile(values, 50)),
    fmt(percentile(values, 95)),
    fmt(percentile(values, 99)),
    fmt(max),
  ].join(","));
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
  if (Number.isFinite(Number(event.seqId))) {
    const seqId = Number(event.seqId);
    seqCounts.set(seqId, (seqCounts.get(seqId) ?? 0) + 1);
  }
  if (Array.isArray(event.seqIds)) {
    for (const rawSeqId of event.seqIds) {
      const seqId = Number(rawSeqId);
      if (Number.isFinite(seqId)) {
        seqCounts.set(seqId, (seqCounts.get(seqId) ?? 0) + 1);
      }
    }
  }
}
const duplicateSeqIds = Array.from(seqCounts.entries())
  .filter(([, count]) => count > 4)
  .map(([seqId, count]) => `${seqId}:${count}`);

console.log("diagnostic,value");
console.log(`max_active_input_listeners,${fmt(maxActiveInputListeners)}`);
console.log(`final_active_input_listeners,${fmt(finalActiveInputListeners)}`);
console.log(`unique_seq_ids,${seqCounts.size}`);
console.log(`duplicate_seq_ids_over_4_stages,${duplicateSeqIds.slice(0, 20).join("|") || "none"}`);
