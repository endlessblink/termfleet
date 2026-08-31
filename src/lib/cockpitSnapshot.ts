// Local cockpit-state capture (TC-035 observability). Each terminal header renders a
// `<CockpitSnapshotProbe>` that reports the RENDERED title + the raw inputs that produced it.
// We debounce-POST the whole map to the status server's `/cockpit-snapshot` route, which
// writes it to a file an operator/agent can read, so we can compare "what's shown" against
// "what each terminal is really working on", for all terminals at once, without screenshots.
//
// Production keeps this observer enabled so installed verification can inspect the exact
// rendered identity. It posts to loopback and has a local Tauri fallback.

import { invoke } from "@tauri-apps/api/core";

export interface CockpitSnapshotEntry {
  paneId: string;
  terminalId?: string;
  tabId?: string;
  groupId?: string | null;
  cwd?: string;
  path?: string;
  workspace?: string;
  previewTitle?: string;
  projectEmoji?: string;
  kind: "agent" | "shell";
  // The exact title/now strings the header is displaying right now.
  task?: string;
  taskSource?: string;
  context?: string;
  contextSource?: string;
  // WHICH RUNG of the task-line ladder won, and what it turned down. Neither was ever
  // recorded anywhere, so "the row says No task declared" could not be told apart from
  // "the row's text was rejected" without re-deriving the whole ladder by hand.
  taskLineSource?: string;
  taskLineRejected?: string;
  title: string;
  titleSource?: string;
  now: string;
  nowSource?: string;
  status?: string;
  // Raw source inputs. The reader classifies titleSource from these.
  tasksFromTodoWrite?: boolean;
  narration?: string;
  durableActivityTitle?: string;
  currentActivity?: string;
  terminalOutput?: string;
  terminalVisibleText?: string;
  terminalVisibleTextUpdatedAt?: number;
  screenRect?: { x: number; y: number; width: number; height: number; devicePixelRatio: number };
  nativeCapture?: {
    path: string;
    capturedAt: number;
    screenRect: { x: number; y: number; width: number; height: number; devicePixelRatio: number };
  };
  statusSummarySource?: string;
  statusSummaryError?: string;
  statusSummaryUpdatedAt?: number;
  statusSummaryNarration?: string;
  statusSummaryTask?: string;
  statusSummaryGoal?: string;
  statusSummaryGoalSource?: string;
  statusSummaryNow?: string;
  statusSummaryPath?: string;
  taskLineup: Array<{ content: string; status: string }>;
  debug?: Record<string, string | number | boolean | undefined>;
  updatedAt: number;
}

export function cockpitSnapshotEnabled(): boolean {
  // This observer is local-only and intentionally deterministic across dev, installed,
  // and dock-relaunched builds; a missing status server is handled by the existing
  // fire-and-forget error path and never affects terminal rendering.
  return true;
}

function snapshotEndpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim() || "http://127.0.0.1:37819/status";
  // Derive the sibling /cockpit-snapshot route from the configured /status base.
  return base.replace(/\/status\/?$/, "") + "/cockpit-snapshot?app=termfleet";
}

const entries = new Map<string, CockpitSnapshotEntry>();
const nativeCaptures = new Map<string, NonNullable<CockpitSnapshotEntry["nativeCapture"]>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let nativeCapturePromise: Promise<unknown> = Promise.resolve();
export const COCKPIT_SNAPSHOT_HEARTBEAT_MS = 10_000;
export const COCKPIT_SNAPSHOT_FLUSH_DELAY_MS = 500;
const COCKPIT_SNAPSHOT_ENTRY_TTL_MS = 30_000;

