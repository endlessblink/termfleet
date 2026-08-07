# TermFleet Regression & Bug Matrix

Purpose: make regression coverage **visible**. Every bug that has bitten this
project (especially ones that came back "again") is listed with its root cause and
the automated guard that should fail if it regresses. **A row with no guard is a
silent-regression risk** — that is exactly how image paste broke twice.

Legend — **Coverage**: ✅ guarded by an automated test/verify · 🟡 partial (unit
only, or source-contract only — no live end-to-end) · ❌ gap (no automated guard).

How to run a guard: `npm run <verify:script>` or `npx playwright test <spec>` or
`cargo test <name>` (in `src-tauri/`). `npm run verify:canvas-all` runs the canvas
Playwright suite; the per-row specs are the precise guards.

## 8. File explorer

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 8.1 | Clicking a file only registers a reference and gives no readable contents | The explorer had an external opener but no internal file-read/preview surface. | `verify:file-explorer` | 🟡 source-contract; needs headed desktop proof |
| 8.2 | “Open externally” appears to do nothing on Linux | The desktop opener was invoked through the WebView plugin path with no reliable fallback or visible dispatch error. The action now calls a Rust desktop command that prefers Kate, then uses `xdg-open`/`gio` fallback. | `verify:file-explorer`, `cargo check` | 🟡 source + compile; needs headed desktop proof |

---

## 1. Terminal input / clipboard

| # | Symptom (regression) | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 1.1 | **Ctrl+Shift+V text paste broke "again"** | `navigator.clipboard.readText()` is blocked in WebKitGTK webviews (copy via `writeText` works, read doesn't — tauri#5835/#12007); the earlier event-based design also broke when a capture-phase `stopPropagation` (bd583fb) stopped the keydown reaching the textarea. **Fixed:** Ctrl+Shift+V now reads the OS clipboard from the **Rust backend** via the `clipboard_read_text` async command (wl-paste→xclip→xsel). Async on purpose — a *sync* clipboard read deadlocks the GTK main thread (plugins-workspace#2267). Right-click paste still uses the native `paste` event's `clipboardData` (which works). | `tests/keymap.spec.ts` (wiring) + manual: `xclip -selection clipboard -o` verified | 🟡 source-contract + backend verified; **needs a live e2e guard (see Gaps)** |
| 1.2 | Bracketed/multiline text paste duplicated or auto-run in agent prompt | Agent TUI + shell both saw raw newlines; needs bracketed-paste wrap (`shouldBracketAgentPromptPaste`). | `verify:bracketed-paste`, `tests/paste-bracketing.spec.ts`, `tests/keymap.spec.ts` | ✅ |
| 1.3 | Image paste / paste decision branching | No image-to-disk pipeline — image paste forwards Ctrl-V (`\x16`) so the agent reads the clipboard. Decision centralized in pure `decidePasteAction` (text never needs arming; image needs an armed clipboard-image). | `tests/paste-image-decision.spec.ts`, `tests/keymap.spec.ts` | 🟡 logic guarded; no live e2e guard |
| 1.4 | Shift+Tab (zellij back-tab) lost to WebKitGTK focus traversal | WebKitGTK eats Tab/Shift+Tab before JS; fixed with GTK key interceptor + window-capture keydown. | `verify:zellij-shortcuts`, `tests/terminal-keyboard-passthrough.spec.ts` | ✅ |
| 1.5 | Control keys / cursor keys wrong in TUIs (vim/less app-cursor) | Keymap SS3 vs CSI encoding. | `verify:keymap`, `tests/keymap.spec.ts` | ✅ |
| 1.6 | Copy / selection loses focus or copies nothing | Ctrl+Shift+C ownership + selection model. | `tests/selection.spec.ts`, `tests/keymap.spec.ts` | ✅ |
| 1.7 | Mouse / wheel not forwarded in TUIs | Mouse encoding + wheel-in-alt-screen. | `verify:terminal-mouse`, `tests/terminal-mouse.spec.ts` | ✅ |
| 1.8 | **Ctrl+Shift+V typed a literal `v` / paste did nothing in the desktop app** | On Linux desktop, GTK/WebKit can handle terminal shortcuts before the React textarea path sees the intended modifiers. The fix extends the native GTK interceptor from Tab-only to terminal clipboard shortcuts, logs `gtk.key` / `gtk.shortcut.emit`, and emits `terminal-workspace-gtk-clipboard-shortcut` back to the active terminal. React then routes that event through the same backend clipboard read and PTY paste path. | `tests/keymap.spec.ts` (GTK/source contract), `tests/terminal-keyboard-passthrough.spec.ts`, live paste log chain `gtk.shortcut.emit -> paste_shortcut.read_text -> pty_send.ok` | 🟡 no dedicated live GUI verifier yet |
| 1.9 | **Map-view paste into Claude/Codex TUI targets the wrong terminal or app chrome** | Clicking a map terminal selected the canvas node but did not necessarily make that terminal's tab, pane, and PTY id the active keyboard owner before paste. The fix makes terminal node activation set `activeTab`, `activePane`, and `activeTerminal` before focusing/zooming; `TerminalCanvas` now accepts capture-phase terminal shortcuts when that session owns keyboard even if the hidden textarea was not already focused. | `tests/map-terminal-rendering.spec.ts --grep "map terminal activation owns"`, `tests/terminal-keyboard-passthrough.spec.ts` | ✅ for ownership contract; 🟡 for live headed map paste |
| 1.10 | **TUI-to-TUI paste copied a large selection, then pasted stale/short text** | Log evidence showed `copy.write_ok chars=1678`, followed by unintended `copy.write_start chars=1` before paste; after reboot, the same class reproduced as `copy.write_start chars=43`. A destination-terminal click/focus could auto-copy a stale non-empty terminal selection because pointer-up copied whenever `selectionRef` had extent, even when no selection drag was active. The fix keeps `hasSelectionExtent` for click-vs-drag and also requires pointer-up to match the active selection pointer before `copySelection()`. | `tests/selection.spec.ts` (`clickExtent=false`, `dragExtent=true`, active pointer-up copy guard) | ✅ |
| 1.11 | Paste/copy diagnostics became noisy or unsafe to trust | Clipboard traces previously allowed non-ASCII/control characters and unbounded lines, making copy/paste failures hard to compare. The fix sanitizes frontend/backend paste logs to single-line ASCII, caps lines, rotates at 256KB, and records structured events (`copy.write_*`, `paste_shortcut.*`, `pty_send.*`, `focus.set`, `gtk.*`). | `cargo test paste_log_lines` | ✅ |
| 1.12 | **Shift-drag cannot highlight content inside a mouse-report TUI** | Canvas pointer handling forwarded every drag to the TUI's mouse protocol, leaving no terminal-selection gesture. Shift-drag now bypasses mouse reporting and uses the existing canvas selection/copy path. | `tests/selection.spec.ts` (pointer routing contract) + `npm run verify:canvas-all` | 🟡 source-contract; live TUI selection still needs headed proof |

