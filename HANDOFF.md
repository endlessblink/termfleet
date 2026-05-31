# Handoff — 2026-05-31 20:35 Sunday

You are continuing work in **termfleet** on branch `design/warp-style-chrome`.

## Current task & next step
Fix **zellij fragmenting into stacked sections on the MAP** (operations canvas) — the
grid doesn't fill the node width and zellij's panes/status-bar land on wrong rows.
This is the PTY-winsize vs alacritty grid-width divergence class, scoped to map nodes.
**Next: build a map-mode reproduction harness** — copy `scripts/verify-zellij-shortcuts.sh`
to a new `scripts/verify-zellij-map.sh` that boots with `VITE_WORKSPACE_MODE=canvas`,
focuses the map terminal node, runs `zellij`, and screenshots so the fragmentation is
visible (user explicitly wants evidence-based, NOT guess-and-revert).

## Files touched / in flight
- COMMITTED (e6ce38c, this branch): all terminal/zellij keyboard+render+daemon fixes —
  `src-tauri/src/{gtk_keys.rs,commands.rs,lib.rs,daemon.rs,pty.rs,vt_grid.rs}`,
  `src/components/{TerminalCanvas,Terminal,MagicCanvas,StatusBar,WorkbenchHeader}.tsx`,
  `src/hooks/useKeybindings.ts`, `src/lib/{terminalFocus,gridRenderer,gridBuffer,gridDiff}.ts`,
  `scripts/verify-zellij-shortcuts.sh`, `tests/{fractional-dpr-pitch,terminal-keyboard-passthrough}.spec.ts`.
- UNCOMMITTED (separate UI-redesign work, NOT mine, leave alone unless asked): deleted
  DockRail/GroupBar/ProjectRail/TabSidebar, `DESIGN.md`, `docs/redesign-preview/`,
  theme/sidebar/StatusBar styling, `workspace.ts` pinnedProjects, `verify-typography.mjs`
  outline rules, `MASTER_PLAN.md`.
- Suspected culprit for the map bug is in committed `MagicCanvas.tsx`: `renderScale={2}` on
  the map TerminalComponent + attaching the map node to the LIVE PTY via `attachToPtyId`.
  Hypothesis: split-pane canvas and map-node canvas both call `daemon_resize_session` on the
  SAME session at different widths (full pane vs 640px node) → winsize flaps → zellij
  fragments. CONFIRM with the harness before changing anything.

## Key decisions & gotchas
- **DO NOT trust headless/logic tests as proof** — the goal hook rejected them. Only a live
  xvfb run against real zellij counts. Reproduce the fragmentation visually FIRST.
- **Shift+Tab is fixed at the GTK layer** (`gtk_keys.rs`), NOT in JS — WebKitGTK eats Tab
  before the webview's JS sees it (proven; wry 0.55 / webkit2gtk 2.0.2). No DOM fix for Tab.
- **Ctrl+T/Ctrl+W/Ctrl+K** fixed via `src/lib/terminalFocus.ts` (`terminalHasKeyboardFocus()`
  early-returns in the two global window keydown listeners). A focused terminal owns the keyboard.
- **The daemon outlives the app** (`process_group(0)`) and owns `/tmp/terminal-workspace-pty-trace.log`.
  Any verify harness MUST `pkill -9 terminal-workspace-daemon` and truncate the trace BEFORE the
  run, then assert only the slice after the last `SHORTCUT-PROBE-START` marker.
- **Verify assertions use embedded python3, not bash grep -F** — `\u{..}` literals get mangled by
  bash → false negatives. PTY trace renders control bytes via Rust `{:?}`: `\u{14}`=Ctrl+T,
  `\u{10}`=Ctrl+P, `\u{1b}[Z`=Shift+Tab, `\u{17}`=Ctrl+W.
- **rtk shell hook + Read tool intermittently return empty this session** — write to /tmp and Read,
  use absolute `/usr/bin` paths and `$HOME/.cargo/bin/cargo`, parse with `python3 -c`, retry empties.
- Build: `cd src-tauri && CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 $HOME/.cargo/bin/cargo build`
  (~10s incremental). Force map mode: `VITE_WORKSPACE_MODE=canvas`. Full fix log in memory file
  `terminal-subsystem-audit-fixes.md`.

## Env / run state
Branch: `design/warp-style-chrome` (NO upstream) | Last commit: `e6ce38c fix(terminal): zellij/TUI shortcuts...`
Running: a dev app instance was live during testing (vite :1420 + target/debug/terminal-workspace);
zellij sessions exist on the machine. xvfb-run + xdotool + import are available for a live harness.
Regression baseline (green pre-map-bug): tsc 0, Playwright 9/9, cargo 35, ZELLIJ_SHORTCUTS_OK 4/4.

Start by: copy `scripts/verify-zellij-shortcuts.sh` → `scripts/verify-zellij-map.sh`, set env to
`VITE_WORKSPACE_MODE=canvas`, have the driver focus the map node + run `zellij`, screenshot to
`/tmp/tw-zellij-map/`, and INSPECT the screenshot to see the fragmentation before editing code.
