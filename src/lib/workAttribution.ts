import { Channel, invoke } from "@tauri-apps/api/core";

// TF-015 diagnostic: the cockpit feels sluggish and the host blocks every
// profiler (perf_event_paranoid=4, no devtools in release builds). This ledger
// times every callback the renderer runs (timers, animation frames, DOM
// events, Tauri event callbacks, React's scheduler) and names the code that
// registered it, so the costly part of the app can be found from the running
// dock build. It records only durations, counts, and bundle positions —
// never terminal text, commands, URLs, or keystrokes.

const FLUSH_INTERVAL_MS = 10_000;
const TOP_SITES = 12;
const MAX_RECORDS = 360; // one hour at the flush interval, then it goes quiet

export type WorkSite = { site: string; totalMs: number; count: number; maxMs: number };
export type WorkWindow = { windowMs: number; busyMs: number; callbacks: number; top: WorkSite[]; mutations: WorkSite[] };

type Clock = () => number;

/** Aggregates callback durations per registration site; testable with a fake clock. */
export function createWorkLedger(now: Clock = () => performance.now()) {
  let sites = new Map<string, WorkSite>();
  let windowStart = now();
  let busyMs = 0;
  let callbacks = 0;
  let depth = 0;

  function record(site: string, ms: number) {
    let entry = sites.get(site);
    if (!entry) {
      entry = { site, totalMs: 0, count: 0, maxMs: 0 };
      sites.set(site, entry);
    }
    entry.totalMs += ms;
    entry.count += 1;
    if (ms > entry.maxMs) entry.maxMs = ms;
  }

  /** Wrap fn so each call is timed under `site`. Nested wrapped calls count once. */
  function wrap<A extends unknown[], R>(site: string, fn: (...args: A) => R): (...args: A) => R {
    return function (this: unknown, ...args: A): R {
      if (depth > 0) return fn.apply(this, args);
      depth += 1;
      const start = now();
      try {
        return fn.apply(this, args);
      } finally {
        const ms = now() - start;
        depth -= 1;
        busyMs += ms;
        callbacks += 1;
        record(site, ms);
      }
    };
  }

  function flush(topN = TOP_SITES): WorkWindow {
    const at = now();
    const all = [...sites.values()];
    const rounded = (s: WorkSite) => ({ site: s.site, totalMs: round(s.totalMs), count: s.count, maxMs: round(s.maxMs) });
    const top = all
      .filter((s) => !s.site.startsWith("mutation:"))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, topN)
      .map(rounded);
    // DOM changes carry no duration of their own; rank them by how often they happen.
    const mutations = all
      .filter((s) => s.site.startsWith("mutation:"))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
      .map(rounded);
    const result = { windowMs: round(at - windowStart), busyMs: round(busyMs), callbacks, top, mutations };
    sites = new Map();
    windowStart = at;
    busyMs = 0;
    callbacks = 0;
    return result;
  }

  return { wrap, record, flush };
}

function round(ms: number) {
  return Math.round(ms * 10) / 10;
}

/**
 * Turn a stack captured inside a patched registration function into a short
 * site label. The first `skip` frames are the ledger's own (the capture helper
 * and the patched function); the next `depth` frames are the registering code,
 * each reduced to `file:line:col` and joined innermost-first with `<`. Several
 * frames are kept because library wrappers (Tauri `listen`, React) sit between
 * the patched entry point and the app code that matters.
 */
