import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { traceTerminalLatency } from "./terminalLatencyTrace";

export const DAEMON_INPUT_EVENT = "terminal-workspace-daemon-input";

const DAEMON_IMMEDIATE_INPUT_PATTERN = /[\r\n\u0003\u0004\u0015\u001b]/;

let terminalInputSequence = 0;

export function nextTerminalInputSequence() {
  terminalInputSequence += 1;
  return terminalInputSequence;
}

interface DaemonInputQueueOptions {
  getId: () => string | null;
  source: string;
  sendEvent?: (event: string, payload: { id: string; data: string; seqIds: number[] }) => Promise<void>;
  tracePty?: (label: string, details?: Record<string, unknown>) => void;
  onFallbackError?: (error: unknown) => void;
}

export interface DaemonInputQueue {
  queue: (data: string, seqId?: number) => void;
  flush: () => void;
  dispose: () => void;
}

export function createDaemonInputQueue({
  getId,
  source,
  sendEvent = emit,
  tracePty,
  onFallbackError,
}: DaemonInputQueueOptions): DaemonInputQueue {
  let pendingInput = "";
  let pendingSeqIds: number[] = [];
  let flushScheduled = false;
  let flushGeneration = 0;

  const clearScheduledFlush = () => {
    flushScheduled = false;
    flushGeneration += 1;
  };

  const flush = () => {
    clearScheduledFlush();
    const id = getId();
    if (!id || !pendingInput) return;

    const data = pendingInput;
    const seqIds = pendingSeqIds;
    pendingInput = "";
    pendingSeqIds = [];

    tracePty?.("frontend.daemon.write.emit.start", {
      id,
      bytes: data.length,
      seqIds,
      source,
      data,
    });
    traceTerminalLatency("frontend.daemon.input.send.start", {
      id,
      bytes: data.length,
      seqIds,
      source,
      data,
    });

    sendEvent(DAEMON_INPUT_EVENT, { id, data, seqIds })
      .catch((writeError) => {
        tracePty?.("frontend.daemon.write.emit.failed", {
          id,
          bytes: data.length,
          seqIds,
          source,
          error: String(writeError),
        });
        traceTerminalLatency("frontend.daemon.input.send.failed", {
          id,
          bytes: data.length,
          seqIds,
          source,
          error: String(writeError),
        });
        invoke("daemon_write_session", { id, data }).catch((fallbackError) => {
          onFallbackError?.(fallbackError);
        });
      })
      .finally(() => {
        tracePty?.("frontend.daemon.write.emit.end", {
          id,
          bytes: data.length,
          seqIds,
          source,
        });
        traceTerminalLatency("frontend.daemon.input.send.end", {
          id,
          bytes: data.length,
          seqIds,
          source,
        });
      });
  };

  const queue = (data: string, seqId = nextTerminalInputSequence()) => {
    pendingInput += data;
    pendingSeqIds.push(seqId);
    const shouldFlushImmediately = DAEMON_IMMEDIATE_INPUT_PATTERN.test(data);
    if (shouldFlushImmediately && flushScheduled) {
      clearScheduledFlush();
      flush();
      return;
    }
    if (shouldFlushImmediately) {
      flush();
      return;
    }
    if (flushScheduled) return;
    flushScheduled = true;
    const generation = ++flushGeneration;
    queueMicrotask(() => {
      if (!flushScheduled || generation !== flushGeneration) return;
      flush();
    });
  };

  return {
    queue,
    flush,
    dispose: () => {
      clearScheduledFlush();
      pendingInput = "";
      pendingSeqIds = [];
    },
  };
}
