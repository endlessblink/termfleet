# TC-001 Baseline Notes

Date: 2026-05-28.

## Captured

- `current-split-desktop.png` - captured from Vite at `http://127.0.0.1:5179/`
  with Chromium headless, viewport `1440x900`.

## Pending Artifacts

- `reference-cockpit.png` - add the external reference image if it can be
  committed. If not, keep the image outside the repo and update these notes with
  its observable traits.

## Current Split View Observations

- The app already has the broad regions needed for the cockpit: top bar, left
  sidebar, central terminal surface, and bottom status bar.
- The hierarchy is still split across competing chrome: top tools, mode bar,
  text mode buttons, command buttons, terminal tabs, and sidebar rows all compete
  for attention.
- The terminal surface is central, but pane actions are still text-heavy and
  always visible.
- The current surface language is close but not unified: several component-local
  backgrounds, borders, and button styles make the shell feel assembled rather
  than designed as one operations desk.

## TC-002 Shell Pass

- `tc-002-left-files-right-ops.png` captures the new shell at `1440x900`.
- The command bar is centered in the single top bar; the previous duplicate
  mode/context row was removed.
- Files now own the left resource sidebar. Sessions and map context now live in
  a right operations sidebar.
- Both shell sidebars are retractable.
- Shell controls use `lucide-react` icons instead of letter glyphs.

## TC-003 One Sidebar Pass

- `tc-003-one-sidebar-linked-terminal.png` captures the one-sidebar direction
  at `1440x900`.
- The right operations sidebar was removed. Sessions, Files, and Map now switch
  inside one retractable contextual sidebar.
- Terminal tabs and map terminal nodes are linked through `terminalTabId`.
- Browser screenshots show a PTY spawn error because Tauri commands are not
  available in Chromium review; use the desktop runtime for live terminal proof.

## TC-004 Terminal Surface Pass

- `tc-004-terminal-surface.png` captures the terminal-first tactical surface at
  `1440x900`.
- Terminal panes now include compact chrome, active status, CWD/title context,
  and icon-only split/close actions.
- Active pane focus uses the cockpit accent without adding always-visible text
  controls.
- Browser preview shows Tauri runtime guidance in the terminal viewport; use the
  desktop runtime for live PTY proof.

## TC-005 Strategic Map Pass

- `tc-005-strategic-map.png` captures the map pass at `1918x1078`.
- The map grid is now a quiet texture instead of the dominant visual identity.
- Terminal map nodes are strategic session cards with state, pane count, group,
  CWD, and a direct icon action to open the full terminal.
- Note and file nodes now share the same cockpit surface and border language as
  the sidebar and terminal shell.
- Selection sync is store-level: active terminal tab/pane selects its linked map
  node, and selecting a linked terminal node activates that session.
- Inactive workspace surfaces now use `display: none`; browser review no longer
  leaks the hidden split terminal under the map.

## TC-006 Command Menu Pass

- `tc-006-command-menu.png` captures the command menu at `1918x1078`.
- The command field now owns a filtered action menu instead of relying on
  browser datalist rendering.
- The menu includes workspace actions, split actions, sessions, panes, and
  tracked file results with icon-first rows and inline shortcut hints.
- Command input keystrokes are stopped before they reach terminal panes.
- Browser review focuses the command field directly because Chromium reserves
  `Ctrl+K`; desktop runtime keeps `Ctrl+K` as the intended command focus path.
