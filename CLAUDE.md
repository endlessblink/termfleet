# CLAUDE.md — termfleet

termfleet is a terminal cockpit / multi-terminal operations workspace: a single
keyboard-first developer operations center. Terminals are the tactical work
surface; files, sessions, the canvas/operations map, and (planned) agents are
supporting instruments. Linux is the first release gate.

## Talking to the user — ALWAYS

- **Before any command, say plainly whether it KILLS THE TERMINALS or not.** State
  it in one line, up front, every time. e.g. "This kills the running processes in
  your terminals (a running command/agent stops), but the terminals and their text
  come back after relaunch" — vs — "This does NOT touch your terminals." Reference:
  `pkill -f terminal-workspace` / killing the daemon = live processes die but
  content restores from disk on relaunch; relaunching the app WITHOUT killing the
  daemon = terminals keep running with processes intact.
- **Be concise and clear for a non-technical reader.** Short sentences, plain
  words, no jargon/paths/flags unless asked. Lead with the answer and the
  terminal-safety note; keep the rest tight.

## Task names are cockpit-visible — write them for non-developers

TermFleet's TASKS panel + header title show your `TaskCreate`/`TaskUpdate` `subject`
and `activeForm` to whoever is watching the cockpit — often non-technical. Write them
in **plain, everyday language**: no file names, code, flags, or jargon. Put the
friendly phrasing in a short present-continuous `activeForm` (the title prefers it),
e.g. `activeForm: "Cleaning up messy terminal text"` rather than
`subject: "Suppress scrollback garbage (neutral floor)"`. This costs no extra tokens —
it's the same task call you already make, just human-readable.

**Record plans/checklists as tasks, not just prose.** When you produce a plan, a
checklist, or a list of steps (e.g. "things to do before release"), create them with
the `TaskCreate` tool — don't only write them in the chat. The cockpit's TASKS panel
mirrors your task tool, so a prose-only list does NOT appear there. Mark the one you're
doing `in_progress` via `TaskUpdate` so the header shows what you're working on.

**Always keep exactly one task `in_progress` while you work.** The header title is
driven by your current task's `activeForm`. With no `in_progress` task, the cockpit
falls back to a guessed line from your last sentence — fine, but vaguer and sometimes a
terse status fragment ("All 71 pass."). So: at the start of any non-trivial work create a
task and set it `in_progress`; when you move on, mark it `completed` and set the next one
`in_progress`. One present-continuous, plain-language `activeForm` at all times keeps the
title specific and honest for whoever is watching — for free, in the task call you already
make.

Stack: **Tauri 2 + React 19 + TypeScript + Rust**, with a **headless-VT
(`alacritty_terminal`) grid rendered to an HTML canvas** as the desktop terminal,
and a **user-local Rust PTY daemon** (Unix-socket IPC) that owns PTYs
independently of the UI lifecycle.

Planning lives in `MASTER_PLAN.md` (the source of truth for task status). Active
task is **TC-017** (headless-VT + Canvas2D renderer replacing xterm.js): stages
a–f done, g done except a live latency/TUI confirmation pass; the canvas renderer
is now the desktop default. TC-018 (BiDi/Hebrew nikud) and TC-015/TC-016 are
TODO backlog.

## Build & run

First Rust build compiles from scratch and can OOM-`Killed` under memory pressure.
Normal operator use and acceptance testing are dock-only. Never ask the operator
to run a development launcher or a terminal command to pick up a fix. Build and
promote the immutable release, then verify the actual dock-launched app.

```bash
npm install
npm run release:install        # build and atomically promote the dock release
npm run verify:installed-release
npm run build                  # frontend only: tsc && vite build
npm run review                 # browser-only preview on http://127.0.0.1:5177
```

Development launchers are internal troubleshooting tools only; they are never
the user handoff or acceptance surface. The desktop terminal is always the
Canvas2D renderer.

Rust-only compile check (non-interactive, no display needed):

```bash
cd src-tauri && CARGO_BUILD_JOBS=1 cargo check
```

Reset persisted layout/theme from the command bar with `Reset layout`.

## Diagnose before debugging — ALWAYS

**If cockpit titles, the TASKS panel, or agent status look wrong/stale/empty, run
`npm run doctor` FIRST** — before reading code, before proposing fixes. It live-checks
the whole status pipeline (hook → status files → pane-id injection → built frontend →
binary age → running-app age → log sizes) and names the broken layer in one second.
The recurring "broken again" reports were runtime wiring (dead helper process, stale
binary), not code — a class no unit test catches. Never ask the operator to run
diagnostics; run them yourself and report the result in plain words. The only actions
to hand the operator are ones only they can do (e.g. relaunching the app).
Failure-mode catalog: `docs/regression-matrix.md`.

Before any bug, repeated failure, behavior correction, or risky fix, review the
unified issue control system with `npm run issues -- check` and
`npm run issues -- list`; show or create the matching issue before changing
production code. Update its lifecycle state and evidence as work progresses, and
do not mark it resolved until the required surface-specific proof is recorded.

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
- `commands.rs` — Tauri command surface (daemon*\*, pty*_, fs\__) + daemon input worker
- `native_terminal.rs` — legacy capability probe; always reports the native pane as unavailable (retired, no GTK/VTE linked)

