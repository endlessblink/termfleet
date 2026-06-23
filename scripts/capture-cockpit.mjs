#!/usr/bin/env node
// Visual capture of the live TermFleet cockpit (TC-035 observability).
//
// We kept losing hours guessing at the rendered title / task list from JSON. This grabs an
// ACTUAL screenshot of the running TermFleet window (every terminal, its header, and the
// TASKS panel — exactly what the operator sees) so a fix can be verified against pixels, not
// a snapshot we hope reflects reality.
//
// X11 only (uses `wmctrl` to find the window + ImageMagick `import` to grab it). Writes a
// timestamped PNG under `.captures/` and prints its absolute path. Pass `--crop-header` to
// also emit a 2x-zoomed crop of the top-right header+TASKS region for readability.
//
//   node scripts/capture-cockpit.mjs [--crop-header] [--name <label>]
//
// The window must be visible (un-occluded) — `import -window <id>` captures on-screen pixels.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".captures");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error) throw new Error(`${cmd} not available: ${res.error.message}`);
  return res;
}

function stamp() {
  // Date.now()/new Date() are fine here (plain script, not a workflow).
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function findWindowId() {
  const res = run("wmctrl", ["-l"]);
  const line = res.stdout
    .split("\n")
    .find((l) => /termfleet/i.test(l));
  if (!line) {
    throw new Error("TermFleet window not found (is the app running?). `wmctrl -l` listed no match.");
  }
  return line.split(/\s+/)[0];
}

const args = process.argv.slice(2);
const cropHeader = args.includes("--crop-header");
const nameIdx = args.indexOf("--name");
const label = nameIdx >= 0 ? args[nameIdx + 1]?.replace(/[^\w.-]+/g, "_") : undefined;

mkdirSync(OUT_DIR, { recursive: true });
const wid = findWindowId();
const base = `cockpit-${stamp()}${label ? `-${label}` : ""}`;
const full = path.join(OUT_DIR, `${base}.png`);

run("import", ["-window", wid, full]);
const size = run("identify", ["-format", "%wx%h", full]).stdout.trim();
console.log(`captured ${full} (${size})`);

if (cropHeader) {
  const [w] = size.split("x").map(Number);
  // Header + TASKS panel live across the top band, right of the dock rail. Crop from the
  // captured PNG (more reliable than `import -crop`) and zoom 2x so small text is legible.
  const crop = path.join(OUT_DIR, `${base}-header.png`);
  const cw = Math.round(w * 0.72);
  const cx = Math.round(w * 0.26);
  run("convert", [full, "-crop", `${cw}x260+${cx}+60`, "+repage", "-resize", "200%", crop]);
  console.log(`captured ${crop} (header crop, 2x)`);
}
