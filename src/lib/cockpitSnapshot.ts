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
  statusSummarySource?: string;
  statusSummaryError?: string;
  statusSummaryUpdatedAt?: number;
  statusSummaryNarration?: string;
  statusSummaryTask?: string;
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
  return base.replace(/\/status\/?$/, "") + "/cockpit-snapshot";
}

const entries = new Map<string, CockpitSnapshotEntry>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
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
      updatedAt: now,
      terminals: Array.from(entries.values()),
    });
    // Fire-and-forget; never let a debug write affect the UI.
    // The Tauri path is authoritative for installed builds; the HTTP path remains
    // useful for dev diagnostics and remote test harnesses.
    const installedRuntime =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (installedRuntime) {
      // Never let a stale browser preview or helper server overwrite the installed
      // cockpit's rendered snapshot. The Tauri command is the single writer there.
      void invoke("cockpit_snapshot_write", { contents: payload }).catch(() => {});
    } else {
      void fetch(snapshotEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }).catch(() => {});
    }
  }, COCKPIT_SNAPSHOT_FLUSH_DELAY_MS);
}

/** Record one pane's rendered state and schedule a debounced flush. No-op unless enabled. */
export function recordCockpitPane(paneId: string, entry: CockpitSnapshotEntry): void {
  if (!cockpitSnapshotEnabled() || !paneId) return;
  entries.set(paneId, entry);
  scheduleFlush();
}

/** Remove an unmounted pane immediately so snapshots never depend on TTL expiry. */
export function removeCockpitPane(paneId: string): void {
  if (!cockpitSnapshotEnabled() || !paneId || !entries.delete(paneId)) return;
  scheduleFlush();
}
