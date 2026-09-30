import { invoke } from "@tauri-apps/api/core";

const SAMPLE_INTERVAL_MS = 1000;
const STALL_THRESHOLD_MS = 250;
const MIN_RECORD_INTERVAL_MS = 1000;
const MAX_RECORDS = 120;

export type RendererStall = {
  source: "timer-gap" | "long-task";
  durationMs: number;
  observedAtMs: number;
};

type Clock = () => number;

/** Small, bounded recorder with an injectable clock for deterministic tests. */
export function createRendererStallRecorder(
  write: (stall: RendererStall) => void,
  now: Clock = () => performance.now(),
) {
  let lastRecordAt = Number.NEGATIVE_INFINITY;
  let recordCount = 0;

  return (source: RendererStall["source"], durationMs: number): boolean => {
    const observedAtMs = now();
    if (
      durationMs < STALL_THRESHOLD_MS ||
      recordCount >= MAX_RECORDS ||
      observedAtMs - lastRecordAt < MIN_RECORD_INTERVAL_MS
    ) {
      return false;
    }

    lastRecordAt = observedAtMs;
    recordCount += 1;
    write({ source, durationMs: Math.round(durationMs), observedAtMs: Math.round(observedAtMs) });
    return true;
  };
}

/**
 * Record renderer event-loop stalls without collecting terminal text, commands,
 * URLs, or input. The existing native logger keeps a bounded JSONL ring.
 */
export function installRendererStallTelemetry() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

  const record = createRendererStallRecorder((stall) => {
    try {
      void invoke("terminal_geometry_log", {
        line: JSON.stringify({ t: Date.now(), kind: "renderer-stall", ...stall }),
      }).catch(() => {
        // Diagnostics must never interfere with rendering or terminal I/O.
      });
    } catch {
      // Ignore synchronous bridge failures too.
    }
  });

  let expectedAt = performance.now() + SAMPLE_INTERVAL_MS;
  const timer = window.setInterval(() => {
    const now = performance.now();
    const driftMs = now - expectedAt;
    expectedAt = now + SAMPLE_INTERVAL_MS;
    if (document.visibilityState === "visible") record("timer-gap", driftMs);
  }, SAMPLE_INTERVAL_MS);

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of list.getEntries()) record("long-task", entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
      window.addEventListener("pagehide", () => {
        window.clearInterval(timer);
        observer.disconnect();
      }, { once: true });
    } catch {
      // Long-task timing is not supported by every WebKit build; timer sampling remains.
    }
  }
}
