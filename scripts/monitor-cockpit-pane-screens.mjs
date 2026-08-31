#!/usr/bin/env node
// Verify the pixels of every TermFleet terminal pane.
// The PNGs must be produced by TermFleet's own WebKit surface; metadata never
// substitutes for a missing pane image.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const statusDir = process.env.TERMFLEET_STATUS_DIR
  || path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
const snapshotPath = process.env.TERMFLEET_COCKPIT_SNAPSHOT_PATH || path.join(statusDir, "termfleet-cockpit-snapshot.json");
const outputDir = process.env.TERMFLEET_PANE_CAPTURE_DIR || path.join(process.cwd(), ".captures", "terminal-panes");
const intervalMs = Number(process.env.TERMFLEET_PANE_CAPTURE_INTERVAL_MS || 3_600_000);
const retainSuccesses = Number(process.env.TERMFLEET_PANE_CAPTURE_RETAIN || 3);
const requireHeaders = process.env.TERMFLEET_PANE_CAPTURE_REQUIRE_HEADERS !== "0";
const expectedPaneCount = Number(process.env.TERMFLEET_PANE_CAPTURE_EXPECTED_COUNT || 0);
const maxAgeMs = 24 * 60 * 60 * 1000;
const nativeCaptureMaxAgeMs = 2 * 60 * 60 * 1000;
const once = process.argv.includes("--once");

mkdirSync(outputDir, { recursive: true, mode: 0o700 });

const sessionDisplay = process.env.TERMFLEET_DISPLAY || process.env.DISPLAY || ":0";
const sessionXauthority = process.env.XAUTHORITY || (() => {
  const dir = `/run/user/${process.getuid?.() ?? ""}`;
  try {
    const candidate = readdirSync(dir).find((name) => name.startsWith("xauth_"));
    return candidate ? path.join(dir, candidate) : undefined;
  } catch {
    return undefined;
  }
})();
const commandEnv = {
  ...process.env,
  DISPLAY: sessionDisplay,
  ...(sessionXauthority ? { XAUTHORITY: sessionXauthority } : {}),
};

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env: commandEnv });
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr || ""} ${result.stdout || ""}`.replace(/\s+/g, " ").trim();
    throw new Error(`${command} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function windowId() {
  const windowList = spawnSync("wmctrl", ["-l"], { encoding: "utf8", env: commandEnv });
  const windows = windowList.status === 0
    ? windowList.stdout.split("\n").filter((line) => /TermFleet/i.test(line))
    : [];
  const activeResult = spawnSync("xdotool", ["getactivewindow"], { encoding: "utf8", env: commandEnv });
  const active = activeResult.status === 0 ? activeResult.stdout.trim() : "";
  if (active) {
    const activeHex = `0x${BigInt(active).toString(16).padStart(8, "0")}`;
    const activeLine = windows.find((line) => line.startsWith(activeHex));
    if (activeLine) return active;
  }
  const search = spawnSync("xdotool", ["search", "--onlyvisible", "--name", "^TermFleet$"], { encoding: "utf8", env: commandEnv });
  const searched = search.status === 0 ? search.stdout.split(/\s+/).filter(Boolean) : [];
  if (searched.length) return searched[0];
  const candidate = windows[windows.length - 1]?.split(/\s+/)[0];
  if (!candidate) throw new Error("no visible TermFleet window");
  return candidate;
}

function clean(value) { return String(value ?? "").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 100) || "unknown"; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function readSnapshot() { return JSON.parse(readFileSync(snapshotPath, "utf8")); }

function readCompleteSnapshot() {
  let latest;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    latest = readSnapshot();
    const panes = Array.isArray(latest.terminals) ? latest.terminals : [];
    const captures = latest.nativeCaptures && typeof latest.nativeCaptures === "object"
      ? latest.nativeCaptures
      : {};
    if (panes.length > 0 && panes.every((pane) => captures[pane.paneId])) return latest;
    if (attempt < 7) spawnSync("sleep", ["0.25"], { env: commandEnv });
  }
  throw new Error("TermFleet has not published a complete per-pane WebKit capture registry");
}

function prune() {
  const now = Date.now();
  const files = readdirSync(outputDir).filter((name) => (name.startsWith("termfleet-pane-") || name.startsWith("termfleet-window-")) && name.endsWith(".png"));
  const byPane = new Map();
  for (const name of files) {
    const full = path.join(outputDir, name);
    const age = now - statSync(full).mtimeMs;
    if (age > maxAgeMs) { unlinkSync(full); continue; }
    const pane = name.startsWith("termfleet-window-") ? "window" : name.split("-")[2] || "unknown";
    if (!byPane.has(pane)) byPane.set(pane, []);
    byPane.get(pane).push({ full, failure: name.includes("-FAIL-") });
  }
  for (const captures of byPane.values()) {
    const successes = captures.filter((capture) => !capture.failure).sort((a, b) => statSync(b.full).mtimeMs - statSync(a.full).mtimeMs);
    for (const capture of successes.slice(retainSuccesses)) unlinkSync(capture.full);
  }
  // Only delete the app's own native evidence files, never other status data.
  for (const name of readdirSync(statusDir)) {
    if (!name.startsWith("termfleet-pane-native-") || !name.endsWith(".png")) continue;
    const full = path.join(statusDir, name);
    if (now - statSync(full).mtimeMs > maxAgeMs) unlinkSync(full);
  }
}