## 2. Canvas renderer (grid / Canvas2D)

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 2.1 | Garbled / duplicated / clipped prompts | PTY winsize vs alacritty grid width divergence — attach at measured size, keep in lock-step. | `verify:canvas-live`, `verify:legacy-prompt-repair`, `tests/grid-diff.spec.ts`, `tests/legacy-prompt-repair.spec.ts` | ✅ |
| 2.2 | Cursor ghost trail | Same-line cursor moves not re-dirtied. | `tests/grid-cursor-dirty.spec.ts` | ✅ |
| 2.3 | Blurry text on fractional DPR / map CSS scale | Fractional-dpr cell pitch. | `tests/fractional-dpr-pitch.spec.ts` | ✅ |
| 2.4 | Box-drawing glyphs misrendered | `fillRect` box glyphs. | `verify:box-glyph`, `tests/box-glyph.spec.ts` | ✅ |
| 2.5 | Reflow corruption on resize / resize storm | Grid resize + alt-screen reflow. | `verify:resize-storm`, `tests/grid-resize.spec.ts` | ✅ |
| 2.6 | Renderer baseline (attach/input/reflow/TUIs) | Core renderer pipeline. | `verify:canvas-renderer`, `verify:canvas-live`, `tests/canvas-renderer.spec.ts` | ✅ |
| 2.7 | Typing lag | Latency on input → render. | `verify:daemon-latency`, `trace:terminal-latency` | 🟡 (backend latency only; no UI-lag assertion) |
| 2.8 | Cursor activity causes status/store churn | Cursor repaint rows were also reported as fresh PTY output. | `tests/grid-cursor-dirty.spec.ts`, `verify:canvas-all` | ✅ focused content-vs-cursor guard; live UI profiling remains useful |
| 2.9 | Wrong/cheap typography in UI chrome | Rubik-only UI font rule. | `verify:typography` | ✅ |
| 2.10 | One pane's output wakes every map node | Map nodes and the workspace surface subscribed to whole tab/runtime collections. | `tests/map-terminal-rendering.spec.ts`, live map latency verifier | ✅ focused subscription guards + 85ms map pixel p95 |

