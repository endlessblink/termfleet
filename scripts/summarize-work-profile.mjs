#!/usr/bin/env node
// Summarise the renderer work-profile records (TF-015) written by
// src/lib/workAttribution.ts into the geometry log, and translate bundle
// positions back to source files using a sourcemap build of the SAME source.
//
// Usage: node scripts/summarize-work-profile.mjs [--minutes N] [--maps DIR]
//   --maps DIR  a `vite build --sourcemap hidden --outDir DIR` of the released
//               source; its assets/*.js names must match the release bundle.
// Output contains only timings and source positions, never terminal contents.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const minutes = Number(flag("--minutes", "10"));
const mapsDir = flag("--maps", "");
const logPath =
  process.env.TERMFLEET_GEOMETRY_LOG ||
  path.join(os.homedir(), ".cache/termfleet/tmp/terminal-workspace-geometry.jsonl");

const since = Date.now() - minutes * 60_000;
const records = [];
for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
  if (!line.includes('"work-profile"')) continue;
  try {
    const record = JSON.parse(line);
    if (record.kind === "work-profile" && record.t >= since) records.push(record);
  } catch {
    // Skip torn lines at the ring boundary.
  }
}
if (!records.length) {
  console.log(`no work-profile records in the last ${minutes} min (${logPath})`);
  process.exit(0);
}

const consumers = new Map();
function consumerFor(file) {
  if (!mapsDir) return null;
  if (!consumers.has(file)) {
    const mapPath = path.join(mapsDir, "assets", `${file}.map`);
    consumers.set(file, fs.existsSync(mapPath) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(mapPath, "utf8"))) : null);
  }
  return consumers.get(file);
}
function translate(position) {
  const match = position.match(/^(.+):(\d+):(\d+)$/);
  if (!match) return position;
  const consumer = consumerFor(match[1]);
  if (!consumer) return position;
  const original = consumer.originalPositionFor({ line: Number(match[2]), column: Number(match[3]) - 1 });
  if (!original.source) return position;
  const source = original.source.replace(/^.*?\/(src|node_modules)\//, "$1/");
  return `${source}:${original.line}${original.name ? ` ${original.name}` : ""}`;
}
function translateSite(site) {
  const at = site.indexOf("@");
  if (at < 0) return site;
  return `${site.slice(0, at)} ${site.slice(at + 1).split("<").map(translate).join(" < ")}`;
}

let windowMs = 0;
let busyMs = 0;
const totals = new Map();
for (const record of records) {
  windowMs += record.windowMs;
  busyMs += record.busyMs;
  for (const site of record.top) {
    const entry = totals.get(site.site) || { totalMs: 0, count: 0, maxMs: 0 };
    entry.totalMs += site.totalMs;
    entry.count += site.count;
    entry.maxMs = Math.max(entry.maxMs, site.maxMs);
    totals.set(site.site, entry);
  }
}
const mutationTotals = new Map();
for (const record of records) {
  for (const site of record.mutations ?? []) mutationTotals.set(site.site, (mutationTotals.get(site.site) || 0) + site.count);
}
const pct = (ms) => `${((100 * ms) / windowMs).toFixed(1)}%`;
const frames = totals.get("render:frame-update");
const layout = totals.get("render:style-layout");
if (frames) {
  const avg = (entry) => (entry ? (entry.totalMs / entry.count).toFixed(1) : "?");
  console.log(
    `sampled screen updates (${frames.count}): style+layout avg ${avg(layout)} ms (max ${layout ? layout.maxMs.toFixed(0) : "?"}), ` +
      `painting avg ${avg(frames)} ms (max ${frames.maxMs.toFixed(0)})`,
  );
}
const lastPage = records.at(-1)?.page;
if (lastPage) console.log(`page size: ${JSON.stringify(lastPage)}`);
if (mutationTotals.size) {
  console.log("most frequent page changes (per second):");
  for (const [site, count] of [...mutationTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`${(count / (windowMs / 1000)).toFixed(1).padStart(8)}/s  ${site.replace(/^mutation:/, "")}`);
  }
}
console.log(
  `${records.length} windows, ${(windowMs / 1000).toFixed(0)} s: JavaScript callbacks busy ${pct(busyMs)} of wall time`,
);
for (const [site, entry] of [...totals.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 20)) {
  console.log(
    `${pct(entry.totalMs).padStart(6)}  n=${String(entry.count).padStart(6)}  max=${entry.maxMs.toFixed(0).padStart(4)}ms  ${translateSite(site)}`,
  );
}
