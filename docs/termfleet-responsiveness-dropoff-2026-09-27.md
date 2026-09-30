# TermFleet responsiveness handoff — 2026-09-27

**State: in_progress.** The goal is to make the whole app feel faster and smoother without losing terminal, agent, clipboard, selection, resize, SSH, or full-screen TUI behavior. The user reports severe sluggishness across the app and that the latest candidate stayed frozen at startup.

## Current runtime and recovery

- The installed performance candidate was promoted, then launched from the dock. Its executable was release `4ee2c693a2e9-cccd47bb159a-d996f3f59df5` (SHA-256 `cccd47bb159aa8e82b3db12bc2f4cc36cf13d4d7dc64345ad7bda18e2d859683`). The user reported that it did not load and stayed frozen. Treat this as a failed live trial; do not claim a responsiveness improvement.
- The prior UI release (`960ef28d6035-fa0d8b06b813-5f47b8f8753d`) was relaunched once, but the current dock-launched process is again the candidate release. A direct capture of its own window is uniformly blank (SHA-256 `273ccd9b004d261afad3b4c662b0ec8835ba39d363ead2d9f0dfa3a4f49e172b`); no TermFleet content is visible.
- The independent PTY daemon was not stopped. It remains reachable at PID `1515447`; the latest daemon status reports 22 live sessions. The daemon owns terminal processes; do not restart it for this UI investigation.
- Current dock process path is the candidate release and its WebKit process is alive, so this is a live blank-window stall rather than a missing process. The desktop log records repeated `vt-grid reader ... daemon stream parse failed` messages, but their causal relationship to the blank window is unproven.
- JIT and graphics safety flags remain in the installed launcher: `JSC_useJIT=false`, software GL, compositing disabled, and DMA-BUF disabled.
- The current checkout has unrelated dirty work. The measured candidate source is isolated at `/tmp/termfleet-perf-candidate`; do not copy its whole tree into the shared checkout or revert unrelated edits.

## Evidence so far

- User-provided 15-second `perf` capture: WebKitWebProcess accounted for 63.34% of the sampled call tree. Named JavaScriptCore symbols included `JSC::SlotVisitor::addParallelConstraintTask` (10.20%) and `JSC::JSString::equalSlowCase` (5.07%, plus another 4.63% sample at the same code area). Most renderer frames were unsymbolized, so the profile does not identify the app-level trigger or prove GPU acceleration is the fix.
- Two candidate changes were measured and focused regressions passed: reject throttled terminal-geometry samples before doing DOM geometry reads; persist terminal snapshots using the real status timestamp instead of a fresh timestamp on each store update.
- Focused Playwright tests passed: `tests/terminal-geometry-throttle.spec.ts` and `tests/workspace-persistence-timestamp.spec.ts` (2 tests). `npm run release:install` completed; `npm run verify:installed-release` confirmed the promoted binary. The installed UI then froze during startup per the user report.
- Do not relax the JIT or graphics safeguards yet. Existing synthetic graphics checks did not demonstrate an acceleration win, and JIT was disabled to protect against prior WebKit crashes.

## Continue from here

1. Restore a usable UI by launching the prior installed release through the dock wrapper; keep the daemon and its 22 live sessions running. The current candidate window is confirmed blank.
2. Diagnose the candidate's blank window by correlating its startup logs, WebKit renderer state, daemon stream parse errors, and first-render heartbeat before another candidate launch. Capture any visual state only through the repository's visual-isolation procedure.
3. Keep TF-015 in `verifying`; record the failed candidate launch and rollback as `live-desktop` evidence, and update its `nextAction` to startup-freeze diagnosis followed by measured input/scroll responsiveness.
4. Resume broad profiling only after startup is reliable: capture matched idle, typing, sidebar scrolling, tab switching, and map interaction samples; separate renderer CPU, main-thread long tasks, canvas paint, IPC, and daemon work. Do not present CPU samples alone as smoothness proof.
5. Keep every accepted fix behind focused regressions, then run installed-release and live desktop verification plus the established functional-equivalence checks. Completion requires demonstrated fast interactions with sessions and terminal behavior intact.

## Build/test locations

- Isolated candidate: `/tmp/termfleet-perf-candidate`.
- Candidate focused test command: `npx playwright test tests/terminal-geometry-throttle.spec.ts tests/workspace-persistence-timestamp.spec.ts`.
- Installed release verification command: `npm run verify:installed-release` from the isolated candidate.
- Canonical issue: `TF-015` in `docs/issue-registry.json`; repository regression matrix and issue requirements remain authoritative.

## Latest recovery readback — 2026-09-27 10:50 Asia/Jerusalem

- The candidate cockpit had exited cleanly while the daemon remained reachable with 23 live sessions. Restored prior immutable release `960ef28d6035-fa0d8b06b813-5f47b8f8753d` through the installed dock wrapper; the daemon was not restarted.
- `wmctrl -l` listed a visible `TermFleet` window. UI PID 3168743 and WebKit PID 3169282 remained alive after about two minutes; their lifetime-average CPU samples were 13.0% and 19.5%. These samples do not establish current interaction latency or visible content.
- `TF-015` records both the clean-exit observation and prior-release recovery. Keep it `verifying`; responsiveness improvement and the actual window contents still need verification.

## Latest renderer sample — 2026-09-27 11:43 Asia/Jerusalem