## 3. Daemon / PTY persistence

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 3.1 | Terminals lost on app relaunch | Daemon must survive app relaunch (kept unless build_id/mtime changed). | `verify:standalone-daemon`, `verify:restart-restore`, `cargo test daemon_survival` | ✅ |
| 3.2 | Terminal content lost on reboot | Disk-backed scrollback replay on cold restore. | `verify:scrollback-reattach`, `cargo test restored_session_replays_saved_scrollback` | ✅ |
| 3.3 | React unmount kills PTY | Unmount must detach, never kill. | `verify:map-terminals` | ✅ |
| 3.4 | Transport errors written into terminal buffer | `[pty write/read failed]` must be runtime state, not buffer text. | `verify:map-terminals` | ✅ |
| 3.5 | Daemon/PTY latency regression | p95 budget (~1ms). | `verify:daemon-latency` | ✅ |
| 3.6 | **All panes remain at shell prompts after their agent processes are killed, even though each pane has a saved conversation** | A surviving daemon correctly keeps each PTY alive, so cold-restore never runs and relaunching the window only reattaches to the idle shells. The Sessions panel now offers **Reconnect agents**: it keys recovery by pane, skips processes already running, verifies local Codex/Claude records, rejects unsafe ids, and writes each valid provider resume command only to its original idle pane. | `tests/agent-reconnect.spec.ts`, `tests/agent-reconnect-button.spec.ts`, `verify:map-terminals`, live desktop multi-pane action | ✅ |
| 3.7 | Private verifier/runtime directory has no user systemd bus | Do not launch a transient systemd daemon unit unless the runtime directory exposes the user bus; fall back to the detached binary so the daemon socket still appears. | `cargo test platform_process`, `verify:standalone-daemon` | ✅ |
| 3.8 | **A pane repeatedly prints “No saved session found” after restart** | A failed Codex resume was never persisted as terminal recovery state, so every ensure replaced the ended PTY with the same invalid resume command. Missing-session output from the current attempt now marks the target `resume-failed`; replayed historical errors are ignored, and the next ensure opens a regular shell instead of retrying that conversation id. | `cargo test failed_agent_resume_is_persisted_and_not_planned_again`, `cargo test replayed_old_resume_error_does_not_poison_a_new_attempt`, `verify:restart-restore`, `verify:standalone-daemon` | ✅ lifecycle Rust guards + live restart and standalone-daemon cold restore |
| 3.9 | **Closing a pane leaves an agent child, test runner, server, or desktop child consuming resources** | Process groups and inherited environment markers are not complete ownership boundaries: descendants can call `setsid`, drop the marker, and become orphaned. Explicit close now places each PTY in its own delegated Linux cgroup and recursively kills that cgroup, with process-group and marker cleanup as fallbacks, without touching other panes or the daemon. | `tests/terminal-close-button.spec.ts`, `cargo test kill_terminates_processes_started_inside_the_pty_session`, `cargo test kill_terminates_detached_descendant_that_drops_pane_marker`, `npm run verify:installed-pane-close` | 🟡 UI close-button + cgroup/process-tree + installed-daemon guards; literal dock X still requires desktop click proof |
| 3.10 | **TermFleet UI exits while WebKit workers keep consuming memory** | The dock unit used `KillMode=process`, which left WebKit children outside the main-process lifetime. The desktop unit now uses `KillMode=control-group`; the daemon remains in its own unit. | `python3 -m unittest tests/test_desktop_launcher_guard.py`, installed restart smoke | 🟡 launcher contract guard; crash/exit live proof remains required |
| 3.11 | **A long-running Canvas2D terminal grows WebKit memory from color churn** | The shared glyph atlas retained one offscreen canvas for every unique character/color/style key forever. The atlas now uses a 4,096-entry LRU so old true-colour tiles can be collected while common glyphs stay hot. | `tests/canvas-renderer.spec.ts` glyph eviction guard, `npm run verify:canvas-all`, `npm run verify:canvas-live`, installed release/restart | ✅ focused cache guard + live Canvas2D/TUI/PTY proof + dock soak below the safety threshold |
| 3.12 | **Two dock clicks create duplicate WebKit renderer trees before the first window appears** | The launcher checked for an existing cockpit, but concurrent wrappers could both pass before either child was visible. A launch lock now serializes wrappers and stays held until the cockpit is observable. | `python3 -m unittest tests/test_desktop_launcher_guard.py`, installed release/restart | 🟡 launcher contract + installed restart; concurrent physical dock-click proof remains required |
| 3.13 | **Pressure returns without an immediate operator-visible explanation** | There was no durable alert channel for renderer D-state, renderer growth, or host PSI. A single-instance watchdog now records actionable PID/RSS/PGID/PSI details, rate-limits flapping host alerts, clearly distinguishes host pressure from renderer recovery, raises a desktop notification with the user-session D-Bus address, and recycles only the desktop group before relaunching it; the daemon and PTYs remain alive. | `python3 -m unittest tests/test_pressure_watchdog.py`, live watchdog process and alert-file check | 🟡 focused contract + live watchdog; automatic recycle exercised by live incident, packaged service installation remains required |
| 3.14 | **Background status refresh makes the cockpit feel busy** | The workspace-wide 4-second sweep was labeled sidecar-only but still probed both provider transcript layouts and context enrichment for up to 24 panes in series. Background polling now reads only the local sidecar; transcript/context enrichment remains available to the visible pane path. | `tests/status-poll-loop.spec.ts` (sidecar-only contract) + `npm run build` | 🟡 focused contract + installed release; needs a controlled live before/after CPU trace |
| 3.15 | **A promoted release cannot replace an older sluggish window, or fails to relaunch** | The launcher reused any existing cockpit regardless of release identity; after replacement, the child reacquired the parent lock and systemd-less fallback lacked the desktop session environment. It now replaces stale UI processes, lets children skip the parent lock, and falls back with the display/session variables required by GTK. | `python3 -m unittest tests/test_desktop_launcher_guard.py tests/test_pressure_watchdog.py`, `npm run doctor`, installed process/hash check | 🟡 focused launcher + live installed process; visual interaction still needs operator confirmation |
| 3.16 | **Host pressure recurs after a one-off cleanup or floods the desktop with repeated notices** | The pressure watchdog existed only as an uninstalled script, and intermittent host pressure could stack near-identical notifications. A user service now installs the watchdog into the TermFleet data area, restarts it automatically, preserves the daemon during renderer recovery, rate-limits host alerts, and replaces one desktop notification instead of stacking them. | `python3 -m unittest tests/test_pressure_watchdog.py tests/test_desktop_launcher_guard.py`, installed `termfleet-pressure-watchdog.service` status, live process/PSI check | ✅ focused regression tests + active user service + stable notification behavior |
| 3.17 | **Canvas live E2E falsely reports missing input before the app launches** | The verifier selected ports from a range containing fixed host services and allowed a cold disposable Tauri build to outlive its GUI budget. It now asks the OS for a free port and allows the first WebKit/Tauri compile to complete. | `python3 -m unittest tests/test_canvas_live_guard.py`, `npm run verify:canvas-live` | ✅ 2 focused guards + live daemon/input/output/resize/Vim/htop/tmux proof |

