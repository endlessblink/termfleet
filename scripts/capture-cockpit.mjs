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
//   node scripts/capture-cockpit.mjs [--crop-header] [--name <label>] [--window-id <xid>] [--list-windows]
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

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeWindowId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("0x")) return raw.toLowerCase();
  try {
    return `0x${BigInt(raw).toString(16).padStart(8, "0")}`;
  } catch {
    return raw.toLowerCase();
  }
}

function stamp() {
  // Date.now()/new Date() are fine here (plain script, not a workflow).
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listWindows() {
  const res = run("wmctrl", ["-l"]);
  return res.stdout
    .split("\n")
    .map((line) => line.match(/^(\S+)\s+\S+\s+\S+\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      id: normalizeWindowId(match[1]),
      title: match[2].trim(),
    }))
    .filter((window) => /termfleet/i.test(window.title));
}

function activeWindowId() {
  const res = run("xdotool", ["getactivewindow"]);
  if (res.status !== 0) return "";
  return normalizeWindowId(res.stdout.trim());
}

function findWindowId({ explicitWindowId, preferActive }) {
  const windows = listWindows();
  if (!windows.length) {
    throw new Error("TermFleet window not found (is the app running?). `wmctrl -l` listed no match.");
  }
  const explicit = normalizeWindowId(explicitWindowId);
  if (explicit) {
    const match = windows.find((window) => window.id === explicit);
    if (!match) {
      throw new Error(`Requested window ${explicit} is not a TermFleet window. Run with --list-windows to inspect candidates.`);
    }
    return match;
  }
  if (preferActive) {
    const active = activeWindowId();
    const match = windows.find((window) => window.id === active);
    if (match) return match;
    throw new Error(`Active window ${active || "(unknown)"} is not TermFleet. Use --window-id or run with --list-windows.`);
  }
  const active = activeWindowId();
  const activeMatch = windows.find((window) => window.id === active);
  if (activeMatch) return activeMatch;
  return windows[windows.length - 1];
}

const args = process.argv.slice(2);
const cropHeader = args.includes("--crop-header");
const listOnly = args.includes("--list-windows");
const preferActive = args.includes("--active");
const explicitWindowId = argValue("--window-id");
const label = argValue("--name")?.replace(/[^\w.-]+/g, "_");

mkdirSync(OUT_DIR, { recursive: true });
if (listOnly) {
  const windows = listWindows();
  const active = activeWindowId();
  for (const window of windows) {
    console.log(`${window.id}${window.id === active ? " *active" : ""} ${window.title}`);
  }
  if (!windows.length) process.exitCode = 1;
  process.exit();
}
const window = findWindowId({ explicitWindowId, preferActive });
const base = `cockpit-${stamp()}${label ? `-${label}` : ""}`;
const full = path.join(OUT_DIR, `${base}.png`);

console.log(`capturing window ${window.id} ${window.title}`);
run("import", ["-window", window.id, full]);
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
