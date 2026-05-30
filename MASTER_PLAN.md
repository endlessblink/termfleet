# MASTER_PLAN.md - termfleet

termfleet is a terminal cockpit / multi-terminal operations workspace
(Tauri 2 + React + Rust, native GTK/VTE panes with a daemon-backed PTY). It is
the current line of the project formerly built as "Magic Canvas"; Linux is the
first release gate. The design preserves the canvas/operations-map workflow
instead of replacing it with a terminal-only split-pane app.

Extracted from `cc-linux-enhancments/terminal-workspace-tauri` on 2026-05-30;
full prior history remains in that monorepo. Superseded predecessors
(terminaltron, terminal-workspace, the web Magic Canvas, zellij-masterplan-tabbar)
were retired during consolidation.

## Summary

| ID | Status | Type | Title |
|----|--------|------|-------|
| MC-001 | DONE | FEATURE | Preserve canvas workspace mode |
| MC-002 | DONE | TASK | Persist workspace mode and canvas state |
| MC-003 | DONE | TASK | Wire files and terminals into canvas nodes |
| MC-004 | DONE | TASK | Add canvas regression fixtures |
| MC-005 | DONE | TASK | Validate Tauri shell parity |
| ~~MC-006~~ | DONE (2026-05-28) | FEATURE | Improve canvas navigation and terminal organization |
| TC-001 | DONE (2026-05-28) | DESIGN | Freeze Terminal Cockpit target and visual rules |
| TC-002 | DONE (2026-05-28) | FEATURE | Rebuild the app shell around one command cockpit |
| TC-003 | DONE (2026-05-28) | FEATURE | Redesign navigation as icon-first dockable panels |
| TC-004 | DONE (2026-05-28) | FEATURE | Make terminal work the primary tactical surface |
| TC-005 | DONE (2026-05-28) | FEATURE | Recast the canvas as a strategic operations map |
| TC-006 | DONE (2026-05-28) | FEATURE | Add command-first navigation and workspace actions |
| TC-007 | DONE (2026-05-28) | TASK | Harden persistence, launch, and hot-reload workflows |
| TC-008 | DONE (2026-05-29) | TASK | Run visual QA loops against the reference standard |
| TC-009 | DONE (2026-05-29) | FEATURE | Decouple PTY lifecycle from the Tauri UI |
| TC-010 | DONE (2026-05-29) | TASK | Normalize Rubik typography across non-terminal UI |
| TC-011 | DONE (2026-05-29) | TASK | Audit and repair the daily project/session flow |
| TC-012 | DONE (2026-05-29) | TASK | Raise terminal rendering quality for Zellij/TUI workloads |
| TC-013 | DONE (2026-05-29) | TASK | Prevent daemon transport failures from flooding terminals |
| ~~TC-014~~ | SUPERSEDED by TC-017 | FEATURE | Make terminal typing latency production-grade (native VTE path abandoned) |
| TC-015 | TODO | FEATURE | Per-node task badges: show associated MASTER_PLAN task + status on canvas terminals |
| TC-016 | TODO | FEATURE | Multi-agent orchestration: spawn/manage sub-agent terminals from the cockpit |
| TC-017 | IN_PROGRESS | FEATURE | Headless-VT (Rust) + canvas renderer — now the desktop default (replaces xterm); live latency/TUI confirmation pending |
| TC-017a | DONE | TASK | Stage 1: headless alacritty_terminal grid + JSON snapshot |
| TC-017b | DONE | TASK | Stage 2: full-frame Canvas2D renderer + font atlas (no diffing) |
| TC-017c | DONE | TASK | Stage 3: binary dirty-diff IPC pipeline |
| TC-017d | DONE | TASK | Stage 4: input translation & keymap (keydown to VT sequences) |
| TC-017e | DONE | TASK | Stage 5: resize/reflow + map-mode CSS transform |
| TC-017f | DONE | TASK | Stage 6: scrollback, selection, copy/paste |
| TC-017g | DONE | TASK | Stage 7: canvas is the desktop default (replaces xterm); xterm browser-only fallback. Live-confirmed in the Tauri app via verify:canvas-live: fills pane (fixed an attach-race fill bug), reflows, live render, p95 1ms input, htop/vim/tmux TUIs |
| TC-018 | TODO | FEATURE | BiDi/RTL + text shaping (Hebrew nikud) in the headless grid — depends on TC-017 |

---

## Active Work

### Phase TC - Terminal Cockpit Redesign

Primary metaphor: Terminal Cockpit / Operations Desk. The app should feel like a
single high-end developer operations center: terminal-first, keyboard-first,
information-dense, calm, and visually unified. Terminals are the tactical work
surface. Files, sessions, agents, links, and the map are supporting instruments.

Watchpost phase scope: TC-001 through TC-008 are one cohesive redesign phase.
Do not split them into unrelated cleanup/design buckets; execute them in order so
the visual system, shell, navigation, terminal surface, map, command layer, run
state, and visual QA converge on one product direction.

Design target:
- Match the reference workbench proportions more than the current graph-paper
  canvas: strong left operational dock, dominant central work area, thin top
  command strip, restrained bottom telemetry.
- Remove duplicate rails, redundant tabs, decorative breadcrumbs, and text-heavy
  controls where an icon with a tooltip is enough.
- Use one visual language everywhere: one dark surface system, one accent system,
  one typography scale, one control height, one focus treatment.
- Keep the canvas, but stop making it the default personality of the app. The
  default experience is a focused terminal cockpit; the canvas is the strategic
  map for arranging and relating sessions.
- Redesign one subsystem at a time. Each task ends with build verification,
  screenshots, and a direct comparison against the reference and these rules.

#### TC-001 - Freeze Terminal Cockpit target and visual rules `DONE (2026-05-28)`
Create the design contract before more component work. Define the final app
anatomy, component hierarchy, token map, icon rules, density rules, and visual
acceptance checklist. Capture current screenshots and the reference screenshot
as the comparison baseline.

Design contract: [docs/terminal-cockpit-design-contract.md](docs/terminal-cockpit-design-contract.md)

Acceptance:
- DONE: A short design contract exists in the linked design note.
- DONE: Every visible region has a defined purpose: top command bar, primary dock,
  terminal surface, optional map/inspector, status telemetry.
- DONE: Text-vs-icon rules are explicit for global nav, panel tabs, mode switches,
  and pane chrome.
- DONE: The next implementation task can be judged without inventing new taste rules.

#### TC-002 - Rebuild the app shell around one command cockpit `DONE (2026-05-28)`
Replace the stitched shell feeling with a single integrated workbench frame. The
top bar, side dock, main surface, and status bar must align to one grid and share
the same surface tokens. Remove old migration-era chrome that competes with the
new hierarchy.

Acceptance:
- DONE: One top command/context bar, one primary dock, one main work surface, one
  bottom telemetry bar.
- DONE: No orphaned breadcrumbs, duplicate mode bars, or floating controls attached to
  the wrong hierarchy.
- DONE: The app reads as a terminal workspace before it reads as a canvas editor.
- DONE: Desktop build and browser dev review show the same shell structure.

Completion notes:
- Added shared Terminal Cockpit surface tokens in `src/styles/theme.css`.
- Recentered the top command bar and moved mode switching into the only top bar.
- Replaced the split left/right sidebar experiment with one retractable
  contextual sidebar.
- Removed letter glyphs from shell controls in favor of `lucide-react` icons.
- Screenshot evidence: `docs/visual-baselines/tc-002-left-files-right-ops.png`.
- Verified with `npm run build`.

#### TC-003 - Redesign navigation as icon-first dockable panels `DONE (2026-05-28)`
Turn Sessions, Files, Map, Links, and future agent tools into one icon-first
navigation system. Expanded panels show detail; collapsed panels become a narrow
dock with tooltips and active-state indicators.

Acceptance:
- DONE: Global mode buttons and panel selectors use icons with accessible labels.
- DONE: Sidebars can be minimized and restored without losing state.
- DONE: The file explorer, sessions list, and map index share row styling, search
  behavior, empty states, and action placement.
- DONE: The old text-heavy tab strips are removed or demoted to secondary labels.

Completion notes:
- Added one contextual sidebar with an icon rail for Sessions, Files, and Map.
- Removed the separate right Operations sidebar.
- Added `DESIGN.md` with the standing rule that controls must use the shared
  icon pack instead of letter glyphs.
- New standalone terminals now create a full-window terminal tab and a linked
  map node using `terminalTabId`.
- Canvas terminal nodes now represent linked sessions and open the full-window
  terminal instead of spawning a separate PTY.
- Screenshot evidence: `docs/visual-baselines/tc-003-one-sidebar-linked-terminal.png`.
- Verified with `npm run build`.

#### TC-004 - Make terminal work the primary tactical surface `DONE (2026-05-28)`
Design the main terminal area as the core product, not as windows floating on a
map. Use focused pane chrome, split controls, session status, and strong focus
states that feel closer to a premium terminal/IDE than a generic canvas node.

Acceptance:
- DONE: Default workspace opens into a terminal-first tactical layout.
- DONE: Terminal pane chrome is minimal, consistent, and action-light until hover/focus.
- DONE: Split/focus/fit/rename/remove actions are discoverable through icons, menus,
  and command palette entries rather than always-visible text buttons.
- DONE: Active, inactive, warning, and busy terminal states are visually distinct
  without adding noise.

Completion notes:
- Added compact terminal pane chrome with active status, session title, CWD, and
  hover/focus icon actions.
- Replaced split/close glyph controls with `lucide-react` icons.
- Recessed terminal panes into the tactical surface with tokenized borders,
  active focus outline, and consistent pane body padding.
- Browser preview uses an in-memory test shell for app-flow validation; real
  OS shell validation still belongs in the Tauri runtime.
- Screenshot evidence: `docs/visual-baselines/tc-004-terminal-surface.png`.
- Verified with `npm run build`.

#### TC-005 - Recast the canvas as a strategic operations map `DONE (2026-05-28)`
Move beyond graph paper with windows. The map should help the user understand
session relationships, groups, and workspace shape. It can contain terminal
previews, but its primary role is strategic overview and arrangement.

Acceptance:
- DONE: Canvas grid is quieter and optional-feeling, not the dominant visual texture.
- DONE: Nodes use the same token system as the rest of the app while remaining
  recognizably spatial objects.