## 4. Map (operations canvas) ↔ split

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 4.1 | Terminal **resets** on map↔split switch | Map node must share the tab's `activePaneId` (`terminalPaneId = linkedTab?.activePaneId ?? node.id`). | `verify:map-terminals` | ✅ |
| 4.2 | Map node freeze / black band when running agent | Map nodes freeze via `applyProjectionClip` (reflow-on-grow/freeze-on-shrink). | `tests/map-terminal-rendering.spec.ts` | 🟡 (rendering spec; freeze-path heuristic under-covered) |
| 4.3 | Phantom PTYs / "extra line on map" | `?? node.id` paneId fallback minted orphan PTYs; prefer an existing pane. | `verify:map-shell-anchor`, `verify:map-terminals` | ✅ |
| 4.4 | zellij/TUI fragmentation in small map node | Alt-screen TUI reflow when a wide session shrinks to the map node. | `verify:zellij-map` | ✅ |
| 4.5 | Map drag writes viewport / pan-perf regression | Dragging must not write `canvasState.viewport`. | `verify:map-terminals` (perf assertion) | ✅ |
| 4.6 | Node reorder / group-by-project breaks | Reorder + grouping logic. | `tests/canvas-node-reorder.spec.ts` | ✅ |
| 4.7 | Idle and explicitly completed terminals cannot be isolated from the map sidebar | The six-state filter grid exposed preview linkage and heuristic test text; completed `$done`/`/done` turns are recorded as `userTask` plus an idle lifecycle rather than `status: done`, and the 30-minute expiry projection must preserve that completion marker even after the pane has entered fallback state. | `tests/status-expiry.spec.ts` + `tests/map-terminal-rendering.spec.ts -g "idle map filter uses\|map sidebar filters"` + `verify:map-terminals` | ✅ |

