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
| 2.8 | Wrong/cheap typography in UI chrome | Rubik-only UI font rule. | `verify:typography` | ✅ |

## 3. Daemon / PTY persistence

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 3.1 | Terminals lost on app relaunch | Daemon must survive app relaunch (kept unless build_id/mtime changed). | `verify:standalone-daemon`, `verify:restart-restore`, `cargo test daemon_survival` | ✅ |
| 3.2 | Terminal content lost on reboot | Disk-backed scrollback replay on cold restore. | `verify:scrollback-reattach`, `cargo test restored_session_replays_saved_scrollback` | ✅ |
| 3.3 | React unmount kills PTY | Unmount must detach, never kill. | `verify:map-terminals` | ✅ |
| 3.4 | Transport errors written into terminal buffer | `[pty write/read failed]` must be runtime state, not buffer text. | `verify:map-terminals` | ✅ |
| 3.5 | Daemon/PTY latency regression | p95 budget (~1ms). | `verify:daemon-latency` | ✅ |

## 4. Map (operations canvas) ↔ split

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 4.1 | Terminal **resets** on map↔split switch | Map node must share the tab's `activePaneId` (`terminalPaneId = linkedTab?.activePaneId ?? node.id`). | `verify:map-terminals` | ✅ |
| 4.2 | Map node freeze / black band when running agent | Map nodes freeze via `applyProjectionClip` (reflow-on-grow/freeze-on-shrink). | `tests/map-terminal-rendering.spec.ts` | 🟡 (rendering spec; freeze-path heuristic under-covered) |
| 4.3 | Phantom PTYs / "extra line on map" | `?? node.id` paneId fallback minted orphan PTYs; prefer an existing pane. | `verify:map-shell-anchor`, `verify:map-terminals` | ✅ |
| 4.4 | zellij/TUI fragmentation in small map node | Alt-screen TUI reflow when a wide session shrinks to the map node. | `verify:zellij-map` | ✅ |
| 4.5 | Map drag writes viewport / pan-perf regression | Dragging must not write `canvasState.viewport`. | `verify:map-terminals` (perf assertion) | ✅ |
| 4.6 | Node reorder / group-by-project breaks | Reorder + grouping logic. | `tests/canvas-node-reorder.spec.ts` | ✅ |

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

## 6. Workspace state / lifecycle

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 6.1 | Tabs/projects vanish | A verify run (`VITE_WORKSPACE_RESET_STATE=1`) cleared shared-origin localStorage; key now namespaced under reset mode. | `tests/workspace-hydration.spec.ts` | ✅ |
| 6.2 | Terminals spawn against default tab before hydration | Hydration gate (`hydrating`) blocks mount until disk layout loads. | `tests/workspace-hydration.spec.ts` | ✅ |
| 6.3 | Duplicate project groups on folder re-open | Canonical group per normalized root (TC-034). | `tests/project-reconciliation.spec.ts` | ✅ |
| 6.4 | Dev window shows stale code | WebKitGTK disk cache served stale JS (now disabled in launchers). | _launcher-level; no automated guard_ | ❌ |
| 6.5 | App-shell smoke (boot without crash) | App mounts. | `tests/app-shell.spec.ts` | ✅ |

## 7. Release / packaging / OSS

| # | Symptom | Root cause | Guard | Coverage |
|---|---|---|---|---|
| 7.1 | Renaming productName broke GUI verifiers | Verifiers search the window by title. | `verify:real-dev-window`, `verify:release` | 🟡 |
| 7.2 | OSS readiness / public audit / README recovery | Packaging + repo hygiene. | `verify:oss-readiness`, `verify:public-audit`, `verify:readme-recovery`, `verify:developer-preview` | ✅ |
| 7.3 | Rust warnings creep | — | `verify:rust-warnings` | ✅ |

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

- Use `$termfleet-regression-planner` when a bug is reported or a failure comes
  back. It selects a guard that exercises the original failure surface and keeps
  runtime-only defects from being mislabeled as fully covered by source checks.
- Use `$termfleet-regression-verifier` before completion, commit, or merge. It
  runs the focused guard first, then the required integration and real desktop
  proof sequentially, and leaves the task open when the decisive surface was not
  exercised.
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