- DONE: Selecting a terminal pane and selecting its map node stay in sync.
- DONE: Map controls are compact, icon-first, and placed as one coherent toolbar.

Completion notes:
- Terminal map nodes are live terminal panes, not compact session references.
  The map and terminal section share the same session model so shell work is
  possible from either surface.
- Quieted the canvas grid and moved map/node styling onto the Terminal Cockpit
  surface, border, and accent tokens.
- Synchronized active terminal tabs, active panes, and terminal map-node
  selection in the workspace store.
- Switched inactive workspace surfaces to `display: none` so hidden terminal
  surfaces cannot visually leak under the map during browser review.
- Screenshot evidence: `docs/visual-baselines/tc-005-strategic-map.png`.
- Verified with `npm run build` and `cargo check`.

#### TC-006 - Add command-first navigation and workspace actions `DONE (2026-05-28)`
Make the command/search bar real: open sessions, switch panels, create terminals,
focus panes, show map, search files, and run workspace commands from one place.

Acceptance:
- DONE: Command bar supports keyboard-first workflows for the core actions.
- DONE: Browser preview supports the same core command actions with a test shell and
  demo workspace so app flows can be tested without Tauri.
- DONE: Core actions include: new terminal, switch sessions/files/map/links, split
  right/down, close pane, reset layout, and open an existing session by name.
- DONE: Visible UI can get simpler because command actions cover secondary paths.
- DONE: Keyboard shortcuts are shown in menus/tooltips where helpful, not as permanent
  explanatory text.
- DONE: Actions work consistently in browser preview, desktop dev, and release builds.

Completion notes:
- Replaced the browser datalist command hint with an owned command menu that
  filters workspace actions, sessions, panes, and open files.
- Added command actions for new terminal, terminal/map/files/sessions/links,
  split right/down, close pane, reset layout, open session, focus pane, and open
  tracked files.
- Added keyboard handling for command ownership: `Ctrl+K` focuses the command
  field in desktop runtime, arrow keys move selection, Enter runs the selected
  action, and Escape closes the menu.
- Stopped command-field keystrokes from bubbling into terminal panes.
- Screenshot evidence: `docs/visual-baselines/tc-006-command-menu.png`.
- Verified with `npm run build`, `cargo check`, and a Playwright browser
  screenshot by focusing the command field directly. Chromium reserves `Ctrl+K`
  in browser review, so shortcut proof belongs to desktop runtime.

#### TC-007 - Harden persistence, launch, and hot-reload workflows `DONE (2026-05-28)`
Make iteration and desktop launch reliable so design changes are visible in the
right runtime. The dev alias, release alias, persisted layout state, and stale
process handling should not obscure whether a redesign shipped.

Acceptance:
- DONE: `terminal-workspace-dev` starts Tauri dev mode with Vite hot reload from any
  directory.
- DONE: `terminal-workspace` launches the rebuilt release binary from any directory.
- DONE: Browser review command starts on a known available port and proves the app can
  be tested without Tauri.
- DONE: Persisted UI state has a reset path for layout/theme changes.
- DONE: The plan documents which command to use while reviewing live design changes.
- DONE: Verification includes a headed or screenshot-backed standalone smoke covering
  shell spawn, typing, split/map switching, and file explorer availability.

Live review commands:
- `terminal-workspace-dev` is the design implementation loop. It resolves the
  app directory from the symlink, clears stale port 1420/Tauri dev processes,
  and runs `npm run tauri dev` so Vite hot reload drives the desktop shell.
- `./run-browser-review.sh` or `npm run review` is the screenshot/Playwright
  loop. It runs the browser-only app at `http://127.0.0.1:5177` with strict
  port ownership so visual review does not depend on Tauri.
- `terminal-workspace` is the release smoke path after the release binary has
  been rebuilt. The alias points at `src-tauri/target/release/terminal-workspace`
  so it can be launched from any directory.
- Reset persisted layout/theme state from the command bar with `Reset layout`.
  The command clears the shared workspace storage key and reloads the app.

Completion notes:
- Added `run-browser-review.sh` and `npm run review` for deterministic
  browser screenshots on port 5177.
- Hardened `run-dev.sh` to run from its symlink target and clear stale Vite and
  Tauri dev processes before starting.
- Moved persisted workspace reset behind a store helper so UI code does not
  hardcode storage internals.
- Verified symlink targets for `terminal-workspace-dev` and `terminal-workspace`.
- Verified with `npm run build`, `cargo check`, and a browser-review server
  smoke that served `http://127.0.0.1:5177`.
- Screenshot smoke evidence:
  `docs/visual-baselines/tc-007-browser-review-smoke.png`. The smoke covers
  terminal typing, split creation, map switching with non-live session cards,
  and file Explorer availability.

#### TC-008 - Run visual QA loops against the reference standard `DONE (2026-05-29)`
Before each redesign slice is called done, capture screenshots and compare them
to the cockpit target. Track the remaining visual debt explicitly instead of
allowing partial passes to accumulate into a disjointed interface.

Acceptance:
- DONE: Each completed TC task records build/test commands and screenshot evidence.
- DONE: Browser screenshot set covers split terminal, files panel, and map mode.
- DONE: Standalone screenshot evidence covers terminal and map surfaces with real
  PTY/filesystem behavior.
- DONE: Visual review checks density, hierarchy, spacing, icon/text balance, and
  component cohesion.
- DONE: Remaining visual issues are written back into the visual QA review
  instead of patched ad hoc.
- DONE: The final pass has no obvious "many cooks" seams between shell, dock,
  terminal, map, and status areas.

Completion notes:
- Added [docs/visual-qa-review.md](docs/visual-qa-review.md) with the density,
  hierarchy, spacing, icon/text balance, and cohesion review.
- Browser evidence includes `tc-008` through `tc-013` screenshots for terminal
  typing, split terminal, linked map terminal, new session, map close, and
  terminal-section close flows.
- Standalone evidence includes `tc-014-standalone-daemon-terminal-section.png`
  and `tc-015-standalone-map-terminal.png`.
- Added `npm run verify:visual`, which checks required visual evidence files
  exist, have expected dimensions, and are not blank.

#### TC-009 - Decouple PTY lifecycle from the Tauri UI `DONE (2026-05-29)`
Move terminal process ownership out of the Tauri window/runtime lifecycle so
terminal sessions can survive frontend reloads, window restarts, and app process
crashes. The preferred architecture is a custom user-local Rust PTY daemon with
Unix-socket IPC; tmux and Zellij remain optional bridge targets, not the primary
backend. Reboot recovery should restore workspace shape, cwd, command hints, and
scrollback rather than promising CRIU-style live process resurrection.

Architecture note:
[docs/recoverable-terminal-architecture.md](docs/recoverable-terminal-architecture.md)

Progress notes:
- 2026-05-29: Terminal panes now derive stable runtime session IDs from
  `tabId + paneId` instead of random mount IDs. The Tauri PTY manager reuses an
  existing stable ID and guards the concurrent attach race by killing the later
  duplicate child before it can replace the first owner. React unmounts and
  cancelled startup mounts now detach without killing the backend PTY; explicit
  close actions remain the destructive path.
- 2026-05-29: Added Tauri `pty_ensure` and `pty_snapshot` APIs plus bounded
  Rust-side scrollback. Reused stable sessions now replay backend-owned output
  after frontend reloads or map/terminal reattach instead of opening as visually
  blank xterm surfaces.
- 2026-05-29: Added explicit terminal runtime status metadata
  (`starting`, `running`, `reconnected`, `stale`, `failed`) and surfaced it in
  split-pane chrome. The UI no longer has to infer liveness from the presence
  of a rendered terminal node alone.
- 2026-05-29: Workspace persistence now keeps terminal metadata snapshots and
  restores them as `stale` restartable sessions instead of deleting all terminal
  records or pretending raw live PTY handles survived. Browser preview and Tauri
  restart stale links through the stable `tabId + paneId` runtime session ID.
- 2026-05-29: Split the Rust PTY engine from direct Tauri event emission behind
  a daemon-ready event sink, and added a `daemon_status` command that checks the
  user-local Unix socket path. At this step the app still used the embedded
  Tauri PTY owner, but startup gained an explicit external-daemon detection
  surface for the next ownership migration.
- 2026-05-29: Added a `terminal-workspace-daemon` Rust binary that binds the
  user-local Unix socket and answers a versioned `status` protocol. `daemon_status`
  now verifies the protocol response instead of treating any connectable socket
  as valid. Cargo `default-run` keeps Tauri packaging pointed at the desktop app
  while the daemon binary can be built and launched separately.
- 2026-05-29: Added typed daemon IPC for `ensureSession` and `listSessions`.
  The daemon process can now own detached PTYs through the same `PtyManager`
  engine and report session metadata over the Unix socket. Live verification
  spawned a daemon-owned `cat` session and listed it with pid, cwd, command, and
  scrollback byte count.
- 2026-05-29: Extended daemon IPC to cover the terminal control plane:
  `writeSession`, `resizeSession`, `snapshotSession`, `getSessionCwd`, and
  `killSession`. Live verification wrote to a daemon-owned `cat` PTY, read the
  echoed data back from daemon-owned scrollback, resized it, read cwd, killed it,
  and confirmed `listSessions` was empty.
- 2026-05-29: Added daemon-readable output cursors with `readSession`. The PTY
  engine now stores scrollback with a monotonic byte offset, so a frontend or
  bridge process can poll only new output and keep xterm buffers live without
  relying on React mount events.
- 2026-05-29: Wired the frontend terminal hook to prefer the external daemon
  when `daemon_status` reports it reachable. In that mode, terminals call
  `daemon_ensure_session`, poll `daemon_read_session`, and send writes/resizes
  through daemon IPC; if the daemon disappears during attach, the hook falls
  back to embedded Tauri PTYs instead of leaving a dead terminal surface.
- 2026-05-29: Release-app smoke with `terminal-workspace-daemon` running under
  `/run/user/1000` created daemon-owned PTYs from the standalone UI. Screenshot
  evidence is in `/tmp/terminal-workspace-standalone-terminal-section.png`, and
  daemon `listSessions` reported release-created bash sessions with growing
  scrollback after typed input.
- 2026-05-29: Added `npm run verify:standalone-daemon`, a repeatable desktop
  smoke that launches the daemon plus release app, focuses the terminal section,
  pastes a clean command through the GUI, and verifies the command output in
  daemon-owned PTY scrollback via `snapshotSession`.
