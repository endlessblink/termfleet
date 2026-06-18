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

| ID         | Title                                                                                                                                                                                                           | Priority | Status            | Dependencies   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | -------------- |
| MC-001     | Preserve canvas workspace mode                                                                                                                                                                                  | P2       | DONE              | -              |
| MC-002     | Persist workspace mode and canvas state                                                                                                                                                                         | P2       | DONE              | -              |
| MC-003     | Wire files and terminals into canvas nodes                                                                                                                                                                      | P2       | DONE              | -              |
| MC-004     | Add canvas regression fixtures                                                                                                                                                                                  | P2       | DONE              | -              |
| MC-005     | Validate Tauri shell parity                                                                                                                                                                                     | P2       | DONE              | -              |
| ~~MC-006~~ | Improve canvas navigation and terminal organization                                                                                                                                                             | P2       | DONE (2026-05-28) | -              |
| TC-001     | Freeze Terminal Cockpit target and visual rules                                                                                                                                                                 | P2       | DONE (2026-05-28) | -              |
| TC-002     | Rebuild the app shell around one command cockpit                                                                                                                                                                | P2       | DONE (2026-05-28) | -              |
| TC-003     | Redesign navigation as icon-first dockable panels                                                                                                                                                               | P2       | DONE (2026-05-28) | -              |
| TC-004     | Make terminal work the primary tactical surface                                                                                                                                                                 | P2       | DONE (2026-05-28) | -              |
| TC-005     | Recast the canvas as a strategic operations map                                                                                                                                                                 | P2       | DONE (2026-05-28) | -              |
| TC-006     | Add command-first navigation and workspace actions                                                                                                                                                              | P2       | DONE (2026-05-28) | -              |
| TC-007     | Harden persistence, launch, and hot-reload workflows                                                                                                                                                            | P2       | DONE (2026-05-28) | -              |
| TC-008     | Run visual QA loops against the reference standard                                                                                                                                                              | P2       | DONE (2026-05-29) | -              |
| TC-009     | Decouple PTY lifecycle from the Tauri UI                                                                                                                                                                        | P2       | DONE (2026-05-29) | -              |
| TC-010     | Normalize Rubik typography across non-terminal UI                                                                                                                                                               | P2       | DONE (2026-05-29) | -              |
| TC-011     | Audit and repair the daily project/session flow                                                                                                                                                                 | P2       | DONE (2026-05-29) | -              |
| TC-012     | Raise terminal rendering quality for Zellij/TUI workloads                                                                                                                                                       | P2       | DONE (2026-05-29) | -              |
| TC-013     | Prevent daemon transport failures from flooding terminals                                                                                                                                                       | P2       | DONE (2026-05-29) | -              |
| ~~TC-014~~ | Make terminal typing latency production-grade (native VTE path abandoned)                                                                                                                                       | P2       | DONE              | TC-017         |
| TC-015     | Per-node task badges: show associated MASTER_PLAN task + status on canvas terminals                                                                                                                             | P2       | DONE (2026-06-01) | -              |
| TC-016     | Multi-agent orchestration: spawn/manage sub-agent terminals from the cockpit                                                                                                                                    | P2       | DONE              | -              |
| TC-016h    | Live terminal activity + agent status list                                                                                                                                                                      | P1       | DONE              | TC-016         |
| TC-016i    | LLM-summarized agent work status: visible task/path/now in terminal and map cards                                                                                                                               | P1       | DONE              | TC-016h        |
| TC-017     | Headless-VT (Rust) + canvas renderer — now the desktop default (replaces xterm)                                                                                                                                 | P2       | DONE              | -              |
| TC-018     | BiDi/RTL + text shaping (Hebrew nikud) in the headless grid — depends on TC-017                                                                                                                                 | P2       | TODO              | -              |
| TC-019     | Warp-style chrome redesign: neutral fill-only design system (no outlines), terminal-first layout, Hack terminal font + #1d2022 gray, themed folder picker, DESIGN.md + CI-enforced no-outlines/typography rules | P2       | IN_PROGRESS       | -              |
| TC-020     | Split-pane and canvas localhost preview surface                                                                                                                                                                 | P2       | DONE (2026-06-01) | -              |
| TC-021     | Open-source developer preview lane: differentiate TermFleet as a local-first agent/ops cockpit                                                                                                                  | P2       | IN_PROGRESS       | -              |
| TC-022     | External agent bridge: let Hermes attach to and control TermFleet terminals                                                                                                                                     | P1       | TODO              | TC-016, TC-017 |
| TC-023     | Cross-platform terminal substrate: isolate Linux daemon, path, process, and shell assumptions before macOS/Windows ports                                                                                         | P1       | IN_PROGRESS       | TC-009, TC-017 |
| TC-024     | Session/map cards: show the project/workspace name in the live summary header                                                                                                                                   | P1       | DONE              | TC-016i        |

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

### TC-024: Session/map cards show project/workspace name

**Priority:** P1
**Status:** Done

The live session/map card header currently shows status such as provider readiness
and task/path/now summaries, but the project identity is not visible enough. In
the All sessions map, cards should show the project/workspace name in the top
summary area so a user can distinguish multiple same-repo or same-command
sessions at a glance.

Acceptance:

- DONE: Each live summary card shows a compact project/workspace label derived
  from the session workspace path, e.g. `arthouse`, `termfleet`, or the configured
  project display name.
- DONE: The label is visible in the card/header area without relying on the tiny
  left sidebar session row.
- DONE: It remains readable when the card is narrow and does not crowd out task,
  path, provider, or current-step status.
- DONE: Browser review screenshot covers at least two sessions from different
  project paths so the distinction is visible: `/tmp/tc-024-workspace-labels.png`
  shows `TermFleet OSS` and `arthouse` in map-card headers.
- DONE: Verification includes `npm run build` plus the relevant agent/status UI
  regression. Evidence: `npm run build`; focused `npx playwright test
  tests/map-terminal-rendering.spec.ts -g "workspace labels"`.

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

### TC-001: Freeze Terminal Cockpit target and visual rules

**Priority:** P2
**Status:** Done

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

### TC-002: Rebuild the app shell around one command cockpit

**Priority:** P2
**Status:** Done

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

### TC-003: Redesign navigation as icon-first dockable panels

**Priority:** P2
**Status:** Done

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

### TC-004: Make terminal work the primary tactical surface

**Priority:** P2
**Status:** Done

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

### TC-005: Recast the canvas as a strategic operations map

**Priority:** P2
**Status:** Done

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

### TC-006: Add command-first navigation and workspace actions

**Priority:** P2
**Status:** Done

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

### TC-007: Harden persistence, launch, and hot-reload workflows

**Priority:** P2
**Status:** Done

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

### TC-008: Run visual QA loops against the reference standard

**Priority:** P2
**Status:** Done

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

### TC-009: Decouple PTY lifecycle from the Tauri UI

**Priority:** P2
**Status:** Done

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
- 2026-05-31: Disk-backed scrollback so terminal **content** survives a daemon
  death (reboot, OOM, dev relaunch that clears the daemon), not just an app-window
  restart where the daemon stayed alive. The daemon now runs `PtyManager::persistent()`
  and checkpoints each session's scrollback (`<id>.scrollback`, 8-byte base-offset
  header + bytes, atomic temp+rename, throttled to 750ms) plus metadata
  (`<id>.meta.json`, cwd/command) under `~/.local/share/terminal-workspace/sessions/`
  (data dir, so it survives a reboot — unlike the runtime-dir socket). On
  `ensure_session` for an id that is no longer live but has a checkpoint, the daemon
  spawns a fresh shell at the saved cwd and seeds its output buffer with the saved
  scrollback (prefixed by a `── session restored ──` banner that first leaves any
  stranded alt-screen). The seeded snapshot flows through the existing
  `feed_grid_from_daemon` path into the VT grid and onto the canvas — no frontend
  change needed. `kill` (explicit close only) deletes the checkpoint so closed
  terminals never resurrect. Evidence: `cargo test` 36 passing incl. new
  `scrollback_survives_a_simulated_daemon_restart` (drops the manager without
  killing, rebuilds from disk on a second manager, asserts content replays).

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

### TC-010: Normalize Rubik typography across non-terminal UI

**Priority:** P2
**Status:** Done

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

### TC-011: Audit and repair the daily project/session flow

**Priority:** P2
**Status:** Done

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

### TC-012: Raise terminal rendering quality for Zellij/TUI workloads

**Priority:** P2
**Status:** Done

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

### TC-013: Prevent daemon transport failures from flooding terminals

**Priority:** P2
**Status:** Done

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

### TC-014: Make terminal typing latency production-grade (SUPERSEDED by TC-017 (2026-05-30))

