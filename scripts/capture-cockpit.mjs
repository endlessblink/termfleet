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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function installedDockPids(explicitPid) {
  const candidates = explicitPid
    ? [String(explicitPid)]
    : run("pgrep", ["-u", String(process.getuid?.() ?? ""), "-x", "termfleet"])
        .stdout
        .split(/\s+/)
        .filter(Boolean);
  return candidates.filter((pid) => {
    try {
      const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      const executable = run("readlink", ["-f", `/proc/${pid}/exe`]).stdout.trim();
      return !commandLine.includes("--terminal-workspace-daemon") &&
        /\/termfleet\/releases\/[^/]+\/termfleet$/.test(executable);
    } catch {
      return false;
    }
  });
}

function listWindows(explicitPid) {
  const dockPids = new Set(installedDockPids(explicitPid));
  const res = run("wmctrl", ["-lp"]);
  return res.stdout
    .split("\n")
    .map((line) => line.match(/^(\S+)\s+\S+\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      id: normalizeWindowId(match[1]),
      pid: match[2],
      title: match[3].trim(),
    }))
    .filter((window) => dockPids.has(window.pid));
}

function activeWindowId() {
  const res = run("xdotool", ["getactivewindow"]);
  if (res.status !== 0) return "";
  return normalizeWindowId(res.stdout.trim());
}

function findWindowId({ explicitWindowId, preferActive, dockPid }) {
  const windows = listWindows(dockPid);
  if (!windows.length) {
    throw new Error("Installed TermFleet dock window not found for a live release process.");
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
const explicitDockPid = argValue("--dock-pid");
const label = argValue("--name")?.replace(/[^\w.-]+/g, "_");

mkdirSync(OUT_DIR, { recursive: true });
if (listOnly) {
  const windows = listWindows(explicitDockPid);
  const active = activeWindowId();
  for (const window of windows) {
    console.log(`${window.id}${window.id === active ? " *active" : ""} pid=${window.pid} ${window.title}`);
  }
  if (!windows.length) process.exitCode = 1;
  process.exit();
}
const window = findWindowId({ explicitWindowId, preferActive, dockPid: explicitDockPid });
const base = `cockpit-${stamp()}${label ? `-${label}` : ""}`;
const full = path.join(OUT_DIR, `${base}.png`);

console.log(`capturing window ${window.id} ${window.title}`);
run("import", ["-window", window.id, full]);
const size = run("identify", ["-format", "%wx%h", full]).stdout.trim();
console.log(`captured ${full} (${size})`);

const [width, height] = size.split("x").map(Number);
const executable = run("readlink", ["-f", `/proc/${window.pid}/exe`]).stdout.trim();
const manifest = {
  capture: full,
  capturedAt: new Date().toISOString(),
  windowId: window.id,
  windowPid: Number(window.pid),
  windowTitle: window.title,
  executable,
  geometry: { width, height },
};
const manifestPath = path.join(OUT_DIR, `${base}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${manifestPath}`);

if (cropHeader) {
  const [w] = size.split("x").map(Number);
  // Header + TASKS panel live across the top band, right of the dock rail. Crop from the
  // captured PNG (more reliable than `import -crop`) and zoom 2x so small text is legible.
  const crop = path.join(OUT_DIR, `${base}-header.png`);
  const cw = Math.round(w * 0.78);
  const cx = Math.round(w * 0.20);
  // Keep the proof image limited to the header band. A taller crop also captures the
  // terminal transcript and the global usage footer, which can contain unrelated
  // process text and make a correct header fail the visual gate.
  run("convert", [full, "-crop", `${cw}x240+${cx}+180`, "+repage", "-resize", "200%", crop]);
  manifest.headerCrop = crop;
  const surfaceCrop = path.join(OUT_DIR, `${base}-surface.png`);
  run("convert", [full, "-crop", `${cw}x${height}+${cx}+0`, "+repage", surfaceCrop]);
  manifest.surfaceCrop = surfaceCrop;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`captured ${crop} (header crop, 2x)`);
}