- 2026-05-29: The release app now auto-launches the user-local daemon by
  spawning the same desktop binary with `--terminal-workspace-daemon` before
  terminal attach. The standalone daemon smoke no longer pre-starts the daemon:
  it verifies app-driven launch, terminal I/O through daemon scrollback, daemon
  survival after killing the app window, and reattach to the same daemon PTY
  after relaunch.
- 2026-05-30: `npm run verify:standalone-daemon` now builds its own non-reset
  release artifact before testing. This prevents native VTE verifier builds that
  embed `VITE_WORKSPACE_RESET_STATE=1` from invalidating standalone restart
  reattach evidence. Fresh evidence passed for
  `terminal-50440931-2480-4835-880e-e1768495be6b-b66262df-9264-47e9-8c38-50ddcc60e7db`.

Acceptance:
- Tauri startup can detect or launch the user-local terminal daemon.
- Real PTY ownership lives in the daemon, not React component mounts or Tauri
  window state.
- Terminal panes attach/detach to stable session IDs without killing processes
  on unmount.
- Closing a session is explicit and distinct from hiding, switching, or
  unmounting a terminal view.
- Workspace persistence records terminal groups, split layout, canvas links,
  cwd, status, and bounded scrollback.
- After app restart, existing live sessions reconnect where the daemon survived.
- After OS reboot, stale sessions restore as restartable session cards with
  scrollback/context, not as fake live processes.

#### TC-010 - Normalize Rubik typography across non-terminal UI `DONE (2026-05-29)`
Make every visible UI surface outside the terminal buffer use the same Rubik
typography system. The interface should read as one product, not a mix of
terminal mimicry, file-tree defaults, and status-bar microtype.

Acceptance:
- Non-terminal UI text inherits Rubik through `--font-ui`.
- UI weights are light: 400 by default, 500 only for selected row names,
  section anchors, and command labels.
- 600+ weights are not used in visible UI except tiny file-type badges where
  legibility at icon scale requires it.
- Monospace is reserved for xterm terminal buffers and truly code-like inline
  content.
- Operations header, Explorer header/tree, map nodes, top status, command menu,
  and bottom status bar look typographically cohesive in one screenshot.

Completion notes:
- Removed unused heavy Rubik 600/700 imports so the visible UI weight system is
  limited to 300/400/500.
- Normalized non-terminal `letterSpacing` declarations to 0 across sidebars,
  map chrome, project rail, and status bar.
- Added `npm run verify:typography`, which fails on visible 600+ UI weights,
  non-zero letter spacing, unused heavy Rubik imports, or monospace usage outside
  allowed terminal/code surfaces.
- Verified with `npm run verify:typography`, `npm run verify:map-terminals`,
  `npx tsc --noEmit --pretty false`, `npx playwright test
  tests/terminal-user-flows.spec.ts --reporter=line`, `cargo test`, and
  `npm run build`.

#### TC-011 - Audit and repair the daily project/session flow `DONE (2026-05-29)`
Run the core user flow end-to-end before more visual polish. The app should be
understandable in 10 seconds: files live in the file tree, projects/sessions
live in the operations panel, the main surface is Terminal or Map, and Map
renders live terminal panes.

Flow:
1. Open app.
2. Create or select a project workspace.
3. Open a terminal in that project.
4. Keep Files visible or hidden independently.
5. Switch between Terminal and Map.
6. Pin an important terminal to Map.
7. Close/kill that terminal from either surface.
8. Return to terminal work without losing context.

Acceptance:
- No duplicate navigation controls.
- Files can stay open while switching Terminal and Map.
- Creating a terminal creates a live terminal map node through store reconciliation.
- Show on Map focuses the canonical live terminal map node.
- Closing a live map terminal closes the real session.
- A project session can be created without going through Files first.
- Selected items use amber accent only, never white outlines.

Verification notes (2026-05-29):
- Replaced compact map terminal references with live `TerminalComponent` panes.
- Added a source contract check so map terminals cannot regress to placeholder
  cards or stale `terminal-map-*` filtering.
- Browser flow verified with
  `npx playwright test tests/terminal-user-flows.spec.ts --reporter=line`.
  The regression now covers live Map terminals, command input through the Map,
  returning from Map to Terminal, creating a second session, and closing a Map
  terminal session without leaving placeholder cards behind. It also covers
  reopening the Terminal section, closing the session from the Terminal section,
  and verifying the replacement terminal remains usable.
- Split-pane Map attach verified: after splitting, Map now attaches to the
  active pane PTY instead of a stale first-pane/node PTY, and the browser
  regression asserts the Map command lands in the active split PTY.
- Type/build verified with `npx tsc --noEmit --pretty false` and
  `npm run build`.
- Standalone Tauri verified through `npm run tauri dev`; screenshot evidence:
  `/tmp/terminal-workspace-verification/tauri-race-fix-entered.png` and
  `/tmp/terminal-workspace-verification/standalone-map-focus-fix.png`.
- PTY lifecycle fix: React unmounts no longer kill session PTYs; explicit
  session close still kills through `closeTerminalSession`.
- Added a visible Terminal-section session close action that calls the same
  `closeTerminalSession` path as Map close.
- Browser PTY lifecycle now matches explicit close semantics: `closeTerminalSession`
  destroys browser PTY sessions instead of leaving stale hidden runtime sessions
  in `__terminalWorkspaceBrowserPtys`, and the browser regression asserts closed
  PTY IDs are removed.
- Project creation regression verifies a project session can be created directly
  from the operations panel, without touching Files first, and the new project
  terminal accepts input.
- Standalone PTY kill behavior now has Rust coverage: `cargo test` exercises
  `PtyManager::spawn`, writes to the PTY, calls `kill`, and asserts later writes
  fail because the PTY entry was removed.
- Verified again with `npm run verify:map-terminals`,
  `npm run verify:terminal-rendering`, `npm run verify:typography`,
  `npx tsc --noEmit --pretty false`, `npx playwright test
  tests/terminal-user-flows.spec.ts --reporter=line`, `cargo test`, and
  `npm run build`.

#### TC-012 - Raise terminal rendering quality for Zellij/TUI workloads `DONE (2026-05-29)`
Treat Zellij, tmux, htop, and other TUIs as first-class rendering targets. The
embedded terminal should look like a real terminal emulator: crisp box drawing,
clean ANSI color blocks, tight cell metrics, and no cheap-looking chrome or
font mismatch.

Acceptance:
- xterm uses a terminal-appropriate mono stack, tighter line height, explicit
  font weights, and no extra letter spacing.
- WebGL renderer is enabled when available and falls back cleanly.
- PTY sessions advertise a capable terminal environment (`TERM`,
  `COLORTERM`, locale) so TUIs render color and box drawing correctly.
- Terminal padding and pane sizing do not compress or blur full-screen TUIs.
- Build and source checks pass after the rendering change.

Completion notes:
- xterm uses a TUI-capable mono stack, explicit regular/bold weights, zero
  letter spacing, tight line height, and WebGL with a DOM fallback.
- Tauri PTYs advertise `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG`,
  and `LC_CTYPE`.
- Split terminal bodies now flex-fill remaining pane space instead of manually
  subtracting chrome height, and `.terminal-container` has zero padding so fit
  calculations do not steal rows or columns from full-screen TUIs.
- Added `npm run verify:terminal-rendering` to lock the terminal rendering
  contract.
- Verified with `npm run verify:terminal-rendering`, `npm run verify:typography`,
  `npm run verify:map-terminals`, `npx tsc --noEmit --pretty false`,
  `npx playwright test tests/terminal-user-flows.spec.ts --reporter=line`,
  `cargo test`, and `npm run build`.

#### TC-013 - Prevent daemon transport failures from flooding terminals `DONE (2026-05-29)`
Harden the frontend PTY transport path so a refused, stale, or dead daemon socket
cannot fill the terminal buffer with repeated infrastructure errors such as
`[pty write failed] Connection refused (os error 111)`. Transport failures are
runtime state, not shell output.

Reliability note:
[docs/terminal-transport-failure-recovery.md](docs/terminal-transport-failure-recovery.md)

Acceptance:
- DONE: Daemon and embedded PTY write failures transition the terminal runtime
  to `failed` once instead of writing repeated diagnostic lines into xterm.
- DONE: Daemon read failures stop the broken transport and publish failed
  runtime metadata without appending `[pty read failed]` to the shell buffer.
- DONE: After a transport failure, additional writes through that broken path
  are ignored until the terminal is restarted or reattached.
- DONE: Source verification rejects any future reintroduction of
  `[pty write failed]` or `[pty read failed]` terminal-buffer output.
- DONE: Existing browser flow, standalone daemon restart reattach, Rust PTY
  tests, and production build still pass.

Completion notes:
- Added a single `stopBrokenTransport` path in `src/hooks/usePty.ts` for read
  and write transport failures.
- The hook now disposes broken listeners, clears daemon polling, nulls the
  failed PTY id, publishes `failed` runtime status, and keeps transport
  diagnostics in the developer console rather than the user terminal.
- Updated `npm run verify:map-terminals` to lock the no-terminal-buffer-spam
  invariant.
- Verified with `npm run verify:map-terminals`, `npm run build`, `cargo test`,
  `npx playwright test tests/terminal-user-flows.spec.ts --reporter=line`,
  `npm run verify:standalone-daemon`, `rg "\[pty write failed\]|\[pty read failed\]"`
  across app/test/script sources, and `git diff --check`.

#### TC-014 - Make terminal typing latency production-grade `SUPERSEDED by TC-017 (2026-05-30)`

Outcome: the native GTK/VTE overlay path was abandoned. It is fundamentally
incompatible with the product: VTE's hardcoded ~80x24 minimum size produced
negative-width GTK allocations and pixman crashes, keyboard focus was unreliable,
and a native GTK widget cannot live on the zoom/pan HTML canvas (the GTK
compositor ignores CSS transforms). External research confirmed both the
WebKitGTK xterm.js latency problem and the GTK-over-webview embedding dead end.
Decision: route all terminals to xterm.js short-term (committed, working but
laggy), and rebuild the renderer as a headless VT in Rust + a custom HTML canvas
renderer. See TC-017. Native VTE code is preserved under the git tag
`native-vte-snapshot`. Research notes:
`docs/terminal-renderer-decision-perplexity-query.md`.

The historical TC-014 investigation notes below are retained for reference.

