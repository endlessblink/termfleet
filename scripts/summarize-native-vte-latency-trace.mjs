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
  console.error(`Missing native VTE latency trace file(s): ${tracePath ?? "/tmp/terminal-workspace-latency-trace-*.jsonl"}`);
  process.exit(1);
}

const events = traceFiles.flatMap((file) => fs.readFileSync(file, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      const event = JSON.parse(line);
      const time = Number(event.epochMs ?? event.rustEpochMs);
      return Number.isFinite(time) ? { ...event, time, file } : null;
    } catch (error) {
      console.error(`Could not parse trace line ${index + 1} in ${file}: ${error}`);
      return null;
    }
  })
  .filter(Boolean))
  .sort((a, b) => a.time - b.time);

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function fmt(value) {
  return value === null ? "n/a" : value.toFixed(1);
}

function bucketAfterKey(targetLabel, maxDeltaMs) {
  const pendingKeys = [];
  const values = [];
  for (const event of events) {
    if (event.label === "native.vte.key.press") {
      pendingKeys.push(event);
      continue;
    }
    if (event.label !== targetLabel) {
      continue;
    }
    while (pendingKeys.length > 0 && event.time - pendingKeys[0].time > maxDeltaMs) {
      pendingKeys.shift();
    }
    const key = pendingKeys.shift();
    if (!key) {
      continue;
    }
    const delta = event.time - key.time;
    if (delta >= 0 && delta <= maxDeltaMs) {
      values.push(delta);
    }
  }
  return values;
}

const buckets = new Map([
  ["native_key_to_contents_changed", bucketAfterKey("native.vte.contents.changed", 250)],
  ["native_key_to_commit", bucketAfterKey("native.vte.commit", 250)],
  ["native_key_to_draw", bucketAfterKey("native.vte.draw", 250)],
  ["native_key_to_after_paint", bucketAfterKey("native.vte.frame.after_paint", 250)],
]);

const keyPressCount = events.filter((event) => event.label === "native.vte.key.press").length;
const contentsChangedCount = events.filter((event) => event.label === "native.vte.contents.changed").length;
const commitCount = events.filter((event) => event.label === "native.vte.commit").length;
const drawCount = events.filter((event) => event.label === "native.vte.draw").length;
const afterPaintCount = events.filter((event) => event.label === "native.vte.frame.after_paint").length;

console.log(`Native VTE latency trace files: ${traceFiles.join(", ")}`);
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

console.log("diagnostic,value");
console.log(`native_key_press_events,${keyPressCount}`);
console.log(`native_contents_changed_events,${contentsChangedCount}`);
console.log(`native_commit_events,${commitCount}`);
console.log(`native_draw_events,${drawCount}`);
console.log(`native_after_paint_events,${afterPaintCount}`);

if (keyPressCount === 0 || contentsChangedCount === 0 || drawCount === 0) {
  console.error("Native VTE latency trace did not capture key press, contents-changed, and draw events.");
  process.exit(1);
}

const commitDeltas = buckets.get("native_key_to_commit") ?? [];
if (commitDeltas.length === 0) {
  console.error("Native VTE latency trace could not pair any key press with VTE commit.");
  process.exit(1);
}

const p95Limit = Number(process.env.TERMINAL_WORKSPACE_NATIVE_VTE_COMMIT_P95_LIMIT_MS ?? "5");
const p95 = percentile(commitDeltas, 95);
if (Number.isFinite(p95Limit) && p95 !== null && p95 > p95Limit) {
  console.error(`Native VTE key-to-commit p95 ${p95.toFixed(1)}ms exceeds ${p95Limit}ms.`);
  process.exit(1);
}

if (process.env.TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_DRAW === "1") {
  const drawDeltas = buckets.get("native_key_to_draw") ?? [];
  if (drawDeltas.length === 0) {
    console.error("Native VTE latency trace could not pair any key press with GTK draw.");
    process.exit(1);
  }

  const drawP95Limit = Number(process.env.TERMINAL_WORKSPACE_NATIVE_VTE_DRAW_P95_LIMIT_MS ?? "25");
  const drawP95 = percentile(drawDeltas, 95);
  if (Number.isFinite(drawP95Limit) && drawP95 !== null && drawP95 > drawP95Limit) {
    console.error(`Native VTE key-to-draw p95 ${drawP95.toFixed(1)}ms exceeds ${drawP95Limit}ms.`);
    process.exit(1);
  }
}

if (process.env.TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_AFTER_PAINT === "1") {
  const afterPaintDeltas = buckets.get("native_key_to_after_paint") ?? [];
  if (afterPaintDeltas.length === 0) {
    console.error("Native VTE latency trace could not pair any key press with GTK frame after-paint.");
    process.exit(1);
  }

  const afterPaintP95Limit = Number(process.env.TERMINAL_WORKSPACE_NATIVE_VTE_AFTER_PAINT_P95_LIMIT_MS ?? "25");
  const afterPaintP95 = percentile(afterPaintDeltas, 95);
  if (Number.isFinite(afterPaintP95Limit) && afterPaintP95 !== null && afterPaintP95 > afterPaintP95Limit) {
    console.error(`Native VTE key-to-after-paint p95 ${afterPaintP95.toFixed(1)}ms exceeds ${afterPaintP95Limit}ms.`);
    process.exit(1);
  }
}
