# AGENTS.md — termfleet

termfleet is a terminal cockpit / multi-terminal operations workspace: a single
keyboard-first developer operations center. Terminals are the tactical work
surface; files, sessions, the canvas/operations map, and (planned) agents are
supporting instruments. Linux is the first release gate.

Stack: **Tauri 2 + React 19 + TypeScript + Rust**, with a **native GTK/VTE**
terminal backend and a **user-local Rust PTY daemon** (Unix-socket IPC) that owns
PTYs independently of the UI lifecycle.

Planning lives in `MASTER_PLAN.md` (the source of truth for task status). Active
task is **TC-014** (terminal typing latency); TC-015/TC-016 are TODO backlog.

## Build & run

First Rust build compiles from scratch and can OOM-`Killed` under memory pressure.
The dev launchers already set `CARGO_BUILD_JOBS=1` / `CARGO_PROFILE_DEV_DEBUG=0` —
use them rather than raw `tauri dev`.

```bash
npm install
./run-native-vte-dev.sh        # = npm run tauri:dev:native-vte — default local dev
npm run build                  # frontend only: tsc && vite build
npm run review                 # browser-only preview on http://127.0.0.1:5177
```

Rust-only compile check (non-interactive, no display needed):
```bash
cd src-tauri && CARGO_BUILD_JOBS=1 cargo check --features native-vte
```

`run-dev.sh` / `terminal-workspace-dev` clear stale Vite + Tauri/daemon processes
before launching, so latency and behavior are measured against a clean runtime.
Reset persisted layout/theme from the command bar with `Reset layout`.

## Verification scripts

Verifiers force the native renderer + split mode via `VITE_*` env overrides
(`VITE_TERMINAL_RENDERER_MODE=native-vte`, `VITE_WORKSPACE_MODE=split`,
`VITE_WORKSPACE_RESET_STATE=1`) so persisted localStorage can't silently turn
release evidence into an xterm/map smoke. Prefer these over ad-hoc checks.

- `npm run verify:native-vte-release-runtime` — release native VTE attach/input/split (strongest proof)
- `npm run verify:native-vte-runtime` — dev native VTE attach/input
- `npm run verify:native-vte-lifecycle` — attach/destroy/reattach across map/split/resize
- `npm run verify:native-vte-restart-reconnect` — daemon survives app kill, session reattaches
- `npm run verify:native-vte-pixel-latency` — external X11 key-to-glyph gate (p95 ≤ 25ms)
- `npm run verify:daemon-latency` — backend-only daemon/PTY latency (p95 ~1ms)
- `npm run verify:standalone-daemon` — daemon-owned PTY restart/reattach smoke
- `npm run verify:map-terminals`, `verify:terminal-rendering`, `verify:typography` — source-contract checks
- `cargo test` (in `src-tauri/`) — Rust PTY/daemon unit tests

## Architecture

Frontend (`src/`):
- `components/Terminal.tsx` — terminal pane; native VTE on desktop, xterm.js fallback in browser
- `components/MagicCanvas.tsx` — strategic operations map (canvas of live terminal nodes)
- `components/WorkbenchHeader.tsx` — top command/context bar + command menu
- `components/SplitPane.tsx`, `WorkbenchSidebar.tsx`, `DockRail.tsx`, `StatusBar.tsx`, `FileExplorer.tsx`
- `hooks/usePty.ts` — PTY transport (browser | tauri | daemon); input via one-way event → Rust worker → persistent Unix stream
- `hooks/useNativeTerminalPane.ts` — native GTK/VTE pane attach/update/destroy + bounds sync
- `stores/workspace.ts` — Zustand store; tabs, splits, canvas nodes, persistence, renderer/workspace mode
- `lib/types.ts`, `lib/terminalLatencyTrace.ts`

Backend (`src-tauri/src/`):
- `pty.rs` — `PtyManager`, bounded scrollback with monotonic byte offsets
- `daemon.rs` — user-local Unix-socket daemon: owns detached PTYs, stdio bridge, input streams
- `commands.rs` — Tauri command surface (daemon_*, pty_*, fs_*) + daemon input worker
- `native_terminal.rs` — native pane capability gating, create/update/destroy, readiness phases
- `native_gtk_pane.rs` — feature-gated GTK overlay embedding the runtime-loaded VTE widget

Key docs in `docs/`: `terminal-cockpit-design-contract.md`, `native-terminal-pane-architecture.md`,
`recoverable-terminal-architecture.md`, `terminal-transport-failure-recovery.md`, `visual-qa-review.md`.

## Hard constraints (learned — do not relitigate)

- **No optimistic local echo and no PTY echo suppression.** Explicitly rejected in
  TC-014. It breaks password prompts, SSH, readline, bracketed paste,
  alternate-screen TUIs, and control keys. Latency is solved with measured
  key-to-render instrumentation + native rendering, not by faking echo.
- **Native VTE is the production desktop terminal**; xterm.js is the browser
  preview / unsupported-platform fallback only. Don't reintroduce xterm as the
  desktop input surface.
- **The daemon owns PTYs**, not React mounts or Tauri window state. React unmount
  must detach, never kill — only explicit close (`closeTerminalSession`) destroys.
- **Never write transport errors into the terminal buffer.** `[pty write failed]`
  / `[pty read failed]` are runtime state → `failed` status + console, not xterm
  output. `verify:map-terminals` enforces this.
- **Canvas/map terminals are not native panes.** The GTK overlay can't scale with
  canvas zoom or clip to the viewport, so on the map they're activation cards;
  clicking switches to the linked split pane where native VTE owns typing.
- Typography: non-terminal UI uses Rubik via `--font-ui`, weights 300/400/500
  only; monospace is reserved for the terminal buffer. `verify:typography` enforces.

## Build / commit hygiene

- Each completed task records build/test commands + screenshot evidence in
  `MASTER_PLAN.md` before being marked DONE.
- Update `MASTER_PLAN.md` status when finishing a task (this repo uses it as the
  task board, integrated with Watchpost).
- The repo has its own fresh git history; full prior history and the retired
  predecessors (terminaltron, terminal-workspace, zellij-masterplan-tabbar, web
  Magic Canvas) live in the `cc-linux-enhancments` monorepo / Codex-mem.
