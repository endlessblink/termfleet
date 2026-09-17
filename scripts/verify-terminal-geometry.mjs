#!/usr/bin/env node
// Judge TermFleet's terminal surface from recorded evidence, not screenshots.
//
// Two independent sources, both written by the running app:
//   1. the always-on geometry log (per pane: grid, canvas box, backing store,
//      container box, scroll modes, display offset, navigation-key decisions);
//   2. the pane output streams (capability probes + terminal output protocols).
//
// Exit codes: 0 pass or nothing to judge yet, 1 on real violations. "Nothing to judge"
// is reported as UNVERIFIED so a non-running app cannot fail a pipeline, but it can
// never be mistaken for a pass.
//
// Usage: node scripts/verify-terminal-geometry.mjs [--json] [--no-streams]

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  judgePaneGeometry,
  judgeKeyRoutes,
  judgePaneStream,
  judgePaneCapture,
} from "./lib/terminal-geometry-verdict.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const scanStreams = !args.includes("--no-streams");
const capturePng = (() => {
  const index = args.indexOf("--png");
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
})();

/**
 * Mean brightness of a window-space rect, via ImageMagick. Returns 0..1. Only used when
 * a capture is supplied; a missing `magick` is reported, never silently passed.
 */
function brightnessFromCapture(rect, png) {
  const result = spawnSync(
    "magick",
    [
      png,
      "-crop",
      `${Math.round(rect.width)}x${Math.round(rect.height)}+${Math.round(rect.x)}+${Math.round(rect.y)}`,
      "+repage",
      "-colorspace",
      "Gray",
      "-format",
      "%[fx:mean]",
      "info:",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `magick exited ${result.status}`);
  }
  const value = Number.parseFloat(result.stdout);
  if (!Number.isFinite(value)) throw new Error(`unparseable brightness ${result.stdout}`);
  return value;
}

// The app writes to the TMPDIR the launcher gave it (~/.cache/termfleet/tmp), which is
// NOT the shell's TMPDIR. Probe the known locations instead of guessing one.
const LOG_CANDIDATES = [
  process.env.TERMFLEET_GEOMETRY_LOG,
  process.env.TMPDIR && path.join(process.env.TMPDIR, "terminal-workspace-geometry.jsonl"),
  path.join(os.homedir(), ".cache", "termfleet", "tmp", "terminal-workspace-geometry.jsonl"),
  "/tmp/terminal-workspace-geometry.jsonl",
].filter(Boolean);

const logPath =
  LOG_CANDIDATES.find((candidate) => existsSync(candidate)) ?? LOG_CANDIDATES[0];
const sessionsDir =
  process.env.TERMFLEET_DATA_DIR
    ? path.join(process.env.TERMFLEET_DATA_DIR, "sessions")
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        "terminal-workspace", "sessions");

const violations = [];
const warnings = [];
let panesJudged = 0;
let keysJudged = 0;
let streamsJudged = 0;
const streamCounts = {};

// --- 1. Geometry log -------------------------------------------------------------
// Two transports write the same records: the always-on geometry command, and the
// latency tracer's event channel (env-gated). Read both so a release that lacks one
// still yields evidence.
const oversizeSkipped = [];

function collectEntries() {
  const entries = [];
  const sources = [logPath];
  const traceDir = process.env.TMPDIR || path.join(os.homedir(), ".cache", "termfleet", "tmp");
  if (existsSync(traceDir)) {
    // Newest first, bounded: the trace dir accumulates a file per process generation and
    // reading all of them made this scan slow enough to time out.
    const candidates = readdirSyncSafe(traceDir)
      .filter((name) => name.startsWith("terminal-workspace-latency-trace-") && name.endsWith(".jsonl"))
      .map((name) => {
        const full = path.join(traceDir, name);
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          mtime = 0;
        }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 40);
    for (const candidate of candidates) sources.push(candidate.full);
  }
  for (const source of sources) {
    if (!existsSync(source)) continue;
    // A growing trace file can reach hundreds of MB; reading it whole throws
    // ERR_STRING_TOO_LONG and takes the verifier down instead of reporting. Skip
    // anything oversized and say so, rather than dying.
    let size = 0;
    try {
      size = statSync(source).size;
    } catch {
      continue;
    }
    if (size > 64 * 1024 * 1024) {
      oversizeSkipped.push(`${path.basename(source)} (${(size / 1048576).toFixed(0)}MB)`);
      continue;
    }
    for (const line of readFileSync(source, "utf8").split("\n")) {
      if (!line) continue;
      // The geometry command writes `{"kind":"geometry",…}` with no label; the tracer
      // writes the same record with a `frontend.canvas.*` label. Accept either.
      const interesting =
        line.includes('"kind":"geometry"') ||
        line.includes('"kind":"key"') ||
        line.includes("frontend.canvas.");
      if (!interesting) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.kind === "geometry" || parsed.kind === "key") entries.push(parsed);
      } catch {
        // Torn line while the app appends is expected.
      }
    }
  }
  return entries;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const entries = collectEntries();
