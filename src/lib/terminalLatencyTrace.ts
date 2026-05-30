import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

const TRACE_EVENT = "terminal-workspace-latency-trace";
const LOCAL_STORAGE_KEY = "terminal-workspace.traceLatency";

let envChecked = false;
let enabled =
  typeof window !== "undefined" &&
  window.localStorage?.getItem(LOCAL_STORAGE_KEY) === "1";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function syncTerminalLatencyTraceEnv() {
  if (envChecked || !isTauriRuntime()) return enabled;
  envChecked = true;
  try {
    enabled = enabled || await invoke<boolean>("terminal_latency_trace_enabled");
  } catch {
    // Tracing is optional; missing command support should never affect terminal I/O.
  }
  return enabled;
}

export function isTerminalLatencyTraceEnabled() {
  return enabled;
}

export function traceTerminalLatency(label: string, details: Record<string, unknown> = {}) {
  if (!enabled || typeof window === "undefined") return;

  const safeDetails = { ...details };
  if (typeof safeDetails.data === "string") {
    safeDetails.dataLength = safeDetails.data.length;
    safeDetails.dataPreview = safeDetails.data.slice(0, 80);
    delete safeDetails.data;
  }

  const event = {
    label,
    epochMs: Date.now(),
    performanceMs: performance.now(),
    ...safeDetails,
  };

  const debugWindow = window as typeof window & {
    __terminalWorkspaceLatencyTrace?: Array<Record<string, unknown>>;
  };
  debugWindow.__terminalWorkspaceLatencyTrace ??= [];
  debugWindow.__terminalWorkspaceLatencyTrace.push(event);

  if (isTauriRuntime()) {
    emit(TRACE_EVENT, event).catch(() => {
      // Trace delivery must not become part of the terminal hot-path failure mode.
    });
  }
}

export { TRACE_EVENT as TERMINAL_LATENCY_TRACE_EVENT };
