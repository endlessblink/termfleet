// Dev-only cockpit-state capture (TC-035 observability). Each terminal header renders a
// `<CockpitSnapshotProbe>` that reports the RENDERED title + the raw inputs that produced it.
// We debounce-POST the whole map to the status server's `/cockpit-snapshot` route, which
// writes it to a file an operator/agent can read, so we can compare "what's shown" against
// "what each terminal is really working on", for all terminals at once, without screenshots.
//
// Gated off unless VITE_COCKPIT_SNAPSHOT is set. Keep this opt-in even in dev:
// a busy map can render many terminal headers, and continuous snapshot POSTs make
// WebKit do work that is only useful during cockpit/header verification.

export interface CockpitSnapshotEntry {
  paneId: string;
  terminalId?: string;
  tabId?: string;
  cwd?: string;
  path?: string;
  workspace?: string;
  previewTitle?: string;
  kind: "agent" | "shell";
  // The exact title/now strings the header is displaying right now.
  task?: string;
  taskSource?: string;
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
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_COCKPIT_SNAPSHOT === "1";
}

function snapshotEndpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim() || "http://127.0.0.1:37819/status";
  // Derive the sibling /cockpit-snapshot route from the configured /status base.
  return base.replace(/\/status\/?$/, "") + "/cockpit-snapshot";
}

const entries = new Map<string, CockpitSnapshotEntry>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (!cockpitSnapshotEnabled() || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const payload = JSON.stringify({
      updatedAt: Date.now(),
      terminals: Array.from(entries.values()),
    });
    // Fire-and-forget; never let a debug write affect the UI.
    void fetch(snapshotEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }).catch(() => {});
  }, 500);
}

/** Record one pane's rendered state and schedule a debounced flush. No-op unless enabled. */
export function recordCockpitPane(paneId: string, entry: CockpitSnapshotEntry): void {
  if (!cockpitSnapshotEnabled() || !paneId) return;
  entries.set(paneId, entry);
  scheduleFlush();
}
