// Dev-only cockpit-state capture (TC-035 observability). Each terminal header renders a
// `<CockpitSnapshotProbe>` that reports the RENDERED title + the raw inputs that produced it.
// We debounce-POST the whole map to the status server's `/cockpit-snapshot` route, which
// writes it to a file an operator/agent can read, so we can compare "what's shown" against
// "what each terminal is really working on", for all terminals at once, without screenshots.
//
// Gated off unless dev mode or VITE_COCKPIT_SNAPSHOT is set; never active in release.

export interface CockpitSnapshotEntry {
  paneId: string;
  tabId?: string;
  cwd?: string;
  kind: "agent" | "shell";
  // The exact title/now strings the header is displaying right now.
  title: string;
  now: string;
  status?: string;
  // Raw source inputs. The reader classifies titleSource from these.
  tasksFromTodoWrite?: boolean;
  narration?: string;
  durableActivityTitle?: string;
  taskLineup: Array<{ content: string; status: string }>;
  updatedAt: number;
}

function snapshotEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return Boolean(env?.DEV) || env?.VITE_COCKPIT_SNAPSHOT === "1";
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
  if (!snapshotEnabled() || flushTimer) return;
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
  if (!snapshotEnabled() || !paneId) return;
  entries.set(paneId, entry);
  scheduleFlush();
}
