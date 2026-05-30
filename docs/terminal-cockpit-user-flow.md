# Terminal Cockpit User Flow

This is the daily-use flow the redesign must optimize before further visual polish.

## Ten-Second Model

A user should understand this within 10 seconds:

- Files live in the independent file tree.
- Projects and terminal sessions live in the operations sidebar.
- The main surface is either Terminal or Map.
- The Map is for deliberately pinned, important sessions only.
- A terminal is always a real session first; a map node is only a reference to it.

## Core Flow

1. Open the app.
2. Create or select a project workspace from the operations sidebar.
3. Open a terminal in that project from the sidebar or command palette.
4. Show or hide Files independently without changing Terminal or Map context.
5. Switch between Terminal and Map from the operations rail.
6. Pin an important terminal to Map with the session row map action.
7. Close or kill that terminal from either the terminal surface or the pinned map reference.
8. Return to terminal work with the active project/session context preserved.

## Information Architecture

- Top bar: command palette, search, workspace status. It is not primary navigation.
- Left rail: Files toggle first, separator, Terminal/Sessions, Map. Links can return later when the relationship view is useful.
- Operations panel: compact project and session list. It must not become a second file browser.
- File tree: secondary retractable panel, visible or hidden independently of Terminal/Map.
- Main surface: one active work surface. Terminal and Map expose the same terminal sessions.
- Map: reconciles live terminal nodes for every terminal session, alongside files and notes.

## Acceptance Checklist

- No duplicate navigation controls.
- Files can stay open while switching Terminal and Map.
- Creating a terminal creates a live terminal map node through store reconciliation.
- Show on Map focuses the canonical live terminal map node.
- Closing a pinned terminal closes the real session.
- The user can create a project session without going through Files first.
- Selected items use amber accent only, never a white outline.
- Rubik is used for interface text; mono is reserved for terminal/code-like text.
- UI weights stay quiet: regular and medium by default, 600 for important labels, 700+ only for rare anchors.

## Current Design Risks

- The project/session model still needs stronger naming around "project" versus "group".
- The command palette should expose the same daily flow actions as the sidebar.
- The map empty state should teach pinning without becoming explanatory clutter.
- File explorer icons and row rhythm still need a final pass against the chosen icon system.