Key docs in `docs/`: `terminal-cockpit-design-contract.md`, `native-terminal-pane-architecture.md`,
`recoverable-terminal-architecture.md`, `terminal-transport-failure-recovery.md`, `visual-qa-review.md`.

## Hard constraints (learned — do not relitigate)

- **No optimistic local echo and no PTY echo suppression.** Explicitly rejected in
  TC-014. It breaks password prompts, SSH, readline, bracketed paste,
  alternate-screen TUIs, and control keys. Latency is solved with measured
  key-to-render instrumentation + the headless-VT/canvas renderer, not by faking echo.
- **The headless-VT + Canvas2D renderer is the production desktop terminal**
  (TC-017): Rust owns the grid via `alacritty_terminal` (fed by the daemon),
  emits binary dirty-diffs, React draws to an HTML `<canvas>` (`TerminalCanvas.tsx`).
  It is the default on desktop (`auto`/`canvas2d`). xterm.js is now ONLY the
  browser-preview fallback (no Tauri runtime); `web-xterm` forces it on desktop
  as an escape hatch. Native GTK/VTE (TC-014) is a retired dead end — do not
  reintroduce it; snapshot at git tag `native-vte-snapshot`.
- **Renderer is Canvas2D, NOT WebGL** (WebKitGTK DMA-BUF/WebGL is unstable). Font
  atlas + `drawImage`; box-drawing via `fillRect`; HiDPI via `devicePixelRatio`.
- **The daemon owns PTYs**, not React mounts or Tauri window state. React unmount
  must detach, never kill — only explicit close (`closeTerminalSession`) destroys.
- **Never write transport errors into the terminal buffer.** `[pty write failed]`
  / `[pty read failed]` are runtime state → `failed` status + console, not terminal
  output. `verify:map-terminals` enforces this.
- **The canvas terminal is a plain DOM `<canvas>`**, so it pans/zooms with CSS
  transforms — it works identically in split panes and on the zoom/pan map
  (unlike the retired GTK overlay, which couldn't live on the canvas).
- **Map arranging is card-type-agnostic.** Tidy/align/distribute must move
  EVERY card on the operations map — terminals, notes, files, drawing boards,
  localhost previews, and whatever card type ships next. Layout code lives in
  `src/lib/canvasArrange.ts` and must never branch on a card's kind; membership
  comes from links (`terminalTabId`, `linkedTerminalPaneId`) first, then from
  where the card is sitting. `tests/canvas-arrange.spec.ts` reads the
  `CanvasNodeType` union from source and fails if a new type is left out, so a
  new map feature is covered by default rather than quietly buried.
- Typography: non-terminal UI uses Rubik via `--font-ui`, weights 300/400/500
  only; monospace is reserved for the terminal buffer. `verify:typography` enforces.

## Agent session recovery is PER-PANE, not per-folder (learned)

- Every map terminal node is its OWN distinct agent conversation. Users routinely
  run several separate codex/claude chats in the SAME project folder (e.g. three
  different `bina-ve-ze` conversations). Never collapse nodes by cwd.
- The durable key is the pane's `runtimeSessionId = terminal-<tabId>-<paneId>`
  (`Terminal.tsx`). It is stable across reopen, daemon recycle, and reboot.
- Each pane's live conversation id is captured per-pane in
  `~/.local/share/terminal-workspace/agent-status/pane-*.json` (`paneId` field ==
  runtimeSessionId, `sessionId` == provider conversation uuid) by the codex/claude
  status hooks — for HAND-STARTED agents too, not only agent-button launches.
- To restore/resume a node, use ITS pane's `sessionId`: `codex resume <id>` or
  `claude --resume <id>`. NEVER use agent-fleet's cwd-keyed "last" snapshot for
  per-node restore — `pin="last"` keeps only the newest chat per folder and
  silently loses the others.
- Daemon cold-restore (`pty.rs plan_agent_restore`) only resumes sessions tagged
  `recovery_kind = AgentTerminal`; a session with no manifest cold-restores as a
  plain shell (scrollback replay only, no resume). TC-054 gap: hand-started agents
  are not tagged yet — see `docs/tc-054-agent-autoresume-design.md`.
- Never run the SAME conversation id in two live panes at once — it corrupts the
  rollout/session file. One live pane per conversation.

## Build / commit hygiene

- Each completed task records build/test commands + screenshot evidence in
  `MASTER_PLAN.md` before being marked DONE.
- Update `MASTER_PLAN.md` status when finishing a task (this repo uses it as the
  task board, integrated with Watchpost).
- The repo has its own fresh git history; full prior history and the retired
  predecessors (terminaltron, terminal-workspace, zellij-masterplan-tabbar, web
  Magic Canvas) live in the `cc-linux-enhancments` monorepo / claude-mem.
