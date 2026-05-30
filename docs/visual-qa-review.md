# Visual QA Review - Terminal Workspace

Date: 2026-05-29

## Evidence

- Browser terminal command: `docs/visual-baselines/tc-008-terminal-typed-command.png`
- Browser split terminal: `docs/visual-baselines/tc-009-terminal-split-right.png`
- Browser map linked terminal: `docs/visual-baselines/tc-010-map-linked-terminal.png`
- Browser second session on map: `docs/visual-baselines/tc-011-new-terminal-session.png`
- Browser map close flow: `docs/visual-baselines/tc-012-map-close-session.png`
- Browser terminal-section close flow: `docs/visual-baselines/tc-013-terminal-section-close-session.png`
- Standalone daemon terminal section: `docs/visual-baselines/tc-014-standalone-daemon-terminal-section.png`
- Standalone map terminal: `docs/visual-baselines/tc-015-standalone-map-terminal.png`
- Browser design refinement: `docs/visual-baselines/tc-016-design-refinement.png`
- Browser Warp-inspired command surface: `docs/visual-baselines/tc-017-warp-inspired-command-surface.png`
- Browser scoped command palette: `docs/visual-baselines/tc-018-warp-command-palette-scopes.png`
- Browser command empty state and status chips: `docs/visual-baselines/tc-019-command-empty-and-status-chips.png`
- Browser terminal surface fallback frame: `docs/visual-baselines/tc-020-terminal-surface-fallback-frame.png`
- Browser explorer token alignment: `docs/visual-baselines/tc-021-explorer-token-alignment.png`
- Browser map token alignment: `docs/visual-baselines/tc-022-map-token-alignment.png`
- Browser map index polish: `docs/visual-baselines/tc-023-map-index-polish.png`
- Browser motion polish command palette: `docs/visual-baselines/tc-024-motion-polish-command.png`
- Browser terminal theme refinement: `docs/visual-baselines/tc-025-terminal-theme-refinement.png`
- Browser pane chrome refinement: `docs/visual-baselines/tc-026-pane-chrome-refinement.png`
- Browser command palette footer: `docs/visual-baselines/tc-027-command-palette-footer.png`
- Browser status telemetry refinement: `docs/visual-baselines/tc-028-status-telemetry-refinement.png`
- Browser session create control: `docs/visual-baselines/tc-029-session-create-control.png`
- Browser sidebar action reveal: `docs/visual-baselines/tc-030-sidebar-action-reveal.png`
- Browser rail control polish: `docs/visual-baselines/tc-031-rail-control-polish.png`
- Browser launch config polish: `docs/visual-baselines/tc-032-launch-config-polish.png`
- Browser explorer footer telemetry: `docs/visual-baselines/tc-033-explorer-footer-telemetry.png`
- Browser pane context menu polish: `docs/visual-baselines/tc-034-pane-context-menu-polish.png`
- Browser explorer context menu polish: `docs/visual-baselines/tc-035-explorer-context-menu-polish.png`
- Browser terminal settings menu polish: `docs/visual-baselines/tc-036-terminal-settings-menu-polish.png`
- Browser sidebar row hover tokenization: `docs/visual-baselines/tc-037-sidebar-row-hover-tokenization.png`
- Browser map index row tokenization: `docs/visual-baselines/tc-038-map-index-row-tokenization.png`
- Browser map control tokenization: `docs/visual-baselines/tc-039-map-control-tokenization.png`
- Browser explorer row interaction tokenization: `docs/visual-baselines/tc-040-explorer-row-interaction-tokenization.png`
- Browser command chrome tokenization: `docs/visual-baselines/tc-041-command-chrome-tokenization.png`
- Browser tokenized terminal theme: `docs/visual-baselines/tc-042-tokenized-terminal-theme.png`

## Warp Reference Notes

- Command palette: Warp treats the palette as global search across workflows,
  notebooks, shortcuts, actions, active sessions, launch configs, files, and
  drive entries. This app now mirrors that model with scoped command prefixes
  for actions, sessions, files, and panes, keeps the palette open for empty
  scoped searches, and supports the `Ctrl+Shift+P` terminal-palette shortcut.
- Split panes: Warp marks the active pane with a compact corner indicator and
  keeps split actions discoverable through the command palette. This app now
  adds an active-pane corner marker while preserving icon-only pane actions.
- Tabs and session navigation: Warp emphasizes named, colored sessions with
  hover close actions and context-menu customization. This app keeps vertical
  session rows, color/emoji settings, inline close/map/terminal actions, and a
  header-level new terminal button.
- Appearance: Warp's terminal UX is built around a polished theme system,
  persistent tab/session metadata, subtle indicators, and a global command
  surface rather than decorative chrome. This pass tightened shared tokens,
  focus states, menu shadows, active-row treatment, and motion timing around
  those principles.
- Terminal primacy: the split surface now has a terminal-frame fallback during
  lazy loading and first measurement, so review captures and cold starts still
  read as a terminal cockpit before the PTY paints.
- Explorer cohesion: file explorer chrome now maps to the same workbench
  surface, border, row-selection, shadow, and motion tokens as sessions,
  command search, status telemetry, and terminal panes.
- Map cohesion: the strategic map now uses defined grid tokens, shared chrome
  tokens for controls and nodes, a nonblank loading fallback, and fitted zoom
  when jumping to live terminal nodes.
- Map index cohesion: the map index sidebar now follows the same header height,
  row selection accent, hover motion, icon-button styling, and text tokens as
  the sessions and explorer panels.
- Motion polish: popovers and surface cards use short reduced-motion-safe
  entrance animations, keeping interactions responsive without changing layout
  dimensions.
