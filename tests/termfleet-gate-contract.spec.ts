import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const gate = readFileSync(join(process.cwd(), "scripts/termfleet-gate.mjs"), "utf8");

test("completion gate validates the rendered Goal field separately from Task", () => {
  expect(gate).toContain('const goal = String(t.context ?? "").trim();');
  expect(gate).toContain('problems.push("no goal on the Goal row")');
  expect(gate).toContain("generic result goal");
  expect(gate).toContain("raw prompt goal");
});

test("screen monitor rejects snapshots written by another application", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  expect(monitor).toContain('snapshot.sourceApp !== "termfleet"');
  expect(monitor).toContain("snapshot belongs to another application");
});

test("TermFleet uses an application-specific snapshot by default", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  const gate = readFileSync(join(process.cwd(), "scripts/termfleet-gate.mjs"), "utf8");
  const live = readFileSync(join(process.cwd(), "scripts/verify-cockpit-live.mjs"), "utf8");
  const taskMonitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-tasks.mjs"), "utf8");
  const doctor = readFileSync(join(process.cwd(), "scripts/termfleet-doctor.mjs"), "utf8");
  expect(monitor).toContain('termfleet-cockpit-snapshot.json');
  expect(gate).toContain('termfleet-cockpit-snapshot.json');
  expect(live).toContain('termfleet-cockpit-snapshot.json');
  expect(live).toContain('fail([...new Set(allFailures)], previousRows)');
  expect(taskMonitor).toContain('termfleet-cockpit-snapshot.json');
  expect(doctor).toContain('termfleet-cockpit-snapshot.json');
});

test("restart smoke passes its isolated snapshot path to the screen monitor", () => {
  const smoke = readFileSync(join(process.cwd(), "scripts/verify-installed-restart-smoke.sh"), "utf8");
  expect(smoke).toContain('TERMFLEET_COCKPIT_SNAPSHOT_PATH="$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json"');
  expect(smoke).toContain('TERMFLEET_PANE_CAPTURE_EXPECTED_COUNT=4');
  expect(smoke).toContain('node "$APP_ROOT/scripts/monitor-cockpit-pane-health.mjs" --once');
  expect(smoke).toContain("Installed restart health gate failed");
  expect(smoke).toContain('"$data_dir/terminal-workspace/agent-status/termfleet-pane-health.json"');
  expect(smoke).toContain('split("installed-restart-root", "vertical"');
});

test("screen monitor refuses to crop panes outside the captured window", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  expect(monitor).toContain("is not fully visible in the captured TermFleet window");
  expect(monitor).toContain("x < 0 || y < 0");
});

test("screen monitor can require a mounted pane count for split-layout smoke", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  expect(monitor).toContain('TERMFLEET_PANE_CAPTURE_EXPECTED_COUNT');
  expect(monitor).toContain("expectedPaneCount > 0");
  expect(monitor).toContain("mounted panes, found");
});

test("desktop launcher does not accept an invisible UI process as healthy", () => {
  const launcher = readFileSync(join(process.cwd(), "scripts/termfleet-desktop-launcher.sh"), "utf8");
  expect(launcher).toContain("cockpit_window_visible()");
  expect(launcher).toContain("replacing stale invisible TermFleet desktop");
  expect(launcher).toContain("cockpit_running && cockpit_window_visible");
});

test("screen monitor leaves a durable receipt when no screenshot can be taken", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  expect(monitor).toContain('latest-failure.json');
  expect(monitor).toContain('source: "termfleet-pane-screen-monitor"');
  expect(monitor).toContain("failedAt");
});

test("screen monitor supplies a usable X11 session to capture tools", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  expect(monitor).toContain('process.env.TERMFLEET_DISPLAY || process.env.DISPLAY || ":0"');
  expect(monitor).toContain("XAUTHORITY");
  expect(monitor).toContain("env: commandEnv");
});

test("screen monitor prefers a fresh in-process WebKit surface", () => {
  const monitor = readFileSync(join(process.cwd(), "scripts/monitor-cockpit-pane-screens.mjs"), "utf8");
  const snapshot = readFileSync(join(process.cwd(), "src-tauri/src/webview_snapshot.rs"), "utf8");
  const commands = readFileSync(join(process.cwd(), "src-tauri/src/commands.rs"), "utf8");
  expect(monitor).toContain("nativeCapture");
  expect(monitor).toContain("no app-owned WebKit capture");
  expect(monitor).toContain("raw-live-termfleet-webkit");
  expect(monitor).toContain("capturedAt");
  expect(monitor).toContain("termfleet-pane-native-");
  expect(monitor).toContain("Only delete the app's own native evidence files");
  expect(snapshot).toContain("SnapshotRegion::Visible");
  expect(snapshot).toContain("snapshot timed out");
  expect(snapshot).toContain("termfleet-pane-native-");
  expect(snapshot).toContain("pane_id: String");
  expect(commands).not.toContain("capture_webview_snapshot(");
  expect(readFileSync(join(process.cwd(), "src/lib/cockpitSnapshot.ts"), "utf8")).toContain("nativeCapturePromise");
});

test("canvas capture never moves the operator viewport", () => {
  const canvas = readFileSync(join(process.cwd(), "src/components/MagicCanvas.tsx"), "utf8");
  expect(canvas).not.toContain("captureSweep");
  expect(canvas).not.toContain("nativeCaptureRunningRef");
  expect(canvas).not.toContain("Move the viewport to each pane");
});
