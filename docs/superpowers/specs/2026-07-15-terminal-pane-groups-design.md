# Terminal pane catch-up: groups & project management — design plan

## Context

The map view has grown far ahead of the regular terminal (split) view: it shows every
terminal at once, groups them by project, filters by work state, and carries the
Running/Waiting/Idle badge and honest headers. The split view still shows one tab at a
time with no project context — you can't see a project's terminals together, flip
between projects, or manage projects from where you actually type. Goal: bring the
terminal pane up to the map's level for grouping and project management, reusing the
primitives that already exist (Groups, `groupId` on tabs, the badge single source of
truth, the sidebar's project rows, map filters).

## Phase 1 — Group switcher strip (see and flip between projects)

A compact strip at the top of the terminal view listing project groups, each chip
showing: emoji/color, name, and a badge rollup (● 2 running · ● 1 waiting). Clicking a
chip switches to that group's most recent tab; Ctrl+1..9 jumps by position.

- Reuse: `Group` + `groupId` (stores/workspace), `paneBadgeAttention` for rollups,
  the sidebar's project-row grouping logic.
- The "needs you" count is the headline: a group with a Waiting pane pulses amber.

## Phase 2 — Group board (a project's terminals tiled together)

A per-group board mode in the split area: all terminals of the selected group tiled in
a flat grid (the canvas renderer already pans/zooms as plain DOM, so tiles are cheap).
Enter zooms a tile to full split; Esc returns to the board. This is "the map, but
flat and keyboard-first" — no free-form canvas, just a grid.

- Reuse: `SplitPane` pane rendering, the map's node-per-terminal wiring
  (`terminalPaneId = linkedTab.activePaneId` contract), badge + header components.
- Keyboard-first: arrows move focus between tiles; typing goes to the focused tile.

## Phase 3 — Project management from the terminal view

- Create/rename/recolor/emoji a group inline (the command bar already has group
  actions on the map side — expose them in the terminal view).
- Move a terminal between groups (context menu + drag onto a group chip).
- Per-group defaults: project root cwd (new terminal opens there), preferred agent
  launcher preset, and a pinned "main" terminal per group.
- Group health line: last activity time + how many panes are waiting on the operator.

## Phase 4 — Cross-view continuity

- Selection sync: focusing a pane in the terminal view highlights the same node on
  the map and the same row in the sidebar (single selected-pane source in the store).
- The group switcher's filter state mirrors the map's "By project" filter, so both
  views always mean the same thing by "current project".

## Order & verification

Build in phase order; each phase lands with Playwright specs (group-strip rollups,
board tiling/zoom, group moves) plus a visual pass. Acceptance stays the operator's
eye — script gates are regression floors only.

## Known debt to fold in while touching these areas

Seven pre-existing map interaction/perf test failures on main (recolor menu, project
emojis, shift-drag box-select, 100-node overview perf, Delete+Ctrl+Z restore, folder
reconciliation, ops-panel work-state filter) — inherited from earlier branch work;
fix alongside Phase 1/2 since the same components are being opened anyway.
