import { useSyncExternalStore } from "react";

/**
 * A shared ~5s clock that re-renders any component reading it. The badge reconciler
 * treats a "working" hook status that stopped updating as a finished turn (idle), but
 * that check only re-runs when the view redraws — without this, a finished pane stayed
 * "Running" until the user clicked it. One interval is shared across all subscribers.
 */
const TICK_MS = 5000;

let now = Date.now();
const listeners = new Set<() => void>();
let intervalId: number | undefined;

function ensureInterval() {
  if (intervalId === undefined && typeof window !== "undefined") {
    intervalId = window.setInterval(() => {
      now = Date.now();
      for (const listener of listeners) listener();
    }, TICK_MS);
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  ensureInterval();
  return () => {
    listeners.delete(callback);
  };
}

/** Returns a value that changes every ~5s, forcing the reading component to re-render. */
export function useStatusClock(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}