Typing in the Tauri terminal must feel immediate enough for daily shell work.
The reliable solution is not optimistic local echo; it is measured key-to-render
latency plus a persistent low-latency input transport that preserves real PTY
semantics.

Problem statement:
- Linux Tauri/WebKitGTK and xterm.js can feel slower than native GPU terminals.
- Backend trace evidence showed daemon receive, PTY write, PTY echo read, and
  daemon emit can happen in the same millisecond, so remaining lag must be
  measured through frontend IPC, xterm rendering, WebKit paint, React remount,
  resize, or focus/layout paths.
- Output already moved away from polling to daemon push via Tauri `Channel`.
  Input has moved off the direct command-response hot path and now uses the
  one-way `terminal-workspace-daemon-input` event feeding a single Rust worker
  queue. That worker writes to a persistent daemon input Unix stream per PTY
  session.
- Fresh release traces after listener cleanup prove the remaining bottleneck is
  the frontend render path: duplicate input listeners are held to one, duplicate
  sequence IDs are absent, daemon subscribers stay at one, and backend input is
  near-zero while xterm/WebKit write-to-render and key-to-RAF remain too high
  for the 15-25ms p95 key-to-glyph target.

Directives:
- Do not implement optimistic local echo or PTY echo suppression as the primary
  fix. It risks correctness in password prompts, SSH, readline, bracketed
  paste, alternate-screen TUIs, and control-key handling.
- Build instrumentation before further performance claims. Backend-only traces
  and daemon scrollback assertions are not enough.
- Keep Tauri commands for the control plane: ensure, resize, kill, snapshot,
  status, and recovery. Move terminal input to a persistent stream/socket.
- Keep xterm mutations outside React state and verify terminal instances do not
  remount during normal tab, map, sidebar, or HMR workflows.
- Dev and release must be measured separately. Dev must launch through
  `run-dev.sh` so stale app and daemon processes cannot hide the real behavior.
- Do not keep fighting WebKitGTK/xterm once release traces prove paint/render is
  the ceiling. The production path is native active panes with React/Tauri kept
  as the cockpit/orchestration shell.
- Active desktop terminal sessions should migrate to native panes first, with
  xterm.js retained as browser preview and unsupported-platform fallback.

Tasks:
- DONE: Remove any partial local-echo stubs and keep the codebase free of
  unapproved local echo behavior.
- DONE: Add a dev-only latency tracer that records keydown, xterm `onData`,
  input send start/end, daemon receive, PTY write, PTY output read, channel
  receive, `term.write`, xterm write callback, xterm render event, and next
  animation frame.
- DONE: Add a compact trace summary or script that reports p50/p95/p99 for
  key-to-daemon, daemon-to-channel, channel-to-write, and write-to-render.
- DONE: Replace direct per-keystroke command-response writes in the hot input
  path with one-way event input and a single Rust daemon input worker queue.
- DONE: Replace event-worker-to-daemon request/response writes with a persistent
  Unix-stream-backed daemon input writer per PTY session.
- DONE: Keep input flushing immediate for printable typing and control keys,
  while batching paste payloads safely.
- DONE: Add subscriber-count verification so HMR/remounts cannot stack daemon
  output streams.
- DONE: Add a terminal latency benchmark that drives fast typing in dev and
  release and asserts no missing/repeated glyphs.
- DONE: Add `npm run verify:daemon-latency`, a backend-only benchmark that
  types through the persistent daemon input stream and waits for echoed output
  through daemon subscription. Current real-daemon evidence: p95 ~= 1.3ms,
  which isolates the remaining perceived lag above the daemon/PTY layer.
- DONE: Add `docs/terminal-latency-perplexity-query.md` for external research
  on Tauri/WebKitGTK/xterm latency after daemon input streaming.
- DONE: Audit `TerminalComponent` and `usePty` for hot-path React state updates,
  remounts, `FitAddon.fit()` loops, resize loops, and WebGL fallback.
- DONE: If post-streaming traces prove WebKit/xterm paint remains the bottleneck,
  document the native terminal-pane fallback options before implementing.
  See `docs/native-terminal-pane-architecture.md`.
- DONE: Add the Tauri command contract for native terminal panes:
  capabilities, create, update, and destroy. The first checked-in command
  surface is intentionally capability-gated until the GTK/VTE widget backend is
  compiled.
- DONE: Add Linux VTE dependency diagnostics. Current local evidence: GTK3 dev
  headers and VTE runtime are present; `vte-2.91.pc` is optional because the
  backend now uses runtime symbol loading from `libvte-2.91.so.0`.
- DONE: Add a `native-vte` Cargo feature and runtime VTE ABI loader. The
  feature is intentionally outside default builds and no longer requires
  `libvte-2.91-dev` just to compile.
- DONE: Add explicit native terminal readiness phases (`runtimeMissing`,
  `developmentHeadersMissing`, `backendNotCompiled`, `embeddingNotReady`,
  `directPtyNotReady`, `ready`) and frontend trace fields so fallback state is
  diagnosable without guessing.
- DONE: Add native create-request validation for session/tab/pane identity and
  positive pane bounds before the GTK/VTE backend can attach native widgets.
- DONE: Add a feature-gated GTK/VTE embedding module that receives the Tauri
  `WebviewWindow`, obtains the Linux GTK `default_vbox()`, creates a raw VTE
  terminal widget, packs it into the GTK container, and tracks update/destroy
  lifecycle. Native availability remains gated until direct PTY ownership is
  implemented.
- DONE: Add runtime VTE direct-PTY spawning through `vte_terminal_spawn_sync`
  and `vte_terminal_watch_child`, using the requested command or a login shell
  without local echo or shell-behavior simulation.
- DONE: Make `npm run verify:native-vte-build` pass without `libvte-2.91-dev`
  by resolving VTE symbols at runtime from the installed runtime library.
- DONE: Add `./run-native-vte-dev.sh`, `npm run tauri:dev:native-vte`, and
  `npm run verify:native-vte-runtime` so headed verification can launch the
  actual native feature build rather than the default xterm fallback build.
- DONE: Switch the `terminal-workspace-dev` launcher to the native VTE feature
  build so normal local dev no longer exercises the laggy xterm/WebKitGTK
  terminal path by accident.
- DONE: Replace the first GTK packing attempt with an overlay/fixed-layer
  embed that keeps the runtime-loaded VTE widget inside the measured active
  pane bounds instead of below the WebView. Current headed evidence:
  `npm run verify:native-vte-runtime` observed `native-terminal-vte-attached`
  and captured `/tmp/terminal-workspace-native-vte-runtime.png` with the VTE
  surface inside the selected map terminal pane.
- DONE: Add native-pane bounds/focus synchronization from React through
  `ResizeObserver`, window resize/scroll events, and a low-frequency 250ms
  reconciliation tick. The tick sends GTK bounds updates outside the keystroke
  path so native overlay geometry can recover from WebKitGTK/Tauri event gaps.
- DONE: Prevent native focus churn by keeping xterm focus calls out of native
  mode and only calling GTK `grab_focus()` on a native focused-state transition
  instead of every geometry reconciliation.
- DONE: Extend `npm run verify:native-vte-runtime` to prove VTE attach,
  typed-command input (`echo native-vte-input-ok`), and continuing native pane
  reconciliation updates with screenshot evidence.
- DONE: Make native VTE dev launchers resource-conservative by exporting
  `CARGO_BUILD_JOBS=1` and `CARGO_PROFILE_DEV_DEBUG=0`. This targets local
  `Killed` failures during the final Rust compile/link step by trading first
  native dev build speed for lower peak memory.
- DONE: Increase the native VTE headed smoke startup wait budget so serialized
  first-time native feature builds do not fail before the window can open.
- DONE: Reduce native VTE dev compile/link pressure by changing the desktop
  Rust library crate output to `rlib` only. The app binary links the library
  directly; generating `staticlib`/`cdylib` artifacts in dev produced hundreds
  of megabytes of unused output and contributed to local `Killed` failures.
- DONE: Extend `npm run verify:native-vte-runtime` to prove split-pane native
  VTE attach and typed input. Current headed evidence observed two
  `native-terminal-vte-attached` records and captured
  `/tmp/terminal-workspace-native-vte-dev-runtime-split.png`.
- DONE: Add `npm run verify:native-vte-release-runtime`, which builds through
  the Tauri CLI release path with `native-vte`, forces split workspace mode and
  the native renderer for the verifier build, launches the release binary, and
  proves native VTE attach/input/split outside dev/HMR. Current headed evidence
  observed release `native-terminal-vte-attached` records and captured
  `/tmp/terminal-workspace-native-vte-release-runtime.png` plus
  `/tmp/terminal-workspace-native-vte-release-runtime-split.png`.
- DONE: Add trace-only native VTE GTK/VTE signal probes for `key-press-event`,
  `commit`, `contents-changed`, GTK `draw`, and GDK frame-clock
  `after-paint`, plus
  `scripts/summarize-native-vte-latency-trace.mjs`. The native runtime smokes
  now fail if key-to-VTE-commit p95 exceeds 5ms. Fresh evidence:
  `npm run verify:native-vte-runtime` reported `native_key_to_commit` p95 1ms,
  p99 1ms; `npm run verify:native-vte-release-runtime` reported p95 0ms, p99
  0ms. `contents-changed` remains diagnostic only because VTE batches it and it
  does not represent per-glyph paint.
- DONE: Add `npm run verify:native-vte-visual-latency`, a release-only native
  VTE benchmark that drives isolated keystrokes at a controlled cadence and
  gates both key-to-GTK-draw and key-to-GDK-frame-after-paint p95 at 25ms.
  Fresh headed release evidence after the daemon bridge and frame-clock probe:
  `native_key_to_after_paint` p50 9ms, p95 15ms, p99 15ms;
  `native_key_to_draw` p50 9ms, p95 15ms, p99 15ms;
  `native_key_to_commit` p95 1ms; screenshot
  `/tmp/terminal-workspace-native-vte-visual-latency.png`. This is the current
  closest automated proxy for key-to-glyph paint without adding local echo or
  shell simulation.
- DONE: Add trace-only native VTE destroy records and
  `npm run verify:native-vte-lifecycle`, a release-headed verifier for native
  pane lifecycle transitions. Fresh evidence: map switch destroyed native panes,
  map-card activation reattached native VTE in split mode, close pane destroyed
  a native pane, splitting again reattached, and window resize produced 72
  native pane updates with 3 unique measured widths. Current run passed after
  render acceleration with `attaches=5`, `destroys=3`, `updates=70`,
  `unique_widths=3`, screenshots in
  `/tmp/terminal-workspace-native-vte-lifecycle`.
