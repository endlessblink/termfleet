// Storage write governor (TF-015 follow-up, 2026-09-29).
//
// WebKit keeps localStorage in a SQLite database with a write-ahead log. The
// cockpit was rewriting ~1 MB of quest progress every second and ~0.5 MB of
// workspace state on every status change — about 0.5 MB/s, 40 GB/day. The log
// and its index grew to ~80 MB, WebKit's storage process then read ~700 MB/s at
// startup, and the window never left the splash screen.
//
// Every localStorage write in the app goes through this one gate:
// - an unchanged value is never written again;
// - each key is written at most once per interval, and the interval grows with
//   the value's size (a per-key byte budget), so a large record cannot flood
//   the disk no matter how often a component saves it;
// - the first write after a quiet period goes through immediately, so storage
//   errors (e.g. quota) still surface synchronously to the caller;
// - reads return the newest pending value (read-your-writes);
// - pending values are written when the page is hidden or unloaded, and on
//   flushStorageWrites().
// Keys that exceed their budget are reported (names and sizes only).

const MIN_INTERVAL_MS = 2_000;
// Per-key sustained write budget. WebKit holds a read snapshot on this database
// for the whole session, so its write log can only be folded back at the next
// launch: every byte written while running stays on disk until then. 1 KB/s per
// key keeps a multi-day session in the low hundreds of MB; a 0.5 MB record saves
// every ~8 minutes, and every pending value is still written on close.
const BYTES_PER_SECOND_BUDGET = 1_000;
const MAX_INTERVAL_MS = 15 * 60_000;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type GovernorReport = { key: string; bytes: number; coalesced: number };

type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

let storageFullHandler: (() => void) | null = null;

/** Register a way to free space when a deferred write finds storage full. */
export function setStorageFullHandler(handler: (() => void) | null) {
  storageFullHandler = handler;
}

export function writeIntervalMs(bytes: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round((bytes / BYTES_PER_SECOND_BUDGET) * 1000)));
}

/**
 * Wrap raw storage operations with the write policy above. `raw` performs the
 * real write; `now` and `timer` are injectable for tests.
 */
export function createStorageGovernor(options: {
  raw: StorageLike;
  now?: () => number;
  timer?: Timer;
  report?: (event: GovernorReport) => void;
}) {
  const raw = options.raw;
  const now = options.now ?? (() => Date.now());
  const timer: Timer = options.timer ?? {
    set: (fn, ms) => globalThis.setTimeout(fn, ms),
    clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const lastWritten = new Map<string, { value: string; at: number }>();
  const pending = new Map<string, string>();
  const timers = new Map<string, unknown>();
  const coalesced = new Map<string, number>();

  function writeNow(key: string, value: string) {
    raw.setItem(key, value);
    lastWritten.set(key, { value, at: now() });
    pending.delete(key);
    const skipped = coalesced.get(key) ?? 0;
    coalesced.delete(key);
    if (skipped > 0) options.report?.({ key, bytes: value.length, coalesced: skipped });
  }

  function flushKey(key: string) {
    const handle = timers.get(key);
    if (handle !== undefined) timer.clear(handle);
    timers.delete(key);
    const value = pending.get(key);
    if (value === undefined) return;
    try {
      writeNow(key, value);
    } catch (error) {
      // A deferred write has no caller left to handle a full store, so give the
      // registered handler (e.g. retired quest profiles) one chance to free
      // space, then retry once.
      let retried = false;
      if (storageFullHandler) {
        try {
          storageFullHandler();
          writeNow(key, value);
          retried = true;
        } catch {
          // fall through to the warning below
        }
      }
      if (!retried) {
        pending.delete(key);
        console.warn(`[termfleet] deferred storage write failed for ${key}`, error);
      }
    }
  }

  function setItem(key: string, value: string) {
    const previous = lastWritten.get(key);
    if (!pending.has(key) && previous?.value === value) return;
    if (pending.get(key) === value) return;
    const due = previous ? previous.at + writeIntervalMs(value.length) : 0;
    if (!pending.has(key) && now() >= due) {
      writeNow(key, value); // may throw: callers keep synchronous error handling
      return;
    }
    pending.set(key, value);
    coalesced.set(key, (coalesced.get(key) ?? 0) + 1);
    if (!timers.has(key)) {
      timers.set(key, timer.set(() => flushKey(key), Math.max(0, due - now())));
    }
  }

  function getItem(key: string): string | null {
    const value = pending.get(key);
    return value !== undefined ? value : raw.getItem(key);
  }

  function removeItem(key: string) {
    const handle = timers.get(key);
    if (handle !== undefined) timer.clear(handle);
    timers.delete(key);
    pending.delete(key);
    lastWritten.delete(key);
    raw.removeItem(key);
  }

  function flushAll() {
    for (const key of [...pending.keys()]) flushKey(key);
  }

  /** Forget everything pending (the backing store is being cleared). */
  function reset() {
    for (const handle of timers.values()) timer.clear(handle);
    timers.clear();
    pending.clear();
    lastWritten.clear();
    coalesced.clear();
  }

  return { setItem, getItem, removeItem, flushAll, reset, pendingCount: () => pending.size };
}

let flushInstalled: (() => void) | null = null;

/** Write every pending value now (e.g. before an intentional app exit). */
export function flushStorageWrites() {
  flushInstalled?.();
}

/**
 * Route window.localStorage through the governor. Desktop (Tauri) only — the
 * SQLite write-log problem is WebKitGTK's; the browser preview keeps plain
 * storage. Idempotent; never throws.
 */
export function installStorageGovernor(report?: (event: GovernorReport) => void) {
  try {
    if (flushInstalled || typeof window === "undefined" || typeof Storage === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const local = window.localStorage;
    const proto = Storage.prototype;
    const nativeSet = proto.setItem;
    const nativeGet = proto.getItem;
    const nativeRemove = proto.removeItem;
    const governor = createStorageGovernor({
      raw: {
        setItem: (key, value) => nativeSet.call(local, key, value),
        getItem: (key) => nativeGet.call(local, key),
        removeItem: (key) => nativeRemove.call(local, key),
      },
      report,
    });
    proto.setItem = function (this: Storage, key: string, value: string) {
      if (this !== local) return nativeSet.call(this, key, value);
      governor.setItem(String(key), String(value));
    };
    proto.getItem = function (this: Storage, key: string) {
      if (this !== local) return nativeGet.call(this, key);
      return governor.getItem(String(key));
    };
    proto.removeItem = function (this: Storage, key: string) {
      if (this !== local) return nativeRemove.call(this, key);
      governor.removeItem(String(key));
    };
    const nativeClear = proto.clear;
    proto.clear = function (this: Storage) {
      if (this === local) governor.reset();
      return nativeClear.call(this);
    };
    flushInstalled = governor.flushAll;
    const flush = () => governor.flushAll();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  } catch {
    // Storage policy must never stop the cockpit from starting.
  }
}
