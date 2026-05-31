# AGENTS.md — termfleet

termfleet is a terminal cockpit / multi-terminal operations workspace: a single
keyboard-first developer operations center. Terminals are the tactical work
surface; files, sessions, the canvas/operations map, and (planned) agents are
supporting instruments. Linux is the first release gate.

Stack: **Tauri 2 + React 19 + TypeScript + Rust**, with a **headless-VT
(`alacritty_terminal`) grid rendered to an HTML canvas** as the desktop terminal,
and a **user-local Rust PTY daemon** (Unix-socket IPC) that owns PTYs
independently of the UI lifecycle.

Planning lives in `MASTER_PLAN.md` (the source of truth for task status). TC-017
(headless-VT + Canvas2D renderer replacing xterm.js) is DONE: the canvas renderer
is the production desktop default. The retired native GTK/VTE path (TC-014) has
been removed from the build — there is no `--features native-vte` anymore;
its source is preserved at git tag `native-vte-snapshot`. TC-018 (BiDi/Hebrew
nikud) and TC-015/TC-016 are TODO backlog.

## Build & run

First Rust build compiles from scratch and can OOM-`Killed` under memory pressure.
The dev launchers already set `CARGO_BUILD_JOBS=1` / `CARGO_PROFILE_DEV_DEBUG=0` —
use them rather than raw `tauri dev`.

```bash
npm install
./run-native-vte-dev.sh        # = npm run tauri:dev — default local dev (Canvas2D terminal)
npm run build                  # frontend only: tsc && vite build
npm run review                 # browser-only preview on http://127.0.0.1:5177
```

The launcher name is kept for muscle memory but builds the default (canvas)
target; the desktop terminal is always the Canvas2D renderer.

Rust-only compile check (non-interactive, no display needed):
```bash
cd src-tauri && CARGO_BUILD_JOBS=1 cargo check
```

`run-dev.sh` / `terminal-workspace-dev` clear stale Vite + Tauri/daemon processes
before launching, so latency and behavior are measured against a clean runtime.
Reset persisted layout/theme from the command bar with `Reset layout`.

## Verification scripts

Verifiers force the canvas renderer + split mode via `VITE_*` env overrides
(`VITE_TERMINAL_RENDERER_MODE=canvas2d`, `VITE_WORKSPACE_MODE=split`,
`VITE_WORKSPACE_RESET_STATE=1`) so persisted localStorage can't silently turn
release evidence into an xterm/map smoke. Prefer these over ad-hoc checks.

- `npm run verify:canvas-live` — live desktop canvas attach/input/reflow + real TUIs (vim/htop/tmux), strongest end-to-end proof
- `npm run verify:canvas-all` — Playwright pixel checks (renderer, grid-diff, keymap, resize, selection, box-glyph)
- `npm run verify:daemon-latency` — backend-only daemon/PTY latency (p95 ~1ms)
- `npm run verify:standalone-daemon` — daemon-owned PTY restart/reattach smoke
- `npm run verify:map-terminals`, `verify:terminal-rendering`, `verify:typography` — source-contract checks
- `cargo test` (in `src-tauri/`) — Rust PTY/daemon unit tests

## Architecture

Frontend (`src/`):
- `components/Terminal.tsx` — terminal pane; routes to `TerminalCanvas` (headless-VT + Canvas2D) on desktop, xterm.js fallback in browser
- `components/TerminalCanvas.tsx` — production desktop terminal: Canvas2D renderer over the Rust grid (`grid_*` commands), hidden-textarea input
- `lib/gridSnapshot|gridDiff|gridBuffer|fontAtlas|gridRenderer|keymap|selection|boxGlyph.ts` — the canvas renderer pipeline (decode/apply/draw/input)
- `components/MagicCanvas.tsx` — strategic operations map (canvas of live terminal nodes)
- `components/WorkbenchHeader.tsx` — top command/context bar + command menu
- `components/SplitPane.tsx`, `WorkbenchSidebar.tsx`, `DockRail.tsx`, `StatusBar.tsx`, `FileExplorer.tsx`
- `hooks/usePty.ts` — PTY transport (browser | tauri | daemon); input via one-way event → Rust worker → persistent Unix stream
- `stores/workspace.ts` — Zustand store; tabs, splits, canvas nodes, persistence, renderer/workspace mode
- `lib/types.ts`, `lib/terminalLatencyTrace.ts`

Backend (`src-tauri/src/`):
- `pty.rs` — `PtyManager`, bounded scrollback with monotonic byte offsets
- `daemon.rs` — user-local Unix-socket daemon: owns detached PTYs, stdio bridge, input streams
- `commands.rs` — Tauri command surface (daemon_*, pty_*, fs_*) + daemon input worker
- `vt_grid.rs` — `GridManager`: alacritty-backed grid, binary dirty-diff wire format
- `native_terminal.rs` — legacy capability probe; always reports the native pane as unavailable (retired)

Key docs in `docs/`: `terminal-cockpit-design-contract.md`,
`recoverable-terminal-architecture.md`, `terminal-transport-failure-recovery.md`, `visual-qa-review.md`.

## Hard constraints (learned — do not relitigate)

- **No optimistic local echo and no PTY echo suppression.** Explicitly rejected in
  TC-014. It breaks password prompts, SSH, readline, bracketed paste,
  alternate-screen TUIs, and control keys. Latency is solved with measured
  key-to-render instrumentation + the headless-VT/canvas renderer, not by faking echo.
- **The headless-VT + Canvas2D renderer is the production desktop terminal**
  (TC-017): Rust owns the grid via `alacritty_terminal` (fed by the daemon),
  emits binary dirty-diffs, React draws to an HTML `<canvas>`. It is the default
  on desktop (`auto`/`canvas2d`). xterm.js is ONLY the browser-preview fallback;
  `web-xterm` forces it on desktop as an escape hatch. Native GTK/VTE (TC-014)
  is a retired, removed dead end — do not reintroduce it; snapshot at git tag
  `native-vte-snapshot`.
- **Renderer is Canvas2D, NOT WebGL** (WebKitGTK DMA-BUF/WebGL is unstable). Font
  atlas + `drawImage`; box-drawing via `fillRect`; HiDPI via `devicePixelRatio`.
- **The daemon owns PTYs**, not React mounts or Tauri window state. React unmount
  must detach, never kill — only explicit close (`closeTerminalSession`) destroys.
- **Never write transport errors into the terminal buffer.** `[pty write failed]`
  / `[pty read failed]` are runtime state → `failed` status + console, not terminal
  output. `verify:map-terminals` enforces this.
- **The canvas terminal is a plain DOM `<canvas>`**, so it pans/zooms with CSS
  transforms — it works identically in split panes and on the zoom/pan map.
- Typography: non-terminal UI uses Rubik via `--font-ui`, weights 300/400/500
  only; monospace is reserved for the terminal buffer. `verify:typography` enforces.

## Build / commit hygiene

- Each completed task records build/test commands + screenshot evidence in
  `MASTER_PLAN.md` before being marked DONE.
- Update `MASTER_PLAN.md` status when finishing a task (this repo uses it as the
  task board, integrated with Watchpost).
- The repo has its own fresh git history; full prior history and the retired
  predecessors live in the `cc-linux-enhancments` monorepo / claude-mem.