- DONE: Replace native VTE direct shell ownership with a daemon-backed stdio
  bridge. VTE now spawns the app binary with
  `--terminal-workspace-daemon-stdio --id <stable-session-id>`, puts the bridge
  PTY in raw/no-echo mode, streams VTE input into the detached daemon PTY, and
  writes daemon output back to VTE. This preserves native rendering while making
  the Rust daemon the durable PTY owner for restart/reconnect.
- DONE: Add `npm run verify:native-vte-restart-reconnect`, a release-headed
  verifier that exports a shell variable through native VTE, kills only the app,
  confirms the external daemon survives, relaunches, reattaches to the same
  native VTE session id, and verifies `echo $TW_NATIVE_RECONNECT_MARKER`
  returns the original marker from the same daemon-owned shell. Fresh evidence:
  `Native VTE restart reconnect passed; session=terminal-e8f24b24-ddb2-481f-876c-fce89682c14d-8d621bc8-93b5-4a24-9ec8-c68f9d1ecb30`,
  screenshots in `/tmp/terminal-workspace-native-vte-restart-reconnect`.
- DONE: Re-verify after the daemon bridge: release native visual latency still
  passes with `native_key_to_draw` p50 7ms, p95 17ms, p99 19ms; lifecycle still
  passes with `attaches=8`, `destroys=5`, `updates=71`, `unique_widths=3`.
- DONE: Make native pane attachment deterministic by storing the terminal host
  DOM node in React state. Passing `ref.current` directly was non-reactive and
  could leave release builds on the web/xterm fallback until an unrelated
  re-render happened.
- DONE: Add verifier-only build-time overrides for terminal renderer and
  workspace mode (`VITE_TERMINAL_RENDERER_MODE=native-vte`,
  `VITE_WORKSPACE_MODE=split`) so persisted local UI state cannot accidentally
  turn release evidence into a map/xterm smoke.
- DONE: Add verifier-only `VITE_WORKSPACE_RESET_STATE=1` so repeated smoke runs
  start from a deterministic one-pane layout and do not inherit stale
  localStorage split geometry. This fixed prior false evidence where repeated
  split tests shrank the active pane to unusable widths.
- DONE: Diagnose `Could not connect to localhost: Connection refused` during
  dev checks: it occurs when no Vite process is listening on port 1420, or when
  a raw Cargo-built desktop binary expects the dev URL. Verified
  `terminal-workspace-dev` starts Vite and `curl http://127.0.0.1:1420/`
  returns `HTTP/1.1 200 OK`; standalone/release proof must use
  `npm run verify:native-vte-release-runtime`, which embeds `frontendDist`.
- DONE: Fix the broken canvas/map terminal. The native VTE backend draws on a
  fixed GTK overlay above the WebView (absolute margin + `set_size_request` in
  `native_gtk_pane.rs`); it cannot scale with canvas zoom or clip to the canvas
  viewport, so on the map it rendered as a floating, mispositioned terminal that
  overlapped the toolbar and other nodes. Canvas terminal nodes now keep the
  native pane off (`enabled: isRuntimeVisible && !standalone` in `Terminal.tsx`).
  In browser/unsupported fallback they still use the DOM xterm renderer because
  it transforms and clips with the canvas. In native-capable desktop mode they
  are activation cards instead of active xterm inputs; clicking the card switches
  to the linked split pane where native VTE owns interactive typing. Locked in
  by `verify:map-terminals` source assertions and
  `npm run verify:native-vte-lifecycle`, which now proves map mode destroys
  native panes and map-card activation reattaches native VTE in split mode.
  Fresh lifecycle evidence: `attaches=5`, `destroys=3`, `updates=72`,
  `unique_widths=3`, screenshots in `/tmp/terminal-workspace-native-vte-lifecycle`.
- DONE: Validate native VTE restart/reconnect behavior after app process
  restart with daemon-backed native VTE sessions.
- DONE: Add `npm run verify:native-vte-pixel-latency`, an external X11
  screen-pixel cross-check that runs the release native VTE app without
  per-key latency trace probes, drives sustained typing via in-process XTest
  events, samples the same glyph position with unmeasured backspace resets, and
  gates first visible pixel change at p95 <= 25ms. Fresh headed release evidence
  after native VTE content-change paint requests: `samples=60`, p50 13ms, p95
  14ms, p99 17ms, max 17ms, report
  `/tmp/terminal-workspace-native-vte-pixel-latency-report.json`, screenshot
  `/tmp/terminal-workspace-native-vte-pixel-latency.png`. This is the current
  independent key-to-glyph gate; the GTK frame-clock `after-paint` trace remains
  the in-process diagnostic gate.
- DONE: Add native VTE render acceleration by queueing a GTK draw and requesting
  the frame-clock paint phase on VTE `contents-changed`. This fixed the
  external screen-pixel tail without local echo, PTY echo suppression, or shell
  behavior simulation.

Current snippets to share for external review:

Frontend `onData` / daemon write path in `src/hooks/usePty.ts`:
```ts
dataDisposableRef.current = terminal!.onData((data: string) => {
  if (ptyIdRef.current) {
    queueDaemonInput(data);
  } else if (!transportFailedRef.current) {
    pendingWrites.push(data);
  }
});

const flushDaemonInput = () => {
  daemonInputFlushTimeout = null;
  if (!ptyIdRef.current || !pendingDaemonInput) return;
  const data = pendingDaemonInput;
  pendingDaemonInput = "";
  emit(DAEMON_INPUT_EVENT, { id: ptyIdRef.current, data }).catch((writeError) => {
    tracePty("frontend.daemon.write.emit.failed", {
      bytes: data.length,
      error: String(writeError),
    });
    invoke("daemon_write_session", { id: ptyIdRef.current, data }).catch(
      (fallbackError) => {
        stopBrokenTransport(fallbackError, "write");
      }
    );
  }).finally(() => {
    tracePty("frontend.daemon.write.emit.end", {
      bytes: data.length,
    });
  });
};
```

Latency trace enablement:
```bash
TERMINAL_WORKSPACE_TRACE_LATENCY=1 npm run tauri dev
npm run trace:terminal-latency
```

Tauri event worker in `src-tauri/src/commands.rs`:
```rust
pub const DAEMON_INPUT_EVENT: &str = "terminal-workspace-daemon-input";
static DAEMON_INPUT_SENDER: OnceLock<Sender<DaemonInputEvent>> = OnceLock::new();

pub fn start_daemon_input_worker() {
    let _ = DAEMON_INPUT_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<DaemonInputEvent>();
        std::thread::spawn(move || {
            let mut streams = HashMap::<String, UnixStream>::new();
            for payload in receiver {
                if let Err(error) = write_daemon_input_stream(&mut streams, payload.id, payload.data) {
                    eprintln!("terminal workspace daemon input write failed: {error}");
                }
            }
        });
        sender
    });
}

pub fn handle_daemon_input_event(payload: &str) {
    let payload = match serde_json::from_str::<DaemonInputEvent>(payload) {
        Ok(payload) => payload,
        Err(error) => {
            eprintln!("terminal workspace daemon input payload parse failed: {error}");
            return;
        }
    };

    if let Some(sender) = DAEMON_INPUT_SENDER.get() {
        if sender.send(payload).is_ok() {
            return;
        }
    }
    eprintln!("terminal workspace daemon input worker is unavailable");
}
```

Persistent daemon input stream in `src-tauri/src/daemon.rs`:
```rust
fn handle_daemon_input_stream(
    stream: &mut UnixStream,
    pty_manager: &PtyManager,
    id: &str,
    initial_data: &[u8],
) -> Result<(), String> {
    stream.set_read_timeout(None).map_err(|error| error.to_string())?;
    if !initial_data.is_empty() {
        let data = String::from_utf8_lossy(initial_data);
        pty_manager.write(id, &data)?;
    }

    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            return Ok(());
        }
        let data = String::from_utf8_lossy(&buffer[..count]);
        pty_manager.write(id, &data)?;
    }
}
```

Tauri fallback command in `src-tauri/src/commands.rs`:
```rust
#[tauri::command]
pub fn daemon_write_session(id: String, data: String) -> Result<(), String> {
    match send_daemon_request(DaemonRequest::WriteSession { id, data })? {
        DaemonResponse::WriteSession { ok: true } => Ok(()),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}
```

Daemon request handler in `src-tauri/src/daemon.rs`:
```rust
DaemonRequest::WriteSession { id, data } => {
    pty_manager.write(&id, &data)?;
    DaemonResponse::WriteSession { ok: true }
}
```

PTY write in `src-tauri/src/pty.rs`:
```rust
pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
    let mut ptys = self.ptys.lock().unwrap();
    let entry = ptys
        .get_mut(id)
        .ok_or_else(|| format!("PTY {} not found", id))?;
    entry
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    entry.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}
```

Acceptance:
- Key-to-render latency benchmark exists and runs against both Tauri dev and
  release builds.
- The benchmark reports latency distribution, not only eventual daemon
  scrollback.
- Persistent input transport replaces per-key Tauri command invocation.
- No optimistic local echo is introduced.
- Fast typing has no repeated or missing glyphs.
- HMR/remount does not accumulate daemon subscribers.
- Existing standalone daemon restart, map terminal, browser flow, Rust tests,
  and release build verifications stay green.

Progress notes (2026-05-29):
- Removed the normal daemon input dependency on per-write
  `invoke("daemon_write_session")`. xterm `onData` and imperative paste writes
  now emit `terminal-workspace-daemon-input`; the Rust worker writes to a
  persistent Unix stream opened with `DaemonRequest::InputStream`.
- Added opt-in latency tracing with `TERMINAL_WORKSPACE_TRACE_LATENCY=1`.
  Frontend, Tauri, daemon, PTY, channel, xterm write callback, render, and RAF
  checkpoints are written to per-process/per-thread JSONL trace files under
  `/tmp/terminal-workspace-latency-trace-*.jsonl`.
- Added `npm run trace:terminal-latency` to summarize p50/p95/p99 latency
  buckets across those trace files.