## 5. Project identity / header / status

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 5.1 | **Workspace pill shows parent category, not the project** (e.g. `productivity` instead of `flow-state`) | Stored `projectRoot` is a shallow category folder; label never used the git toplevel. Now `workspaceLabelFor` prefers the git repo name. | `tests/header-project-label.spec.ts` | ✅ |
| 5.2 | Header title stale/guessed instead of the real task | Title = current task `activeForm` from the real task list (sidecar), never a local model. | `tests/header-real-task-title.spec.ts`, `tests/stable-header.spec.ts`, `tests/terminal-header-view-model.spec.ts`, `verify:terminal-summary-visual` | ✅ |
| 5.3 | TASKS panel always empty | `TodoWrite` deprecated → capture `TaskCreate`/`TaskUpdate` via hook → sidecar. | `tests/agent-status-sidecar.spec.ts`, `tests/agent-status-summary.spec.ts`, `tests/agent-status-end-to-end.spec.ts`, `verify:agent-status-summary` | ✅ |
| 5.4 | Each terminal must show its OWN title/list | Per-pane `TERMFLEET_PANE_ID` injection (needs daemon replace to take; confirmed live in cockpit panes 2026-07-02). | `tests/map-terminal-rendering.spec.ts`, `verify:map-terminals`, `npm run doctor` (checks the env var is actually injected) | ✅ |
| 5.5 | Header renders garbage status fragment | Summary source labelling / neutral-floor sanitization. | `tests/summary-source-label.spec.ts`, `tests/task-lineup-*.spec.ts`, `tests/visible-task-lineup.spec.ts`, `tests/terminal-question-rendering.spec.ts` | ✅ |
| 5.6 | Map "Unassigned" group for folder-picker tabs | Folder-picker tabs got no group → show cwd name. | `tests/project-reconciliation.spec.ts` | ✅ |
| 5.7 | **Titles + TASKS dead in every desktop launch, "fixed" many times, always came back** | The pipeline's ONLY reader was the HTTP status server (127.0.0.1:37819), and **nothing owns that process**: the dev launcher `trap`-kills it on script exit, and a desktop launch (systemd → release binary) never starts one. Hook → sidecar files worked the whole time. **Fixed 2026-07-02:** the app reads the sidecar files directly — Tauri command `agent_status_read_sidecar` + `src/lib/agentStatusSidecar.ts` (file-name parity with `scripts/lib/agent-status-paths.mjs`); the HTTP server is only an optional override. | `tests/agent-status-local-sidecar.spec.ts` (parity + shaping + precedence), `cargo test agent_status_sidecar`, `npm run doctor` (live wiring) | ✅ |
| 5.8 | Fresh shell pane can never receive its FIRST task list (stuck on "No task list" + scraped title) | Cold-start chicken-and-egg: the polling gate skipped panes with no `Working (` marker / durable activity / existing task list — but a pane can't get its first list without asking. **Fixed 2026-07-02:** gated panes always ask (local read is cheap) and only apply `source === "sidecar"` results, so heuristics still can't overwrite. | `tests/agent-status-local-sidecar.spec.ts` (sidecar source distinction); gate wiring in `Terminal.tsx`/`MagicCanvas.tsx` has no dedicated guard | 🟡 |
| 5.9 | Map headers never update in the desktop app (only in dev-launcher runs) | `MagicCanvas` refused to poll unless `window.location.port === "1420"` or an env endpoint was set — never true in a release/desktop launch. **Fixed 2026-07-02:** polls when the Tauri sidecar reader is available; in desktop-only mode applies ONLY sidecar results (heuristic scrapes never overwrite). | none dedicated (mocked-Tauri visual specs exercise the guard indirectly) | 🟡 |
| 5.10 | Fix is "done" but the running app predates it (stale release binary / stale embed / old process) | Desktop launches run `target/release/terminal-workspace` with the frontend **embedded at build time**; a rebuilt dist means nothing until the binary is rebuilt AND the app relaunched. Cost a full day of "still super bad" reports against an old binary. | `npm run doctor` (binary contains the fix, embed newer than dist, running process newer than binary) | ✅ |
| 5.11 | Status server's `cockpit-header-trace.jsonl` grew unbounded (reached **8 GB**) | Every cockpit-snapshot POST appended a trace line with no cap. **Fixed 2026-07-02:** rotates at 25 MB (one previous generation kept). | `npm run doctor` (warns on oversized trace); rotation itself has no unit test | 🟡 |
| 5.12 | **A costly chat looks identical to a lightweight one, so Sol/high-reasoning sessions can consume most of their context or account budget unnoticed** | Codex already writes model, reasoning, context-window, per-turn usage, and rate-limit pressure into each pane's rollout, but TermFleet discarded those records. Both headers now share one width-safe indicator and a viewport-positioned guidance dialog. Recommendations disclose confidence, evidence, and tradeoffs; clear work can suggest Luna, while high-stakes, diagnostic, or system-level work on a lighter model can suggest Sol. Changes are never automatic: an explicit action opens Codex's native in-session `/model` picker. | `tests/session-transcript.spec.ts`, `tests/agent-budget.spec.ts` (lighter + stronger routing and confidence), `tests/agent-workstream.spec.ts -g "high-token chat"` (900×700 geometry), `tests/map-terminal-rendering.spec.ts -g "high token pressure"` (viewport dialog + `/model` command), `npm run verify:map-terminals` | ✅ browser data path + split/map screenshots + hover/click disclosure + mocked native picker command; relaunched desktop proof pending |
| 5.13 | **Task repeatedly mutates into a long completion report, vague continuation, raw user complaint/rationale, or `No task declared` while the agent still has a plan** | Generated titles, plan prose, and raw requests were competing for one visible field, and an expired sidecar hid its current step without contributing the model-authored plan purpose. Explicit goals remain durable; otherwise the resolver selects the clearest outcome-bearing plan step across completed and active todos even while idle/stale. Waiting/testing remains `Now`; continuation-only prompts, rationales, vendor continuation titles, and injected skill text cannot displace the purpose. | `tests/codex-status-hook.spec.ts`, `tests/session-transcript.spec.ts`, `tests/task-line.spec.ts`, `tests/task-line-plumbing.spec.ts`, `tests/status-expiry.spec.ts`, Rust transcript-context test, `verify:task-line` | ✅ exact Bina/Rough Cut/Flow State regressions + live-record sweep + installed dock restart/capture |
| 5.14 | **Task text ends in an orphan fragment such as `o...`, `s...`, or `th…`** | Multiple display paths truncated by raw character count, then narrow one-line fleet cards applied another CSS-only cut. All task/activity truncation now uses one word-boundary helper; fleet tasks use two fixed lines and are pre-fitted before layout. | `tests/text-truncation.spec.ts`, `tests/cockpit-row-stability.spec.ts`, `npm run build`, installed dock capture | ✅ pure formatter + stable-layout contract + headed dock pixel review |
| 5.15 | **Task shows a technically accurate checklist item, copies one project's subject into another pane, produces an unclear joined-word title, or falls back to `Working` in the top strip** | The resolver originally called one plan sentence “processed context.” The first model prompt then hard-coded Bina reservations/refunds as its universal example while the transcript parser treated the injected `AGENTS.md` startup envelope as the user's request; the local model could also discard joined words, genericize a concrete feature such as Catalog into “fix,” starve quiet panes behind the 24-pane polling cap, let a later checklist fallback overwrite a good model title, and show bare runtime state instead of the durable task in the split header. The desktop now skips startup wrappers, sends pane-owned raw context through a domain-neutral prompt, preserves concrete subjects during correction, normalizes safe joined/derived words, rejects cross-project inventions, rotates the capped poll by oldest pane, keeps model-authored context above fallback lines, and renders the durable task in the top strip. | `tests/task-line-plumbing.spec.ts -g "whole-conversation|startup instructions|pane-specific answer|joined words|ordinary derived words|processed outcome|model-authored purpose|split header shows"`, Rust oversized-startup + instruction-wrapper tests, `tests/status-poll-loop.spec.ts`, `npm run verify:task-line`, `CARGO_BUILD_JOBS=1 cargo check`, installed dock capture and persisted readback of the affected Flow State, Bina, and Rough Cut panes | ✅ red/green guards + 84-test task-line suite + 10-test poll suite + live local-model trace + installed release `71531f32704e-2f834b3e7ac5`; exact readback shows pane-owned Flow State, Bina reservations/refunds, and Rough Cut editing context, while fresh dock screenshot SHA-256 `a10a06f1ff58351b4bc74e6ca9522f37cb0cf06d19acf0ab141cc775029ab518` contains no placeholder or bare `Working` title |

