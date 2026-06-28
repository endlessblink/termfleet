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
| 1.6 | Copy / selection loses focus or copies nothing | Ctrl+Shift+C ownership + selection model. | `tests/selection.spec.ts` | ✅ |
| 1.7 | Mouse / wheel not forwarded in TUIs | Mouse encoding + wheel-in-alt-screen. | `verify:terminal-mouse`, `tests/terminal-mouse.spec.ts` | ✅ |

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
| 5.4 | Each terminal must show its OWN title/list | Per-pane `TERMFLEET_PANE_ID` injection (needs daemon replace to take). | `tests/map-terminal-rendering.spec.ts`, `verify:map-terminals` | 🟡 (dormant until daemon replaced; no guard for the injection itself) |
| 5.5 | Header renders garbage status fragment | Summary source labelling / neutral-floor sanitization. | `tests/summary-source-label.spec.ts`, `tests/task-lineup-*.spec.ts`, `tests/visible-task-lineup.spec.ts`, `tests/terminal-question-rendering.spec.ts` | ✅ |
| 5.6 | Map "Unassigned" group for folder-picker tabs | Folder-picker tabs got no group → show cwd name. | `tests/project-reconciliation.spec.ts` | ✅ |

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

1. **Clipboard paste (text + image) has no live end-to-end guard (rows 1.1, 1.3).**
   Source-contract + unit tests now exist, but every real breakage was runtime
   (WebKitGTK clipboard, event propagation, the agent reading `\x16`) — a unit test
   cannot see it. Add a `verify:clipboard-paste` live script modeled on
   `verify-bracketed-paste.sh`: (a) `xclip -selection clipboard` a known TEXT
   string, focus the canvas terminal, send Ctrl+Shift+V, assert the PTY received
   that text; (b) `xclip -t image/png` an image, Ctrl+Shift+V, assert the PTY
   received `\x16`. This is the only guard that would have caught the text-paste
   regression — the source-contract test can lock wiring but not WebKit runtime.
2. **Typing-lag has no UI-level assertion (2.7)** — only backend latency. A
   key-to-pixel trace threshold in a Playwright run would guard perceived lag.
3. **Map-node freeze-path heuristic under-covered (4.2)** — the
   reflow-on-grow/freeze-on-shrink decision (`mapNodeLayoutMode`) deserves a unit
   test independent of pixel rendering.
4. **WebKit stale-cache + productName-title fragility (6.4, 7.1)** are guarded only
   by convention/launcher flags — easy to silently re-break.
5. **Per-pane status injection (5.4)** is dormant until the daemon is replaced; no
   guard asserts `TERMFLEET_PANE_ID` is actually injected.

## Process — preventing future regressions

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