- Tightened `npm run verify:tauri-performance` polling from 100ms to 50ms and
  added `fast_type_integrity_ms`, which fails if a fast typed token is missing
  or repeated in daemon scrollback.
- Added `npm run verify:tauri-dev-performance`, which launches via `./run-dev.sh`
  so stale Vite/app/daemon processes are cleared before dev-mode latency is
  judged.
- Added `subscriberCount` to daemon `listSessions` and assert
  `max_subscribers_before <= 1` and `max_subscribers_after_toggle <= 1` in the
  release and dev performance verifiers.
- Hot-path audit result: xterm writes and input listeners stay in refs/effects,
  not React state; `FitAddon.fit()` is visibility/resize driven, not input
  driven; WebGL load/fallback is traced; no local echo path is present.
- Release trace evidence from a passing run: `typed_last_char_echo_ms=109`,
  `fast_type_integrity_ms=553`, input send to Tauri receive p95 `2ms`,
  worker to daemon stream receive p95 `1ms`, daemon stream receive to PTY write
  start p95 `0ms`, PTY write start to end p95 `1ms`, channel receive to
  xterm write call p95 `13ms`, write call to RAF p95 `8ms`.
- Bounded release key-to-render summary after trace pairing fixes:
  `ondata_to_write_call` p95 `24ms`, `keydown_to_write_raf` p95 `28ms`.
- Dev verifier evidence from `./run-dev.sh`: `typed_last_char_echo_ms=94`,
  `fast_type_integrity_ms=564`, `max_subscribers_before=1`,
  `max_subscribers_after_toggle=1`.
- Traced dev evidence: `typed_last_char_echo_ms=92`,
  `fast_type_integrity_ms=686`, input send to Tauri receive p95 `2ms`,
  worker to daemon stream receive p95 `1ms`, daemon stream receive to PTY write
  start p95 `0ms`, PTY write start to end p95 `1ms`,
  `ondata_to_write_call` p95 `23ms`, `keydown_to_write_raf` p95 `31ms`.

#### TC-017 - Headless-VT (Rust) + custom canvas renderer `IN_PROGRESS`

Replace the terminal renderer entirely. The PTY/daemon backend is fast (~1ms p95)
and stays. The problem is the renderer: xterm.js on WebKitGTK has baseline +
over-time typing lag (WebGL/DMA-BUF instability, JS heap growth), and the native
GTK/VTE overlay is a dead end (see TC-014). Target architecture: Rust owns the
terminal grid state via a headless VT crate fed by PTY bytes; Rust computes
dirty-cell diffs and pushes a compact binary payload to the frontend; React draws
glyphs on a plain HTML5 `<canvas>` via a font atlas. This kills WebKitGTK render
lag and JS heap growth, and because it is a normal DOM `<canvas>` it pans/zooms
with CSS — one renderer works in both split and map surfaces, and it future-proofs
multi-agent/standalone/overlay modes.

Hard constraints (carried forward): no optimistic local echo / no PTY echo
suppression. Keep xterm.js behind a flag as the working fallback until the canvas
renderer passes a TUI-correctness + latency bar, then delete it (TC-017g).

Crate decision: **`alacritty_terminal` (v0.22+)**, used headless. Feed it PTY
bytes (`process_new_bytes`), read its grid (`grid().display_iter()`); it must NOT
own the PTY — the existing daemon stays the PTY authority. Rejected: `vt100`
(weaker modern-TUI correctness) and `wezterm-term` (heavy ecosystem coupling).

Binary wire format (little-endian, frontend reads as ArrayBuffer):
- `[0]` u8 message type (0x01 = diff, 0x02 = full sync)
- `[1..5]` cursor x,y (u16 each)
- `[5..9]` u32 mode flags (alt screen, cursor hidden, ...)
- `[9..]` dirty rows: each = u16 row index, u16 changed-cell count, then
  12-byte cells: u32 UTF-32 char, u32 fg RGBA, u32 bg RGBA, u16 style flags
  (bold/italic/underline/inverse).

Performance plan (target key-to-glyph p95 15-25ms): Rust drains the PTY read
buffer fully, updates the grid, and emits a diff at most 60Hz (~16ms). React
queues incoming diffs and applies them inside `requestAnimationFrame` (no layout
thrash). Measure latency by tagging a keypress with an invisible DCS sequence;
Rust flags the next diff carrying it; React measures keypress->flagged-diff delta.

Escape hatches: skip ligatures for MVP; handle CJK/wide chars via the grid's
"wide" flag (advance `char_width * 2`); if Tauri IPC chokes on high-frequency
binary blobs, fall back to an mmap shared buffer or a local WebSocket for the
terminal stream, bypassing the IPC router.

Subtasks (each independently testable; ordered to de-risk early):

##### TC-017a - Stage 1: headless grid + JSON snapshot `DONE`
Initialize a headless `alacritty_terminal::Term` behind an `EventListener`. Pipe
the daemon's Unix-socket PTY bytes into it on a dedicated blocking thread, state
behind an `RwLock`. Add a Tauri command `snapshot_grid` that serializes a 24x80
grid (chars + color/style flags) to JSON.
Acceptance: run `htop` in the PTY; `snapshot_grid` returns correct chars + colors.
Risk: PTY blocking the async runtime -> isolate the processor in a blocking thread.

Implemented in `src-tauri/src/vt_grid.rs`:
- Pinned `alacritty_terminal = 0.25.1` (headless via `VoidListener`, ANSI bytes
  fed through `vte::ansi::Processor::advance`). The crate does NOT own the PTY —
  the daemon stays PTY authority; `GridManager` opens its own subscriber stream
  (`SubscribeSession`) and feeds bytes on a per-session named blocking thread,
  state behind `RwLock<TermState>`.
- Tauri commands `grid_attach` / `grid_snapshot` / `grid_detach`
  (`commands.rs`, registered in `lib.rs`; `GridManager` is `.manage`d).
  `grid_snapshot` serializes a row-major grid of `{c, fg, bg, bold, italic,
  underline, inverse, wide}` plus cursor + altScreen/cursorVisible. Colors are
  resolved with a deterministic standard xterm-256 palette (truecolor exact);
  wide-char spacer cells are dropped so columns stay aligned. Daemon snapshot is
  replayed on attach to reconstruct the current screen.
Evidence (`cd src-tauri`): `cargo check` clean; `cargo test` → 25 passed / 5
  suites. Unit tests (`vt_grid::tests`, 6): plain text, CR/LF, SGR red, 24-bit
  truecolor, bold flag, alt-screen mode. Live integration test
  (`tests/grid_live.rs`): boots the daemon in an isolated `XDG_RUNTIME_DIR`,
  runs a real `bash` PTY, `printf '\033[31mREDWORD\033[0m'`, and asserts the grid
  reconstructs a red (`#cd0000`) `REDWORD` run in a well-formed 24x80 snapshot
  (~0.5s). htop confirmed installed; the automated proof uses a deterministic
  colored word instead of htop's nondeterministic frame.
Next: TC-017b (Canvas2D renderer + font atlas) consumes `grid_snapshot`.

##### TC-017b - Stage 2: full-frame Canvas2D renderer + font atlas `DONE`
React `<canvas>` component with a `requestAnimationFrame` loop rendering the
Stage-1 snapshot. Pre-render an offscreen font atlas (ASCII grid) and blit glyphs
with `drawImage`. Canvas2D, NOT WebGL (WebKitGTK DMA-BUF/WebGL is unstable).
HiDPI: scale canvas by `devicePixelRatio` and `ctx.scale(dpr, dpr)`.
Acceptance: static `htop` frame renders with correct colors, alignment, crisp on
HiDPI.

Implemented as pure, framework-light modules so the renderer is testable
without Tauri:
- `src/lib/gridSnapshot.ts` — TS mirror of the Rust `GridSnapshot` JSON + parse.
- `src/lib/fontAtlas.ts` — `measureCell()` (monospace metrics) + `GlyphAtlas`, a
  tinted-glyph cache keyed by `(char, fg, bold, italic)`. Each unique glyph is
  rasterized once into an offscreen tile at `cellPx * dpr` and blitted with
  `drawImage` — a bounded atlas given the terminal's finite palette. Canvas2D
  only; no WebGL.
- `src/lib/gridRenderer.ts` — `sizeCanvasToGrid()` sets the backing store to
  `cols*cellW*dpr × rows*cellH*dpr` while the CSS box stays at logical size
  (HiDPI crispness); `renderSnapshot()` fills bg rects (overdrawn 1px to avoid
  device-rounding seams), blits glyph tiles, draws underline + bar cursor,
  swaps fg/bg on `inverse`.
- `src/components/TerminalCanvas.tsx` — `grid_attach` then a RAF poll of
  `grid_snapshot` → render. A plain DOM `<canvas>`, so it pans/zooms with CSS
  transforms (the property native VTE could never satisfy). Input/diffing are
  later stages; this is the output half.
Evidence: `npx tsc --noEmit` clean; `cargo test` 25 passed (serialization now
  emits every column incl. wide spacers so `cells[row][col]` is positional).
  `npm run verify:canvas-renderer` (Playwright/Chromium, pixel-level): renders a
  hand-built snapshot at dpr=2 and asserts backing store = `cols*cellW*2 ×
  rows*cellH*2` with CSS box at logical px (HiDPI), a `#0000ee` bg cell samples
  blue, the red `#cd0000` "R" rasterizes inside cell (0,0) with ZERO stray red
  in the adjacent empty cell (alignment), and the atlas cached exactly 1 tile.
Next: TC-017c (binary dirty-diff IPC) replaces full-frame JSON polling.

##### TC-017c - Stage 3: binary dirty-diff IPC pipeline `DONE`
Rust tracks a dirty-row bitset; emits the binary diff payload (above) at <=60Hz
via `app_handle.emit()`. React parses the ArrayBuffer and updates only changed
cells.
Acceptance: `cmatrix` renders smoothly with markedly lower CPU than xterm.js.

Transport decision: Tauri v2 `Channel<InvokeResponseBody>` + `Raw(Vec<u8>)`
delivers a true `ArrayBuffer` to JS (verified in tauri-2.11.2 source:
`InvokeResponseBody::Raw` → `new Uint8Array(...).buffer`). A plain `Vec<u8>`
hits the blanket `impl<T: Serialize> IpcResponse` and would serialize as a JSON
number array (~6× overhead) — avoided.

