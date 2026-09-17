// Always-on terminal geometry + key-routing diagnostics.
//
// WHY: the recurring failures in this area were invisible from outside the app — a map
// card wider than its grid, a canvas whose backing store disagreed with its CSS box, a
// scroll key claimed where the grid held no scrollback. Every one of those was argued
// about from screenshots because nothing recorded the numbers. This writes them, live
// and cheaply, to a capped JSONL file the verifier reads (`verify:terminal-geometry`).
//
// Rules: best-effort only. Nothing here may throw, block, or affect terminal I/O.

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

const GEOMETRY_INTERVAL_MS = 1000;
const lastGeometryAt = new Map<string, number>();
// Second, already-proven transport: the latency tracer's event channel, which the Rust
// side appends to its trace file whenever TERMINAL_WORKSPACE_TRACE_LATENCY is set. The
// dedicated command is the always-on path; this one guarantees the data exists even if
// a release ever ships without the command, because the event path predates it.
const TRACE_EVENT = "terminal-workspace-latency-trace";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function write(label: string, entry: Record<string, unknown>) {
  if (!isTauriRuntime()) return;
  const payload = { t: Date.now(), ...entry };
  try {
    void invoke("terminal_geometry_log", { line: JSON.stringify(payload) }).catch(() => {
      // Diagnostics must never surface as terminal failures.
    });
  } catch {
    // ignore
  }
  try {
    void emit(TRACE_EVENT, { label, ...payload }).catch(() => {
      // ignore
    });
  } catch {
    // ignore
  }
}

export interface TerminalGeometrySample {
  id: string;
  map: boolean;
  cols: number;
  rows: number;
  displayOffset: number;
  hasHistory: boolean;
  altScreen: boolean;
  mouseReport: boolean;
  sgrMouse: boolean;
  alternateScroll: boolean;
  dpr: number;
  cellWidth: number;
  cellHeight: number;
  canvasDeviceWidth: number;
  canvasDeviceHeight: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
  shellWidth: number;
  shellHeight: number;
  overlayDeviceWidth: number;
  overlayDeviceHeight: number;
  /**
   * Canvas box in window coordinates, so a window capture can be scoped to this pane
   * and its ink judged against the box the renderer believes it owns.
   */
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  selected?: boolean;
}

/** Throttled (1/s per pane) geometry sample. */
export function recordTerminalGeometry(sample: TerminalGeometrySample) {
  const now = Date.now();
  const previous = lastGeometryAt.get(sample.id) ?? 0;
  if (now - previous < GEOMETRY_INTERVAL_MS) return;
  lastGeometryAt.set(sample.id, now);
  write("frontend.canvas.geometry", { kind: "geometry", ...sample });
}

export interface TerminalKeyRouteSample {
  id: string;
  key: string;
  map: boolean;
  /** What the navigation decision resolved to, or null when the key fell through. */
  action: string | null;
  hasHistory: boolean;
  altScreen: boolean;
  mouseReport: boolean;
}

/**
 * One line per navigation-key decision. This is what proves why a key did not scroll:
 * `action: "history"` with `hasHistory: false` is the swallowed-key signature, and
 * `action: null` means the key was handed to the application.
 */
export function recordTerminalKeyRoute(sample: TerminalKeyRouteSample) {
  write("frontend.canvas.keyroute", { kind: "key", ...sample });
}
