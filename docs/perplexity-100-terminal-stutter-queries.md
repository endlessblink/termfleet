# Perplexity research queries: 100-terminal cockpit stutter

Use primary sources where possible: WebKitGTK, Tauri 2, GTK, React, Zustand,
Rust, and browser performance documentation or issue trackers.

## Platform and transport

1. In Tauri 2 with WebKitGTK, how are `Channel<T>` messages queued and
   delivered when the WebView main thread is busy, and can a producer create
   unbounded memory growth or frame starvation? Include official source code,
   documented limits, and known Linux/WebKitGTK issues.

2. What are the WebKitGTK/WebKit2GTK limits and failure modes when one page
   owns roughly 100 HTML canvas elements receiving frequent binary updates?
   Compare Canvas2D partial-row drawing, ImageBitmap, OffscreenCanvas, and
   requestAnimationFrame scheduling on Linux.

3. For a Tauri 2 desktop app using a Rust Unix-socket daemon and one stream per
   PTY, what backpressure patterns prevent 100 terminal output streams from
   starving the UI thread? Cite production implementations or official APIs.

## Frontend scheduling and state

4. In React 19 with Zustand, what is the measurable cost of 100 mounted
   components subscribing to large nested arrays, and which selector/equality
   patterns prevent one terminal update from rerendering unrelated panes?

5. What scheduling strategy best handles high-frequency terminal diffs across
   100 views: one global requestAnimationFrame coordinator, one rAF per view,
   time-sliced batches, or worker-backed rendering? Compare latency, fairness,
   and memory behavior in Chromium/WebKit.

6. How should a background poller process 100 independent status records without
   serially awaiting every pane, causing multi-second cycles and store-update
   bursts? Compare bounded concurrency, priority queues, stale-result dropping,
   and visibility-aware polling.

## Terminal rendering

7. What are the performance characteristics of applying binary dirty-row diffs
   to 100 terminal grids in JavaScript, especially when each diff allocates cell
   objects and snapshots expose the full grid? Identify allocation and garbage
   collection patterns that cause visible freezes.

8. For `alacritty_terminal` grids feeding browser Canvas2D, what batching and
   dirty-region strategies preserve interactive input latency while handling
   simultaneous TUI redraws from 100 PTYs?

## Linux diagnosis

9. On Linux, which measurements distinguish WebKitGTK main-thread starvation,
   GPU/compositor stalls, JavaScript garbage collection, CPU saturation, memory
   reclaim, and daemon/socket backpressure during a desktop freeze?

10. What Linux tools and trace markers provide reliable end-to-end correlation
    from PTY output arrival to Rust event delivery, JavaScript diff handling,
    Canvas2D paint, and visible frame completion in a Tauri/WebKitGTK app?

## Product-scale acceptance

11. What workload design is appropriate for benchmarking a terminal cockpit with
    100 live shells plus agent TUIs: output rates, active/inactive pane mix,
    resize frequency, status polling, and concurrent compiler load?

12. What practical acceptance budgets should a Linux desktop terminal cockpit
    target at 100 panes for input-to-visible-echo p95, frame gaps, CPU, RSS,
    dropped updates, and recovery behavior?