Wire format (little-endian) finalized in `vt_grid.rs`: 15-byte header (u8 type
0x01 diff / 0x02 full, u16 cols, u16 rows, u16 cursor col, u16 cursor line, u32
mode flags [bit0 alt, bit1 cursor-visible], u16 dirty-row count), then per dirty
row `u16 index, u16 cell count, cells`; each cell 14 bytes (u32 char, u32 fg
RGBA, u32 bg RGBA, u16 style [bold/italic/underline/inverse/wide]).

- Rust: `GridManager` now holds a `Session` per id (grid state + emit state +
  stop flag). `run_emitter` is a 16ms (~60Hz) ticker that captures a `WireFrame`,
  diffs row-by-row vs the last emitted frame, and pushes only changed rows;
  cursor/mode always ride in the header so cursor-only moves emit a 0-dirty-row
  diff. It idles (no capture) when no subscriber is attached. `subscribe_diffs`
  sends an immediate full sync to each new subscriber (diffs are idempotent —
  rows carry absolute cell values — so overlap with the shared emitter is safe).
  Command `grid_subscribe_diffs(id, on_diff: Channel<InvokeResponseBody>)`.
- Frontend: `gridDiff.ts` decodes the ArrayBuffer; `gridBuffer.ts` keeps the
  persistent visible grid and `apply()`s a frame returning the row set to
  repaint (changed rows ∪ old/new cursor rows — only the visible screen is held
  in JS, no scrollback growth); `gridRenderer.renderPartial()` repaints just
  those rows + cursor. `TerminalCanvas.tsx` subscribes via `Channel<ArrayBuffer>`:
  full sync → `renderSnapshot`, diff → `renderPartial`.
Evidence: `cargo test` 31 passed / 5 suites — 6 new codec tests (full-sync
  header/dims, first-row glyphs, diff emits only changed rows, identical frames
  no-op, cursor-move = diff with 0 dirty rows, dimension change forces full).
  `cargo check` clean (Channel command compiles through the macro). `tsc` clean.
  `npm run verify:grid-diff` (Playwright): builds wire buffers matching the Rust
  encoder, decodes, applies a full sync (red "R") then a row-1-only diff (blue
  bg), and asserts via sampled pixels that the blue appears only after the diff
  and the red glyph in the *unredrawn* row 0 survives `renderPartial`.