function ocr(image) {
  const result = spawnSync("tesseract", [image, "stdout"], { encoding: "utf8", env: commandEnv });
  if (result.status !== 0) throw new Error(`OCR failed for ${image}`);
  return result.stdout.replace(/\s+/g, " ").trim();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function capture() {
  prune();
  const snapshot = readCompleteSnapshot();
  if (snapshot.sourceApp !== "termfleet") throw new Error("snapshot belongs to another application");
  const panes = (Array.isArray(snapshot.terminals) ? snapshot.terminals : [])
    .filter((pane) => {
      const rect = pane?.nativeCapture?.screenRect || pane?.screenRect;
      if (!pane?.paneId || rect?.width <= 0 || rect?.height <= 0) return false;
      // Map snapshots contain mounted panes outside the current viewport; only
      // panes intersecting the captured surface are visible acceptance targets.
      return rect.x + rect.width > 0 && rect.y + rect.height > 0;
    });
  if (!panes.length) throw new Error("no visible pane rectangles in the TermFleet snapshot");
  if (expectedPaneCount > 0 && panes.length !== expectedPaneCount) {
    throw new Error(`expected ${expectedPaneCount} mounted panes, found ${panes.length}`);
  }
  const capturedAt = new Date().toISOString();
  const manifest = { schemaVersion: 2, source: "raw-live-termfleet-webkit", capturedAt, panes: [] };
  for (const pane of panes) {
    const native = pane.nativeCapture || snapshot.nativeCaptures?.[pane.paneId];
    if (!native?.path || !existsSync(native.path)) {
      throw new Error(`pane ${pane.paneId} has no app-owned WebKit capture`);
    }
    const age = Date.now() - Number(native.capturedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > nativeCaptureMaxAgeMs) {
      throw new Error(`pane ${pane.paneId} WebKit capture is stale`);
    }
    if (!path.basename(native.path).startsWith("termfleet-pane-native-") || !native.path.endsWith(".png")) {
      throw new Error(`pane ${pane.paneId} capture is not TermFleet-owned`);
    }
    const full = native.path;
    const rect = native.screenRect;
    const size = run("identify", ["-format", "%wx%h", full]);
    const [imageWidth, imageHeight] = size.split("x").map(Number);
    const scale = Number(rect.devicePixelRatio) || 1;
    const x = Math.round(rect.x * scale);
    const y = Math.round(rect.y * scale);
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    if (x < 0 || y < 0 || x + width > imageWidth || y + height > imageHeight) {
      const entirelyOffscreen = x + width <= 0 || y + height <= 0 || x >= imageWidth || y >= imageHeight;
      if (entirelyOffscreen) continue;
      throw new Error(`pane ${pane.paneId} is not fully visible in the captured TermFleet window`);
    }
    const paneId = clean(pane.paneId);
    const pending = path.join(outputDir, `termfleet-pane-${paneId}-PENDING-${stamp()}.png`);
    const image = path.join(outputDir, `termfleet-pane-${paneId}-OK-${stamp()}.png`);
    try {
      const result = spawnSync("magick", [full, "-crop", `${width}x${height}+${x}+${y}`, "+repage", pending], { encoding: "utf8", env: commandEnv });
      if (result.status !== 0 || !existsSync(pending)) throw new Error(`capture failed for pane ${pane.paneId}`);
      const colors = Number(run("identify", ["-format", "%k", pending]));
      if (!Number.isFinite(colors) || colors <= 1) throw new Error(`blank capture for pane ${pane.paneId}`);
      const visibleText = ocr(pending);
      const missingRows = requireHeaders
        ? ["Task:", "Goal:", "Now:"].filter((label) => !new RegExp(label.slice(0, -1), "i").test(visibleText))
        : [];
      if (missingRows.length) throw new Error(`pane ${pane.paneId} does not visibly prove ${missingRows.join(", ")}`);
      renameSync(pending, image);
       manifest.panes.push({ paneId: pane.paneId, image, sha256: sha256(image), source: "raw-live-termfleet-webkit", rect: { x, y, width, height }, colors, visibleText, metadata: { task: pane.task || "", goal: pane.context || "" } });
    } catch (error) {
      if (existsSync(pending)) renameSync(pending, pending.replace("-PENDING-", "-FAIL-"));
      throw error;
    }
  }
  if (!manifest.panes.length) throw new Error("no visible pane rectangles in the captured TermFleet window");
  writeFileSync(path.join(outputDir, `manifest-${stamp()}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  prune();
  console.log(`TERMFLEET_PANE_SCREEN_OK panes=${manifest.panes.length} intervalMs=${intervalMs} output=${outputDir}`);
}

async function main() {
  do {
    try {
      capture();
      const receipt = path.join(outputDir, "latest-failure.json");
      if (existsSync(receipt)) unlinkSync(receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeFileSync(
        path.join(outputDir, "latest-failure.json"),
        `${JSON.stringify({ schemaVersion: 1, source: "termfleet-pane-screen-monitor", failedAt: new Date().toISOString(), reason: message }, null, 2)}\n`,
        { mode: 0o600 },
      );
      console.error(`TERMFLEET_PANE_SCREEN_FAIL ${message}`);
      if (once) process.exitCode = 1;
    }
    if (!once) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (!once);
}

await main();