## 6. Workspace state / lifecycle

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 6.1 | Tabs/projects vanish | A verify run (`VITE_WORKSPACE_RESET_STATE=1`) cleared shared-origin localStorage; key now namespaced under reset mode. | `tests/workspace-hydration.spec.ts` | ✅ |
| 6.2 | Terminals spawn against default tab before hydration | Hydration gate (`hydrating`) blocks mount until disk layout loads. | `tests/workspace-hydration.spec.ts` | ✅ |
| 6.3 | Duplicate project groups on folder re-open | Canonical group per normalized root (TC-034). | `tests/project-reconciliation.spec.ts` | ✅ |
| 6.4 | Dev window shows stale code | WebKitGTK disk cache served stale JS (now disabled in launchers). | _launcher-level; no automated guard_ | ❌ |
| 6.5 | App-shell smoke (boot without crash) | App mounts. | `tests/app-shell.spec.ts` | ✅ |
| 6.6 | Startup opens on a blank or distracting partial workspace, terminals mount before restoration, the vessel sits inside an unwanted colored square, or the wordmark changes weight/clarity while appearing | The webview had no first-paint shell, while the existing hydration fallback covered only the workspace surface. The inline gate now owns first paint and tells one restrained terminal-to-vessel story in open space: prompt and hull establish the vessel together, all ship geometry resolves before the wordmark takes focus, and nine fixed-weight letters reveal through crisp masks before the quiet vessel idle. It never delays readiness and becomes fully static for reduced motion. | `tests/startup-splash.spec.ts` (hydration, terminal-spawn guard, no-background-rectangle contract, nine-letter stagger and fixed-weight contract, reduced motion, controlled 160/600/840/1200ms phases), `tests/app-shell.spec.ts` | ✅ browser runtime + source contract + dense rendered-frame review |
| 6.7 | **Restart loads an older pane set even though today’s sessions are still running** | Multiple desktop windows independently mirrored their in-memory layouts to one shared file, so a stale window could win the last write. Hydration now restores every daemon-live session missing from the saved layout while continuing to reject dead persisted sessions, preserving the TC-040 closed-tab rule. The installed launcher also focuses an existing TermFleet process instead of starting another writer. | `tests/workspace-hydration.spec.ts`, `tests/test_installed_release.py` | ✅ state transition + launcher reuse guard; installed restart proof required |
| 6.8 | **A dock click says it reused TermFleet but no window exists** | A defunct cockpit process still matched the single-window guard, so the launcher focused nothing and exited. The guard now ignores zombie processes while continuing to ignore the daemon and reuse a genuinely live cockpit. | `tests/test_desktop_launcher_guard.py` | ✅ exact zombie/daemon/live-cockpit process cases + promoted dock launcher |
| 6.9 | **A map terminal header has live task content but its terminal body is empty after restart** | The canvas map preferred a persisted `terminalPtyId` even after that PTY disappeared from the live tab, so the header remained populated while the renderer attached to a dead session. Map reattachment now uses the live pane PTY or the canonical `terminal-<tab>-<pane>` session identity. | `tests/map-terminal-rendering.spec.ts -g "stale persisted PTY id"`, `npm run verify:installed-restart`, fresh dock screenshot | ✅ focused red/green guard + promoted installed release + visible non-empty terminal output; broad canvas suite remains partial |