export function siteFromStack(kind: string, stack: string | undefined, skip = 2, depth = 3): string {
  // WebKit frames look like "name@url:line:col"; V8 like "at name (url:line:col)".
  const positions = (stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(skip)
    .map((line) => line.match(/([^/@( ]+:\d+:\d+)\)?$/)?.[1])
    .filter((position): position is string => Boolean(position))
    .slice(0, depth);
  return `${kind}@${positions.length ? positions.join("<") : "?"}`;
}

function installHooks() {
  const ledger = createWorkLedger();
  const siteFor = (kind: string, depth = 3) => siteFromStack(kind, new Error().stack, 2, depth);

  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeRaf = window.requestAnimationFrame.bind(window);
  startFlushing(ledger, nativeSetInterval);
  try {
    installRenderSampling(ledger, nativeSetInterval, nativeRaf);
  } catch {
    // Optional; the callback timings below still work without it.
  }

  window.setTimeout = function (handler: TimerHandler, timeout?: number, ...args: unknown[]) {
    if (typeof handler !== "function") return nativeSetTimeout(handler, timeout, ...args);
    return nativeSetTimeout(ledger.wrap(siteFor("timeout"), handler as (...a: unknown[]) => unknown), timeout, ...args);
  } as typeof window.setTimeout;

  window.setInterval = function (handler: TimerHandler, timeout?: number, ...args: unknown[]) {
    if (typeof handler !== "function") return nativeSetInterval(handler, timeout, ...args);
    return nativeSetInterval(ledger.wrap(siteFor("interval"), handler as (...a: unknown[]) => unknown), timeout, ...args);
  } as typeof window.setInterval;

  window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    nativeRaf(ledger.wrap(siteFor("frame"), callback));

  // DOM events. Keep a per-listener map so removeEventListener still works.
  const wrappedListeners = new WeakMap<object, Map<string, EventListener>>();
  const proto = EventTarget.prototype;
  const nativeAdd = proto.addEventListener;
  const nativeRemove = proto.removeEventListener;
  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof listener !== "function") return nativeAdd.call(this, type, listener, options);
    let byType = wrappedListeners.get(listener);
    if (!byType) {
      byType = new Map();
      wrappedListeners.set(listener, byType);
    }
    let wrapped = byType.get(type);
    if (!wrapped) {
      wrapped = ledger.wrap(siteFor(`event:${type}`), listener as (event: Event) => void);
      byType.set(type, wrapped);
    }
    return nativeAdd.call(this, type, wrapped, options);
  };
  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    const wrapped = typeof listener === "function" ? wrappedListeners.get(listener)?.get(type) : undefined;
    return nativeRemove.call(this, type, wrapped ?? listener, options);
  };

  // React's scheduler runs renders from a MessageChannel `onmessage` handler.
  const onmessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  if (onmessage?.set && onmessage.get) {
    const nativeSet = onmessage.set;
    Object.defineProperty(MessagePort.prototype, "onmessage", {
      configurable: true,
      enumerable: onmessage.enumerable,
      get: onmessage.get,
      set(this: MessagePort, handler: ((event: MessageEvent) => void) | null) {
        nativeSet.call(this, typeof handler === "function" ? ledger.wrap(siteFor("scheduler"), handler) : handler);
      },
    });
  }

  // Rust→JS channel messages (terminal grid diffs) reach app code through the
  // Channel class's `onmessage` accessor, which is an ordinary configurable
  // class property — wrap handlers there to time and count every message.
  try {
    const accessor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
    if (accessor?.set && accessor.get && accessor.configurable) {
      const nativeChannelSet = accessor.set;
      Object.defineProperty(Channel.prototype, "onmessage", {
        configurable: true,
        enumerable: accessor.enumerable,
        get: accessor.get,
        set(this: Channel<unknown>, handler: (response: unknown) => void) {
          nativeChannelSet.call(this, typeof handler === "function" ? ledger.wrap(siteFor("channel"), handler) : handler);
        },
      });
    }
  } catch {
    // Diagnostics only.
  }

  // Tauri's `__TAURI_INTERNALS__.transformCallback` is a non-writable property;
  // assigning it throws in module code and stopped the whole cockpit from
  // starting (2026-09-28). Rust→JS event callbacks are therefore not timed here.
}

let installed = false;

