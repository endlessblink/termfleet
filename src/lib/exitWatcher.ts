// Shared terminal exit-event poller.
//
// Each canvas terminal needs to learn when its daemon PTY ends (eof/killed/
// read-error) so it can report an exit. Previously every TerminalCanvas ran its
// own `setInterval(500ms)` calling `daemon_list_session_events` — which returns
// ALL events and is scanned per terminal. With many live map terminals that is
// O(N) RPC calls per tick and an O(N·events) scan, i.e. O(N²) total work.
//
// This module collapses that to ONE interval for the whole process: a single
// `daemon_list_session_events` call per tick, scanned once into a map, then
// fanned out to per-session callbacks. Each session is reported at most once.

import { invoke } from "@tauri-apps/api/core";

const POLL_INTERVAL_MS = 500;

export interface TerminalExit {
  id: string;
  code: number;
  success: boolean;
}

interface SessionEvent {
  id: string;
  kind: string;
  exit_status?: { code?: number | null; success?: boolean } | null;
}

type ExitCallback = (exit: TerminalExit) => void;

const callbacks = new Map<string, ExitCallback>();
// Sessions already reported (or whose registrant unregistered) — never fire twice.
const reported = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function isExitKind(kind: string): boolean {
  return kind === "eof" || kind === "killed" || kind === "read-error";
}

async function poll(): Promise<void> {
  if (polling) return; // skip if the previous RPC is still in flight
  if (callbacks.size === 0) return;
  polling = true;
  try {
    const events = await invoke<SessionEvent[]>("daemon_list_session_events");
    // Latest event per session wins; we only care about registered, unreported ones.
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (reported.has(event.id)) continue;
      const cb = callbacks.get(event.id);
      if (!cb || !isExitKind(event.kind)) continue;
      reported.add(event.id);
      const code = event.exit_status?.code ?? (event.kind === "read-error" ? 1 : 0);
      const success = event.exit_status?.success ?? event.kind !== "read-error";
      cb({ id: event.id, code, success });
    }
  } catch {
    // Transport hiccup — try again next tick. Never surfaced to the buffer.
  } finally {
    polling = false;
  }
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}

function stopTimerIfIdle(): void {
  if (timer !== null && callbacks.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Watch `sessionId` for its terminating event. `cb` fires at most once, the
 * first time an eof/killed/read-error event for that session is observed.
 * Re-registering a session id replaces the callback and re-arms it (a fresh
 * mount after a previous one exited can observe a new exit).
 */
export function register(sessionId: string, cb: ExitCallback): void {
  reported.delete(sessionId);
  callbacks.set(sessionId, cb);
  ensureTimer();
}

/** Stop watching `sessionId`. Idempotent. */
export function unregister(sessionId: string): void {
  callbacks.delete(sessionId);
  reported.delete(sessionId);
  stopTimerIfIdle();
}