function scheduleFlush() {
  if (!cockpitSnapshotEnabled() || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const now = Date.now();
    for (const [paneId, entry] of entries) {
      if (now - entry.updatedAt > COCKPIT_SNAPSHOT_ENTRY_TTL_MS) entries.delete(paneId);
    }
    const payload = JSON.stringify({
      sourceApp: "termfleet",
      updatedAt: now,
      terminals: Array.from(entries.values()),
      nativeCaptures: Object.fromEntries(nativeCaptures),
    });
    // Fire-and-forget; never let a debug write affect the UI.
    // The Tauri path is authoritative for installed builds; the HTTP path remains
    // useful for dev diagnostics and remote test harnesses.
    // Try the Tauri writer first even when the WebView does not expose its global
    // marker yet; an installed dock must never lose its rendered snapshot because
    // environment detection raced startup. Browser previews fall back to the
    // loopback status endpoint when the command is unavailable.
    void invoke("cockpit_snapshot_write", { contents: payload }).catch(() =>
      fetch(snapshotEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }).catch(() => {}),
    );
  }, COCKPIT_SNAPSHOT_FLUSH_DELAY_MS);
}

/** Capture a pane after the map has made that pane visible. */
export function captureNativePane(paneId: string): Promise<string> {
  nativeCapturePromise = nativeCapturePromise
    .catch(() => undefined)
    .then(() => invoke<string>("capture_webview_snapshot", { paneId, fullDocument: false }));
  return nativeCapturePromise as Promise<string>;
}

export function recordNativeCapture(
  paneId: string,
  capture: CockpitSnapshotEntry["nativeCapture"],
): void {
  if (!capture) return;
  nativeCaptures.set(paneId, capture);
  const entry = entries.get(paneId);
  if (entry) entries.set(paneId, { ...entry, nativeCapture: capture });
  scheduleFlush();
}

/** Record one pane's rendered state and schedule a debounced flush. No-op unless enabled. */
export function recordCockpitPane(paneId: string, entry: CockpitSnapshotEntry): void {
  if (!cockpitSnapshotEnabled() || !paneId) return;
  const capturedGoal = entry.context?.trim()
    ? entry.context.trim()
    : entry.statusSummaryGoalSource === "opening-request" &&
        entry.statusSummaryGoal &&
        entry.statusSummaryGoal.length <= 220 &&
        !/[…]$/.test(entry.statusSummaryGoal.trim())
      ? entry.statusSummaryGoal.trim()
      : "";
  const capturedGoalSource =
    entry.contextSource && entry.contextSource !== "missing"
      ? entry.contextSource
      : entry.statusSummaryGoalSource;
  const existingCapture = nativeCaptures.get(paneId);
  entries.set(paneId, capturedGoal
    ? { ...entry, context: capturedGoal, contextSource: capturedGoalSource, nativeCapture: existingCapture }
    : { ...entry, nativeCapture: existingCapture });
  scheduleFlush();
}

/** Remove an unmounted pane immediately so snapshots never depend on TTL expiry. */
export function removeCockpitPane(paneId: string): void {
  if (!cockpitSnapshotEnabled() || !paneId || !entries.delete(paneId)) return;
  scheduleFlush();
}

/** Copy the latest rendered details for every pane for human/runtime handoff. */
export async function copyCockpitPaneDetails(): Promise<number> {
  const text = Array.from(entries.values()).map((entry) => [
    `Pane: ${entry.paneId}`,
    `Workspace: ${entry.workspace ?? ""}`,
    `Path: ${entry.path ?? entry.cwd ?? ""}`,
    `Task: ${entry.task ?? ""}`,
    `Goal: ${entry.context ?? ""}`,
    `Now: ${entry.now ?? ""}`,
    `Status: ${entry.status ?? ""}`,
    `Task source: ${entry.taskSource ?? ""}`,
    `Goal source: ${entry.contextSource ?? ""}`,
    `Now source: ${entry.nowSource ?? ""}`,
    `Terminal screen:\n${entry.terminalVisibleText ?? entry.terminalOutput ?? ""}`,
  ].join("\n")).join("\n\n---\n\n");
  if (!text) throw new Error("No rendered pane details are available");
  await navigator.clipboard.writeText(text);
  return entries.size;
}