/** Patch the renderer's callback entry points. Idempotent; desktop-only; never throws. */
export function installWorkAttribution() {
  if (installed || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  installed = true;
  try {
    installHooks();
  } catch {
    // A diagnostic must never stop the cockpit from starting. Any hook that was
    // installed before the failure keeps working on its own.
  }
}

/** Names (never values) of inline style properties that differ between two style strings. */
export function changedStyleProperties(before: string, after: string): string {
  const parse = (text: string) => {
    const map = new Map<string, string>();
    for (const part of text.split(";")) {
      const colon = part.indexOf(":");
      if (colon > 0) map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    return map;
  };
  const a = parse(before);
  const b = parse(after);
  const names = new Set<string>();
  for (const [name, value] of b) if (a.get(name) !== value) names.add(name);
  for (const name of a.keys()) if (!b.has(name)) names.add(name);
  return [...names].sort().slice(0, 4).join(",");
}

/** Name a DOM node by its nearest classed element: "terminal-header" etc. */
export function mutationLabel(node: Node | null): string {
  const own: Element | null = node && node.nodeType === 1 ? (node as Element) : node?.parentElement ?? null;
  let element = own;
  while (element && !element.getAttribute("class")) element = element.parentElement;
  const first = element?.getAttribute("class")?.trim().split(/\s+/)[0] ?? "";
  const named = first ? first.slice(0, 48) : element?.tagName.toLowerCase() ?? "?";
  // Unclassed targets (inline-styled React divs) keep their own tag in front.
  return own && own !== element ? `${own.tagName.toLowerCase()} in ${named}` : named;
}

/**
 * JS timings miss the browser's own style/layout/paint work, which dominates
 * when compositing is off. Four times a second, time one rendering update (a
 * frame callback to the first task after that frame is painted) and count
 * which parts of the page the app keeps changing. Counts and durations only.
 */
function installRenderSampling(
  ledger: ReturnType<typeof createWorkLedger>,
  nativeSetInterval: typeof window.setInterval,
  nativeRaf: typeof window.requestAnimationFrame,
) {
  const channel = new MessageChannel();
  let frameStart = 0;
  // Page changes of the last half second, so a slow repaint can name its trigger.
  const recentChanges: Array<{ at: number; label: string }> = [];
  const noteChange = (label: string) => {
    const at = performance.now();
    recentChanges.push({ at, label });
    while (recentChanges.length && (recentChanges.length > 400 || at - recentChanges[0].at > 500)) recentChanges.shift();
  };
  channel.port1.addEventListener("message", () => {
    if (frameStart) {
      const paintMs = performance.now() - frameStart;
      ledger.record("render:frame-update", paintMs);
      if (paintMs >= 60) {
        for (const label of new Set(recentChanges.map((change) => change.label))) {
          ledger.record(`hitch-after:${label}`, paintMs);
        }
      }
    }
    frameStart = 0;
  });
  channel.port1.start();
  nativeSetInterval(() => {
    if (frameStart || document.visibilityState !== "visible") return;
    nativeRaf(() => {
      // Force style+layout now so the remainder of the update is painting.
      const layoutStart = performance.now();
      document.documentElement.getBoundingClientRect();
      frameStart = performance.now();
      ledger.record("render:style-layout", frameStart - layoutStart);
      channel.port2.postMessage(0);
    });
  }, 250);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      let what = record.type === "attributes" ? `attr:${record.attributeName}` : record.type;
      if (record.attributeName === "style") {
        const now = (record.target as Element).getAttribute("style") ?? "";
        what += `(${changedStyleProperties(record.oldValue ?? "", now)})`;
      }
      const label = `${what}@${mutationLabel(record.target)}`;
      ledger.record(`mutation:${label}`, 0);
      noteChange(label);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
  });
}

/** Size of what the browser must lay out and paint. Counts only, no content. */
function pageStats() {
  try {
    const canvases = [...document.getElementsByTagName("canvas")];
    const width = window.innerWidth;
    const height = window.innerHeight;
    let canvasMegapixels = 0;
    let visibleCanvases = 0;
    let visibleCanvasMegapixels = 0;
    for (const canvas of canvases) {
      const pixels = (canvas.width * canvas.height) / 1e6;
      canvasMegapixels += pixels;
      const rect = canvas.getBoundingClientRect();
      if (rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height && rect.width > 0) {
        visibleCanvases += 1;
        visibleCanvasMegapixels += pixels;
      }
    }
    return {
      elements: document.getElementsByTagName("*").length,
      canvases: canvases.length,
      canvasMegapixels: round(canvasMegapixels),
      visibleCanvases,
      visibleCanvasMegapixels: round(visibleCanvasMegapixels),
      viewport: `${width}x${height}@${window.devicePixelRatio}`,
    };
  } catch {
    return null;
  }
}

function startFlushing(ledger: ReturnType<typeof createWorkLedger>, nativeSetInterval: typeof window.setInterval) {
  let records = 0;
  const flushTimer = nativeSetInterval(() => {
    const sample = ledger.flush();
    if (document.visibilityState !== "visible" || sample.callbacks === 0) return;
    records += 1;
    if (records >= MAX_RECORDS) clearInterval(flushTimer);
    try {
      void invoke("terminal_geometry_log", {
        line: JSON.stringify({ t: Date.now(), kind: "work-profile", ...sample, page: pageStats() }),
      }).catch(() => {
        // Diagnostics must never interfere with rendering or terminal I/O.
      });
    } catch {
      // Ignore synchronous bridge failures too.
    }
  }, FLUSH_INTERVAL_MS);
}

installWorkAttribution();