- Terminal theme cohesion: xterm ANSI colors now use the same restrained
  workbench accent family as the surrounding chrome instead of neon cyan,
  magenta, and green values.
- Pane chrome refinement: active terminal focus is now a thin workbench line,
  runtime status is a compact state pill, pane actions use tokenized hover
  states, and terminal scrollback styling matches the shell.
- Command palette refinement: command rows now expose category metadata or
  shortcuts consistently, and the palette footer shows keyboard navigation
  affordances plus the selected-result count.
- Status telemetry refinement: the bottom band now uses compact state icons for
  the active session, project root, PTY runtime state, PTY count, groups, and
  sessions instead of separator text and generic badges.
- Session create control: the session header now owns new-terminal creation
  with a dedicated amber plus control and count pill, while the redundant footer
  terminal text button was removed.
- Sidebar action reveal: inactive session and map rows now keep secondary
  controls quiet until hover or keyboard focus, while active rows keep actions
  visible for repeated terminal operations.
- Rail control polish: operations rail buttons, the header new-terminal button,
  and launcher controls now share restrained tokenized hover/focus states.
- Launch config polish: the project launcher now reads as a compact terminal
  launch configuration surface with a title, Enter hint, shared input focus
  treatment, and subtle surface motion.
- Pane context menu polish: split and close actions now use the same popover,
  keycap, danger, and hover tokens as the command palette and workbench chrome.
- Explorer context menu polish: file actions now use compact icon-led rows,
  grouped separators, shared popover tokens, and restrained destructive-state
  styling instead of a plain text menu.
- Terminal settings menu polish: session rename, color, and emoji controls now
  use shared popover motion, compact metadata hierarchy, focused input styling,
  and selected-state treatment for quick terminal customization.
- Sidebar row hover tokenization: session and map rows now use shared CSS hover
  and focus treatment, keeping inactive rows calm while exposing secondary
  actions without inline pointer-style mutations.
- Map index row tokenization: the canvas index is now mounted in canvas mode,
  uses real terminal/file/note icons, and shares selected, hover, focus, and
  close-button tokens with the rest of the operations workbench.
- Map control tokenization: the canvas toolbar, zoom controls, and node shadow
  now use shared workbench motion, hover, surface, and shadow tokens instead of
  local button and shadow values.
- Explorer row interaction tokenization: file and folder rows now use shared
  CSS hover/focus states and keyboard activation instead of local pointer-style
  mutations.
- Command chrome tokenization: the focused command entry, status bar floor,
  map fallback card, and global document text color now use shared workbench
  surface, shadow, and text tokens.
- Tokenized terminal theme: xterm now resolves background, foreground, cursor,
  selection, and ANSI colors from CSS terminal tokens with source verification
  to prevent palette drift away from the workbench theme.
- Terminal block rail: terminal bodies now carry a Warp-inspired command block
  rail outside the xterm cell grid, preserving exact TUI metrics while making
  command/output structure and attach-context affordances visually legible.
- Universal input context: the command strip now exposes scoped toolbelt
  filters and active session/project/pane/file chips in the palette, mirroring
  modern terminal input context without adding another toolbar.
- Launch configuration palette: `launch_configs:` is now a first-class command
  scope with runnable project shell, clean terminal, and split workbench entries,
  making repeated terminal setups reachable from the same universal input.
- Live-state motion polish: active terminal status dots and block markers now
  use restrained reduced-motion-safe pulse timing, while command palette rows
  enter with a short staggered reveal that reinforces keyboard navigation.
- Responsive command bar: the universal input now uses command-width tokens and
  narrow desktop rules that hide secondary shortcut/status details before the
  input or toolbelt can collide with the rest of the workbench chrome.
- New-terminal launch menu: the sidebar `+` remains the primary new-terminal
  control, and now exposes right-click launch options for inherited terminals,
  project shells, split workbench panes, and named project sessions.
- New-terminal keyboard menu: the same `+` control advertises its launch menu
  with a compact corner indicator, opens from keyboard navigation, and moves
  focus directly into the first launch action.
- Warp cohesive redesign: the command bar, sidebars, explorer, terminal frame,
  and composer now share a charcoal desktop-shell language with soft filled
  selection states and a terminal-first lime accent.
- Canvas classic grid: the map background now uses a restrained dot-and-line
  grid on flat charcoal instead of the previous textured checker field.
- Explorer footer telemetry: the file panel footer now reports root-level item,
  directory, and file counts with a shared hide-control hover treatment.

## Review

- Density: The shell now reads as a dense developer workbench rather than a
  landing page or canvas demo. The top command strip, contextual sidebar, file
  panel, terminal surface, map nodes, and status telemetry all use compact
  sizing.
- Hierarchy: Terminal work is the dominant tactical surface. Files and map are
  supporting instruments, and the map contains live terminal panes rather than
  placeholder cards.
- Spacing: Pane bodies, sidebars, and map controls share the same tight rhythm.
  xterm containers have no padding that steals terminal cells.
- Icon/text balance: Global navigation and pane actions are icon-first with
  accessible labels. Text is reserved for project/session/file identity and
  terminal content.
- Cohesion: Rubik is used for non-terminal UI, a TUI-capable mono stack is used
  for xterm, amber accent is reserved for selection/live focus, and status
  labels do not replace terminal content.

## Remaining Visual Debt

- Large bundle/chunk warnings remain a build concern, not a visual blocker.
- The standalone smoke uses a real desktop window and clipboard automation; it
  proves UI/PTY behavior but does not replace a future full visual diff suite.