## 7. Release / packaging / OSS

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 7.1 | Renaming productName broke GUI verifiers | Verifiers search the window by title. | `verify:real-dev-window`, `verify:release` | 🟡 |
| 7.2 | OSS readiness / public audit / README recovery | Packaging + repo hygiene. | `verify:oss-readiness`, `verify:public-audit`, `verify:readme-recovery`, `verify:developer-preview` | ✅ |
| 7.3 | Rust warnings creep | — | `verify:rust-warnings` | ✅ |
| 7.4 | **The vessel logo looks blurry, jagged, off-center, or like pixel art despite using SVG files** | Size-specific integer rectangles and `crispEdges` defeated SVG smoothing; after the smooth master landed, Tauri still published only the first configured 32px bitmap through `_NET_WM_ICON`, so Plasma enlarged it for the dock. Production now uses one inverted navy/bone 100-unit smooth master for every source and puts the 128px render first in the Tauri icon list, making Plasma downsample instead of enlarge. | `tests/app-shell.spec.ts` (master hash, smooth geometry, single-source wiring, RGBA outputs, 128-first bundle order), `scripts/regenerate-icons.mjs`, live `_NET_WM_ICON` inspection and relaunched desktop capture | ✅ live dock/title proof + browser startup and source guards |
| 7.5 | Dock relaunch opens a blank Vite error screen or starts external terminals after reboot | The installed `termfleet` command resolved to `run-dev.sh`, so the dock compiled dirty source at launch and inherited development recovery behavior. Releases now build fully before atomic promotion into a user-local immutable release directory; the dock launcher rejects source/build-tree executables. | `verify:installed-release`, `verify:installed-restart`, `tests/test_installed_release.py` | ✅ installed provenance + headed restart/restore + no external terminals |
| 7.6 | Source tests pass but the dock repeatedly shows the old broken cockpit | Fixes were verified in source without promoting the immutable release that the dock actually opens, while `doctor` still described an obsolete development-launch setup. Normal operator use and acceptance are now explicitly dock-only; `doctor` compares the installed dock checksum with the current release build and fails when they differ. The headed restart smoke also exports its display to every window probe and lexically sorts window IDs before `comm`, preventing false “window missing” failures. | `tests/test_installed_release.py`, `verify:installed-release`, `verify:installed-restart`, `doctor` | ✅ source policy + checksum provenance + 2319-color headed window capture |
| 7.7 | **The dock shows a generic Konsole icon or a separate question mark and launches through a stale external script** | Release promotion first left desktop metadata and the pinned launcher owned by an older install lane. The installed binary rename then made GTK report `WM_CLASS = "termfleet", "Termfleet"` while the desktop entry declared case-mismatched `TermFleet`. Finally, Plasma's pinned task manager kept its own stale `plasma_icons/*.desktop` copy even after the main entry was corrected, leaving the running vessel icon beside a separate `?` launcher. The release installer now owns the launcher, branded SVG, desktop entry, command symlink, matching live window class, and every TermFleet pinned copy; it refreshes both KDE's service cache and the live Plasma shell after a pin changes. | `tests/test_installed_release.py` (stale pinned-copy rejection), `verify:installed-release` (main/pinned equality), `verify:installed-restart` (live `WM_CLASS`), host desktop capture after real panel reload | ✅ installed metadata + live headed window identity + vessel-only taskbar capture |
| 7.8 | **The dock-launched TermFleet process and window stay alive while the whole window renders as a blank dark frame** | WebKitGTK's DMA-BUF/compositing path can fail at the Linux desktop surface even though the Tauri process and X11 window remain alive. The dock launcher now passes software GL plus WebKit compositing/DMA-BUF disable flags into its systemd child, matching the known-good live verifiers. | `tests/test_desktop_launcher_guard.py`, `npm run verify:installed-release`, `npm run verify:installed-restart`, fresh active-window screenshot | ✅ launcher contract + promoted release + live window/terminal pixels; broad canvas suite remains partial |