console.log(`collected ${entries.length} geometry/key record(s)`);
if (entries.length) {
  const geometry = entries.filter((entry) => entry.kind === "geometry");
  const keys = entries.filter((entry) => entry.kind === "key");
  const latest = new Map();
  for (const sample of geometry) latest.set(sample.id, sample);
  panesJudged = latest.size;
  keysJudged = keys.length;
  for (const sample of latest.values()) violations.push(...judgePaneGeometry(sample));

  // Judge the renderer's claim against the pixels, when a capture is supplied. Without
  // one the geometry half still runs — this is additive, never a substitute.
  if (capturePng && existsSync(capturePng)) {
    for (const sample of latest.values()) {
      const { violations: found, brightness, error } = judgePaneCapture(
        sample,
        (rect) => brightnessFromCapture(rect, capturePng),
      );
      violations.push(...found);
      if (typeof brightness === "number") {
        console.log(
          `capture: ${String(sample.id).slice(0, 22)} rect ${sample.rectWidth}x${sample.rectHeight} ` +
            `at ${sample.rectX},${sample.rectY} brightness ${brightness.toFixed(5)}`,
        );
      } else if (error) {
        console.log(`capture: ${String(sample.id).slice(0, 22)} not judged (${error})`);
      }
    }
  }
  violations.push(...judgeKeyRoutes(keys));
}

// --- 2. Pane output streams ------------------------------------------------------
if (scanStreams && existsSync(sessionsDir)) {
  const { readdirSync, statSync } = await import("node:fs");
  const files = readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".scrollback"))
    .map((name) => path.join(sessionsDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 8);
  for (const file of files) {
    const paneId = path.basename(file, ".scrollback");
    const text = readFileSync(file, "latin1");
    const { counts, violations: found, warnings: noted } = judgePaneStream(paneId, text);
    if (Object.keys(counts).length === 0 && found.length === 0 && noted.length === 0) continue;
    streamsJudged += 1;
    streamCounts[paneId.slice(0, 40)] = counts;
    violations.push(...found);
    warnings.push(...noted);
  }
}

if (asJson) {
  console.log(
    JSON.stringify(
      { logPath, sessionsDir, panesJudged, keysJudged, streamsJudged, streamCounts, violations },
      null,
      2,
    ),
  );
} else {
  console.log(`geometry log : ${existsSync(logPath) ? logPath : "(none yet)"}`);
  console.log(`pane streams : ${sessionsDir}`);
  console.log(
    `judged       : ${panesJudged} pane geometry, ${keysJudged} key decisions, ${streamsJudged} output streams`,
  );
  const probed = Object.entries(streamCounts);
  if (probed.length) {
    console.log("\ncapability probes seen in pane output:");
    for (const [pane, counts] of probed) {
      console.log(`  ${pane}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    }
  }
  if (oversizeSkipped.length) {
    console.log(`\nskipped oversized trace files (${oversizeSkipped.length}):`);
    for (const name of oversizeSkipped) console.log(`  ${name}`);
  }
}

if (panesJudged === 0 && streamsJudged === 0) {
  console.log("\nVERDICT=UNVERIFIED no geometry samples and no probe-bearing streams to judge");
  process.exit(0);
}

if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}) — neutralised, not defects:`);
  for (const warning of warnings) console.log(`  ${warning.code}  ${warning.detail}`);
}

if (violations.length === 0) {
  console.log("\nVERDICT=PASS no geometry or key-routing violations");
  process.exit(0);
}

console.log(`\nVERDICT=FAIL ${violations.length} violation(s):`);
for (const violation of violations) {
  console.log(`  ${violation.code}  ${violation.id ?? ""}  ${violation.detail}`);
}
process.exit(1);
