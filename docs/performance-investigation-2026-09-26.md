# Performance investigation — 2026-09-26

Status: in_progress. TF-015 remains verifying; installed responsiveness and blank-pane recovery are not proven.

## Baseline diagnosis

- Installed UI PID 683412, WebKit PID 683449, release `960ef28d6035-fa0d8b06b813-5f47b8f8753d`.
- WebKitGTK/JSC packages: 2.52.6-0ubuntu0.24.04.1. X11, NVIDIA RTX 4070 Ti, driver 580.178.04.
- Runtime: JSC_useJIT=false, LIBGL_ALWAYS_SOFTWARE=1, WEBKIT_DISABLE_COMPOSITING_MODE=1, WEBKIT_DISABLE_DMABUF_RENDERER=1.
- Renderer process CPU: 4.49 seconds / 5.03 wall seconds; minimized sample 4.17 / 5.02; later sample 6.35 / 5.025. Other host activity was present. Process accounting includes threads and is not input latency.
- Earlier low CPU immediately after relaunch did not persist. No current key-to-visible-echo measurement exists.

## Disposable graphics comparison

Separate Python GI WebKit window, synthetic content only; no sessions or app storage attached. 28 canvases, 800x400 each, OffscreenCanvas ASCII atlas, one dirty row per frame for 180 frames. JIT and DMA-BUF mitigations retained throughout.

| Configuration | Frame delta p50 / p95 / max (ms) | Draw p50 / p95 / max (ms) |
| --- | --- | --- |
| Current software GL and compositing disabled | 16 / 17 / 26 | 6 / 12 / 18 |
| Software GL unset, compositing still disabled | 16 / 18 / 23 | 6 / 13 / 18 |
| Software GL and compositing disable both unset | 16 / 21 / 22 | 6 / 14 / 18 |

All canvases had at least 51,430 glyph pixels. This checks canvas buffers, not visible presentation. Short, single-run synthetic comparisons show no speedup; they neither establish actual GPU usage nor provide app stability/functional-equivalence evidence. Live graphics settings were not changed. Harness: `/tmp/termfleet-graphics-probe.py`.

## Concrete candidate: defer diagnostic geometry reads

Before: every terminal paint reads DOM geometry before the logger discards samples within its one-second throttle. Candidate: perform those reads inside a lazy collector after the existing per-pane throttle. Expected falsifiable effect: repeated calls within the throttle window do not invoke the collector. Diagnostic cadence, terminal rendering, PTY ownership, and input behavior remain the same.

Focused regression `tests/terminal-geometry-throttle.spec.ts` failed before implementation, then passed (1 test, 974 ms). Covers first call, 999 ms suppression, separate panes, 1000 ms eligibility, shared eager/lazy budget and timer eligibility. `npx tsc --noEmit` passed. Installed latency impact remains unverified; no release was promoted for this change.

## Next gate

### Follow-up measurements

Read-only per-thread procfs sample over 10 seconds: WebKit main thread 5.09 CPU seconds; seven HeapHelper threads 0.55–0.56 seconds each; Collector Thread 0.54 seconds. This suggests allocation/collection pressure merits investigation, but thread names and CPU totals are not a stack profile.

Read-only workspace file observation over 15 seconds found 11 revisions, 7 identical after removing terminal `lastStatusAt` fields, averaging 270,049 bytes per revision. No private contents were emitted. Source assigns `Date.now()` during every persisted terminal projection, defeating serialized equality for otherwise identical state. Candidate: preserve the existing event timestamp; do not change runtime status timestamp writers or forced close flushes. Installed write reduction and end-to-end latency are still unverified.

The geometry slice additionally passed `npm run verify:terminal-rendering` and `npm run build` (existing chunk-size/dynamic-import warnings). Neither command installs a release. The requested perf capture file remains absent; a fresh `sudo -n perf record` attempt returned `sudo: a password is required`.

Timestamp candidate implemented as a one-line projection change. `tests/workspace-persistence-timestamp.spec.ts` uses the real browser store and persistence scheduler: failed before the fix, passed afterward (1 test, 2.8 seconds), with unchanged/runtime-only updates producing no extra writes and real title/status-event changes still persisting. Existing gamification stable-recovery-receipt regression passed (1 test, 3.2 seconds). Fresh `npm run build` passed after both changes. No installed release promotion or relaunch was performed; shared checkout contains unrelated concurrent changes.

The originally reported shuffleboard pane is no longer among live sessions/current workspace tabs; do not silently resurrect it from stale context. A different live shuffleboard pane now has nonempty visible text. These are metadata observations, not visual recovery proof.

Obtain a live renderer CPU stack profile to identify the dominant cost. Kernel profiling restrictions denied capture; sudo requires an operator password. Requested read-only 15-second perf capture of PID 683449. Verify PID identity before any later capture. Do not restart the daemon or duplicate agent conversations. Full installed functional and latency comparison remains required before claiming delivery.

## 2026-09-28 follow-up: current live process

- Dock UI PID 685369 and its WebKitWebProcess child PID 685396 are running the promoted release `353017b7354a-b11df5c09703-457ceb2bda9d`. The WebKit main thread used roughly 28–31% CPU during a short sample while the UI process was mostly idle. This localizes activity to the WebKit process, not to a specific function or user-visible delay.
- The cockpit snapshot timestamp remained fresh. Its source is a JavaScript interval; freshness proves the callback ran, not that input or painting is responsive. In `scripts/termfleet-pressure-watchdog.sh`, the `cockpit-heartbeat-stale` path reports “renderer is blocked” based on desktop age and snapshot mtime. That wording overstates what the detector measures; recovery still occurred as configured.
- `eu-stack` could not attach to the WebKit process and kernel `perf_event_paranoid=4` prevented a usable perf recording. No sysctl change or daemon intervention was attempted. The daemon remained PID 1515447 with 28 live and 1492 persisted sessions.
- The active UI and WebKit child lacked `JSC_useJIT`; the installed launcher differs from the dirty current source launcher, which contains the JIT setting. This is an installed rollout gap for TF-055, but does not explain the current WebKit CPU by itself.
- Root cause, current installed frontend instrumentation coverage, and real typing-to-visible-paint latency remain unknown. Keep TF-015 and TF-055 verifying. Do not restart the PTY daemon. Before any dock relaunch, promote a reviewed launcher fix and explicitly tell the operator that only the desktop UI needs restarting; then verify the child process environment and run a bounded live interaction check.