---

## Open gaps (prioritized — close these to stop "again" regressions)

1. **Clipboard paste (text + image + TUI-to-TUI + map-view focus) has no single live end-to-end guard (rows 1.1, 1.3, 1.8, 1.9).**
   Source-contract + unit tests now exist, but every real breakage was runtime
   (WebKitGTK clipboard, event propagation, the agent reading `\x16`) — a unit test
   cannot see it. Add a `verify:clipboard-paste` live script modeled on
   `verify-bracketed-paste.sh`: (a) `xclip -selection clipboard` a known TEXT
   string, focus the canvas terminal, send Ctrl+Shift+V, assert the PTY received
   that text; (b) `xclip -t image/png` an image, Ctrl+Shift+V, assert the PTY
   received `\x16`; (c) in map mode, activate a non-current terminal node and
   assert paste lands in that node's PTY; (d) copy a multi-line terminal selection,
   click/focus a second terminal with an existing/stale selection, paste, and assert
   the copied payload is not overwritten by destination focus. This is the only guard that would
   have caught the text-paste and map/TUI-to-TUI runtime regressions — source
   contracts lock wiring but not GTK/WebKit/runtime focus behavior.
2. **Typing-lag has a live guard but should become cheaper (2.7)** — backend
   latency remains covered by `verify:daemon-latency`; the map surface now has
   `verify:map-terminal-latency:live`, which drives a private Tauri/Xvfb run and
   gates both internal canvas trace buckets and external screenshot pixel
   latency. Keep working toward a faster headless/pixel harness for routine CI.
3. **Map-node freeze-path heuristic under-covered (4.2)** — the
   reflow-on-grow/freeze-on-shrink decision (`mapNodeLayoutMode`) deserves a unit
   test independent of pixel rendering.
4. **WebKit stale-cache + productName-title fragility (6.4, 7.1)** are guarded only
   by convention/launcher flags — easy to silently re-break.
5. ~~Per-pane status injection (5.4) is dormant~~ — confirmed live 2026-07-02;
   `npm run doctor` now asserts `TERMFLEET_PANE_ID` is actually injected.
6. **Status polling gate wiring (5.8, 5.9) has no dedicated guard.** The
   ask-always/apply-sidecar-only rules live inline in `Terminal.tsx` and
   `MagicCanvas.tsx`; a refactor could silently reintroduce the cold-start hole or
   desktop no-poll. Extract the decision into a pure helper + unit spec, or add an
   anchored source-contract check.
7. **Runtime wiring rot is a class, not a bug (5.7, 5.10, 5.11).** Unit tests can't
   see a dead helper process, a stale binary, or a runaway log. `npm run doctor` is
   the guard for this class — run it FIRST whenever titles/tasks "break again",
   before touching code.

## Process — preventing future regressions

- Agents automatically apply `termfleet-regression-planner` when a bug is
  reported or a failure comes back. It selects a guard that exercises the
  original failure surface and keeps runtime-only defects from being mislabeled
  as fully covered by source checks.
- Agents automatically continue with `termfleet-regression-verifier` before
  completion, commit, push, or merge. It runs the focused guard first, then the
  required integration and real desktop proof sequentially, and leaves the task
  open when the decisive surface was not exercised. The user never needs to
  invoke either skill or start a new session.
- **Every bug fix adds a row here + a guard.** No fix is "done" (per `/done`) until
  a test/verify would fail if it regressed. A fix with no guard is a future "again".
- **Prefer the cheapest guard that actually covers the failure mode.** Pure-logic
  bugs → unit spec (e.g. `decidePasteAction`). Runtime/clipboard/WebKit/agent bugs
  → a live `verify:*` script; a unit test alone is 🟡, not ✅.
- **Avoid brittle source-contract regexes that span unrelated blocks.** The
  `keymap.spec.ts` paste assertion silently relied on a token in a *different*
  handler; refactoring one broke the other. Anchor each assertion to its own block.
- **Run the relevant guard before marking done:** `verify:canvas-all` for renderer/
  input changes, `verify:map-terminals` for map/session-id changes,
  `verify:restart-restore` + `cargo test` for daemon/persistence changes.