Note: the "lower CPU than xterm.js / cmatrix smooth" claim is structural — only
  changed rows are decoded and repainted, the JS holds only the visible screen,
  and emits coalesce at 60Hz — and is confirmed end-to-end at the TC-017g
  latency/CPU gate in the integrated runtime (the live Channel↔webview seam
  can't be exercised headlessly without a Tauri window).
Next: TC-017d (input translation & keymap).

##### TC-017d - Stage 4: input translation & keymap `DONE`
Hidden `<textarea>` over the canvas captures `keydown` (IME-friendly); translate
`KeyboardEvent` to VT sequences (arrows, fn keys, ctrl/alt/meta, bracketed paste)
and send to the daemon. Keymap is the single source of truth.
Acceptance: type `ls -la`, Enter -> output appears immediately.

- `src/lib/keymap.ts` — single source of truth. `keyEventToBytes(event, modes)`
  covers Enter/Backspace/Tab/Shift-Tab/Esc, arrows + Home/End (CSI normally,
  SS3 `ESC O` under DECCKM app-cursor mode, `CSI 1;<mod>` when modified),
  Insert/Delete/PageUp/PageDown (`CSI n~`), F1–F4 (SS3) and F5–F12 (CSI),
  Ctrl+letter → control bytes (incl. Ctrl+@/[/\\/]/^/_/Space), Alt+x → ESC
  prefix, Backspace=DEL. Returns `null` for bare modifiers and Meta shortcuts.
  `encodePaste()` normalizes newlines to `\r` and wraps in `ESC[200~/201~` when
  bracketed paste is on.
- DECCKM/keypad/bracketed-paste correctness: extended the wire mode flags (Rust
  `WireFrame` + `gridDiff`/`GridBuffer`) with `appCursor` (bit2), `appKeypad`
  (bit3), `bracketedPaste` (bit4), so the keymap honors the terminal's live
  mode (vim/less arrows, paste guarding).
- `TerminalCanvas.tsx` — hidden transparent `<textarea>` over the canvas owns
  keyboard focus; `onKeyDown` → keymap → `daemon_write_session` (the proven PTY
  write path); `onPaste` → `encodePaste`. No optimistic echo — the PTY echoes
  and the grid updates via diffs (honors the hard constraint).
Evidence: `npm run verify:keymap` (Playwright) constructs real `KeyboardEvent`s
  in Chromium and asserts exact byte sequences (Enter=13, Shift-Tab=ESC[Z,
  Ctrl+A=1, Alt+b=ESC b, ArrowUp normal=ESC[A vs app=ESC O A vs Ctrl=ESC[1;5A,
  Delete=ESC[3~, F1=ESC O P, F5=ESC[15~, bare Shift/Meta→null, bracketed paste
  framing). `tsc` clean; `cargo test` 31 passed. Live "type ls -la → output"
  confirmed at TC-017g integration (write path is the same one usePty uses).
Next: TC-017e (resize/reflow + map-mode CSS transform).

##### TC-017e - Stage 5: resize/reflow + map-mode transform `DONE`
`ResizeObserver` computes cols/rows from pixel size; send `Resize(cols,rows)` ->
`term.resize()`. Verify on the pan/zoom map under CSS `transform: scale()/translate()`.
Acceptance: terminal reflows on pane resize AND renders correctly transformed on
the map, with no GTK overlay crashes (it's a DOM canvas).

- Rust: `grid_resize(id, cols, rows)` → `GridManager::resize` → `TermState::resize`
  (the headless grid reflows so it interprets PTY output at the new size). Kept
  in lock-step with `daemon_resize_session` (the PTY). A dimension change forces
  the next emit to be a full sync, repainting at the new size.
- Frontend: `computeGridSize(w, h, cellW, cellH)` floors to fit and clamps to
  >=1 (a collapsed pane never sends a 0-size resize). `TerminalCanvas` runs a
  `ResizeObserver` on its shell: on box change it derives cols/rows and invokes
  both `daemon_resize_session` and `grid_resize`. Initial reflow fires after
  subscribe so the grid matches the real pane size.
- Map mode: the renderer targets a plain DOM `<canvas>` backing store, so CSS
  `transform: scale()/translate()` is purely a compositor operation — it never
  touches the pixels or GTK. This is exactly what the native VTE overlay could
  not do (TC-014's dead end).
Evidence: `cargo test` 32 passed — new `resize_changes_grid_dimensions_and_
  preserves_content` (resize 80x24→100x30 keeps "hello" on row 0). `tsc` clean.
  `npm run verify:grid-resize` (Playwright): `computeGridSize` floor/clamp
  asserted; and after rendering a red glyph, applying `scale(2.4) translate(...)`
  leaves the canvas backing store byte-identical (same width/height, identical
  `getImageData`) — proving transform-independent rendering with no GTK crash.
Next: TC-017f (scrollback, selection, copy/paste).

##### TC-017f - Stage 6: scrollback, selection, copy/paste `DONE`
Wheel -> scroll commands; Rust shifts the viewport into history and emits a full
sync. Mouse drag -> grid coords -> highlight via `fillRect` alpha composite;
`navigator.clipboard` for copy/paste.
Acceptance: scroll 10k lines of `dmesg` with no JS heap growth (only visible
screen held in JS).

- Scrollback (Rust): `capture` now reads `grid[Line(row - display_offset)]` so a
  scrolled viewport shows history (no-op at offset 0). `grid_scroll(id, delta)`
  → `term.scroll_display(Scroll::Delta)`. alacritty's default 10000-line history
  lives entirely in Rust; the JS `GridBuffer` only ever holds the visible screen,
  so scrolling 10k lines cannot grow the frontend heap (the acceptance property,
  by construction).
- Selection/copy (frontend, `selection.ts`, pure): `normalizeRange` orders drag
  endpoints row-major; `rowSpan`/`isCellSelected` give per-row inclusive spans;
  `selectionToText` extracts text trimming trailing whitespace per line;
  `pointToCell` hit-tests a pointer offset to a clamped cell. `TerminalCanvas`
  draws the highlight on a separate overlay `<canvas>` (alpha `fillRect`,
  decoupled from the diff render), wheel → `grid_scroll`, drag → selection,
  pointer-up / Ctrl(Cmd)+Shift+C → `navigator.clipboard.writeText`. Pointer math
  divides out any CSS scale so selection is correct on the zoom/pan map.
Evidence: `cargo test` 33 passed — new `scrolling_into_history_reveals_older_
  lines` (print 100 lines, scroll up, assert line0/line1 reappear). `tsc` clean.
  `npm run verify:selection` (Playwright): normalize/rowSpan/isCellSelected,
  single + multi-line `selectionToText` (per-line trailing-space trim), and
  `pointToCell` floor + clamp.
Next: TC-017g (TUI correctness, latency gate, delete xterm.js).

##### TC-017g - Stage 7: TUI correctness, latency gate, delete xterm.js `DONE`
Render box-drawing (U+2500..U+257F) via raw `fillRect` (no atlas sub-pixel gaps).
Validate `zellij`, `tmux`, `vim`, `htop` (alt screen, 256/truecolor, splits align).
Pass the key-to-glyph p95 15-25ms gate. Then remove the xterm.js dependency and
the `wantsNativeRenderer`/native-VTE fallback shims.
Acceptance: TUIs render artifact-free, latency gate green, xterm.js deleted.

DONE in this pass (automatable, headless-verifiable):
- Box-drawing + block elements via `fillRect` (`src/lib/boxGlyph.ts`):
  U+2500..257F lines/corners/T-junctions/crosses (light+heavy; doubles
  approximated by their single segment set), plus common blocks
  (█▀▄▌▐ and ░▒▓ shades via alpha). The renderer routes these geometrically and
  bypasses the glyph atlas, so borders tile with no sub-pixel gaps.
- Canvas renderer integrated as an **opt-in** mode: `TerminalRendererMode` gains
  `"canvas2d"` (set `VITE_TERMINAL_RENDERER_MODE=canvas2d`). `Terminal.tsx`
  renders `<TerminalCanvas>` in that mode (xterm + native-VTE hooks go inert);
  default stays xterm so the daily-driver app is untouched. `TerminalCanvas` is
  self-sufficient: `daemon_ensure_running`/`daemon_ensure_session` →
  `grid_attach` → `grid_subscribe_diffs`, input via `daemon_write_session`.
- Evidence: `npm run build` clean; `npm run verify:canvas-all` (6 Playwright
  specs) green; full `playwright test` suite 11 passed (incl. existing flows —
  no regression from the `Terminal.tsx` change). `verify:box-glyph` samples
  pixels: ─ bright at mid-height/dark at top, │ bright at mid-width/dark at
  left, █ fills the cell, ░ renders dim — and the font atlas stays empty (box
  glyphs never touch it).

PRODUCTION CUTOVER — DONE: the canvas renderer is now the **default desktop
terminal**. `Terminal.tsx` routes `auto` (the default) and `canvas2d` to
`<TerminalCanvas>` whenever the Tauri runtime is present; xterm.js is now ONLY
the browser-preview fallback (no Tauri runtime), with `web-xterm` as a desktop
escape hatch. `CLAUDE.md` hard constraints updated to make the headless-VT +
Canvas2D renderer the production terminal and mark native VTE retired. The
xterm.js *dependency* is intentionally retained solely for the browser preview
(`npm run review`) and its Playwright flows; it no longer renders in the app.
Evidence: `npm run build` clean; full `playwright test` 11 passed (browser flows
still exercise xterm via the no-Tauri fallback — no regression);
`verify:terminal-rendering` + `verify:typography` (TerminalCanvas allowlisted)
pass for the files I own.

LIVE CONFIRMATION — DONE (2026-05-30): the canvas renderer was driven in the
live Tauri desktop app (real WebKitGTK, on a private Xvfb so it never touches the
user's :0 desktop) via the new `scripts/verify-canvas-live.sh`
(`VITE_TERMINAL_RENDERER_MODE=canvas2d`, split mode, reset state). Every goal
criterion passed with screenshot evidence in `/tmp/tw-canvas-live/`:
- **Fills its pane** — `01-default.png`. NOTE: this exposed and fixed a real bug.
  The grid stayed at the 80×24 attach default and only filled after a later
  resize. Root cause: `TerminalCanvas` `ResizeObserver` can fire on the initial
  layout BEFORE `grid_attach` resolves; that early fire recorded the pane size in
  `lastCols/lastRows` while `grid_resize` no-op'd on the unattached session, so
  the post-attach `applyResize()` saw no change and never grew the grid. Fix: an
  `attached` flag gates `applyResize` so the first real fit always runs
  post-attach (`src/components/TerminalCanvas.tsx`).
- **Reflows on resize** — `03-resized-small.png` (1000×680, colored `ls` reflows
  and fills) → `04-resized-large.png` (back to 1600×1000, refills).
- **Renders live, never stale** — `02-typed.png` (colored `ls --color` output),
  `06-htop.png`→`07-htop-live.png` (continuous htop redraw between frames),
  tmux output round-trips.
- **Types as fast as Alacritty** — backend key-to-PTY latency from the live run
  (177 keystrokes, `TERMINAL_WORKSPACE_TRACE_LATENCY=1`): p50=0ms, **p95=1ms**,
  max=1ms. No optimistic echo (real PTY round-trip).
- **Real TUIs** — `htop` (`06/07`), `vim` (`05a` empty buffer + `~` markers + status
  line, `05` inserted text with `[+]` modified flag), `tmux` (`08/09` green status
  bar + nested pane I/O). All enter the alternate screen and fill the pane.
  (Note: `vim` on this machine is aliased to Neovim+LazyVim which self-exits on a
  version check — an environment quirk, not a renderer issue; verified with
  `vim -u NONE`. The canvas correctly rendered nvim's alt-screen error too.)

Automated regression check after the fix: `npm run build` clean, `tsc --noEmit`
clean, `npm run verify:canvas-all` 6/6 passed, `verify:terminal-rendering` and
`verify:typography` pass. (`verify:map-terminals` is broken independently of this
work — it crashes reading a non-existent `../DESIGN.md` and references the retired
`native_vte.rs`; needs separate reconciliation with the TC-017 cutover.)

If a regression appears, `VITE_TERMINAL_RENDERER_MODE=web-xterm` reverts to xterm
on desktop instantly. Optional remaining polish: a true instrumented key-to-glyph
p95 (tag keypress with an invisible DCS, flag the carrying diff in Rust, measure
keypress→flagged-diff in React) — confirmation only, not a blocker to the default.

#### TC-018 - BiDi/RTL + text shaping (Hebrew nikud) in the headless grid `TODO`
Future pass, layered on the completed TC-017 renderer (needs the binary IPC
payload from TC-017c and the shared font atlas from TC-017b/g). Goal: an
RTL-safe grid that mixes English (LTR commands) and Hebrew (RTL, with nikud /
combining marks) without breaking the fixed-width cell model. Do the layout math
headlessly in Rust; React still receives a plain visual coordinate grid.

Pipeline (split the flow into a logical buffer and a visual grid buffer):
`PTY → logical buffer (alacritty grid) → (1) unicode-bidi reorder → (2) rustybuzz
shape → visual grid buffer → binary IPC diff → canvas`.

- **Stage 1 — logical vs. visual grid split (Rust).** Add a secondary
  `visual_grid` in `vt_grid.rs` (the alacritty grid is the logical/history
  buffer). A conversion pass clones the active viewport into `visual_grid` as a
  baseline. Verify: ASCII flows identically through both grids, zero perf drop.
- **Stage 2 — BiDi reorder (`unicode-bidi = 0.3`).** For each modified viewport
  line, run `BidiInfo::new(&text, None)`, walk the visual runs, reverse RTL runs
  when copying into `visual_grid`. Cursor tracks the *visual* endpoint, not the
  logical one. Verify: `echo "שלום"` shows ש rightmost, ם leftmost.
- **Stage 3 — shaping & diacritics (`rustybuzz = 0.12`).** Load the bundled
  monospace font as a `rustybuzz::Face`; shape BiDi-reordered runs. Combining
  marks (nikud) with nonzero x/y offset stay in the *base* cell as packed
  metadata — no extra grid cell. Verify: `שָׁלוֹם` occupies exactly 4 cells with
  vowel offsets attached.
- **Stage 4 — extend binary cell payload to 16 bytes:** `[0..4]` u32 glyph index
  (from rustybuzz, replacing raw UTF-32), `[4..6]` packed i8 x/y micro-offsets,
  `[6..10]` u32 fg RGBA, `[10..14]` u32 bg RGBA, `[14..16]` u16 style flags.
- **Stage 5 — canvas glyph pipeline (`Terminal*.tsx`).** Re-key the font atlas by
  glyph ID (not ASCII); `drawImage` by glyph ID; shift draw target by the cell's
  micro-offsets for diacritics.

Risks/mitigations: (1) BiDi/shaping per byte is expensive on fast dumps (`cat`)
→ compute **lazily**, only on visible viewport lines, and cache per-line; skip
unchanged lines. (2) Backend layout vs. frontend drawing must use the *same*
font → bundle one monospace font in Tauri assets; Rust loads it from disk, React
builds its atlas from the identical file.

#### MC-001 - Preserve canvas workspace mode `DONE`
Add a first-class workspace mode switch with `canvas`, `split`, and `graph`
surfaces. The Tauri app currently defaults to the split terminal workspace; this
task restores a canvas surface as a peer mode so the desktop migration does not
drop the existing Magic Canvas concept.

#### MC-002 - Persist workspace mode and canvas state `DONE`
Extend `workspaceUiState` with the active workspace mode and persist canvas
nodes, viewport, selected node, and node-terminal/file bindings. Restore the
selected mode and canvas state after reload without resurrecting stale PTY IDs.

#### MC-005 - Validate Tauri shell parity `DONE`
Run frontend build, Rust check, Tauri release build, and a manual `tauri dev`
smoke pass covering split terminals, file explorer operations, and canvas mode.

#### MC-006 - Improve canvas navigation and terminal organization `DONE (2026-05-28)`
Add safe all-side canvas node resizing, canvas pan/zoom controls, title renaming
from node headers, and a canvas sidebar that lists canvas terminals separately
from split-pane terminal tabs.

---

## Roadmap

#### MC-003 - Wire files and terminals into canvas nodes `DONE`
Allow file explorer actions and terminal tabs to create or attach canvas nodes.
Canvas terminal nodes should launch terminals in the selected directory while
file nodes should reference the tracked open-file model.

#### MC-004 - Add canvas regression fixtures `DONE`
Add fixtures for mixed terminal/file canvas layouts, Hebrew/English labels, and
mode switching. Verify canvas surfaces stay usable while raw PTY RTL remains
best-effort.

---

## Backlog (post-consolidation)

#### TC-015 - Per-node task badges on canvas terminals `TODO`
Surface each terminal's associated MASTER_PLAN task and status directly on its
canvas node (and in the sidebar list) as a compact badge: task id, short title,
and a status dot (Todo / In-Progress / Blocked / Done). Lets the operations map
double as a live task board.

Origin: salvaged concept from the retired `zellij-masterplan-tabbar` plugin,
which rendered MASTER_PLAN task status in the zellij tab bar. Only the idea
carries forward; that plugin was a zellij WASM module and shares no code with
termfleet's Tauri/Rust stack.

Acceptance (draft):
- A terminal node can be bound to a task id from a project's MASTER_PLAN.
- The node shows task id + status badge; status updates when the plan changes.
- Unbound terminals render with no badge and no layout shift.

#### TC-016 - Multi-agent orchestration from the cockpit `TODO`
Let one cockpit terminal spawn and manage multiple sub-agent terminals (Claude
Code / Codex / bash) that work autonomously while the user monitors and steers
them from the canvas. This is the core vision of the retired web "Magic Canvas"
predecessor, brought into the native Tauri cockpit.

Origin: the web Magic Canvas (Express + ws + node-pty + xterm) implemented this
via a `tc-spawn` CLI, stream-json output parsing, git-worktree isolation per
agent, and an agent-memory panel. None of that Node code is reusable here; the
architecture and research are preserved in claude-mem (Mar 2026 observations).

Acceptance (draft):
- A cockpit action spawns a named sub-agent terminal (interactive or headless).
- Headless agents stream readable status/output into their canvas node.
- Parent can send follow-up tasks to a child; child exit is surfaced on the node.
- Optional git-worktree isolation per agent to avoid file conflicts.