- Prior release UI PID 3168743 and WebKit PID 3169282 were still running. Across a five-second interval, WebKit accumulated four CPU seconds while the UI process accumulated one; lifetime averages were 58.2% and 8.5%, respectively. This identifies sustained renderer CPU work but not its trigger or perceived interaction latency.
- `node scripts/summarize-terminal-latency-trace.mjs` found no existing `/tmp/terminal-workspace-latency-trace-*.jsonl`, so there is no input-to-paint data for this run. No synthetic input was sent into live panes; the daemon and all 23 sessions remain untouched.
- A requested 15-second read-only `perf record` was denied because the host sets `perf_event_paranoid=4` and grants no `CAP_PERFMON`, `CAP_SYS_PTRACE`, or `CAP_SYS_ADMIN`; no system policy was changed and no profile was produced.
- `TF-015` remains `verifying`. Next gate: obtain an authorized renderer profile or enable existing trace instrumentation for a controlled visible interaction, then correlate renderer work with a concrete UI component. No candidate fix is supported by this sample alone.

## Latest dock readback — 2026-09-27 12:42 Asia/Jerusalem

- The user reports the newly released app eventually came up but still feels stuck. Earlier first workspace paint took about 89 seconds.
- Current dock UI PID 4005569 and WebKit PID 4005681 are alive after about 8m36s; sampled lifetime CPU was 10.0% for the app and 57.5% for WebKit. This confirms ongoing renderer work, not the app-level cause or interaction delay.
- Read-only profiling through the available shell was rejected by its command allowlist. The prior profile artifact was zero-sized; no usable call graph exists. Do not change runtime safeguards based on CPU percentage alone.
- `TF-015` now links matrix rows 3.14, 3.31, and 3.37 and records the current live sample. It stays `verifying`; next action is a non-empty renderer profile followed by a regression-locked candidate and matched visible input/scroll checks.

## Latest live responsiveness read — 2026-09-27 15:18 Asia/Jerusalem

- User still reports whole-app sluggishness. Dock UI PID 4005569 is running release `2732af0b315b-7a1df6f18ec3-dc45f829f69c`; WebKit PID 4005681 remains alive.
- Across a four-second CPU-time comparison, WebKit accumulated 2 seconds of CPU time (about half of one core); the UI process accumulated none. Host CPU and memory PSI were zero. I/O PSI showed some/full stalls of 1.90%/1.74% over 10 seconds and 2.07%/1.77% over 60 seconds. This suggests active renderer work and modest recent host I/O stalls, but does not identify which causes the user's interaction delay.
- The daemon remains reachable with 19 live sessions and 1,474 total session records. Separately, the runtime controller reported four attached panes, while the persisted workspace file contained 22 tabs and 22 terminal entries; these counts describe different sources and must not be combined. No input-to-paint trace exists, and the available profiler route remains blocked by shell allowlist/host perf policy. The app and daemon were not restarted, and no terminal input was synthesized.
- A possible cache for unchanged transcript-tail parsing was examined. Its unit guard passed, but it leaves the file reads intact and the poll volume is too small to explain the measured renderer CPU by itself, so the speculative change was removed and not released.
- `TF-015` stays `verifying`. Next action: obtain a usable renderer profile or input-to-paint trace, correlate it with a concrete UI path, then choose a regression-locked fix. Do not infer a source change from these process and PSI samples alone.

## Bounded renderer diagnostics added — 2026-09-27

- Added a startup-installed sampler for visible-window event-loop timer gaps and browser-reported long tasks. It records only timing values and source labels; it never reads terminal text, commands, URLs, or keystrokes.
- The sampler ignores durations below 250 ms, writes at most once per second, and stops after 120 records per window. Records use the existing native JSONL ring, which is already size-capped; no broad latency trace was enabled.
- `npx playwright test tests/renderer-stall-telemetry.spec.ts --reporter=line` passed (2 tests). `npm run build` passed. `git diff --check` passed.
- This is diagnostic visibility, not a speed fix. It is source-only until a safe dock release promotion and UI relaunch; no installed logger output or responsiveness improvement has been verified. The PTY daemon was left untouched.
- Next: when the running UI can be safely relaunched, promote the change, reproduce the visible sluggishness, and inspect `${TMPDIR:-/tmp}/terminal-workspace-geometry.jsonl` (or the configured `TERMFLEET_GEOMETRY_LOG`) for `kind=renderer-stall` entries; correlate gaps with the affected interaction before changing behavior.

## Latest responsiveness baseline — 2026-09-27 18:20 Asia/Jerusalem

- The user reports the relaunched app is still less responsive than expected. The captured desktop now shows the workspace, so the splash eventually clears; perceived responsiveness remains unresolved.
- Dock UI PID 1746285 is running installed release `2732af0b315b-28ebd5c8996b-22d6173da485`; WebKit PID 1746342 is alive. Across a 12-second process-time sample, WebKit accumulated about four CPU seconds and the UI process about one. This supports ongoing renderer work, not a specific component or input delay.
- Host memory availability was 35 GiB. CPU pressure was near zero in the latest short window; I/O PSI remained elevated (10-second `some`/`full` 4.06%/3.49%, 60-second 2.31%/2.00%). This is a competing-pressure signal, not proof that disk activity causes the UI lag.
- Geometry records are flowing, but the installed `renderer-stall` sampler emitted no records. `node scripts/summarize-terminal-latency-trace.mjs` found no input-to-render trace. No profiler was run and no synthetic input was sent to live terminals.
- The daemon remains reachable (PID 1515447) with 23 live sessions and four runtime-controller panes. No app or daemon restart was performed during this measurement.
- `TF-015` remains `verifying`. Next: measure the user's slowest named interaction through an existing trace or a disposable pane; correlate its delay with renderer/IPC/daemon activity, then choose a regression-locked fix. Current process and PSI samples do not justify changing renderer safeguards or polling behavior.