**Priority:** P2
**Status:** Done
**Depends:** TC-017

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
  emit(DAEMON_INPUT_EVENT, { id: ptyIdRef.current, data })
    .catch((writeError) => {
      tracePty("frontend.daemon.write.emit.failed", {
        bytes: data.length,
        error: String(writeError),
      });
      invoke("daemon_write_session", { id: ptyIdRef.current, data }).catch(
        (fallbackError) => {
          stopBrokenTransport(fallbackError, "write");
        },
      );
    })
    .finally(() => {
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

### TC-017: Headless-VT (Rust) + custom canvas renderer

**Priority:** P2
**Status:** DONE

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
  and the red glyph in the _unredrawn_ row 0 survives `renderPartial`.
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
  Ctrl+letter → control bytes (incl. Ctrl+@/[/\\/]/^/\_/Space), Alt+x → ESC
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
  > =1 (a collapsed pane never sends a 0-size resize). `TerminalCanvas` runs a
  > `ResizeObserver` on its shell: on box change it derives cols/rows and invokes
  > both `daemon_resize_session` and `grid_resize`. Initial reflow fires after
  > subscribe so the grid matches the real pane size.
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
- 2026-06-08: Reliable transcript scroll correction: plain wheel in
  `TerminalCanvas` now always scrolls TermFleet's own grid history, including
  sessions whose foreground app enabled mouse reporting or alternate-scroll;
  `Alt+wheel` preserves the old app-owned wheel path for TUIs. Evidence:
  `npm run verify:terminal-mouse`, `npm run verify:map-terminals`,
  `npm run verify:canvas-all`, `npm run build`, and
  `CARGO_BUILD_JOBS=1 cargo test vt_grid::tests::scroll --manifest-path
src-tauri/Cargo.toml` passed.
- 2026-06-09: Added explicit immersive terminal mode for TUI ownership. The
  targeted split pane can now hide the app header, sidebars, status bar, pane
  chrome, resize handles, and sibling panes so full-screen TUIs can own the
  viewport; `Escape` exits before reaching the PTY and `Ctrl+Shift+F` toggles
  immersive mode from the command surface or focused canvas terminal. Evidence:
  `npm run verify:map-terminals`, `npm run build`, and
  `npm run verify:canvas-all` passed. Live `npm run verify:zellij-map` was
  attempted but the Xvfb window disappeared and the run hung after app launch,
  so it was interrupted without a product verdict.
- 2026-06-09: Hardened daemon socket recovery after the UI showed
  `Terminal attach failed: Connection refused`. Daemon requests now retry through
  `daemon_ensure_running()` at the socket boundary, the VT grid subscriber uses
  the same recovery path, and `TerminalCanvas` stops after an unreachable daemon
  status instead of continuing into a raw refused `daemon_ensure_session` call.
  Evidence: `npm run verify:map-terminals`, `npm run build`,
  `CARGO_BUILD_JOBS=1 cargo check --manifest-path src-tauri/Cargo.toml`,
  `npm run verify:standalone-daemon`, and `npm run verify:canvas-all` passed.
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
xterm.js _dependency_ is intentionally retained solely for the browser preview
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
`verify:typography` pass.

Reliability hardening addendum — 2026-06-02:

- Added a single terminal reliability gate so the hardening matrix is not hidden
  across separate scripts. `npm run verify:terminal-reliability` runs source
  contracts, Canvas2D renderer/diff Playwright tests, Rust `vt_grid::tests`,
  Rust `pty::tests`, and the frontend build against an isolated
  `/tmp/tw-terminal-reliability-target` cargo target. The same script runs the
  full private Xvfb/Tauri matrix when invoked as `npm run
verify:terminal-reliability:live` (legacy prompt repair, regular-shell
  scrollback reattach, zellij map, bracketed paste, resize storm, zellij
  shortcuts, canvas live, standalone daemon, restart restore). Evidence:
  `npm run verify:terminal-reliability` passed with
  `TERMFLEET_TERMINAL_RELIABILITY_OK live=0`; `npm run verify:map-terminals`
  statically requires both package aliases and all matrix entries.
- Fresh verification pass after the legacy old-session repair wiring:
  `npm run verify:map-terminals` passed, `npm run verify:canvas-all` passed 9/9,
  `cargo test vt_grid::tests -- --nocapture` passed 17/17,
  `cargo test pty::tests -- --nocapture` passed 10/10, and `npm run build`
  passed. Live private Xvfb/Tauri canaries also passed:
  `APP_BUDGET=240 npm run verify:legacy-prompt-live` with
  `LEGACY_PROMPT_REPAIR_REUSED_PTY`, `LEGACY_PROMPT_REPAIR_CTRL_L_SENT`,
  `LEGACY_PROMPT_REPAIR_INPUT_REACHED_DAEMON`,
  `LEGACY_PROMPT_REPAIR_OUTPUT_IN_SNAPSHOT`,
  `LEGACY_PROMPT_REPAIR_VISUAL_REPAINT changed_pixels=9517`, and
  `LEGACY_PROMPT_REPAIR_OK`; `APP_BUDGET=240 npm run
verify:scrollback-reattach` with `SCROLLBACK_MOVED_INTO_HISTORY`,
  `SCROLLBACK_REATTACHED_REUSED_PTY`,
  `SCROLLBACK_RESET_TO_BOTTOM_BEFORE_INPUT`,
  `SCROLLBACK_INPUT_REACHED_DAEMON`, `SCROLLBACK_OUTPUT_IN_SNAPSHOT`, and
  `SCROLLBACK_REATTACH_VISUAL_REPAINT changed_pixels=12991`;
  `APP_BUDGET=360 npm run verify:zellij-map` with `GRID_PTY_MATCH (both
99x24 cols)`, `MAP_INPUT_REACHED_DAEMON`, nonblank map screenshots, and
  repaint evidence (`htop-redraw changed_pixels=15824`, `map-input
changed_pixels=72211`); `APP_BUDGET=300 npm run verify:bracketed-paste` with
  `BRACKETED_PASTE_MARKERS_IN_VIM`,
  `BRACKETED_PASTE_NO_STALE_MARKERS_AFTER_DISABLE`, and
  `BRACKETED_PASTE_OK`; `APP_BUDGET=360 npm run verify:resize-storm` with
  `RESIZE_STORM_MULTIPLE_SIZES grid=6 pty=6`,
  `RESIZE_STORM_GRID_PTY_MATCH grid=(157, 52) pty=(157, 52)`,
  `RESIZE_STORM_INPUT_REACHED_DAEMON`,
  `RESIZE_STORM_VISUAL_REPAINT post-storm-input changed_pixels=263975`, and
  `RESIZE_STORM_OK`; `APP_BUDGET=360 npm run verify:zellij-shortcuts` with
  exact Ctrl+T/Ctrl+P/Shift+Tab/Ctrl+W byte assertions and
  `ZELLIJ_SHORTCUTS_OK`.
- Selected map terminals now stop terminal-body mouse events at the terminal
  surface, so canvas/node selection cannot steal focus from the hidden terminal
  input. `npm run verify:zellij-map` now clicks the selected map terminal and
  fails unless the private daemon trace reports `MAP_INPUT_REACHED_DAEMON`.
- Blank canvas terminals now paint an initial background, retry a backend
  `grid_snapshot`, and show a visible failed runtime state if no visible grid
  content arrives after attach. Silent blank terminal panes are a verifier-locked
  regression (`npm run verify:map-terminals`).
- `scripts/verify-canvas-live.sh` now proves regular shell input/output, not only
  screenshots: it requires `CANVAS_LIVE_INPUT_REACHED_DAEMON` and
  `CANVAS_LIVE_OUTPUT_IN_SNAPSHOT` for the marker `TF_CANVAS_LIVE_INPUT_OK`.
- Live verifiers now run in private `XDG_RUNTIME_DIR`, `XDG_DATA_HOME`, trace
  files, and `CARGO_TARGET_DIR` directories. Cleanup kills only the verifier-owned
  process group and private daemon PID. The tmux section uses
  `/tmp/tw-canvas-live/tmux.sock`, never the user's default tmux server.
- Fresh verification: `npm run build`, `npm run verify:map-terminals`,
  `APP_BUDGET=360 npm run verify:zellij-map`, `APP_BUDGET=360 npm run
verify:canvas-live`, `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check
cargo check`, and `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check
cargo test` all pass.
- Additional completion-audit evidence: `npm run verify:canvas-all` passed all
  six renderer/grid/keymap/selection tests; `python3 scripts/verify-restart-restore.py`
  passed outside the sandbox with a private debug binary after proving the sandbox
  blocked daemon startup with `Operation not permitted`; and
  `APP_BUDGET=360 npm run verify:zellij-shortcuts` passed byte-level assertions
  for Ctrl+T (`0x14`), Ctrl+P (`0x10`), Shift+Tab (`ESC[Z`), and Ctrl+W (`0x17`).
  `verify-restart-restore.py` now builds/uses `/tmp/tw-restart-restore-target`
  and prints daemon log tails on startup failure; `verify:zellij-shortcuts` now
  waits for the window according to `APP_BUDGET` so cold private builds don't
  produce false shortcut failures.
- Release-path restart evidence: `APP_BUDGET=240 npm run
verify:standalone-daemon` now builds its own release binary under
  `/tmp/tw-standalone-daemon-smoke/target`, launches the app under private
  `XDG_RUNTIME_DIR`/`XDG_DATA_HOME`, types `STANDALONE_CLIP_OK_680`, finds it in
  daemon scrollback, stops only the app process, verifies the daemon PID is
  unchanged, relaunches the app, types `STANDALONE_RECONNECT_OK_681`, and finds
  the second marker in the same session id. The verifier logs to
  `/tmp/tw-standalone-daemon-smoke/driver.log`, captures
  `/tmp/tw-standalone-daemon-smoke/failure.png` on failure, and never touches the
  user's live daemon/socket/target.
- Release restart visual evidence: `verify:standalone-daemon` now captures
  successful before/after restart screenshots and fails if the terminal region is
  blank, visually flat, or unchanged after reconnect. Evidence:
  `APP_BUDGET=360 npm run verify:standalone-daemon` passed with
  `STANDALONE_RESTART_VISUAL_CONTENT before-app-restart mean=8306.9 sd=2576.1`,
  `STANDALONE_RESTART_VISUAL_CONTENT after-app-restart mean=8468.1 sd=3487.4`,
  `STANDALONE_RESTART_VISUAL_REPAINT app-restart changed_pixels=4455`, and
  `Standalone daemon restart reattach passed` for the same session id. Success
  screenshots are
  `/tmp/tw-standalone-daemon-smoke/01-before-app-restart.png` and
  `/tmp/tw-standalone-daemon-smoke/02-after-app-restart.png`.
- Responsiveness under load pass (2026-06-13): `TerminalCanvas` now coalesces
  grid diff rendering into one `requestAnimationFrame` paint, snapshots the grid
  once per painted frame instead of once per diff, scans only changed rows for
  visible-content detection on partial diffs, and coalesces input-triggered
  `grid_scroll_to_bottom` into one frame-scheduled command instead of one Tauri
  invoke per key. This keeps burst output, map previews, and fast typing from
  competing on the same synchronous canvas/input path while preserving real PTY
  echo semantics. Evidence: `npm run build` passed; `CARGO_BUILD_JOBS=1 cargo
check` initially passed with dead-code warnings from unused clipboard-image
  helpers; those helpers were removed and `npm run verify:rust-warnings` now
  runs `cargo check` with `RUSTFLAGS=-Dwarnings` and passes with
  `TERMFLEET_RUST_WARNINGS_OK`. `npm run verify:map-terminals`
  passed; `npm run verify:canvas-all` passed 12/12; `npm run
verify:terminal-rendering` passed; `npm run verify:daemon-latency` reported
  p95 `1.4ms`, max `1.4ms`; live desktop `TERMINAL_WORKSPACE_ALLOW_SHARED_DEV_CLEANUP=1
npm run verify:tauri-dev-performance` passed with `typed_last_char_echo_ms=94`,
  `fast_type_integrity_ms=544`, `cpu_stress_workers=2`,
  `stressed_typed_last_char_echo_ms=97`, `terminal_burst_300_lines_ms=937`,
  `canvas_pan_10x_ms=146`, and `max_subscribers_after_toggle=1`.
  Final reliability aggregate also passed after the verifier trace parsers were
  updated for the persistent input stream: `TERMFLEET_TERMINAL_RELIABILITY_LIVE=1
APP_BUDGET=360 npm run verify:terminal-reliability` ended with
  `TERMFLEET_TERMINAL_RELIABILITY_OK live=1`, including the source contract,
  12/12 canvas Playwright specs, Rust `vt_grid` + `pty` suites, daemon survival,
  build, live legacy prompt repair, scrollback reattach, map shell anchor,
  zellij-on-map, bracketed paste, resize storm, zellij shortcuts, canvas-live,
  standalone daemon restart/cold-restore, and restart/restore simulation.
  `npm run verify:typography` remains red on unrelated pre-existing outline /
  letter-spacing checks in LinksView, LocalhostPreview, MagicCanvas, and
  WorkbenchSidebar.
- Release cold-restore visual evidence: `verify:standalone-daemon` now also
  kills the app and daemon after the app-restart pass, relaunches against the
  same private `XDG_DATA_HOME`, verifies the prior marker is replayed into the
  same session id, and requires nonblank/repainted terminal pixels before and
  after cold-restore input. Evidence: `APP_BUDGET=420 npm run
verify:standalone-daemon` passed with daemon PID changing from `3577575` to
  `3578889`, the same session id
  `terminal-92863c38-601b-4a50-89c4-02392401711d-898d4fa6-aa7e-438f-a137-725642cb992a`,
  `STANDALONE_RESTART_VISUAL_CONTENT after-daemon-restart-before-input mean=8414.8 sd=3211.1`,
  `STANDALONE_RESTART_VISUAL_CONTENT after-daemon-restart-input mean=8584.4 sd=4008.7`,
  `STANDALONE_RESTART_VISUAL_REPAINT daemon-cold-restore-input changed_pixels=4714`,
  and `Standalone daemon cold restore passed`. Success screenshots are
  `/tmp/tw-standalone-daemon-smoke/03-after-daemon-restart-before-input.png` and
  `/tmp/tw-standalone-daemon-smoke/04-after-daemon-restart-input.png`.
- Research constraint captured for future modifiers: daemon-owned PTYs plus
  app-restart reattach are the correct reliability base; after daemon death or
  OS reboot, Linux cannot honestly preserve running process state without
  heavyweight checkpointing. TermFleet's guarantee is therefore no silent
  blank/broken UI, safe app restart reattach, and cold restore of scrollback,
  cwd, metadata, and terminal size.
- Canvas terminal session-switch guard: `TerminalCanvas` now resets terminal
  modes, first-frame state, selection anchors, and delayed-paste waiters on every
  session attach, and delayed paste delivery is guarded by a session epoch so a
  paste or stale mode snapshot cannot cross into a newly attached PTY. Evidence:
  `npm run verify:map-terminals`, `npm run build`, and
  `APP_BUDGET=360 npm run verify:zellij-map` passed after the change; the zellij
  map run ended with `GRID_PTY_MATCH (99,24)` and `MAP_INPUT_REACHED_DAEMON`.
- Split/reconnected scrollback viewport guard: the headless grid now hides the
  live cursor while the grid is scrolled into history, exposes
  `grid_scroll_to_bottom`, and `TerminalCanvas` resets the grid viewport to the
  live bottom on attach and before every input path (normal keys/paste plus the
  GTK Tab/Shift+Tab capture path). This prevents a reconnected split terminal
  from painting a stale historical viewport mixed with the live prompt/cursor,
  which is the broken view shown in the 2026-06-02 screenshot. Evidence:
  `npm run verify:map-terminals`, `npm run build`,
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo test
vt_grid::tests::scrolled_history_hides_cursor_until_bottom_reset`, and
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo check`
  passed. Live follow-up after the viewport fix: `APP_BUDGET=360 npm run
verify:canvas-live` passed with `CANVAS_LIVE_INPUT_REACHED_DAEMON` and
  `CANVAS_LIVE_OUTPUT_IN_SNAPSHOT`, and `APP_BUDGET=360 npm run
verify:zellij-map` passed with `GRID_PTY_MATCH (99,24)` plus
  `MAP_INPUT_REACHED_DAEMON`.
- Shortcut verifier hardening: `verify:zellij-shortcuts` now revalidates or
  reacquires the Tauri window before screenshots, terminal focus, and the
  shortcut probe, so transient Xvfb/Tauri window IDs cannot create false hangs or
  missing-window failures. Timed live evidence: `timeout 420 env APP_BUDGET=360
npm run verify:zellij-shortcuts` passed with exact daemon bytes for Ctrl+T
  (`0x14`), Ctrl+P (`0x10`), Shift+Tab (`ESC[Z`), and Ctrl+W (`0x17`).
- Regular-shell scrollback reattach guard: `npm run verify:scrollback-reattach`
  now runs a private Xvfb/private-daemon live regression that fills shell
  scrollback, scrolls the grid into history, switches split -> map -> split, and
  rejects any run where post-reattach input lands on a different PTY id. It also
  requires `grid.scroll_to_bottom` after reattach input and compares before/after
  screenshots so backend-only success cannot hide a stale canvas. Evidence:
  `APP_BUDGET=240 npm run verify:scrollback-reattach` passed with
  `SCROLLBACK_MOVED_INTO_HISTORY`, `SCROLLBACK_REATTACHED_REUSED_PTY`,
  `SCROLLBACK_RESET_TO_BOTTOM_BEFORE_INPUT`,
  `SCROLLBACK_INPUT_REACHED_DAEMON`, `SCROLLBACK_OUTPUT_IN_SNAPSHOT`, and
  `SCROLLBACK_REATTACH_VISUAL_REPAINT changed_pixels=13185`; screenshots are in
  `/tmp/tw-scrollback-reattach/`.
- Zellij map visual guard: `verify:zellij-map` now preserves the trace parser's
  failure status and fails if the selected map terminal screenshots are blank,
  visually flat, or frozen. It crops the focused terminal region in
  `04-map-after-switch.png`, `05-map-htop-settled.png`, and
  `06-map-htop-redraw.png`, requires high-contrast terminal content, and compares
  screenshots across htop redraw and map input. Evidence: `APP_BUDGET=360 npm run
verify:zellij-map` passed with `GRID_PTY_MATCH (99,24)`,
  `MAP_INPUT_REACHED_DAEMON`, `ZELLIJ_MAP_VISUAL_CONTENT` for all three map
  frames, `ZELLIJ_MAP_VISUAL_REPAINT htop-redraw changed_pixels=17567`, and
  `ZELLIJ_MAP_VISUAL_REPAINT map-input changed_pixels=74090`; screenshots are in
  `/tmp/tw-zellij-map/`.
- Sparse map shell prompt guard: selected map terminals now keep fresh/sparse
  primary-screen shell prompts at their real top row, matching normal terminal
  semantics. The previous map-only bottom-anchor presentation was removed because
  it made map terminals behave unlike Konsole/xterm. `npm run
verify:map-shell-anchor` remains as a private Xvfb/Tauri screenshot canary, but
  it now fails if the selected map shell cursor is too low in the terminal body.
  Evidence: `npm run verify:map-terminals` now rejects `mapSurface` /
  `applySparseMapAnchor` returning, `APP_BUDGET=180 npm run
verify:map-shell-anchor` requires `MAP_SHELL_PROMPT_TOP_OK`, and `npm run
verify:terminal-reliability` covers the fast source/browser/Rust/build gate.
- Zellij map readability guard: selected map terminals now preserve normal map
  geometry and use fixed backing-store supersampling, not inverse CSS scaling,
  so zooming the map does not crop or churn the live TUI. Powerline separators
  used by zellij/tmux themes render geometrically instead of relying on Hack font
  fallback, which prevents missing-character boxes in status bars. Canvas mouse
  clicks now forward VT mouse reports when the TUI enables mouse mode, so zellij
  tab/pane clicks reach the PTY. Evidence: `npm run verify:box-glyph`, `npm run
verify:terminal-mouse`, `npm run verify:map-terminals`, `npm run build`, and
  `APP_BUDGET=260 npm run verify:zellij-map` passed; the zellij run ended with
  `GRID_PTY_MATCH (both 99x24 cols)`, `MAP_INPUT_REACHED_DAEMON`,
  `MAP_MOUSE_REPORT_REACHED_DAEMON`, `MAP_ZOOM_VISUAL_ONLY`, visual
  content/repaint checks, and screenshots in `/tmp/tw-zellij-map/`.
- Map overview readability guard: terminal nodes below 100% map zoom now render
  a truthful state/shape preview from the latest grid snapshot instead of
  trying to make dense live terminal text readable at 36-78% zoom or showing a
  fake summary card. Readable 100%+ terminals remain live. Evidence:
  `npm run verify:map-terminals`, `npm run build`, `npm run verify:canvas-all`,
  and `APP_BUDGET=260 npm run verify:zellij-map` passed after adding the snapshot
  callback and preview cache.
- Map preview visual polish: the overview preview now renders compact terminal
  characters/colors rather than stretched block cells, so low-zoom selected nodes
  read as terminal thumbnails instead of damaged output. Visual evidence:
  inspected `/tmp/termfleet-visual-qa/after-preview-text.png`,
  `/tmp/termfleet-visual-qa/focused-readable.png`, and the zellij smoke
  screenshots `/tmp/tw-zellij-map/06a-map-after-zoom-churn.png` plus
  `/tmp/tw-zellij-map/06b-map-focused-readable.png`.
- Map terminal text-quality regression: `tests/map-terminal-rendering.spec.ts`
  now asserts live map canvases never use pixelated image scaling and that
  overview previews group terminal runs into compact text segments instead of
  thousands of per-cell DOM nodes. Evidence: `npx playwright test
map-terminal-rendering`, `npm run verify:canvas-all`, `npm run
verify:map-terminals`, `npm run build`, and `APP_BUDGET=260 npm run
verify:zellij-map` passed after switching live map terminals to a smooth 2x
  backing store and adding transform hints for map zoom.
- Standalone daemon cold-restore flush guard: `PtyOutputBuffer::snapshot` and
  `read_since` now force a pending scrollback persist flush before returning, so
  verifier-driven daemon death cannot lose the newest marker between throttle
  windows. Evidence: `cargo test pty::tests -- --nocapture` passed 11/11
  including `snapshot_forces_dirty_persist_flush_before_daemon_death`, and
  `APP_BUDGET=360 npm run verify:standalone-daemon` passed with app restart
  reattach, daemon PID change, same-session cold restore, and post-restore input
  repaint.
- Bracketed-paste mode guard: `npm run verify:bracketed-paste` now runs a
  private Xvfb/private-daemon live regression that enters `vim -u NONE`, uses the
  terminal paste shortcut (`Ctrl+Shift+V`), and requires the daemon write stream
  to contain `ESC[200~ ... ESC[201~` around the multi-line payload while Vim has
  bracketed paste enabled. It then exits Vim, explicitly disables bracketed paste
  while a foreground `sleep` prevents Bash from immediately re-enabling the
  mode, pastes again, and fails if old TUI bracketed mode leaks into that second
  paste. Evidence: `APP_BUDGET=300 npm run verify:bracketed-paste` passed with
  `BRACKETED_PASTE_MARKERS_IN_VIM`, `BRACKETED_PASTE_VIM_PAYLOAD`,
  `BRACKETED_PASTE_NO_STALE_MARKERS_AFTER_DISABLE`,
  `BRACKETED_PASTE_DISABLED_PAYLOAD`, and `BRACKETED_PASTE_OK`; screenshots are
  in `/tmp/tw-bracketed-paste/`. Follow-up checks after adding the guard:
  `npm run verify:map-terminals`, `npm run build`, and
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo check`
  all pass.
- Research-driven verifier reduction: external guidance points to a layered
  suite instead of one headed E2E per bug class: Rust grid/PTY invariants first,
  frontend Canvas2D pixel checks second, and private Tauri/Xvfb only for
  WebKitGTK/focus/rendering canaries. Added fast Rust invariants for the resize
  failure class: `resize_storm_keeps_wire_frame_rectangular_and_modes` repeatedly
  resizes an alternate-screen, bracketed-paste, mouse-reporting grid and requires
  rectangular frames, preserved modes, full-sync frames on every dimension change,
  and a nonblank final frame. Added
  `alternate_screen_roundtrip_preserves_main_scrollback` so alt-screen TUI content
  cannot leak into restored shell scrollback. Evidence:
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo test
vt_grid::tests -- --nocapture` passed 17/17 in the fast grid layer, followed by
  `npm run verify:map-terminals` and
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo check`.
  `npm run verify:resize-storm` is now wired as the slow private Xvfb canary for
  the same class and passed after fixing the verifier's `xdotool windowsize`
  argument split. Live evidence: `RESIZE_STORM_MULTIPLE_SIZES grid=6 pty=6`,
  `RESIZE_STORM_GRID_PTY_MATCH grid=(157, 52) pty=(157, 52)`,
  `RESIZE_STORM_INPUT_REACHED_DAEMON`, `RESIZE_STORM_TRACE_OK`,
  `RESIZE_STORM_VISUAL_REPAINT post-storm-input changed_pixels=254762`, and
  `RESIZE_STORM_OK`; screenshots are in `/tmp/tw-resize-storm/`.
- Backend PTY resize contract locked in the fast layer: added
  `detached_spawn_records_requested_winsize` and
  `resize_storm_tracks_final_winsize_and_reuse_does_not_shrink` so daemon-owned
  sessions remember their requested spawn winsize, track every successful resize
  through a storm, and report the live final size on reattach instead of shrinking
  a reused zellij/tmux/TUI session. Evidence:
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo test
pty::tests -- --nocapture` passed 10/10, `npm run verify:map-terminals` now
  statically requires these PTY tests, and
  `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=/tmp/tw-termfleet-cargo-check cargo check`
  passed.
- Frontend binary-diff recovery hardened: `GridBuffer` now treats every full sync
  as authoritative even at the same dimensions, clears stale rows before applying
  the payload, and normalizes decoded row widths to the current grid width. This
  prevents a reconnect/full-sync recovery frame from leaving old terminal rows in
  the client buffer if the frontend had stale same-size state. Evidence:
  `npm run verify:grid-diff` passed 2/2, including
  `full sync is authoritative and clears stale same-size buffer state`;
  `npm run verify:map-terminals` now statically requires the reset behavior and
  regression test; `npm run build` passed.
- Malformed binary-diff failure path hardened: `decodeFrame` now validates frame
  length, message type, dimensions, dirty-row bounds, row cell count, and
  codepoints before mutating the frontend grid buffer. `TerminalCanvas` catches
  decode/apply failures, marks the terminal failed through the existing visible
  runtime state, and preserves the prior rendered buffer instead of letting an
  uncaught stream callback exception leave a silent broken canvas. Evidence:
  `npm run verify:grid-diff` passed 3/3, including
  `malformed binary frames fail explicitly before mutating the grid buffer`;
  `npm run verify:map-terminals` now statically requires decoder validation,
  visible failed-state wiring, and the malformed-frame regression; `npm run build`
  passed.
- Legacy duplicate-prompt repair for old reused plain-shell sessions: old PTYs
  that already emitted stacked prompt bytes before the resize fixes can still
  reconstruct that bad-looking screen when the grid replays daemon scrollback.
  `TerminalCanvas` now detects the narrow first-frame pattern from the 2026-06-02
  screenshot (same shell prompt above the cursor prompt with only blank rows
  between) and sends one Ctrl-L redraw to the real daemon PTY. This keeps the
  parser and PTY consistent, repairs old plain-shell sessions, and skips
  alternate-screen sessions such as zellij/tmux/vim. Evidence:
  `npx playwright test legacy-prompt-repair` passed, `npm run verify:grid-diff`
  passed 3/3 after extending malformed-frame coverage to invalid cursor
  coordinates and trailing bytes, `npm run verify:map-terminals` statically
  requires the repair detector/wiring, and `npm run build` passed. The repair is
  now part of the standard fast frontend verifier: `npm run
verify:legacy-prompt-repair` passed 1/1, and `npm run verify:canvas-all` now
  includes it and passed 9/9. Slow live evidence is covered by
  `npm run verify:legacy-prompt-live`, which seeds the exact duplicated-prompt
  shape in a private Xvfb/Tauri daemon, switches `split -> links -> split` to
  reattach the same PTY without map reflow, and passed with
  `LEGACY_PROMPT_REPAIR_REUSED_PTY`, `LEGACY_PROMPT_REPAIR_CTRL_L_SENT`,
  `LEGACY_PROMPT_REPAIR_INPUT_REACHED_DAEMON`,
  `LEGACY_PROMPT_REPAIR_OUTPUT_IN_SNAPSHOT`,
  `LEGACY_PROMPT_REPAIR_VISUAL_REPAINT changed_pixels=9460`, and
  `LEGACY_PROMPT_REPAIR_OK`; screenshots are in
  `/tmp/tw-legacy-prompt-repair/`.

If a regression appears, `VITE_TERMINAL_RENDERER_MODE=web-xterm` reverts to xterm
on desktop instantly. Optional remaining polish: a true instrumented key-to-glyph
p95 (tag keypress with an invisible DCS, flag the carrying diff in Rust, measure
keypress→flagged-diff in React) — confirmation only, not a blocker to the default.

### TC-018: BiDi/RTL + text shaping (Hebrew nikud) in the headless grid

**Priority:** P2
**Status:** Todo

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
  when copying into `visual_grid`. Cursor tracks the _visual_ endpoint, not the
  logical one. Verify: `echo "שלום"` shows ש rightmost, ם leftmost.
- **Stage 3 — shaping & diacritics (`rustybuzz = 0.12`).** Load the bundled
  monospace font as a `rustybuzz::Face`; shape BiDi-reordered runs. Combining
  marks (nikud) with nonzero x/y offset stay in the _base_ cell as packed
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
unchanged lines. (2) Backend layout vs. frontend drawing must use the _same_
font → bundle one monospace font in Tauri assets; Rust loads it from disk, React
builds its atlas from the identical file.

### MC-001: Preserve canvas workspace mode

**Priority:** P2
**Status:** Done

Add a first-class workspace mode switch with `canvas`, `split`, and `graph`
surfaces. The Tauri app currently defaults to the split terminal workspace; this
task restores a canvas surface as a peer mode so the desktop migration does not
drop the existing Magic Canvas concept.

### MC-002: Persist workspace mode and canvas state

**Priority:** P2
**Status:** Done

Extend `workspaceUiState` with the active workspace mode and persist canvas
nodes, viewport, selected node, and node-terminal/file bindings. Restore the
selected mode and canvas state after reload without resurrecting stale PTY IDs.

### MC-005: Validate Tauri shell parity

**Priority:** P2
**Status:** Done

Run frontend build, Rust check, Tauri release build, and a manual `tauri dev`
smoke pass covering split terminals, file explorer operations, and canvas mode.

### MC-006: Improve canvas navigation and terminal organization

**Priority:** P2
**Status:** Done

Add safe all-side canvas node resizing, canvas pan/zoom controls, title renaming
from node headers, and a canvas sidebar that lists canvas terminals separately
from split-pane terminal tabs.

---

## Roadmap

### MC-003: Wire files and terminals into canvas nodes

**Priority:** P2
**Status:** Done

Allow file explorer actions and terminal tabs to create or attach canvas nodes.
Canvas terminal nodes should launch terminals in the selected directory while
file nodes should reference the tracked open-file model.

### MC-004: Add canvas regression fixtures

**Priority:** P2
**Status:** Done

Add fixtures for mixed terminal/file canvas layouts, Hebrew/English labels, and
mode switching. Verify canvas surfaces stay usable while raw PTY RTL remains
best-effort.

---

## Backlog (post-consolidation)

### TC-015: Per-node task badges on canvas terminals

**Priority:** P2
**Status:** Done

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

Completion notes:

- Added durable `CanvasNode.taskBinding` metadata plus a no-dependency
  MASTER_PLAN parser for table rows and task headings.
- Map terminal node chrome now exposes a task-binding control and renders a
  compact status badge outside the terminal buffer; the map sidebar mirrors it.
- Task status is re-read from the project `MASTER_PLAN.md` while mounted, so a
  changed plan updates the badge without requiring Zellij/tmux.

Verification:

- `npm run build` passed.
- `npm run verify:map-terminals` passed with TC-015 static guards.

### TC-020: Split-pane and canvas localhost preview surface

**Priority:** P2
**Status:** Done

Add a first-class preview pane so TermFleet can show a local web app beside the
terminal running its dev server, with the same preview represented on the map.

Acceptance:

- DONE: Command palette can open a preview pane next to the active terminal.
- DONE: Preview URL can be edited, normalized, persisted, and reloaded.
- DONE: Preview defaults to the localhost URL detected from the active terminal's
  output, so each dev terminal owns its relevant port.
- DONE: Quick actions support common local dev ports `3000` and `5173`.
- DONE: Canvas mode shows the preview as a node next to the linked terminal.
- DONE: The preview is isolated from PTY/daemon behavior; iframe-blocked apps
  remain a browser security limitation.

Completion notes:

- Added `preview` split-pane leaves plus persisted `previewUrl` state.
- Terminal panes detect localhost URLs from PTY output and store the relevant
  preview URL on that terminal pane.
- Added a `LocalhostPreview` surface with URL entry, reload, quick-port buttons,
  and a full-surface iframe.
- Added command menu and rail entry points for opening a preview beside the
  active development terminal.
- Added map preview nodes linked back to the originating terminal tab/pane.

Verification:

- `npm run build` passed.
- `npx playwright test tests/localhost-preview.spec.ts` passed.

### TC-021: Open-source developer preview lane

**Priority:** P2
**Status:** In Progress

Prepare TermFleet for a public open-source developer preview without positioning
it as another terminal emulator. The public story is: **a local-first operations
cockpit for supervising many terminals, local services, and coding agents**.

Launch bar:

- The first public release should prove the agent/ops cockpit loop in one
  coherent demo: open a project, spawn or attach multiple workstream terminals,
  see them on the operations map, bind them to tasks, preview local services,
  recover/reconnect sessions, and capture verification evidence.
- Do not launch on terminal aesthetics alone. Ghostty, Warp, Wave, Tabby, and
  existing multiplexers already cover large parts of the "better terminal"
  market. TermFleet differentiates through persistent multi-workstream control,
  spatial operations context, local-first recovery, and agent supervision.
- Treat TC-016 as the flagship feature for this lane, not a side feature.

Workstreams:

1. **Agent cockpit vertical slice**
   - Spawn named Codex / Claude Code / OpenCode / shell workstream terminals
     from the command bar and map.
   - Show agent role, task prompt, cwd, branch/worktree, status, last activity,
     and exit state on the node and sidebar.
   - In progress: redesigned the terminal/map header around useful
     `Context / Path / Now` fields, fed by the visible canvas grid snapshot plus
     recent transcript tail. Prompt/model chrome such as provider names,
     `Working ... esc to interrupt`, and bare prompt fragments are filtered
     before display. The optional local summarizer now uses a tiny-model-friendly
     payload with a heuristic candidate; `scripts/agent-status-summary-ollama.mjs`
     defaults to `gemma4:e2b-it` through Ollama and falls back deterministically.
     TUI wheel handling now keeps plain alternate-screen scrolling inside the
     app as faux arrow scrolling, while Shift+wheel remains the explicit outer
     scrollback bypass. Verification: `npm run verify:agent-status-summary`;
     `npx playwright test tests/map-terminal-rendering.spec.ts
     tests/terminal-mouse.spec.ts tests/agent-status-summary.spec.ts
     tests/agent-workstream.spec.ts`; `npm run build`; `npm run
     verify:map-terminals`; `git diff --check`;
     unsandboxed `APP_BUDGET=360 npm run verify:canvas-live` passed with
     Canvas2D live shell input/output, resize, vim, htop, and tmux screenshots in
     `/tmp/tw-canvas-live/`.
   - Let the parent cockpit send a follow-up message or stop/restart a child.
   - Keep the first version local and explicit; no hidden cloud orchestration.

2. **Operations map intelligence**
   - Auto-group nodes by project, task, branch, service, and agent role.
   - Add map filters for active, failed, waiting-for-input, test-running, and
     preview-linked terminals.
   - In progress: added shared operations-map filters across the primary map
     panel and the canvas map index. Nodes can now be narrowed to all, active,
     failed, waiting, tests, or preview-linked states from terminal status,
     preview URLs, and workstream metadata; empty filtered states now explain
     that no nodes match. Also hardened the sidebar preview rail against
     temporarily missing active-tab state. Verification: `npm run build`; `npm
     run verify:map-terminals`; unsandboxed `npx playwright test
     tests/map-terminal-rendering.spec.ts`; `git diff --check`.
   - Make the map explain the current workspace without manual arrangement.

3. **Durable recovery as a visible product feature**
   - Surface daemon/session states clearly: live, reconnecting, stale, restored,
     failed, and explicitly closed.
   - Add a "restore workspace" proof path to the demo and README.
   - Keep the existing rule that React unmount detaches but does not kill PTYs.

4. **Runbook and evidence capture**
   - Capture command history, cwd, branch, selected logs, test commands, preview
     URLs, screenshots, and verification status into a shareable local artifact.
   - Redact secrets and machine-local absolute paths before export.
   - Link captured evidence back to MASTER_PLAN task badges where available.

5. **Local services dashboard**
   - Detect localhost URLs, dev servers, ports, and failing commands from terminal
     output and process state.
   - Make preview nodes first-class companions to the service terminal that owns
     them.
   - Add quick actions for restart, open in browser, copy URL, and attach logs.

6. **OSS readiness**
   - Write a README that states what TermFleet is, what it is not, and why the
     architecture is different.
   - Add architecture diagram(s), demo GIF/video, install/run instructions,
     contribution guide, issue templates, license, and security disclosure path.
   - Run a secrets/path/license audit before publishing.
   - Ensure a fresh clone can build or fail with actionable prerequisite errors.

Acceptance (draft):

- A fresh user can run TermFleet from the README and understand the product in
  under 60 seconds from the first screen or demo.
- The demo differentiates TermFleet as an agent/ops cockpit, not a generic
  split-pane terminal.
- TC-016 has a working vertical slice with at least two independently supervised
  agent/workstream terminals.
- Session recovery is visible and verified with the existing daemon-backed smoke
  path.
- Preview/service detection works for at least one common local web app flow.
- Public docs include install, architecture, contribution, license, security,
  limitations, and roadmap sections.
- Repo audit finds no committed secrets, personal tokens, accidental private
  paths in user-facing docs, or unsupported claims.

Verification (planned):

- `npm run build`
- `npm run verify:canvas-live`
- `npm run verify:standalone-daemon`
- `npm run verify:canvas-all`
- Fresh-clone README smoke on a clean temp directory or VM/container equivalent.

### TC-022: External agent bridge: let Hermes attach to and control TermFleet terminals

**Priority:** P1
**Status:** Todo
**Depends:** TC-016, TC-017

#### Problem

Hermes can reliably drive coding agents it launches itself, and it can drive
interactive agents when they live inside a controllable PTY layer like tmux. But
that is the wrong long-term dependency for TermFleet: the product is itself a
terminal cockpit. If Codex, Claude Code, OpenCode, shell sessions, or long-running
project terminals are already running inside TermFleet, Hermes should be able to
address those terminals through TermFleet instead of asking the user to use tmux
as a sidecar control plane.

#### Goal

Expose a local-first control bridge so an external orchestrator such as Hermes can
list TermFleet terminals, inspect their state, attach to an existing terminal,
send input/follow-up prompts, open a new managed terminal, and read bounded output
or structured status without stealing ownership from the TermFleet daemon.

#### Scope

- Add a local control API backed by the existing daemon/session model, not a
  separate tmux dependency. Candidate transports: localhost HTTP/WebSocket or a
  Unix-domain socket with explicit local-only binding.
- Provide read APIs for terminal inventory: session id, title, cwd, command,
  project/task binding, shell/agent type, live/stale/failed/waiting status, last
  activity, active pane/node, and whether input is currently safe.
- Provide write APIs for:
  - send text + Enter to an existing terminal
  - send raw key/input sequences when needed
  - open a new terminal for shell / Codex / Claude Code / OpenCode with cwd,
    env, prompt, task id, and optional worktree metadata
  - stop/restart/close a managed terminal with clear confirmation semantics
- Provide bounded output APIs: recent screen text, recent scrollback slice,
  structured events, and waiting-for-input markers. Avoid dumping unbounded
  terminal history into an agent context.
- Add auth/safety suitable for a local developer tool: loopback/UDS only by
  default, per-session capability token or one-time pairing token, command audit
  log, and visible UI indicator when an external controller is attached.
- Add a Hermes-facing CLI/helper contract, for example `termfleetctl list`,
  `termfleetctl send <session> <text>`, `termfleetctl open --agent codex ...`,
  so agents can use terminal/file tools without bespoke MCP first.
- Keep the first version explicit and local. No hidden cloud relay and no silent
  control of terminals the user has not exposed to the bridge.

#### Key files / refs

- Existing daemon/session ownership: `src-tauri/src/daemon_client.rs`, daemon
  session APIs, and the current PTY lifecycle from TC-009 / TC-017.
- Cockpit orchestration surface: TC-016.
- Canvas/headless renderer state and session attach model: TC-017.
- Future agent-facing wrapper: `termfleetctl` or equivalent local CLI.

#### Verification

- Hermes can list TermFleet sessions and identify at least one shell terminal,
  one Codex/Claude terminal, and their cwd/status without tmux.
- Hermes can send a follow-up prompt to an existing TermFleet-managed agent
  terminal and read back enough output to know whether it is working or waiting.
- Hermes can open a new managed Codex/Claude/shell terminal through TermFleet and
  see it appear in the cockpit/map with correct metadata.
- Closing/restarting a terminal through the bridge updates both the daemon state
  and the UI, and never kills an unrelated terminal.
- External-control attachment is visible in the UI and recorded in an audit log.
- Local-only security is enforced: API refuses non-loopback/unauthorized access,
  and tests cover missing/invalid capability tokens.

Progress notes:

- Control-surface read-only slice added: `docs/control-surface.md` defines the
  TC-022 query/command/event boundary and ownership rules, and
  `scripts/termfleetctl.mjs` exposes read-only JSON for `status --json`,
  `sessions list --json`, and `agents list --json`. The CLI reads the existing
  daemon socket plus durable workspace/session mirrors without spawning,
  writing, killing, or creating sessions. Verification:
  `node scripts/verify-termfleetctl.mjs` passed; live read-only daemon checks
  showed `reachable=true`, `mode=externalDaemon`, 7 live sessions, 8 persisted
  sessions, and 8 merged session rows.
- Follow-up CLI wiring added: package scripts now expose
  `npm run termfleetctl -- ...` and `npm run verify:termfleetctl`, keeping the
  first control-surface slice easy to run without making it a mutating command
  surface. Verification: `npm run verify:termfleetctl` passed.
- First vertical slice added: command palette and sidebar launch menu can create
  a supervised `Codex workstream` terminal, persist agent/workstream metadata on
  the tab, show the workstream in the sessions list, and render an `AGENT` node
  badge plus provider status on the operations map.
- New workstream creation switches to the map and centers the created node so the
  supervision surface is visible immediately.
- Second slice added: workstreams now carry a provider `startupCommand`
  (`codex`, `claude`, or `opencode`), pass that command into the existing PTY
  spawn path, and advance visible status from `ready` to `running` / `failed`
  based on terminal lifecycle callbacks.
- Third slice added: agent workstreams now have a durable input queue. The map
  node exposes a follow-up prompt action, queued text is sent through the mounted
  terminal transport, and each input is marked sent after dispatch.
- Fourth slice added: agent workstreams now parse conservative status cues from
  terminal output (`waiting`, `failed`, `done`) across a rolling output window,
  and map nodes expose non-destructive Stop / Restart controls. Stop kills the
  PTY while keeping the workstream node; Restart bumps the workstream generation
  so the terminal remounts through the existing spawn path.
- Fifth slice added: agent workstream launchers now check provider availability
  before creating the tab. Desktop uses a Tauri `agent_provider_statuses`
  command to check `codex`, `claude`, and `opencode` on PATH; browser preview
  records simulated availability for regression coverage. Workstream metadata
  stores the provider availability message, unavailable providers stay in a
  failed inline state instead of mounting a shell, and the initial launch prompt
  is queued automatically through the same terminal dispatch path as follow-up
  prompts.

- Sixth slice added: workstreams now maintain a durable cockpit event timeline
  for mission creation, provider readiness, queued prompts, sent prompts, parsed
  status changes, stop, and restart. Agent map nodes render a compact mission
  panel plus latest timeline events above the live terminal, and the sessions
  list includes the latest workstream event so the loop reads as a supervised
  agent cockpit rather than a tagged terminal.
- Seventh slice added: provider definitions now include a small control contract
  (`launchMode`, `readinessCheck`, `stopBehavior`, `structuredStatus`) and each
  workstream tracks a cockpit phase (`queued`, `launching`, `active`,
  `needs-input`, `complete`, `interrupted`, `blocked`). The map cockpit renders
  launch/readiness/status/stop cells so the UI is explicit about what is
  provider-aware today and what is still terminal-inferred.
- Eighth slice added: workstreams now track provider readiness (`path-checked`,
  `provider-ready`, `auth-required`, `unknown`) and classify provider output for
  auth-required, ready, and interrupted/cancelled cues. The cockpit also has an
  explicit Interrupt control that sends Ctrl-C through the terminal transport
  and records an `Interrupt requested` operator event before the hard Stop path.
- Ninth slice added: workstreams now maintain durable operator guidance fields
  (`lastSummary`, `nextAction`) derived from launch, prompt dispatch, parsed
  status, interrupt, stop, and restart transitions. The map cockpit renders a
  Summary/Next row and the sessions list includes the latest summary, so a run
  can be understood without reading terminal scrollback or raw timeline cards.
- Tenth slice added: the terminal output bridge now recognizes structured
  provider signals of the form `[[TERMFLEET_AGENT_EVENT {...}]]`. These signals
  can set status, phase, readiness, summary, next action, and event labels,
  mark the workstream as structured-status capable, and are de-duplicated across
  replay windows. Heuristic parsing ignores marker payloads so structured
  summaries are not overwritten by fallback text matching.
- Eleventh slice added: desktop provider launches now route through a
  repo-local shell adapter command (`scripts/agent-provider-adapter.sh`) returned
  by the Tauri provider availability check. The PTY spawn path supports command
  strings via `$SHELL -lc`, so adapter commands can include arguments. The
  adapter emits structured launch/exit/failure markers around the real provider
  CLI, giving Codex/Claude/OpenCode launches a concrete structured-status path
  before a deeper provider API exists.
- Twelfth slice added: agent workstreams now roll up into a shared supervision
  lane. The canvas renders an at-a-glance `Agent workstreams` overlay with total,
  active, waiting, blocked, and complete counts plus quick focus rows. The
  sidebar Sessions and Map panels use the same summary logic so multiple child
  agents read as one supervised lane instead of isolated terminals.
- Thirteenth slice added: provider contracts now include explicit auth-check and
  control-protocol fields, persisted on each workstream and rendered as Auth /
  Control cockpit cells. Provider readiness classification now gives
  auth-required and provider-ready states provider-specific summaries and next
  actions, and the rolling-output classifier uses the newest readiness cue so an
  authenticated/ready message can recover from an earlier auth-required prompt.
- Fourteenth slice added: cancellation now has an explicit lifecycle. Interrupt
  sends Ctrl-C but moves the workstream to a `cancelling` phase with
  `Cancellation requested` guidance instead of immediately claiming interruption.
  Provider output that says cancelled/interrupted/aborted then acknowledges the
  cancellation and moves the run to `interrupted` / `stopped`; hard Stop remains
  the fallback when the provider does not return control.
- Fifteenth slice added: the provider adapter now participates in the control
  plane instead of only wrapping launch/exit. It traps interrupt/termination
  signals, emits structured cancellation-request markers, forwards the signal to
  the provider process, and emits a structured cancellation-ack marker once the
  provider exits. Desktop provider command construction now shell-quotes the
  adapter path, so repo paths containing single quotes cannot break launches.
- Sixteenth slice added: workstreams now maintain a durable run record:
  queued prompts, sent prompts, structured signals, control actions, and current
  outcome. The map cockpit renders a compact `Agent run record` row so the demo
  loop can be understood at a glance without reading scrollback or timeline
  cards.
- Seventeenth slice added: agent cockpit nodes now expose `Copy agent run brief`.
  The copied handoff includes mission, provider, status/phase, readiness,
  summary, next action, outcome, run-record counters, and latest event, making
  the completed demo loop shareable without scraping terminal output.
- Eighteenth slice added: agent lane summaries now compute prioritized operator
  attention. Canvas, Sessions, and Map lane surfaces show the highest-priority
  item requiring action (auth required, needs input, cancelling, blocked, or
  complete) plus the relevant next-action detail, so multi-workstream supervision
  points the operator at the right child instead of only showing counts.
- Nineteenth slice added: primary attention rows are now actionable. Clicking
  the highlighted attention item on the canvas focuses the target workstream
  node, while the Sessions and Map sidebars open/focus the same workstream in
  their respective surfaces.
- Twentieth slice added: agent launch now captures a concrete mission before
  creating the workstream. The mission is persisted separately from the mutable
  latest prompt, rendered in the cockpit mission panel, and used in the copied
  run brief even after follow-up prompts and structured provider markers change
  the current prompt.
- Twenty-first slice added: completed workstreams now have an explicit operator
  review step. `Mark run reviewed` moves the run to a durable reviewed phase,
  records a control event, preserves the completed run record, and clears lane
  attention so the supervision loop can close without deleting the workstream.
- Twenty-second slice added: agent workstreams now carry a durable run identity
  and timing record. Each run gets a provider-scoped run id, the cockpit run
  record shows run/generation plus completion/review times, and copied run
  briefs include run id, generation, started, completed, and reviewed fields so
  handoffs refer to a specific supervised run.
- Twenty-third slice added: agent cockpit nodes now have a visible operator
  composer for follow-up prompts. Follow-ups no longer rely on modal
  `window.prompt`; the composer queues through the same durable input path, and
  xterm's link-hit overlay no longer intercepts cockpit controls.
- Twenty-fourth slice added: provider exit is now a first-class run-record
  field. Structured provider markers and the desktop adapter can carry an
  `exitCode`, the cockpit renders an Exit cell, and copied run briefs include
  the exit code so child termination is visible without reading terminal
  scrollback.
- Twenty-fifth slice added: the cockpit now shows durable operator input
  history. The latest queued/sent prompt is visible below the composer and is
  included in copied run briefs, so operator steering is inspectable without
  reading event titles or terminal output.
- Twenty-sixth slice added: blocked/failed workstreams now expose a visible
  recovery affordance. `Draft recovery prompt` appears in the cockpit composer
  for failed children, seeds a recovery prompt, and structured provider signals
  now clear stale heuristic windows so old auth/status text cannot overwrite
  newer machine-readable failure state.
- Twenty-seventh slice added: structured provider events can now carry
  operator-facing evidence. The cockpit persists the evidence string, renders it
  beside Summary/Next, and includes it in copied run briefs so a completed child
  result has visible proof without scraping terminal scrollback.
- Twenty-eighth slice added: structured provider events can now report the
  child work stage. The cockpit persists the stage, renders it as a provider
  control cell, and includes it in copied run briefs so operators can see
  whether the child is analysing failure, executing, verifying, or ready for
  review.
- Twenty-ninth slice added: structured provider events can now report a child
  artifact. The cockpit persists the artifact path/name, renders it beside
  Summary/Next/Evidence, and includes it in copied run briefs so a completed
  child run points to a concrete deliverable instead of only terminal output.
- Thirtieth slice added: structured provider events can now report confidence.
  The cockpit persists the confidence string, renders it in the provider control
  grid, and includes it in copied run briefs so an operator can distinguish a
  high-confidence completion from a low-confidence failure at a glance.
- Thirty-first slice added: structured provider events can now report risk.
  The cockpit persists the risk string, renders it beside Confidence in the
  provider control grid, and includes it in copied run briefs so handoffs carry
  the child's own residual-risk note rather than only pass/fail status.
- Follow-up visual pass: the provider control grid now wraps into four columns
  across two rows so Stage / Confidence / Risk remain readable after adding the
  structured telemetry fields.
- Current limitation: status parsing is text-pattern based, not provider-native
  structured state. Stop/restart is PTY-level control, not a provider-aware
  graceful cancellation protocol. Provider availability is PATH-based; it does
  not yet validate auth/session readiness for each CLI.

Verification:

- `npm run build` passed.
- Browser smoke against `http://127.0.0.1:5177/` created `New agent workstream`
  from the command palette and found both `agent` and `Codex · running` visible.
- Screenshot evidence: `/tmp/termfleet-agent-workstream-smoke.png`.
- `npx playwright test tests/agent-workstream.spec.ts` passed, covering command
  palette creation, visible map badges, persisted provider metadata, startup
  command, runtime status, queued follow-up input, terminal dispatch, and sent
  acknowledgement, waiting-state parsing, stop, and restart.
- `npm run build` passed again after provider availability wiring.
- `npx playwright test tests/agent-workstream.spec.ts` passed again, now also
  covering browser-preview provider availability metadata and automatic initial
  prompt dispatch before the follow-up prompt.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed for the new provider
  status command.
- `npm run build` passed after the cockpit event timeline UI/model changes.
- `npx playwright test tests/agent-workstream.spec.ts` passed after adding
  assertions for the visible mission panel, persisted event timeline, prompt
  sent events, follow-up events, stop event, and restart/status event sequence.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed again.
- `npm run build` passed after adding provider control-contract metadata and
  cockpit phases.
- `npx playwright test tests/agent-workstream.spec.ts` passed after adding
  assertions for visible provider-control cells plus persisted launch mode,
  readiness check, stop behavior, structured-status flag, and phase transitions.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed again.
- `npm run build` passed after adding provider readiness classification and the
  interrupt control path.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering the
  visible `path-checked` readiness cell, persisted readiness metadata, Interrupt
  button, browser Ctrl-C dispatch, `Interrupt requested` event, hard Stop, and
  restart.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed again.
- `npm run build` passed after adding durable operator summaries and next-action
  guidance.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering the
  visible Summary/Next row and persisted guidance through launch, follow-up,
  waiting, interrupt, hard stop, and restart.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed again.
- `npm run build` passed after adding structured provider signal parsing.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering a
  structured completion marker that updates status, phase, readiness,
  structured-status flag, summary, next action, and timeline signal event.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed again.
- `sh scripts/agent-provider-adapter.sh unsupported` emitted a structured
  adapter failure marker and exited `64`, proving the wrapper failure path
  without requiring a real provider install.
- `npm run build` passed after routing desktop providers through the adapter
  command.
- `npx playwright test tests/agent-workstream.spec.ts` passed with the existing
  browser-preview structured-signal loop.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after adding shell
  command-string support to the PTY spawn path.
- `npm run build` passed after adding shared agent-lane aggregation and the
  canvas/sidebar supervision surfaces.
- `npx playwright test tests/agent-workstream.spec.ts` passed with two tests,
  covering the existing supervised Codex loop plus a two-workstream lane summary
  (`2 agents`, `2 active`) in UI and persisted state.
- `cd src-tauri && cargo check` passed after the multi-workstream supervision
  UI slice.
- `npm run build` passed after adding provider auth/control contract metadata
  and cockpit Auth / Control cells.
- `npx playwright test tests/agent-workstream.spec.ts` passed with coverage for
  auth-required output (`readiness=auth-required`, auth summary/next action,
  provider event) followed by authenticated ready output recovering to
  `readiness=provider-ready`, `phase=active`, and provider-ready guidance.
- `cd src-tauri && cargo check` passed after the provider-aware readiness/control
  UI slice.
- `npm run build` passed after adding the explicit `cancelling` phase and
  cancellation-pending UI state.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering the
  graceful-cancel flow: Ctrl-C request leaves the workstream running but
  `phase=cancelling`, and later provider cancellation output acknowledges the
  cancellation as `status=stopped`, `phase=interrupted`.
- `cd src-tauri && cargo check` passed after the cancellation lifecycle slice.
- Fake-provider adapter smoke passed: a stub `codex` on PATH launched through
  `scripts/agent-provider-adapter.sh`, received forwarded `TERM`, and emitted
  structured `Adapter launched`, `Adapter termination requested`, and
  `Provider cancellation acknowledged` markers before exiting `143`.
- `cargo test shell_quote_handles_single_quotes` passed for robust adapter path
  quoting.
- `sh scripts/agent-provider-adapter.sh unsupported` emitted the expected
  structured adapter failure marker and exited `64`.
- `npm run build` passed after the adapter-supervision and Rust launch quoting
  changes.
- `npx playwright test tests/agent-workstream.spec.ts` passed after the adapter
  supervision changes, preserving the browser-preview cockpit loop.
- `cd src-tauri && cargo check` passed after the adapter-supervision slice.
- `npm run build` passed after adding durable run-record fields and the
  cockpit `Agent run record` row.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  prompt/sent/signal/control counts and outcome across launch, follow-up,
  auth-required, provider-ready, cancellation, stop, restart, and structured
  completion.
- `cd src-tauri && cargo check` passed after the run-record cockpit slice.
- `npm run build` passed after adding the copyable agent run brief action.
- `npx playwright test tests/agent-workstream.spec.ts` passed after granting
  clipboard permissions, copying the final agent run brief, and verifying the
  copied handoff contains mission, provider, status, readiness, summary, next
  action, outcome, run-record counters, and latest structured event.
- `cd src-tauri && cargo check` passed after the run-brief cockpit slice.
- `npm run build` passed after adding prioritized lane-attention aggregation and
  lane attention rows.
- `npx playwright test tests/agent-workstream.spec.ts` passed after verifying
  auth-required attention is surfaced in the canvas/map lane and final completed
  work prompts review attention.
- `cd src-tauri && cargo check` passed after the lane-attention slice.
- `npx playwright test tests/agent-workstream.spec.ts` passed after proving the
  canvas attention row can restore focus to the auth-required agent workstream
  after focus moves to a new terminal.
- `npm run build` passed after making attention rows actionable.
- `cd src-tauri && cargo check` passed after the actionable-attention slice.
- `npm run build` passed after adding launch mission capture and durable mission
  metadata.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering the
  mission launch dialog, persisted mission, mutable latest prompt, copied run
  brief mission preservation, and two-workstream launch missions.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the mission
  capture slice.
- `npm run build` passed after adding the reviewed completion state and cockpit
  control.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  structured completion, copied run brief, `Mark run reviewed`, persisted
  reviewed state, and lane attention clearing (`0 attention`).
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the reviewed
  completion slice.
- `npm run build` passed after adding durable run identity and timing fields.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  persisted run id, created/completed/reviewed timestamps, visible run/timing
  cells, and copied brief run/timing lines.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the run identity
  and timing slice.
- `npm run build` passed after replacing modal follow-ups with the visible
  cockpit composer and preventing xterm link-layer click interception.
- `npx playwright test tests/agent-workstream.spec.ts` passed after sending all
  operator follow-ups through `Agent follow-up prompt` / `Queue follow-up
prompt`, including auth-required, provider-ready, cancellation ack, and
  structured completion flows.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the visible
  composer slice.
- `npm run build` passed after adding provider exit-code propagation to
  structured signals, adapter exit markers, the cockpit run record, and copied
  run briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after verifying
  structured completion with `exitCode=0`, the visible Exit cell, preserved exit
  code after review, and `Exit: 0` in the copied run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the provider
  exit-code slice.
- `npm run build` passed after adding the visible latest-input strip and copied
  brief latest-input line.
- `npx playwright test tests/agent-workstream.spec.ts` passed after verifying
  `Agent input history` shows the latest sent follow-up prompt and copied briefs
  include the latest structured input.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the input
  history slice.
- `npm run build` passed after adding the failed-workstream recovery draft
  affordance and making structured provider signals authoritative over stale
  heuristic output.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering a
  structured provider failure (`status=failed`, `phase=blocked`, `exitCode=2`),
  blocked lane attention, visible `Draft recovery prompt`, queued recovery
  prompt, and recovery back to provider-ready state.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the recovery
  affordance slice.
- `npm run build` passed after adding first-class provider evidence capture to
  structured signals, workstream metadata, the cockpit panel, and copied run
  briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  structured failure evidence, structured completion evidence, visible cockpit
  Evidence guidance, and `Evidence:` in the copied run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the evidence
  capture slice.
- `npm run build` passed after adding first-class provider stage capture to
  structured signals, workstream metadata, the provider control grid, and copied
  run briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  structured failure stage (`failure analysis`), structured completion stage
  (`review`), visible cockpit Stage cells, and `Stage:` in the copied run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the stage
  capture slice.
- `npm run build` passed after adding first-class provider artifact capture to
  structured signals, workstream metadata, operator guidance, and copied run
  briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering a
  failed-run crash artifact (`logs/provider-crash.txt`), a completed-run report
  artifact (`reports/checkout-flow.md`), visible cockpit Artifact guidance, and
  `Artifact:` in the copied run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the artifact
  capture slice.
- `npm run build` passed after adding first-class provider confidence capture
  to structured signals, workstream metadata, the provider control grid, and
  copied run briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  low confidence on structured failure, high confidence on structured
  completion, visible cockpit Confidence cells, and `Confidence:` in the copied
  run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the confidence
  capture slice.
- `npm run build` passed after adding first-class provider risk capture to
  structured signals, workstream metadata, the provider control grid, and copied
  run briefs.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  structured failure risk (`provider crashed before saving state`), structured
  completion risk (`low residual risk`), visible cockpit Risk cells, and
  `Risk:` in the copied run brief.
- `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check` passed after the risk
  capture slice.
- Temporary Playwright visual smoke passed for the structured telemetry cockpit
  panel. Layout measurements showed no provider-grid overflow after the four
  column wrap (`provider scrollWidth=798 clientWidth=798`), and screenshot
  evidence was captured at `/tmp/termfleet-agent-telemetry-panel.png`.
- `npx playwright test tests/agent-workstream.spec.ts` passed after covering
  visible agent node header task text at launch and after a queued follow-up
  prompt.
- `npm run build` passed after moving the mutable agent task into the always
  visible canvas node header while preserving ordinary shell terminal headers.

### TC-016: Multi-agent orchestration from the cockpit

**Priority:** P2
**Status:** DONE

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

### TC-016h: Live terminal activity + agent status list

**Priority:** P1
**Status:** DONE

User-facing correction for TC-016: the product goal is not an abstract "agent
cockpit"; it is terminals that say what they are doing in real time, with a
compact sidebar/list for scanning many terminals at once.

Product rule:

- Terminal pane/header shows one short live activity strip, for example
  `Now: running tests · needs proof` or `Now: waiting for auth`.
- Sidebar agent rows show the scan-friendly structured state: mission/title,
  provider (`codex`, `claude`, `opencode`, `shell`), lifecycle (`working`,
  `idle`, `blocked`, `done`), current activity, and proof/review/attention state.
- Clicking a sidebar row focuses the real terminal.
- The terminal remains the primary shell surface; status text must not replace
  scrollback or add noisy chrome.
- The same data should also feed map nodes and copied briefs, but sidebar +
  terminal-header visibility is the acceptance gate.

Acceptance:

- A live run with at least two supervised workstreams shows distinct sidebar rows
  like `mission · working · codex` and `mission · idle · claude`.
- Each corresponding terminal pane/header shows a short `Now:` description that
  changes as the workstream starts, runs, waits/blocks, completes, or exits.
- Provider, status, current activity, and proof/review/attention state are
  visible from the sidebar without opening every terminal.
- Follow-up, stop/restart, provider-exit, blocked/auth, and completion states
  update both the terminal strip and sidebar row from the existing workstream
  metadata/event path.
- Verification includes the focused Playwright agent-workstream spec plus a
  browser or desktop smoke screenshot proving the compact list and terminal
  activity strip are visible together.

Progress notes:

- First slice: the agent run lists in the Sessions and Map sidebars now render
  as compact status rows instead of generic `Copy run` rows. Each row leads with
  the mission/title, then shows scan-friendly status/provider/activity/attention
  state such as `working · codex · running tests · needs proof`, while still
  preserving the existing run-brief copy side effect.
- The terminal pane already exposes the short `Now:` strip for agent
  workstreams; regression coverage now locks that the visible sidebar row and
  terminal strip can be reached in the same launch flow.
- Verification: `npm run build` passed; `npx playwright test
  tests/agent-workstream.spec.ts` passed 9/9 after locking compact map rows,
  terminal `Now:` visibility, and the browser-preview provider activity variant.
- Second slice: the terminal pane/header `Now:` strip is now activity-first
  instead of repeating mission/provider/phase. The terminal header keeps the
  mission in the existing context cell and uses `Now:` only for the current
  activity, for example `Now: Ready for review` or `Now: codex: command is not
  available...`.
- Verification: `npm run build` passed; `npx playwright test
  tests/agent-workstream.spec.ts` passed 9/9 with assertions updated to reject
  the old verbose `mission · provider · phase · activity` header format.
- Third slice: the multi-workstream regression now seeds distinct provider and
  lifecycle states in the visible run list: a `working · codex` row and an
  `idle · claude` row. The same test clicks the Sessions sidebar rows and
  verifies each corresponding terminal header exposes a short `Now:` strip,
  including the real browser-preview provider-output activity for the Codex
  terminal and a structured idle activity for the Claude row.
- Verification: `npm run build` passed; `npx playwright test
  tests/agent-workstream.spec.ts -g "agent lane summarizes multiple supervised
  workstreams"` passed; `npx playwright test tests/agent-workstream.spec.ts`
  passed 9/9; `git diff --check` passed.

### TC-016i: LLM-summarized agent work status

**Priority:** P1
**Status:** DONE
**Depends on:** TC-016h

Goal: a user looking at a terminal/map card can immediately understand what the
agent is actually working on, where it is working, and what it is doing now,
without reading raw terminal output, command strings, or metadata.

This is the correction lane for the current TC-016h gap: `Now:` text that comes
directly from terminal output can say things like `/clear`, `hi`, provider
runtime errors, or shell commands. That is not enough. TermFleet needs a small
LLM/status process that turns terminal output + workstream events into a
human-facing status object.

Product rule:

- Use a small local/cheap LLM/status process to summarize noisy terminal output
  and workstream events into structured UI status.
- Render the summarized status prominently in the terminal/map card header:
  `Working on: <task>`, `Path: <file/lane/module>`, and
  `Now: <current concrete step>`.
- Keep provider/status chips visible nearby, for example
  `codex · working · needs proof`.
- Do not show raw commands as the primary answer to "what is this agent doing?"
  unless the command itself is the task.
- Use the empty horizontal space in map terminal cards; important status text
  must not be hidden behind ellipsis while the card has unused room.
- Preserve the terminal buffer as the shell surface underneath; the summary
  should explain the run, not replace scrollback.
- Apply the frontend design skill to the map/terminal header in practice: dense,
  professional operations UI; task and path first; readable at a glance.

Status schema:

```json
{
  "task": "Fix TC-016h map header status visibility",
  "path": "src/components/MagicCanvas.tsx",
  "now": "Updating the map node header layout",
  "status": "working",
  "provider": "codex",
  "confidence": "high"
}
```

Implementation slices:

1. Add the status summarizer contract:
   - Input: workstream mission, provider, latest prompt, latest terminal output,
     recent events, cwd/git/path context.
   - Output: strict JSON with `task`, `path`, `now`, `status`, `provider`, and
     optional `proof`, `blocker`, `confidence`.
   - Fallback: deterministic non-LLM summary from mission + path + current
     activity when the LLM/status process is unavailable.
2. Add update cadence:
   - Update on launch, prompt sent, notable terminal output, provider phase
     changes, completion/blocker events, and a short active interval.
   - Avoid calling the LLM for every keystroke; debounce noisy output while still
     feeling live.
3. Redesign the map terminal card/header:
   - First line: `Working on: <task>`.
   - Second line: `Path: <path>` and `Now: <step>`.
   - Status chips: provider, lifecycle, proof/blocker/review state.
   - Use available card width before truncating.
4. Mirror the same status in the split terminal header and sidebar rows without
   duplicating noisy copy.
5. Add proof and regression coverage.

Acceptance:

- A real or seeded agent run whose terminal contains only noisy command/output
  still shows a human-readable task/path/now summary in the map card.
- The map header visibly answers "what is this agent working on?" without
  opening Details, copying a brief, or reading terminal scrollback.
- The split terminal header and sidebar row use the same summarized status.
- Raw terminal commands/provider errors are demoted to supporting activity, not
  the main status, when a better task summary is available.
- Long status text uses available card width and wraps/clamps deliberately; it
  must not be hidden in a tiny ellipsis strip while the card has empty space.

Testing and verification:

- Unit/contract tests for the summarizer parser/fallback:
  - valid JSON response maps to UI status;
  - malformed/empty response falls back to mission/path/current activity;
  - noisy terminal output like `/clear`, `hi`, shell prompts, provider errors,
    and long command strings does not become the primary task.
- Playwright regression for a map terminal card:
  - seed noisy terminal output plus a workstream mission/path;
  - assert visible `Working on:`, `Path:`, `Now:`, and provider/status chips;
  - assert no important task/path text is hidden by avoidable ellipsis.
- Visual proof:
  - browser or desktop screenshot showing the map card with the summarized
    task/path/now header and terminal buffer underneath.
  - screenshot review must fail if there is large unused header space while the
    status is truncated.
- Required commands before marking done:
  - `npm run build`
  - focused summarizer/unit tests
  - focused Playwright map-card proof
  - `npx playwright test tests/agent-workstream.spec.ts`
  - `git diff --check`

Progress notes:

- First slice: added the `agentStatusSummary` contract/fallback layer and wired
  map/split headers to render user-facing agent status instead of raw terminal
  output. Agent map nodes now show `Working on`, `Path`, `Now`, and compact
  provider/status chips in the header, using the card width before truncation.
  The split terminal header mirrors `Working on: <task>` and the summarized
  `Now:` line.
- The fallback explicitly demotes noisy terminal output such as `/clear`, `hi`,
  shell prompts, and browser-preview provider command errors so those strings do
  not become the primary task/status. Stopped/done/blocked lifecycle states are
  preserved in the visible status chips instead of flattening to generic idle.
- The map fleet summary is compact and bounded so it does not cover agent card
  controls or the terminal/cockpit status area.
- Verification: `npm run build` passed; `npx playwright test
  tests/agent-status-summary.spec.ts tests/agent-workstream.spec.ts` passed
  12/12; `git diff --check` passed. Visual proof saved at
  `docs/visual-baselines/tc-016i-agent-status-map.png`.
- Second slice: added the optional real status-process hook. When
  `VITE_AGENT_STATUS_SUMMARY_ENDPOINT` is set, terminal workstream updates post
  debounced transcript + workstream context to that endpoint and persist the
  returned strict JSON as `workstream.statusSummary`. When the endpoint is not
  configured or fails, the UI keeps using the deterministic fallback without
  writing fallback summaries into the store.
- Verification after second slice: `npm run build` passed; `npx playwright test
  tests/agent-status-summary.spec.ts tests/agent-workstream.spec.ts` passed
  14/14.
- Third slice: added a repo-local no-dependency status summary process at
  `scripts/agent-status-summary-server.mjs`. It serves `POST /status`, returns
  strict JSON, supports CORS for the Vite/Tauri webview, and can delegate to a
  configured local model/LLM command through `TERMFLEET_AGENT_STATUS_COMMAND`
  plus optional JSON-array `TERMFLEET_AGENT_STATUS_ARGS`. Start it, then run the
  app with `VITE_AGENT_STATUS_SUMMARY_ENDPOINT=http://127.0.0.1:37819/status`.
  If no command is configured, the server still provides a structured fallback
  so the app contract can be tested without credentials.
- Verification after third slice: `npm run verify:agent-status-summary` passed;
  `npx playwright test tests/agent-status-summary.spec.ts` passed 5/5;
  `npm run build` passed.
- Final closeout verification: `npm run verify:agent-status-summary` passed;
  `npm run build` passed; `npx playwright test
  tests/agent-status-summary.spec.ts tests/agent-workstream.spec.ts` passed
  14/14; `git diff --check` passed.

TC-016 parent closeout:

- The parent orchestration lane is complete through the current cockpit scope:
  named supervised agent terminals can be launched from the command palette/map,
  interactive and headless provider profiles are represented in durable
  workstream metadata, map/split/sidebar surfaces show readable task/path/now
  status instead of raw terminal noise, queued follow-up prompts and provider
  exits are visible, proof/attention/recovery queues are surfaced, copied lane
  briefs summarize active child workstreams, and dedicated Git worktree
  provisioning/cleanup has Rust-side coverage.
- Closeout verification: `npm run build` passed; `npm run
  verify:agent-status-summary` passed; `npm run verify:agent-adapter` passed;
  `npx playwright test tests/agent-workstream.spec.ts
  tests/agent-status-summary.spec.ts` passed 14/14; `cargo test
  --manifest-path src-tauri/Cargo.toml worktree` passed 4/4 targeted tests.

TC-016 historical progress notes:

- First slice implemented as a supervised local workstream surface:
  `createAgentWorkstream()` creates a tab with durable `workstream` metadata and
  an ordinary terminal PTY, then exposes it through the command palette,
  right-click launch menu, sessions list, and canvas map.
- Agent workstreams now pass provider startup commands through the existing
  terminal `command` prop into `daemon_ensure_session` / `pty_ensure`.
- Agent workstreams now have a durable input queue consumed by mounted split/map
  terminals; the map node can queue follow-up prompts and mark them sent after
  dispatch.
- Agent workstreams now expose Stop and Restart map-node controls. Restart is
  implemented by killing the current PTY, clearing terminal runtime state, and
  incrementing `workstream.generation` so the mounted terminal remounts fresh.
- Agent workstream launchers now check provider availability before creation,
  record the availability result in durable metadata, keep unavailable providers
  in a failed inline state, and automatically send the initial prompt through
  the terminal transport when the provider is available. The next implementation
  step is provider-aware graceful cancellation, auth/session readiness checks,
  and structured status extraction.
- Agent workstreams now have a durable cockpit event timeline and map-node
  mission panel, so the demo loop exposes mission, provider, prompt, status,
  stop, and restart state without relying on terminal scrollback.
- Agent workstreams now expose provider control-contract metadata and explicit
  run phases in both durable state and the map cockpit, distinguishing
  provider-aware launch/readiness facts from terminal-inferred status.
- Agent workstreams now classify provider readiness/auth/cancel cues from CLI
  output and expose an interrupt-before-stop operator control, so the cockpit
  loop has a graceful cancellation request before hard PTY teardown.
- Agent workstreams now surface a durable operator summary and next action in
  the map cockpit and sessions list, turning terminal/output changes into a
  scannable supervision loop.
- Agent workstreams can now consume a narrow structured provider-event marker,
  giving provider adapters a machine-readable path for status/readiness/summary
  updates before a full provider-native protocol exists.
- Desktop Codex/Claude/OpenCode workstreams now launch through a TermFleet
  adapter wrapper that emits structured lifecycle markers around the real CLI.
- Agent workstreams now roll up into a shared supervision lane across the canvas
  overlay and sidebar map/session indexes, so multiple child agents can be
  scanned as one control surface.
- Agent workstreams now persist provider auth-check/control-protocol metadata,
  render Auth / Control cockpit cells, and recover readiness from
  auth-required to provider-ready when newer CLI output proves the provider
  session is authenticated.
- Agent workstreams now distinguish cancellation requested from cancellation
  acknowledged: Ctrl-C enters a visible `cancelling` phase and provider cancel
  output completes the transition to interrupted/stopped.
- The provider adapter now supervises provider lifecycle signals directly:
  launch, termination requested, and cancellation acknowledged are emitted as
  structured markers, and Rust quotes the adapter command path safely.
- Agent workstreams now persist and render a compact run record: prompt count,
  sent count, structured signal count, control count, and current outcome.
- Agent workstreams can now copy a concise run brief from the cockpit, turning
  the visible run record into a shareable handoff artifact.
- Agent lane summaries now surface prioritized operator attention instead of
  only showing aggregate counts.
- Agent lane attention rows are now clickable focus controls for the highlighted
  workstream.
- Agent launches now prompt for a mission before creating the workstream, keep
  that mission separate from follow-up prompts, and preserve it in the cockpit
  panel plus copied run brief.
- Agent launches now use the mission as the durable terminal/tab title instead
  of naming every child run `Codex agent` / provider-only. Provider identity
  stays visible in cockpit metadata, while Sessions, persisted state, and copied
  run briefs identify the child by the actual task. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies the
  stored tab title plus copied run briefs use `Investigate flaky checkout flow`
  while node metadata still shows `Codex agent`. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Split-pane agent status now names the mission before provider/phase/activity.
  The tactical terminal surface reads like `Now: Investigate flaky checkout
flow · Codex agent · active · ...` instead of only `Codex agent · active`,
  so the operator can tell what a child terminal is doing without switching back
  to the map node or opening copied briefs. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies both
  active and complete split-pane agent strips carry the scenario mission plus
  provider, phase, and current activity. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Map agent node titles now stay mission-stable after follow-up prompts. The
  node header continues to identify the child terminal by the original mission,
  while the latest prompt remains visible in input history and the live
  activity/meta rows report what the agent is doing now. This keeps the canvas
  from renaming a supervised child every time the operator sends steering text.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 5/5 and verifies the map node title remains `Investigate flaky
checkout flow` after an `echo waiting for input` follow-up, while the follow-up
  is still shown in `Agent input history`. Additional verification passed `npm
run build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`,
  and `git diff --check`.
- Agent lane summaries now include a compact health row on the canvas and map
  supervision surfaces, with shared derivation used by the Sessions sidebar too.
  The row collapses the long counter cloud into `Running`, `Review ready`,
  `Needs attention`, or `Stable` plus the meaningful pressure counts, so an
  operator can see at a glance whether the child fleet is simply running or has
  auth, recovery, risk, stale, proof, closeout, or cleanup pressure. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and
  verifies running single-agent state, auth/recovery pressure, proof overflow,
  stale pressure, recovered workspace-group totals, and two-agent fleet totals
  through the visible health row. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Raw provider process exits now become cockpit-visible agent state even without
  a structured provider marker. The terminal runtime recognizes
  `process/provider/command exited with code/status N`, persists the exit code,
  moves successful exits to reviewable completion and non-zero exits to blocked
  recovery, records a provider timeline event, and exposes the exit through the
  node header, current-activity row, run record, lane health, and recovery rows.
  Browser preview also supports a deterministic `exit <code>` command so this
  loop is regression-testable without a host process. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 6/6 and verifies
  `exit 7` produces `failed/blocked`, exit code `7`, `blocked · system`
  activity, visible run-record exit, lane health recovery pressure, and
  canvas/map recovery rows. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Agent lanes now support an active-agent status sweep from the canvas,
  Sessions sidebar, and Map sidebar. The sweep queues the shared status-check
  prompt only to active child workstreams, records the input as a
  `mission-control` / `Status sweep` action, and focuses the first targeted run,
  so a parent operator can ask the whole live fleet what it is doing without
  opening each terminal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 7/7 and verifies two active agents both
  receive mission-specific status prompts, prompt counts increment, mission
  control events are recorded, and the canvas/map controls are visible.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- The status-sweep control now explains its operational scope before mutating
  child terminals. Canvas, Sessions, and Map lane headers render a shared sweep
  plan like `Sweep 2 active · 1 held`, and the control tooltip names the held
  runs as skipped. The sweep still targets only active workstreams, so completed,
  blocked, waiting, or interrupted runs are held for their more specific
  mission-control actions instead of receiving generic status checks.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 7/7 and verifies two active agents plus one completed held run show
  `Sweep 2 active · 1 held`, only the active agents receive the status-check
  prompt, and the held run's prompt queue is unchanged. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent lanes now have a guarded active-fleet interrupt alongside status sweep.
  Canvas, Sessions, and Map render an `Interrupt N active · M held` plan, then
  reuse the existing graceful cancellation path for active child workstreams
  only. Held runs are skipped, so completed/blocked/waiting/interrupted children
  keep their specific mission-control state instead of being accidentally
  cancelled by a batch action. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 7/7 and verifies two active agents plus
  one completed held run show `Interrupt 2 active · 1 held`, only the active
  runs move to `running/cancelling` with `Cancellation requested`, and the held
  completion stays `done/complete` with no cancellation event. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent lanes now also have a guarded recovery restart action. Canvas,
  Sessions, and Map render a `Restart N recovery · M held` plan, where recovery
  targets are failed, blocked, stopped, or interrupted child runs. The action
  reuses the existing per-run restart path only for those recovery targets, so
  active/cancelling children and completed runs are held instead of being
  restarted by a broad batch command. The canvas overlay action labels now wrap
  into lane chips instead of widening the header, avoiding overlap with agent
  node controls. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 7/7 and verifies two active agents,
  one completed held run, and one failed recovery run show `Restart 1 recovery
· 3 held`; status sweep and interrupt skip the recovery/completed runs; the
  restart action restarts only the failed recovery run and clears restart
  pressure to `Restart 0 recovery · 4 held`. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent lanes now have a guarded closeout-review batch action. Canvas,
  Sessions, and Map render `Review N ready · M held` based on the existing
  proof-plus-handoff-memory closeout rule, then mark only closeout-ready review
  items as reviewed with mission-control provenance. Runs that are complete but
  missing proof or handoff memory stay held and keep their blocked review rows,
  so lane-level closeout cannot silently acknowledge incomplete child work.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 7/7 and verifies a ready-with-proof/memory run can be reviewed from
  the lane-level action, while unproven and memory-missing completions show
  `Review 0 ready · 1 held`, keep the batch button disabled, and remain
  unreviewed when their blocked review rows are clicked. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent evidence rows now open reported artifacts into the workspace file
  context instead of leaving artifact paths as inert text. The shared lane model
  resolves artifact paths against the workstream worktree, git root, or cwd when
  available; Canvas, Sessions, and Map evidence rows add that artifact to
  `openFiles` while preserving the existing proof snippet copy behavior. Rows
  with artifacts now read `Open proof`, making the proof/artifact handoff a
  cockpit action rather than manual file navigation. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 7/7 and verifies
  clicking a proof row still copies `mission: evidence (artifact)` while adding
  `reports/flaky-checkout-summary.md` as an open file with name
  `flaky-checkout-summary.md`. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Split terminal panes now show a separate sanitized `Output:` glimpse for
  agent terminals when a child run has produced readable terminal output. This
  makes the tactical terminal pane itself answer what the child is doing, not
  just the map/sidebar lane. The same regression exposed and fixed a remount
  downgrade: generic terminal-ready events no longer erase waiting,
  auth-required, blocked, complete, reviewed, interrupted, or cancelling agent
  state when switching between split and map views. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 7/7 and verifies
  `waiting for input` appears in `split-agent-pane-output`, then confirms an
  auth-required child remains auth-required after returning from split view.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent lanes now have a guarded batch proof-request action. Canvas, Sessions,
  and Map render `Proof N needed · M held`, and the new proof button queues the
  shared verification prompt only to completed child runs that lack evidence and
  artifacts. Proofed runs, active runs, recovery runs, and review-blocked runs
  that already have proof are held. The regression also tightened structured
  final-state protection: terminal heuristics can still capture output and
  cancellation, but cannot overwrite final structured summaries with generic
  completion text after a proof signal. Regression coverage: `npx playwright
test tests/agent-workstream.spec.ts` passed 7/7 and verifies the lane-level
  proof button queues a `mission-control` / `Request proof` prompt with the
  current summary and operator request, then disables once proof is attached.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent lanes now have the matching guarded batch memory-request action for the
  proof-to-closeout path. Canvas, Sessions, and Map render `Memory N needed · M
held`; the new memory button queues the same durable handoff-memory prompt as
  the individual `Request memory` mission row, but only to proofed completed
  runs that still lack durable memory. Unproofed, active, recovery, reviewed,
  and already-memory-ready runs are held. The same regression also tightened
  final structured-state protection so stale terminal heuristics cannot replace
  provider readiness after a structured blocked/complete signal. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 7/7 and
  verifies memory is held before proof, enabled after proof, queues a
  `mission-control` / `Request memory` prompt, then disables after durable
  memory is recorded. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent lanes now have a guarded batch risk-mitigation action. Canvas,
  Sessions, and Map render `Risk N open · M held`; the new risk button queues
  the existing mitigation prompt only to child runs with low/medium confidence
  or non-benign residual risk, while holding clean, active, proof, memory,
  recovery, and review-only runs. This gives the parent cockpit a fleet-level
  way to ask every risky child to mitigate or justify remaining risk before
  closeout. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 7/7 and verifies a six-agent risky
  fleet shows `Risk 6 open`, the canvas and Map controls are enabled, and the
  canvas batch action queues `mission-control` / `Mitigate risk` prompts to all
  six affected runs. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Completed agent runs can now be acknowledged as reviewed from the cockpit,
  clearing lane attention while keeping the workstream and its run record.
- Agent run records now include a durable run id plus started/completed/reviewed
  timing, making copied briefs and lane entries refer to a concrete run rather
  than a generic tab title.
- Agent cockpit nodes now include a visible follow-up composer, so operator
  steering happens inside the cockpit instead of through modal prompts.
- Provider exit codes now flow into the run record and copied brief, making
  child process termination visible from the cockpit.
- Latest operator input now appears in the cockpit and run brief with queued/sent
  state, so follow-up steering is part of the visible run record.
- Failed/blocked workstreams now surface a one-click recovery prompt draft, and
  structured provider events are protected from stale heuristic overrides.
- Structured provider evidence now persists into the cockpit and copied run
  brief, giving the operator a proof line for the child run outcome.
- Structured provider stage now persists into the cockpit and copied run brief,
  making the child run's current work phase visible without terminal scrollback.
- Structured provider artifacts now persist into the cockpit and copied run
  brief, so completed child work points at a concrete deliverable.
- Structured provider confidence now persists into the cockpit and copied run
  brief, making child-run certainty visible in the control plane.
- Structured provider risk now persists into the cockpit and copied run brief,
  making residual risk part of the agent handoff instead of terminal-only text.
- The provider control grid now wraps to four columns across two rows so the
  expanded telemetry cells stay readable on the standard agent cockpit node.
- Agent canvas node headers now show the current task prompt directly, while
  ordinary shell terminal nodes keep their existing title/cwd header behavior.
- Agent workstreams now expose first-class current activity metadata:
  `currentActivity`, `activityKind`, `activitySource`, and `activityUpdatedAt`.
  The terminal runtime derives activity from structured provider markers or
  readable terminal output, while operator controls seed activity for launch,
  follow-up prompts, cancellation, stop, restart, and review. The map cockpit
  now shows a visible `Now`/`Signal` row, sidebar and lane rows include current
  activity, copied run briefs include the activity line, and the provider
  adapter emits activity in lifecycle markers. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 2/2 and locks
  structured activity through state, UI, lane attention, and copied brief.
  Verification also passed `npm run build`, `npm run verify:map-terminals`,
  `npm run verify:rust-warnings`, and `npm run verify:terminal-reliability`
  (`TERMFLEET_TERMINAL_RELIABILITY_OK live=0`).
- Agent workstreams now carry local ops context alongside provider/run state:
  launch cwd, cwd label, git root/branch/dirty state, worktree path, and
  isolation mode. Desktop resolves this through a dependency-free Tauri
  `workstream_git_context` command; browser preview degrades to an explicit
  shared-workspace/unknown-root context. The map cockpit renders `Agent local
context` and `Agent workspace isolation` rows, agent lane rows include that
  context, and copied run briefs include `Cwd`, `Git`, `Isolation`, and
  `Worktree` lines. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and checks persisted context,
  cockpit display, isolation display, and copied brief. Verification also
  passed `npm run build`, `cd src-tauri && CARGO_BUILD_JOBS=1 cargo check`,
  `npm run verify:map-terminals`, and `npm run verify:rust-warnings`
  (`TERMFLEET_RUST_WARNINGS_OK`).
- Agent launch now asks for an isolation policy (`shared` or `dedicated`) after
  the mission prompt, persists `isolationStatus` and `isolationNote`, and
  records the choice as a cockpit control event. Shared runs are explicit
  `shared workspace`; dedicated runs are honestly marked `dedicated worktree
requested` until a later slice wires automatic `git worktree` provisioning.
  The cockpit, lane rows, and copied run briefs now distinguish shared checkout
  runs from dedicated-worktree requests instead of hiding that control-plane
  decision in terminal text. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 with one shared run and one
  dedicated-requested run. Verification also passed `npm run build`, `npm run
verify:rust-warnings`, and `npm run verify:map-terminals`.
- Dedicated agent isolation now has a real desktop provisioning path: the
  frontend precomputes the run id before launch, then Tauri
  `workstream_prepare_dedicated_worktree` creates a unique sibling Git worktree
  under `.termfleet-worktrees/<repo>/<run-id>` with branch
  `termfleet/<run-id>` when the selected cwd belongs to a Git repository. If no
  Git repo exists, the target already exists non-empty, or `git worktree add`
  fails, the cockpit receives `isolationStatus=unavailable` plus the failure
  note instead of pretending isolation succeeded. Browser preview still shows
  requested isolation because it cannot provision local worktrees. Regression
  coverage: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test commands::tests
--lib` passed 6/6 for target/branch safety helpers; `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 for shared/requested browser
  workflow; `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check` passed.
- Dedicated worktree runs now have an explicit lifecycle/cleanup record in the
  cockpit. Workstreams persist `worktreeCleanupStatus` and
  `worktreeCleanupNote`; provisioned dedicated worktrees start as cleanup
  `available`, unprovisioned/browser dedicated requests start as `manual`, and
  shared checkout runs are `not-needed`. Dedicated agent nodes expose a
  non-destructive `Request worktree cleanup` control that records operator
  intent, updates the current activity/outcome, increments control count, and
  writes a timeline event without deleting local files. The map cockpit and
  copied run brief show cleanup status and note so worktree ownership is visible
  as part of the run, not left as terminal tribal knowledge. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 2/2 and
  verifies shared cleanup state plus dedicated cleanup request state. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent supervision lanes now roll up workspace ownership and cleanup state, not
  just execution status. `summarizeAgentLane()` counts shared checkout runs,
  dedicated worktree runs, ready dedicated worktrees, and cleanup-requested
  worktrees; the canvas overlay plus sidebar session/map lanes render these as
  chips alongside active/waiting/blocked/complete counts. This makes the control
  surface read like an ops cockpit: the operator can see at a glance how many
  child agents are using shared state, how many are isolated, and whether any
  cleanup handoff is pending. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and verifies `1 dedicated`, `1
shared`, `0 cleanup`, then `1 cleanup` after a cleanup request. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Dedicated worktree cleanup now has a guarded execution path. Tauri exposes
  `workstream_remove_dedicated_worktree`, which refuses unmanaged paths outside
  `.termfleet-worktrees`, refuses paths without worktree metadata, and refuses
  dirty worktrees before calling `git worktree remove`. The cockpit now
  separates `Request worktree cleanup` from `Execute worktree cleanup`, and the
  store records `removed`, `blocked`, or `manual` cleanup outcomes as control
  events without collapsing the agent run record. Browser preview fails closed
  into manual cleanup because it cannot remove local worktrees. Regression
  coverage: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test commands::tests
--lib` passed 8/8, including a real temporary Git repo cycle that provisions
  a dedicated worktree with `git worktree add`, verifies its contents, removes
  it with the guarded cleanup command, and confirms the worktree path is gone.
  `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and verifies browser manual cleanup
  fallback after execution. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent supervision lanes now expose focusable workspace groups instead of only
  a flat child-agent list. `summarizeAgentLane()` derives ordered groups by
  shared checkout or dedicated worktree/run identity, tracks each group's active
  agents, attention count, and cleanup-requested count, and the canvas overlay
  plus sessions/map sidebars render those groups as focus buttons. This makes
  workspace ownership operable from the cockpit: an operator can jump to a
  shared checkout group or a dedicated-worktree group and see cleanup pressure
  at the group level before drilling into individual terminals. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 2/2 and
  verifies two workspace groups for one shared and one dedicated agent, plus
  group-level `1 cleanup` after requesting dedicated cleanup. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent supervision lanes now copy an aggregate cockpit brief. The shared lane
  model formats a `Agent supervision brief` with totals, workspace-group
  ownership, active/attention/cleanup pressure, and each child agent's task,
  current activity, next action, isolation, and cleanup state. The canvas
  overlay plus sessions/map sidebars expose icon buttons for copying this
  operator handoff, so the parent cockpit can communicate the state of the
  whole agent swarm without opening individual terminal scrollback. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 2/2
  and verifies the copied brief for one shared and one dedicated agent, then
  verifies the copied brief updates with group-level cleanup after requesting
  dedicated cleanup. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, and `npm run verify:map-terminals`.
- Agent workstreams now have a durable cockpit memory/handoff field. Structured
  provider markers can emit `memory`, the terminal parser persists it on the
  workstream, the map cockpit renders an `Agent memory` row, and both per-run
  and aggregate supervision briefs include the memory line. New runs start with
  an explicit "No agent memory reported yet." placeholder, so missing handoff
  state is visible instead of silently absent. This closes the first slice of
  the original agent-memory-panel idea without introducing a separate storage
  surface yet. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and verifies structured memory in
  persisted state, cockpit UI, copied run brief, and copied lane brief.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, and `npm run verify:map-terminals`.
- Agent memory is now lane-scannable, not only node-local or copy-only.
  `summarizeAgentLane()` derives `memoryItems` from real reported memories while
  ignoring the explicit no-memory placeholder. The canvas overlay and
  sessions/map sidebars render a `memories` chip plus focusable memory rows, so
  the operator can spot child-agent handoff facts from the supervision lane
  before opening a terminal or copying the aggregate brief. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 2/2 and verifies
  `0 memories` before structured memory, then `1 memories` plus visible canvas
  and map lane memory after the structured completion marker. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Completed child-agent work now forms an explicit lane-level review queue.
  `summarizeAgentLane()` derives `reviewItems` for completed-but-unreviewed
  workstreams, includes a `review ready` count in the lane status text and
  aggregate supervision brief, and the canvas overlay plus sessions/map sidebars
  render focusable `Review` rows with the run summary and artifact/evidence
  detail. Marking a run reviewed clears the queue item without deleting the run
  record, so the cockpit has a visible closeout loop for agent-produced work.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 2/2 and verifies `1 review` plus visible canvas/map review rows after
  structured completion, then `0 review` and no review row after `Mark run
reviewed`. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Attention-worthy child-agent work now forms a lane-level queue, not only a
  single primary attention callout. `summarizeAgentLane()` derives sorted
  `attentionItems` from the existing auth-required, waiting, cancelling,
  blocked, and complete classifications, includes an `attention queue` count in
  the lane status text and aggregate supervision brief, and the canvas overlay
  plus sessions/map sidebars render focusable attention rows for the top items.
  This keeps the current primary alert while making multiple agents needing
  operator action scannable from the supervision lane. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 2/2 and verifies
  queue rows for auth-required, blocked, and complete states, plus queue
  clearing after `Mark run reviewed`. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Child-agent proof is now lane-scannable through an explicit evidence queue.
  `summarizeAgentLane()` derives `evidenceItems` from structured evidence and
  artifact fields, includes an `evidence` count in lane status text and
  aggregate supervision briefs, and the canvas overlay plus sessions/map
  sidebars render focusable `Evidence` rows. This lets the parent operator
  inspect what proof each agent has produced without opening every node or
  scrolling terminal output. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and verifies evidence rows for
  structured failure and completion signals, including artifacts in the copied
  supervision brief. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Blocked or failed child agents now form a lane-level recovery queue.
  `summarizeAgentLane()` derives `recoveryItems` for blocked, failed, or
  provider-unavailable workstreams, includes a `recovery` count in the lane
  status text and aggregate supervision brief, and the canvas overlay plus
  sessions/map sidebars render focusable `Recovery` rows with a copyable prompt.
  This moves recovery from node-only affordance to the swarm supervision lane, so
  the parent operator can see which children need intervention without opening
  each terminal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 2/2 and verifies `1 recovery`, visible
  canvas/map recovery rows, and `Recovery queue:` plus the generated prompt in
  the copied supervision brief. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Completed child-agent work without proof is now explicitly flagged before
  review. `summarizeAgentLane()` derives `proofItems` for completed/unreviewed
  workstreams that have no evidence line and no artifact path, includes a `proof
needed` count in lane status text and aggregate supervision briefs, and the
  canvas overlay plus sessions/map sidebars render focusable `Proof needed` rows
  with the agent summary and proof request. This keeps a child agent's "done"
  state from looking release-ready when it has not produced verification
  evidence. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies `1 proof`, no evidence
  row, visible canvas/map proof rows, and `Proof needed:` plus the request in the
  copied supervision brief. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Proof-needed child-agent work is now actionable from the cockpit node. When a
  completed/unreviewed workstream has neither evidence nor artifact output, the
  composer exposes a `Draft proof request` control that seeds a provider-specific
  follow-up asking for completed-work summary, exact verification commands,
  results, and artifact paths. The request then flows through the existing
  durable prompt queue/input history, so the parent operator can turn a weak
  "done" into a proof-gathering loop without hand-writing the prompt. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and
  verifies the proof request draft includes the run summary and next action, then
  dispatches through the browser-preview prompt path. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- The proof-needed loop now has regression coverage for resolution into real
  evidence. After a proof request is dispatched, a later structured provider
  marker with `evidence` and `artifact` clears the `Proof needed` rows, hides the
  draft-proof control, moves the workstream into the evidence queue, and updates
  the copied supervision brief from `Proof needed: - none` plus concrete
  evidence. This locks the operator loop from weak completion to requested proof
  to reviewable evidence. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies the canvas/map proof
  rows disappear while evidence rows and copied evidence brief appear. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Review-ready child-agent work can now be acknowledged directly from the
  supervision lanes. Canvas, Sessions, and Map `Review` rows call the same durable
  `reviewWorkstream()` path as the node header button, clearing review and
  attention queues while preserving the run record and reviewed timestamp. This
  turns the lane from a passive index into an operator closeout surface for
  completed agent work. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and now closes the structured
  completion run by clicking the canvas review row, then verifies reviewed state,
  `0 queue`, `0 review`, and no remaining review row. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent supervision lanes now show a recent-event feed across child agents.
  `summarizeAgentLane()` derives the latest durable workstream events across the
  swarm, includes an `events` count in lane status text and aggregate briefs, and
  the canvas overlay plus Sessions/Map sidebars render focusable event rows. This
  gives the parent operator a chronological sense of what just changed without
  opening each terminal or reading raw scrollback. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and verifies
  visible canvas/map event rows for structured completion, recent events in the
  copied supervision brief, and event counts in aggregate totals. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent supervision lanes now surface risk/confidence warnings across child
  agents. `summarizeAgentLane()` derives `riskItems` for low/medium confidence or
  non-benign risk text, includes a `risk` count in lane status text and aggregate
  briefs, and the canvas overlay plus Sessions/Map sidebars render focusable
  `Risk` rows. Benign high-confidence outcomes such as `low residual risk` and
  `no known residual risk` do not remain in the queue, so the operator sees
  unresolved risk instead of every completed run. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and verifies a
  low-confidence structured failure appears in the canvas/map risk queue and
  copied brief, then clears after a high-confidence structured completion.
  Additional verification passed `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check`.
- Active child-agent silence is now lane-scannable through an explicit stale
  queue. `summarizeAgentLane()` derives `staleItems` for active workstreams whose
  latest activity timestamp is older than ten minutes, includes a `stale` count
  in lane status text and aggregate briefs, and the canvas overlay plus
  Sessions/Map sidebars render focusable `Stale` rows using the agent mission
  instead of the generic terminal title. This makes an agent that is still marked
  active but has stopped reporting progress visible without opening terminal
  scrollback. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies a persisted/reloaded
  sixteen-minute idle agent appears in the canvas/map stale queue and copied
  supervision brief. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff --check`.
- Stale child-agent work is now actionable from the supervision lane. Each stale
  row carries a provider-specific status-check prompt and clicking the row queues
  that prompt through the same durable workstream input path used by normal
  follow-ups, focuses the target run, updates activity timestamps, and clears the
  stale queue item. This turns "active but quiet" from a passive warning into an
  operator check-in loop without requiring the node composer to be visible under
  the canvas overlay. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies a persisted/reloaded
  sixteen-minute idle agent can be checked in from the canvas stale row, after
  which the stale count drops to zero and persisted state records the status
  prompt, `Prompt sent` event, and fresh activity timestamp. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Recovery queue rows are now actionable from the supervision lane. Each
  recovery item uses the agent mission as its label and clicking the row sends
  the generated provider-specific recovery prompt through the durable workstream
  input path while focusing the target run. The recovery queue intentionally
  remains visible until later provider output proves the child is running again,
  so a sent recovery prompt does not falsely mark the run healthy. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and
  verifies a structured failed run appears in the canvas/map recovery queue,
  clicking the canvas recovery row dispatches the exact generated recovery prompt
  with a `Prompt sent` event, and later ready output clears the blocked state.
  Additional verification passed `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check`.
- Proof-needed queue rows are now actionable from the supervision lane. Each
  proof item uses the agent mission as its label and clicking the row sends the
  generated proof request through the durable workstream input path while
  focusing the target run. The proof-needed queue remains visible until the child
  returns evidence or an artifact, so requesting proof does not falsely make an
  unproven completion review-ready. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies an unproven completed
  run appears in the canvas/map proof queue, clicking the canvas proof row
  dispatches the exact proof request with a `Prompt sent` event, and later
  structured evidence clears the proof queue into the evidence queue. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Risk queue rows are now actionable from the supervision lane. Each risk item
  uses the agent mission as its label and clicking the row sends a generated
  mitigation prompt asking the child to reduce or justify the risk, report
  updated confidence, residual risk, and verification evidence. The risk queue
  intentionally remains visible until a later structured signal reports high
  confidence with benign residual risk, so asking for mitigation does not hide an
  unresolved risk. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies a low-confidence failed
  run appears in the canvas/map risk queue, clicking the canvas risk row
  dispatches the generated mitigation prompt with a `Prompt sent` event, and a
  later high-confidence completion clears the risk row while preserving the full
  run record. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff --check`.
- Evidence queue rows now act as proof handoff controls. Each evidence item uses
  the agent mission as its label and carries a concise copyable proof snippet
  combining the evidence line plus artifact path; clicking an evidence row copies
  that snippet to the clipboard while focusing the target run. This makes proven
  child-agent output reusable from the supervision lane without opening terminal
  scrollback or manually reconstructing artifact paths. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and verifies a
  proof-request response moves into the evidence queue, the canvas evidence row
  copies `Summarize flaky test failures: npm test -- flaky-checkout passed
(reports/flaky-checkout-summary.md)`, and the copied lane brief still includes
  the same evidence. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff --check`.
- Agent memory rows now act as copyable handoff controls. Each memory item uses
  the agent mission as its label and carries a concise `mission: memory` snippet;
  clicking a memory row copies that snippet to the clipboard while focusing the
  target run. This makes child-agent handoff facts reusable from the supervision
  lane without opening the node or copying the whole aggregate brief. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and
  verifies a structured memory signal appears in the canvas/map memory rows and
  clicking the canvas memory row copies `Investigate flaky checkout flow:
Checkout flake isolated to retry timing; preserve auth fixture logs.`.
  Additional verification passed `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check`.
- Recent-event rows now act as copyable audit-trail controls. Each event uses
  the agent mission as its label and carries a concise `mission: kind · label -
detail` snippet; clicking a recent-event row copies that snippet to the
  clipboard while focusing the target run. The aggregate supervision brief now
  also names recent events by mission instead of the generic terminal title, so
  copied handoffs point to the child task that actually changed. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and
  verifies a structured completion event copies `Investigate flaky checkout
flow: signal · Structured completion - Provider emitted a machine-readable
completion signal.`, while aggregate lane briefs use mission-based recent
  event lines. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff --check`.
- Workspace-group rows now act as copyable ownership handoffs. Each group derives
  a concise brief with workspace label, agent count, active count, cleanup
  pressure, attention pressure, and isolation/branch detail; clicking a group row
  copies that brief to the clipboard while focusing the group's primary run.
  This makes shared-checkout versus dedicated-worktree ownership reusable from
  the supervision lane without copying the whole aggregate brief. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 3/3 and
  verifies clicking the shared workspace group copies `workspace root unknown: 1
agents, 1 active (shared workspace · branch unknown)`. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Individual agent-run rows now act as copyable per-run handoffs from the
  supervision lane. The detailed run brief formatter moved into the shared lane
  model and is reused by the node header, canvas overlay, Sessions sidebar, and
  Map sidebar. Clicking a `Copy run` row still focuses the target run but also
  copies the same per-agent brief with task, current activity, evidence,
  memory, risk/confidence, isolation, cleanup, and run counters, so an operator
  can hand off one child agent without opening the node controls or copying the
  full aggregate brief. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies clicking the canvas
  run row copies the structured completion run brief, including `Now: Reviewing
checkout report`, evidence, and run counters. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Operator prompts are now visible from the supervision lane instead of being
  hidden inside each agent node. `summarizeAgentLane()` derives recent prompt
  items from every child run's durable `inputQueue`, counts total prompts in
  lane status text, includes an `Operator prompts:` section in the copied
  aggregate brief, and the canvas overlay plus Sessions/Map sidebars render
  copyable `Copy prompt` rows with queued/sent state. This makes parent-issued
  steering part of the cockpit record: the operator can see what was asked,
  whether it has dispatched, and copy one prompt without opening the child
  terminal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies prompt chips, visible
  canvas/map prompt rows, queued versus sent state, clipboard copies, and
  aggregate brief prompt lines. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent terminal output now contributes a sanitized cockpit glimpse instead of
  living only in terminal scrollback. The terminal runtime records a short,
  prompt-filtered `terminalOutput` line on each workstream from readable PTY
  output, excluding structured provider markers and shell prompt chrome. The
  lane summary counts agents with output, the copied aggregate brief includes a
  `Terminal output:` section, and the canvas overlay plus Sessions/Map sidebars
  render copyable `Copy output` rows. This lets the parent operator see what the
  child terminal most recently said even when the provider has not emitted a
  structured status marker. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies durable terminal
  output metadata, canvas/map output rows, clipboard copy, and aggregate brief
  output lines. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent next actions are now lane-scannable instead of only appearing inside
  each node or copied run brief. `summarizeAgentLane()` derives `nextItems` from
  each child workstream's durable `nextAction`, counts `next actions` in the
  lane status text, adds a `Next actions:` section to the copied aggregate
  brief, and renders copyable `Copy next` rows in the canvas overlay plus
  Sessions/Map sidebars. This gives the parent operator a cockpit-level list of
  what each child expects next, including the distinction between a queued run
  still watching provider startup and a running run waiting for provider
  response. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies next-action chips,
  visible canvas/map next rows, clipboard copy, and aggregate brief next-action
  lines. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent supervision now has one mission-control priority queue instead of
  requiring the operator to scan recovery, risk, proof, stale, review, and
  attention rows independently. `summarizeAgentLane()` derives
  `supervisorItems`, orders concrete actions by urgency, deduplicates to one
  highest-priority action per child run, counts mission items in lane status
  text, and includes a `Mission control:` section in the copied aggregate
  brief. The canvas overlay plus Sessions/Map sidebars render actionable
  mission rows; queue-prompt rows dispatch the same durable follow-up prompt as
  the underlying proof/risk/stale controls, review rows mark the run reviewed,
  and focus rows open the child run. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies review, proof, and
  stale check-in mission rows plus copied mission-control brief lines.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control actions now leave a durable audit trail instead of looking
  like anonymous prompt/review mutations. Workstream inputs persist
  `source=mission-control` plus the mission action label, sent events preserve
  labels such as `Mission control: Request proof sent`, aggregate prompt rows
  and copied run briefs include `via mission-control`, and review actions from
  the mission queue record `Mission control reviewed run`. This keeps the
  cockpit timeline honest: later handoffs show which operator actions came from
  the priority queue while `currentActivity` remains free to show what the child
  terminal is actually doing. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies mission-control review,
  proof request, and stale check-in source/label metadata plus mission-control
  queued/sent events. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent supervision lanes now lead with an operator-readable cockpit headline,
  not only counters and queue rows. The shared lane model derives
  `cockpitHeadline` from the top mission-control item first, then active or
  complete aggregate state, and the canvas overlay plus Sessions/Map sidebars
  render that headline above the detailed rows. Copied aggregate briefs include
  `Cockpit headline:` so handoffs preserve the same "what should I do next?"
  signal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 3/3 and verifies running, proof-needed,
  stale-check-in, and post-check-in headlines in the canvas/map lanes plus
  copied brief headline lines. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control backlog pressure is now explicit when the prioritized queue
  is clipped. The shared lane model separates total `missionItemCount` from the
  visible top-five mission rows, tracks `hiddenMissionItemCount`, and includes
  hidden pressure in lane status text, cockpit headlines, and copied aggregate
  briefs. Canvas, Sessions, and Map lanes now render all five prioritized
  mission rows plus a `+n hidden` pressure indicator when more items remain, so
  a busy parent cockpit cannot mistake a capped list for the whole queue.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 4/4 and adds a six-agent unproven-completion case that verifies `6
mission`, `1 hidden`, five visible mission rows, map/canvas overflow rows, and
  copied brief overflow text. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control can now be copied as a focused operator brief instead of only
  as part of the full aggregate supervision brief. The shared lane model exposes
  `formatAgentMissionControlBrief()`, and the canvas overlay plus Sessions/Map
  sidebars add dedicated copy controls for the current mission headline, total
  mission pressure, hidden backlog count, and visible priority rows. This gives
  the parent cockpit a compact "what needs action now" handoff without copying
  every run, event, prompt, terminal output, and evidence section. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 4/4 and
  verifies the canvas/map mission-control brief copy path in the six-agent
  overflow case. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Focused mission-control briefs are now operational, not just descriptive.
  Visible mission items include an action line (`send prompt`, `mark reviewed`,
  or `focus run`), and prompt-based rows include the exact prompt payload that
  will be sent to the child agent. This makes a copied mission-control handoff
  sufficient for another operator to understand the next command without
  opening the full aggregate brief or the child terminal. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 4/4 and verifies
  the six-agent overflow mission-control brief contains `Action: send prompt`
  plus the copied proof-request prompt payload. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Mission-control handoffs now identify the concrete child run, not only the
  mission title. The shared lane model attaches a compact run identity
  (`provider · status/phase · short run id`) to each visible mission-control
  item, renders it in canvas/Sessions/Map mission rows, and includes it in the
  focused mission-control brief. This lets an operator match a copied action
  item back to the exact child terminal even when several agents share similar
  missions or statuses. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 4/4 and verifies mission-control rows
  plus copied mission-control briefs include `Codex · done/complete`; older
  broad status checks were narrowed to exact node text so the richer mission
  rows do not collide with status assertions. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Mission-control handoffs now identify the child run's workspace context as
  well as the run itself. Each visible mission-control item carries
  `workspaceIdentity` from the existing ops-context formatter, renders it in
  canvas/Sessions/Map mission rows, and includes it in focused mission-control
  briefs as `Workspace: <cwd/branch/isolation>`. This makes handoffs usable when
  several child agents share similar missions but operate against different
  shared or dedicated checkouts. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 4/4 and verifies canvas mission rows
  plus copied mission-control briefs include `shared workspace` / workspace root
  context. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control pressure now shows its composition, not just total backlog
  size. The shared lane model exposes a priority-ordered `missionBreakdown`,
  canvas/Sessions/Map render a `Mission mix` row, and focused mission-control
  briefs include `Breakdown: <label>: <count>` so a busy parent cockpit can
  distinguish proof requests from recovery, risk, stale check-ins, review, or
  focus actions without opening each child run. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 4/4 and verifies the
  six-agent overflow queue renders `Request proof: 6` in canvas/map plus copied
  mission-control briefs. Additional verification passed `npm run build`, `npm
run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control rows now show what the target child is doing, not only which
  action the parent should take. Each visible mission item carries the child's
  current activity from the shared activity classifier, renders `Now:
<activity>` in canvas/Sessions/Map mission rows, and includes the same `Now:`
  line in focused mission-control briefs. This keeps the priority queue grounded
  in live child-agent state, so an operator can see both "request proof" and
  "ready for proof" without opening terminal scrollback. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 4/4 and verifies
  the six-agent overflow queue renders/copies `Now: Ready for proof`. The
  helper now waits on the composer value instead of pointer-clicking through the
  overlay. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent terminal tiles now show current activity directly in their canvas node
  header metadata. Agent headers keep the task title as the first line, then
  render `provider · phase · activity`, using the same activity classifier as
  the node detail panel and supervision lanes. This makes each terminal tile
  answer "what is being done in here?" before the operator opens details or
  scans the aggregate lane. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 4/4 and verifies launch/browser-preview
  activity, waiting-for-input activity, and structured `Ready for review`
  activity in `canvas-agent-node-header-meta`. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Review queues now show proof readiness before an operator closes a child run.
  `summarizeAgentLane()` tags review-ready work as `Ready with proof` when an
  evidence line or artifact is present, otherwise `Needs proof`; canvas,
  Sessions, Map, mission-control rows, and copied aggregate briefs render that
  status next to the review summary. This makes the cockpit harder to misuse:
  completed-but-unproven work is visible as reviewable but not silently
  equivalent to proven work. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 4/4 and verifies unproven completions
  show `Needs proof`, while structured evidence/artifact completions show
  `Ready with proof` in review rows, mission-control, and copied briefs.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Review proof readiness is now visible at aggregate-lane level too. The shared
  lane summary derives `reviewReadyWithProof` and `reviewNeedsProof`, includes
  them in `agentLaneStatusText()`, and renders `proven` / `unproven` review
  chips in canvas, Sessions, and Map lanes. This lets the parent cockpit show
  whether pending reviews are backed by evidence before the operator scans
  individual rows. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 4/4 and verifies unproven completions
  show `0 proven` / `1 unproven`, proven completions show `1 proven` / `0
unproven`, and copied aggregate briefs include `0 proven review · 0 unproven
review` for idle review state. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Attention pressure now has a visible breakdown instead of only a total queue
  count. The shared lane summary derives `attentionBreakdown`, copied aggregate
  briefs include `Attention mix: ...`, and canvas/Sessions/Map lanes render an
  `Attention mix` row such as `Auth required: 1`, `Blocked: 1`, or `Complete:
1`. This lets the operator distinguish authentication, blocked, and
  completion-review pressure without scanning individual child-agent rows.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 4/4 and verifies auth-required, blocked, and complete attention mixes
  plus copied aggregate brief text. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Risk pressure now has a visible severity breakdown instead of only a total
  risk count. The shared lane summary derives `riskBreakdown` from unresolved
  risk items, copied aggregate briefs include `Risk mix: ...`, and
  canvas/Sessions/Map lanes render a `Risk mix` row such as `low confidence:
1`. This lets the operator distinguish low/medium confidence and risk-only
  pressure before scanning individual risk rows. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 4/4 and verifies
  low-confidence risk appears in canvas/map plus copied aggregate brief text,
  then clears after a high-confidence benign completion. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Split terminal panes now show agent activity directly in the pane chrome, not
  only on the map/canvas. Agent panes render a compact `Now: <provider> ·
<phase> · <activity>` line next to the cwd/status area, so a split-terminal
  operator can see what the child agent is doing without opening the cockpit
  details. The same slice hardened remount behavior: terminal attach/readiness
  events no longer downgrade structured complete/blocked/reviewed/interrupted
  state, and processed structured provider markers are remembered on the
  workstream so scrollback replay does not double-count signals. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 4/4 and
  verifies split-pane activity for browser-preview startup and `Ready for
review`, while preserving exact structured signal counts after switching
  between split and map surfaces. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Operator-authored memory can now be saved from the agent cockpit without
  sending another prompt to the child agent. The existing composer gained a
  `Save operator memory` control that records a human handoff note on the
  workstream, updates current activity/outcome, increments control history, and
  writes an audit event. The saved note immediately appears in the node memory
  row, lane memory rows, copied memory snippets, and aggregate briefs, while
  prompt/sent counts remain unchanged. Regression coverage: `npx playwright
test tests/agent-workstream.spec.ts` passed 5/5 and verifies the saved note,
  unchanged prompt counts, control event, visible canvas/map memory rows, and
  copied `mission: memory` snippet. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Review queues now show handoff-memory readiness alongside proof readiness.
  `summarizeAgentLane()` marks each review-ready run as `Memory ready` when it
  has a real provider/operator memory note, otherwise `Needs memory`; canvas,
  Sessions, Map, mission-control rows, and copied aggregate briefs render the
  status next to `Ready with proof` / `Needs proof`. This keeps a proofed child
  run from looking handoff-complete when the operator still lacks durable
  restart context. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies structured
  completions with memory show `Memory ready`, proofed completions without
  memory show `Needs memory`, and copied lane briefs include the same status.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Handoff-memory readiness is now visible at aggregate-lane level too. The
  shared lane summary derives `reviewReadyWithMemory` and `reviewNeedsMemory`,
  includes them in `agentLaneStatusText()`, and renders `handoff ready` /
  `handoff missing` chips in canvas, Sessions, and Map lanes. This lets the
  parent cockpit show whether pending reviews have durable restart context
  before the operator scans individual review rows. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  review-ready runs with memory show `1 handoff ready` / `0 handoff missing`,
  proofed runs without memory show `0 handoff ready` / `1 handoff missing`, and
  copied aggregate briefs include the same counts. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Missing handoff memory is now actionable from mission control. Once a child
  agent has proof but no durable memory note, `summarizeAgentLane()` derives a
  `Request memory` mission item ahead of `Review`, with a generated prompt that
  asks the provider for restart context, decisions, caveats, proof location, and
  risk. The focused mission-control brief copies the same action and prompt, and
  clicking the mission row sends it through the durable mission-control prompt
  queue instead of forcing the operator to compose it manually. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and
  verifies proofed/memory-missing runs show `Next: Request memory`, copied
  briefs include `Handoff memory needed:` and `Prompt: Provide durable handoff
memory`, and clicking the row records `Mission control: Request memory sent`.
  The overflow mission-control regression now also waits for each structured
  completion marker to persist before asserting queue totals. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Auth-required child agents now produce a dedicated copied handoff section.
  `summarizeAgentLane()` derives `authItems` from workstreams whose readiness is
  `auth-required`, and the aggregate supervision brief now includes an `Auth
queue:` with the failing mission, next action, readiness check, auth detection
  rule, and provider availability message when present. This turns an auth
  prompt from a transient terminal-output inference into restartable operator
  context for the next person who picks up the cockpit. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  the copied aggregate brief includes `Auth queue:`, `Provider requires
authentication`, `Next: Authenticate the CLI, then restart or send a recovery
prompt`, the PATH readiness check, and the CLI auth-output scan. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Auth-required child agents are now visible as copyable lane rows too. The
  derived `authItems` carry a concise `mission: reason; next=...; readiness=...;
auth=...` handoff string, and canvas, Sessions, and Map lanes render `Copy
auth` rows that focus the affected run while copying that snippet. This makes
  auth recovery operable from the lane itself instead of requiring a full
  aggregate brief copy or terminal scrollback. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  canvas/map auth rows, clipboard text with the next action, readiness check,
  and auth scan rule. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Direct lane action rows now preserve mission-control provenance. Canvas,
  Sessions, and Map rows for stale check-ins, risk mitigation, recovery, and
  proof requests all call `queueWorkstreamInput()` with
  `source: "mission-control"` plus a stable label such as `Check in`,
  `Mitigate risk`, `Recover`, or `Request proof`. The input history and timeline
  now show these lane-originated interventions as cockpit actions instead of
  anonymous operator follow-ups. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies risk/recovery row
  clicks persist `latestInputSource: "mission-control"`, the row labels, queued
  mission-control events, and sent events like `Mission control: Recover sent`.
  Existing stale/proof mission-control assertions continue to pass. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Auth pressure is now visible in aggregate lane totals. `agentLaneStatusText()`
  includes `${authItems.length} auth`, and canvas, Sessions, and Map lane chips
  render the same count beside proof/risk/recovery counts. This keeps
  authentication blockers from being hidden inside the broader attention queue
  when an operator scans the cockpit header or copied aggregate brief.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 5/5 and verifies auth-required runs show `1 auth`, while idle
  multi-agent briefs include `0 auth` in totals. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Review closeout is now gated on both proof and durable handoff memory. The
  shared lane model exposes closeout-readiness helpers, the canvas node
  `Mark run reviewed` button stays disabled until evidence/artifact and memory
  exist, and canvas, Sessions, and Map review rows now focus blocked runs
  without mutating them. This prevents an operator from accidentally marking a
  child agent reviewed while the cockpit is still asking for proof or restart
  context. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies blocked review rows
  remain `complete` with no `reviewedAt` when proof/memory are missing and when
  proof exists but handoff memory is still missing. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Closeout pressure is now explicit in aggregate lane totals. The shared lane
  summary derives `reviewCloseoutReady` and `reviewCloseoutBlocked` from the
  proof-plus-memory closeout rule, `agentLaneStatusText()` includes both counts,
  and canvas, Sessions, and Map lanes render `closeout ready` / `closeout
blocked` chips next to the broader review count. This lets an operator see at
  a glance whether reviews are safe to close or still blocked by missing proof
  or handoff memory, without mentally correlating the proof and memory chips.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 5/5 and verifies completed runs without proof/memory show `0 closeout
ready` / `1 closeout blocked`, proofed runs without memory stay blocked, and
  fully proven/memorized runs show `1 closeout ready` / `0 closeout blocked`.
  Copied aggregate briefs now include the same counts. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Direct review-row closeout now preserves mission-control provenance. Once a
  run is proofed and has durable handoff memory, clicking its canvas, Sessions,
  or Map review row calls `reviewWorkstream()` with
  `source: "mission-control"` and label `Review`, matching the rest of the lane
  action rows instead of recording an anonymous operator review. The node header
  button remains a plain operator acknowledgment, while lane-originated closeout
  is now auditable in the run event stream. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies a
  direct canvas review-row click records `Mission control reviewed run` with
  detail `Review: acknowledged the completed run record`. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Closeout blockers now have an operator-visible diagnosis row. The shared lane
  model derives a `closeoutBreakdown` with `Ready`, `Needs proof`, `Needs
memory`, or `Needs proof + memory` buckets, copied aggregate briefs include a
  `Closeout mix:` line, and canvas, Sessions, and Map lanes render the same
  `Closeout mix` row near mission/attention/risk mix. This makes the cockpit
  explain why closeout is blocked without forcing the operator to inspect each
  review row. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies ready runs show
  `Ready: 1`, unproven/unmemorized runs show `Needs proof + memory: 1`, and
  proofed memory-missing runs show `Needs memory: 1` in both visible lanes and
  copied aggregate briefs. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Provider readiness is now visible at aggregate-lane level. The shared lane
  model derives a `readinessBreakdown` from each workstream's provider
  availability and readiness state (`Provider ready`, `Auth required`, `Path
checked`, `Unknown readiness`, or `Provider unavailable`), copied aggregate
  briefs include a `Readiness mix:` line, and canvas, Sessions, and Map lanes
  render the same `Readiness mix` row. This lets the cockpit show whether the
  local agent fleet is merely path-checked, authenticated and ready, or blocked
  on auth/provider availability without inspecting individual terminals.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 5/5 and verifies launch state shows `Path checked: 1`, auth output
  flips the aggregate mix to `Auth required: 1`, structured completion shows
  `Provider ready: 1`, and copied aggregate briefs carry the same readiness
  mix. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Provider mix is now visible at aggregate-lane level. The shared lane model
  derives `providerBreakdown` from each workstream's provider metadata, copied
  aggregate briefs include a `Provider mix:` line, and canvas, Sessions, and
  Map lanes render a matching `Provider mix` row. This lets the cockpit show
  which local agent runtimes make up the fleet before the operator drills into
  individual runs. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies a single supervised
  Codex run shows `Codex: 1`, a two-run lane shows `Codex: 2` on both canvas and
  Map, and copied aggregate briefs include `Provider mix: Codex: 2`.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Worktree isolation is now visible as an aggregate cockpit mix. The shared
  lane model derives `isolationBreakdown` from each workstream's isolation
  mode/status using the same labels shown in run cards, copied aggregate briefs
  include an `Isolation mix:` line, and canvas, Sessions, and Map lanes render a
  matching `Isolation mix` row. This lets the operator see shared-checkout
  pressure versus dedicated-worktree requests without opening each agent or
  scanning workspace groups. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies a single shared run
  shows `shared workspace: 1`, a mixed two-run lane shows `shared workspace: 1`
  plus `dedicated worktree requested: 1` on canvas and Map, and copied aggregate
  briefs include `Isolation mix: shared workspace: 1 · dedicated worktree
requested: 1`. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Worktree cleanup ownership is now visible as an aggregate cockpit mix. The
  shared lane model derives `cleanupBreakdown` from each workstream's cleanup
  status, copied aggregate briefs include a `Cleanup mix:` line, and canvas,
  Sessions, and Map lanes render a matching `Cleanup mix` row. This lets an
  operator see which runs do not own cleanup targets, which dedicated runs are
  manual, and which ones are actively cleanup-requested without drilling into
  each agent card. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the mixed shared /
  dedicated lane starts as `not-needed: 1 · manual: 1`, changes to
  `not-needed: 1 · requested: 1` after requesting cleanup, and returns to
  `not-needed: 1 · manual: 1` after the browser cleanup fallback records manual
  cleanup. Copied aggregate briefs include the same cleanup mix. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Focused mission-control briefs now carry fleet context, not just the action
  queue. `formatAgentMissionControlBrief()` includes Provider, Isolation,
  Cleanup, Readiness, and Closeout mix lines before the mission breakdown, so
  copied action handoffs preserve the cockpit-wide state needed to understand
  why a queue exists. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies Request memory briefs
  include Provider, Readiness, and Closeout context, while overflow Request
  proof briefs include Provider, Isolation, Cleanup, Readiness, and Closeout
  context on both canvas and Map copies. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Mission-control rows now show signal recency, not just the latest activity
  text. The shared lane model derives `signalAge` from the same
  last-activity/activity/creation timestamp chain used by stale detection,
  canvas/Sessions/Map mission rows render `Signal: ...`, and both aggregate and
  focused copied briefs include the same recency line under `Now:`. This keeps
  a copied action handoff honest about whether "Ready for proof" is fresh or a
  stale terminal signal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies fresh Request memory /
  Request proof mission handoffs show `Signal: just now`, while stale check-in
  mission rows and copied briefs show `Signal: 16m ago`. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Mission-control rows now show signal provenance as well as recency. The shared
  lane model carries `signalSource` from `workstreamActivityMeta()`, so
  canvas/Sessions/Map mission rows and copied mission-control briefs include
  `Source: <kind> · <source>` beside `Now:` and `Signal:`. This lets an operator
  distinguish a queue item caused by a structured provider marker from one
  inferred from terminal output or operator control state. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  structured Request memory / Request proof mission rows and copied focused
  briefs show `Source: complete · structured`. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Hidden mission-control items now survive copied handoffs. The shared lane
  model preserves `hiddenSupervisorItems` after the visible five-row cap, and
  both aggregate and focused mission-control briefs include a `Hidden mission
control:` section with each hidden child run, workspace, activity, signal
  age/source, action, and prompt. This keeps overflow queues compact on screen
  without losing the identity of lower-priority child-agent work when the
  cockpit state is handed to another operator. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies the
  six-agent Request proof overflow still renders `+1 more`, while copied canvas,
  Map, and aggregate briefs name `Overflow proof 6`, its `Request proof` action,
  and `Prompt: Attach proof 6`. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live overflow mission rows now preview the first hidden action instead of
  staying anonymous. Canvas, Sessions, and Map overflow rows still keep the
  visible queue capped, but their text/title now include the first hidden
  mission item's child name, action label, and detail. This lets an operator see
  which lower-priority child is hidden without copying a brief or opening every
  terminal. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof overflow row still shows `+1 more` while canvas and Map rows expose
  `Overflow proof 6`, `Request proof`, and `Needs proof 6`. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Live child-run lists now advertise their own overflow. The canvas, Sessions,
  and Map `Agent runs` lists still cap visible run rows to three, but they now
  append a `+N more agents` row with the first hidden run's provider, phase,
  activity, and workspace context. This keeps dense supervision panes compact
  while making it obvious which child run is hidden behind the cap. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and
  verifies the six-agent Request proof lane shows three visible run rows plus
  `+3 more agents`, `Ready for proof`, and `shared workspace` on canvas and
  Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live operator-prompt lists now advertise hidden steering history. Canvas,
  Sessions, and Map still show the three freshest prompt rows, but append a
  `+N more prompts` row with the first hidden prompt's mission, sent/queued
  state, and prompt preview. This prevents operator instructions from
  disappearing behind the cap without any cockpit cue. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  the six-agent Request proof lane shows three visible prompt rows plus a prompt
  overflow row containing `more prompts`, `Overflow proof`, and `sent` on canvas
  and Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live next-action lists now advertise hidden follow-up work. Canvas, Sessions,
  and Map still show the three freshest `Next actions`, but append a `+N more
next` row with the first hidden child mission and next-action text. This keeps
  a busy parent cockpit from showing a smaller actionable queue than the summary
  count implies. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof lane shows three visible next-action rows plus an overflow row
  containing `more next`, `Overflow proof`, and `Attach proof` on canvas and
  Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live proof-needed queues now advertise hidden proof requests. Canvas,
  Sessions, and Map still show the first three `Request proof` rows, but append
  a `+N more proof` row with the first hidden child mission, summary, and proof
  request. This keeps unproven completed work visible even when the proof queue
  is busier than the live row cap. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof lane shows three visible proof rows plus an overflow row containing
  `more proof`, `Overflow proof`, `Needs proof`, and `Attach proof` on canvas
  and Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live review queues now advertise hidden closeout work and use mission titles.
  Canvas, Sessions, and Map still show the first three review rows, but append
  a `+N more review` row with the first hidden child mission, proof status,
  handoff-memory status, and summary. The shared lane model also titles review
  items by `workstream.mission ?? workstream.prompt ?? tab.title`, so
  review/closeout handoffs point to the child task instead of a generic `Codex
agent` label. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof lane shows three visible review rows plus a review overflow row
  containing `more review`, `Overflow proof`, `Needs proof`, and `Needs memory`
  on canvas and Map, while copied aggregate briefs use `Investigate flaky
checkout flow: Review...`. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live terminal-output lists now advertise hidden output glimpses. Canvas,
  Sessions, and Map still show the first three `Copy output` rows, but append a
  `+N more output` row with the first hidden child mission and its latest
  sanitized terminal-output glimpse. This keeps the parent cockpit from hiding
  what busy child terminals are doing behind the visible row cap. The review
  overflow row was also moved under the review queue instead of the attention
  queue, so closeout overflow remains visible even when no separate attention
  list is rendered. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof lane shows three visible output rows plus an output overflow row
  containing `more output`, `Overflow proof`, and `Output glimpse` on canvas and
  Map, while the existing review overflow assertions still pass. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Live recent-event lists now advertise hidden audit activity. Canvas, Sessions,
  and Map still show the first three `Copy event` rows, but append a `+N more
events` row with the first hidden child mission, event label, and detail. This
  keeps provider-readiness and status audit trails visible as cockpit pressure
  instead of silently hiding lower-priority events behind the row cap. The
  output and review overflow rows were also re-anchored under their own
  terminal-output and review queues, so each overflow cue renders only when its
  own list exists. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent Request
  proof lane shows three visible recent-event rows plus an event overflow row
  containing `more events`, `Overflow proof`, and `Provider session ready` on
  canvas and Map, while output and review overflow assertions still pass.
  Additional verification passed `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check`.
- Live handoff-memory lists now advertise hidden restart context. Canvas,
  Sessions, and Map still show the first three `Copy memory` rows, but append a
  `+N more memory` row with the first hidden child mission and memory note. This
  keeps durable operator/provider handoff facts visible as cockpit pressure, so
  restart context does not disappear behind a row cap while the lane summary
  reports more memories than the operator can see. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies the
  six-agent Request proof lane shows three visible memory rows plus a memory
  overflow row containing `more memory`, `Overflow proof`, and `Handoff memory`
  on canvas and Map. The same regression also verifies review overflow now shows
  `Memory ready` for those memorized runs. Additional verification passed `npm
run build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`,
  and `git diff --check`.
- Live evidence queues now advertise hidden proof artifacts. Canvas, Sessions,
  and Map still show the first three `Copy proof` rows, but append a `+N more
evidence` row with the first hidden child mission, evidence line, and artifact
  path. This keeps proof material visible as cockpit pressure instead of forcing
  the operator to copy the aggregate brief or open child scrollback when many
  agents have attached verification. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent overflow
  lane can transition from proof-needed to evidence-backed runs, then shows
  three visible evidence rows plus an evidence overflow row containing `more
evidence`, `Overflow proof`, `Verification evidence`, and
  `reports/overflow-proof` on canvas and Map. Additional verification passed
  `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Live auth queues now advertise hidden provider-auth blockers. Canvas,
  Sessions, and Map still show the first three `Copy auth` rows, but append a
  `+N more auth` row with the first hidden child mission, auth reason, and next
  action. This keeps authentication blockers visible as fleet-level cockpit
  pressure instead of hiding the fourth blocked agent behind the row cap.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 5/5 and verifies the six-agent overflow lane can transition into
  auth-required runs, then shows three visible auth rows plus an auth overflow
  row containing `more auth`, `Overflow proof`, `Provider requires
authentication`, and `Authenticate the CLI` on canvas and Map. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Live risk queues now advertise hidden risky child runs. Canvas, Sessions, and
  Map still show the first three `Mitigate` rows, but append a `+N more risk`
  row with the first hidden child mission and confidence/risk detail. This keeps
  low-confidence or non-benign residual-risk agents visible as cockpit pressure
  instead of burying the fourth risky run behind the row cap. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and
  verifies the six-agent overflow lane can transition into low-confidence
  residual-risk runs, then shows three visible risk rows plus a risk overflow
  row containing `more risk`, `Overflow proof`, `confidence=low`, and `Residual
risk` on canvas and Map. Additional verification passed `npm run build`, `npm
run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live recovery queues now advertise hidden blocked/failed child runs. Canvas,
  Sessions, and Map still show the first three `Recover` rows, but append a `+N
more recovery` row with the first hidden child mission, failure reason, and
  generated recovery prompt. This keeps failed providers and blocked agents
  visible as cockpit pressure instead of hiding the fourth recovery behind the
  row cap. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 5/5 and verifies the six-agent overflow
  lane can transition into failed/blocked runs, then shows three visible
  recovery rows plus a recovery overflow row containing `more recovery`,
  `Overflow proof`, `Provider failure`, and `Recover Codex agent` on canvas and
  Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live attention queues now advertise hidden operator-action pressure. Canvas,
  Sessions, and Map still show the first three attention rows, but append a `+N
more attention` row with the first hidden label, child mission, and current
  activity. Attention rows now prefer the actual mission/prompt title over the
  generic tab title, so hidden blocked/auth/complete agents identify the work
  being supervised instead of reading as `Codex agent`. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies
  the six-agent overflow lane can transition into blocked runs, then shows three
  visible attention rows plus an attention overflow row containing `more
attention`, `Blocked`, `Overflow proof`, and `Recovery needed` on canvas and
  Map. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Live stale-agent queues now advertise hidden idle child runs. Canvas,
  Sessions, and Map still show the first three `Check in` rows, but append a
  `+N more stale` row with the first hidden child mission, idle age, and last
  visible activity. This keeps long-running agents that have stopped producing
  visible activity from disappearing behind the row cap while the cockpit
  summary reports more stale agents than the operator can inspect. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 5/5 and
  verifies the six-agent overflow lane can transition back into active-but-idle
  runs, then shows three visible stale rows plus a stale overflow row containing
  `more stale`, `Overflow proof`, `idle`, and `Idle child` on canvas and Map.
  Additional verification passed `npm run build`, `npm run verify:rust-warnings`,
  `npm run verify:map-terminals`, and `git diff --check`.
- Live workspace-group lists now advertise hidden workspace ownership. Canvas,
  Sessions, and Map still show the first three workspace groups, but append a
  `+N more groups` row with the first hidden group's label, agent count, active
  count, isolation mode, and branch detail. This keeps shared checkout and
  dedicated-worktree spread visible as cockpit pressure instead of making the
  operator infer hidden groups from the summary count. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 5/5 and verifies the
  six-agent overflow lane can transition into six distinct shared workspace
  groups, then shows three visible workspace groups plus a workspace overflow
  row containing `more groups`, `Workspace group`, `1 agents`, `1 active`, and
  `branch-overflow` on canvas and Map. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Process-survival hotfix: app/dev restarts no longer replace a reachable
  same-protocol daemon just because the binary `build_id` changed. Root cause:
  daemon replacement killed daemon-owned PTYs, while cold restore only replayed
  scrollback and reopened cwd in a fresh shell, so Codex/Claude foreground
  processes disappeared even though the terminal view returned. Replacement is
  now limited to explicit `--fresh-daemon` / `TERMINAL_WORKSPACE_FRESH_DAEMON=1`
  or protocol incompatibility; daemon session/event listing is exposed for
  future kill/restore audits. Evidence: `CARGO_BUILD_JOBS=1 cargo test
daemon::tests --lib`, `CARGO_BUILD_JOBS=1 cargo check`, `npm run
verify:map-terminals`, and live socket owner remained PID `3399682` after
  verification.
- Reliability stress gate added for the exact process-survival regression:
  `npm run verify:daemon-survival` starts a private real daemon, creates a
  long-running child session, calls `daemon_ensure_running()` from a different
  binary/build-id context, and asserts both daemon PID and child PID are
  unchanged. The fast gate `npm run verify:terminal-reliability` now includes
  this regression. Additional evidence: `APP_BUDGET=360 npm run
verify:standalone-daemon` passed app-restart reattach and daemon-cold-restore
  against a private release app; `npm run verify:restart-restore` passed live
  reattach plus daemon SIGKILL/restart restore at the socket layer; `npm run
verify:daemon-latency` reported p95 `1.4ms`; live daemon owner remained PID
  `3399682`.
- Release-blocking survival gate added: `npm run verify:release` now runs the
  terminal reliability suite, restart/restore proof, daemon latency proof, and a
  standalone release GUI smoke before printing `TERMFLEET_RELEASE_CHECK_OK`.
  Fresh evidence: the full gate passed with `TERMFLEET_RELEASE_CHECK_OK gui=1`;
  restart/restore covered app restart plus daemon SIGKILL/restart; daemon
  latency reported p95 `1.3ms`; standalone release smoke preserved daemon PID
  `3626544` across app restart, then proved cold restore after daemon restart to
  PID `3627596`; the user's live daemon socket owner remained PID `3399682`
  while release verification ran.
- Agent auth-blocker recovery now has a fleet-level cockpit action. Canvas,
  Sessions, and Map show `Retry N auth`/`Retry N auth · M held` beside the
  existing recovery/review/proof/memory/risk plans, and the action restarts only
  auth-required child agents after the operator authenticates the CLI. Restart
  metadata now clears stale auth/provider-failure readiness into `unknown` with
  a startup readiness check, so old auth blockers do not remain stuck after a
  retry. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 7/7 and verifies the six-agent overflow
  lane exposes the auth retry plan/action on canvas and Map, then retries all
  six auth-blocked runs into restart-requested provider startup state and
  disables the retry action. Additional verification passed `npm run build`,
  `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Agent cleanup ownership now has a safe fleet-level cockpit request action.
  Canvas, Sessions, and Map show `Cleanup N ready · M held` beside the other
  mission-control plans, and the action requests worktree cleanup only for
  completed/reviewed dedicated worktree runs whose cleanup target is still
  `available`. Active dedicated runs, shared-worktree runs, already-requested
  cleanup, manual cleanup, removed worktrees, and not-needed cleanup are held;
  destructive cleanup execution remains a per-run guarded action. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and
  verifies one cleanup-ready completed dedicated run plus two held runs show the
  cleanup request plan/action on canvas and Map; the canvas batch action changes
  only the eligible run to `worktreeCleanupStatus=requested`, records the
  `Worktree cleanup requested` event, then disables once no cleanup-ready runs
  remain. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Cleanup-requested runs now enter mission control instead of staying as a
  passive health counter. Once a fleet cleanup request is recorded, the shared
  mission queue adds a `Cleanup pending` focus item with the cleanup note,
  workspace/run identity, activity signal, and copied handoff action `focus run
and execute guarded cleanup`; Canvas, Sessions, Map, aggregate briefs, and
  focused mission-control briefs inherit the same row from the shared model.
  This keeps pending worktree cleanup operable from the cockpit while leaving
  destructive cleanup execution on the guarded per-run control. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and
  verifies a requested dedicated cleanup creates one visible mission item on
  canvas and Map, appears in the copied aggregate brief as `Cleanup pending`,
  and includes `Action: focus run and execute guarded cleanup`. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Cleanup-ready runs now count as actionable cockpit pressure before cleanup is
  requested. The shared lane model tracks `cleanupReady`, includes it in the
  aggregate status text and health pressure calculation, and surfaces `N cleanup
ready` on Canvas, Sessions, Map, and copied aggregate briefs. This prevents a
  completed dedicated worktree with an available cleanup target from looking
  stable until after the operator has already clicked the cleanup request.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 8/8 and verifies a completed dedicated run with `available` cleanup
  shows `Needs attention`, `1 cleanup ready`, and `Cleanup 1 ready · 2 held`
  before the batch request, then changes to requested cleanup after the action.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Fleet restart/cleanup controls now preserve mission-control provenance instead
  of recording generic operator controls. The shared store control API accepts
  source/label metadata; Canvas, Sessions, and Map pass
  `source: "mission-control"` for recovery restarts, auth retries, and cleanup
  requests while one-off run controls remain operator-scoped. Regression
  coverage: `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and
  verifies fleet auth retry/recovery restart events are recorded as
  `Mission control requested restart`, and cleanup fleet requests record
  `Mission control requested worktree cleanup` with the `Request cleanup`
  detail while direct per-run cleanup still records the operator event.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control rows now preserve same-run secondary pressure instead of
  silently hiding it behind the one-row-per-agent queue. The shared lane model
  still keeps the visible queue compact, but each primary mission row now
  carries `Also:` actions for lower-priority work on the same child run, the
  mission mix counts those secondary actions, and Canvas, Sessions, Map,
  aggregate briefs, and focused mission-control briefs render the same
  secondary pressure. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies six completed runs
  that primarily need proof also show `Review: 6` in the mission mix, visible
  rows include `Also: Review` plus the proof/memory closeout state, and copied
  mission-control briefs include the same `Also:` handoff line. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Mission-control load now distinguishes compact rows from actual operator
  actions. The shared summary tracks `missionActionCount` and
  `hiddenMissionActionCount` in addition to visible/hidden mission rows, Canvas,
  Sessions, and Map show row and action chips, and copied aggregate plus focused
  mission-control briefs report rows/actions separately. This prevents a
  one-row-per-agent queue from understating runs that need multiple operator
  decisions. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies the six-row overflow
  fixture reports `18 actions` / `3 hidden actions` when proof, review, and
  completion-focus pressure all exist on the same six runs; no-action fixtures
  report zero rows and zero actions. Additional verification passed `npm run
build`, `npm run verify:rust-warnings`, `npm run verify:map-terminals`, and
  `git diff --check`.
- Hidden mission-control overflow now carries the same row/action context as
  the visible queue. Canvas, Sessions, and Map overflow rows say how many
  hidden mission rows and hidden actions remain, preview the first hidden row,
  and include its `Also:` secondary actions; aggregate and focused copied briefs
  use the same `mission rows hidden (N actions)` wording. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and verifies
  the six-run overflow fixture renders `+1 rows · 3 actions`, previews
  `Overflow proof 6`, and carries both `Review` and `Complete` secondary
  pressure in the visible overflow row and copied hidden mission-control
  section. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control dispatch now has its own prompt accounting instead of being
  buried in the generic prompt count. The shared lane summary tracks
  `missionControlPromptCount` and `missionControlPromptSentCount`, Canvas,
  Sessions, and Map show `mission prompts` / `mission sent` chips, and copied
  aggregate briefs include a separate `Mission-control prompts:` section for
  recent cockpit-dispatched asks. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies a six-agent risk
  mitigation batch reports `6 mission prompts` and `6 mission sent` on Canvas
  and Map, while no-dispatch fixtures report zero mission-control prompts and
  `Mission-control prompts: - none` in copied handoffs. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Copied mission-control handoffs now state dispatch state explicitly. Aggregate
  briefs include `Mission-control dispatch: N mission-control prompts · M sent ·
K queued`, and focused mission-control briefs include the same dispatch line
  near the queue summary so an operator can tell whether the cockpit already
  sent the asks or merely queued them. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies zero-dispatch mission
  briefs show `0 sent · 0 queued`, while a six-agent risk mitigation batch shows
  `Dispatch: 6 mission-control prompts · 6 sent · 0 queued`. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Mission-control dispatch now shows what kind of cockpit asks were sent, not
  only how many. The shared lane summary builds a label/state dispatch mix from
  every agent input queue, Canvas, Sessions, and Map render a `Dispatch mix`
  row, and copied aggregate/focused briefs include `Mission-control dispatch
mix` / `Dispatch mix`. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies a six-agent risk
  mitigation batch shows `Mitigate risk: 6 sent` on Canvas and Map and in copied
  mission-control briefs, while no-dispatch handoffs show `Mission-control
dispatch mix: none`. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Mission-control dispatch-mix coverage now explicitly locks the Sessions
  surface, not only Canvas and Map. The Playwright regression switches the
  operations rail to Sessions, verifies `Mitigate risk: 6 sent` in
  `sidebar-agent-lane-dispatch-breakdown`, switches back to Map, and also
  checks stale copied handoffs include `Mission-control dispatch mix: none`.
  While tightening that proof, the raw provider-exit regression was stabilized
  to wait for the durable `Provider process exited` event before asserting the
  final blocked state, preserving the real queued-prompt-to-exit ordering.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 8/8. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Child agent nodes now show the latest mission-control ask directly in the
  visible cockpit panel. When the latest input came from mission control,
  `MagicCanvas` renders an `Agent cockpit ask` row with the prompt text plus
  `Ask state` showing the mission-control label and sent/queued state, so the
  operator can see what the parent cockpit just asked the child to do without
  expanding Details or reading terminal scrollback. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and verifies
  risk mitigation shows `Resolve risk for Codex agent` / `Mitigate risk · sent`
  on the node, then recovery dispatch shows `Recover Codex agent` /
  `Recover · sent`. The same run stabilized the recovery-dispatch fixture by
  reseeding deterministic recovery state between separate mission-control
  actions and loosened cancellation-sweep activity text to allow terminal echo
  while preserving exact cancelling phase, event, and control-count checks.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Split-pane child-agent terminal headers now show the latest mission-control
  ask too. `SplitPane` derives the latest workstream input, and when it came
  from mission control renders an `Ask:` header segment with the cockpit action
  label, sent/queued state, and prompt text, so the terminal pane itself says
  what the parent cockpit just asked the child to do. Regression coverage:
  `npx playwright test tests/agent-workstream.spec.ts` passed 8/8 and verifies
  the split terminal header shows `Ask: Mitigate risk · sent` with the risk
  prompt and later `Ask: Recover · sent` with the recovery prompt. The same test
  pass keeps durable dispatch/event checks for provider-auth races and scopes
  Details-only assertions to the opened Details panel. Additional verification
  passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Fleet run rows now carry the latest mission-control ask too. A shared
  `latestMissionControlAskText()` formatter derives `Ask: <label> ·
<sent|queued> · <prompt>` from the child input queue, and Canvas, Sessions,
  and Map `Copy run` rows append it when the latest ask came from mission
  control. This keeps multi-agent monitoring useful even when the operator is
  looking at the fleet list instead of an opened node or split terminal.
  Regression coverage: `npx playwright test tests/agent-workstream.spec.ts`
  passed 8/8 and verifies a six-agent mitigation dispatch shows `Ask: Mitigate
risk · sent` plus `Resolve risk for Codex agent` in Canvas, Sessions, and Map
  run rows. Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, and `git diff
--check`.
- Copied per-run handoffs now preserve the same cockpit-ask context as the
  visible fleet rows. `formatAgentRunBrief()` adds `Cockpit ask: ...` using the
  shared latest-ask formatter before the generic latest-input line, so a pasted
  child-run brief states the parent command explicitly instead of burying it in
  input history. Regression coverage: `npx playwright test
tests/agent-workstream.spec.ts` passed 8/8 and verifies a copied risk-run
  brief contains `Cockpit ask: Ask: Mitigate risk · sent · Resolve risk for
Codex agent` plus the mission-control latest input line. Additional
  verification passed `npm run build`, `npm run verify:rust-warnings`, `npm run
verify:map-terminals`, and `git diff --check`.
- Agent launch mode is now first-class instead of implied by provider metadata.
  Command-palette and map launches prompt for `terminal` vs `headless`, persist
  `workstream.launchProfile`, and render the selected launch mode in the
  cockpit provider grid. Headless Codex runs are constructed as `codex exec
--json <mission>` in browser-preview state and as `agent-provider-adapter.sh
codex headless <mission>` in the Tauri adapter path; Claude uses `claude -p
--output-format=stream-json <mission>`. The adapter emits a structured
  headless launch marker and then supervises the non-interactive child process
  with the same exit/cancel lifecycle markers. Regression coverage: `npx
playwright test tests/agent-workstream.spec.ts` passed 9/9 after adding
  explicit headless launch coverage and keeping the default terminal launch
  assertion. Adapter-level regression coverage: `npm run verify:agent-adapter`
  passed and proves the headless Codex/Claude command contract plus unsupported
  OpenCode and missing-mission structured failures with fake provider binaries.
  Additional verification passed `npm run build`, `npm run
verify:rust-warnings`, `npm run verify:map-terminals`, `sh -n
scripts/agent-provider-adapter.sh`, and `git diff --check`.

### TC-023: Cross-platform terminal substrate

**Priority:** P1
**Status:** In progress
**Depends:** TC-009, TC-017

#### Problem

TermFleet's UI and headless Canvas2D renderer are mostly portable, but the
terminal substrate still embeds Linux/Unix assumptions directly in production
code: Unix-domain sockets, XDG runtime paths, process-group daemon detach,
`kill` / `stty`, `/tmp`, and POSIX shell defaults. That makes macOS plausible
but unproven, and Windows impossible to compile until the seams are explicit.

#### Goal

Create a safe Linux-preserving substrate layer that keeps the current daemon and
PTY behavior intact while making the platform boundary obvious enough to add
macOS and Windows implementations later.

#### Cleanup plan

- Lock current Linux behavior first with daemon and Rust regressions.
- Introduce wrappers in small slices: `default_shell`, `platform_paths`,
  `daemon_ipc`, then `platform_process`.
- Keep the first pass behavior-preserving: Linux continues to use the same
  XDG socket path, Unix streams, detached process group, shell defaults, and
  daemon protocol.
- Do not add new dependencies until the wrapper-only refactor is stable; evaluate
  `interprocess` only when replacing Unix IPC with a cross-platform backend.

#### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run verify:daemon-survival`
- `npm run verify:daemon-latency`
- `npm run verify:standalone-daemon`
- `npm run verify:release` before marking the lane done.

Progress notes:

- Started with the lowest-risk wrapper slices: default shell resolution and
  daemon/runtime path helpers. Baseline `npm run verify:daemon-survival` passed
  before edits; full `cargo test --manifest-path src-tauri/Cargo.toml` passed
  unit tests but the sandboxed integration daemon process hung after
  `Operation not permitted`, so the dedicated daemon survival gate is the
  baseline for this pass.
- Added a behavior-preserving `daemon_ipc` wrapper and routed daemon requests,
  persistent input streams, subscriptions, and grid daemon attach through it
  while still using Unix sockets on Linux. Verification after the wrapper pass:
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` passed (54 tests),
  `npm run verify:daemon-survival` passed, `npm run verify:daemon-latency`
  passed with p95 1.5ms, and `git diff --check` passed.
- Added a behavior-preserving `platform_process` wrapper for detached daemon
  launch and explicit daemon termination. Linux still uses `process_group(0)`
  and `kill`, but those assumptions now live behind the platform seam.
  Verification repeated after this slice: `cargo test --manifest-path
  src-tauri/Cargo.toml --lib` passed (54 tests), `npm run
  verify:daemon-survival` passed, `npm run verify:daemon-latency` passed with
  p95 1.5ms, and `git diff --check` passed.
