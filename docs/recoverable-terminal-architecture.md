# Recoverable Terminal Architecture

Status: active architecture, implemented through TC-009 with hardening work
remaining.
Scope: Magic Canvas / Terminal Cockpit PTY lifecycle.
Decision: build a custom local Rust PTY daemon instead of using tmux, Zellij, or
CRIU as the primary backend.

## Problem

The original desktop app owned PTYs inside the Tauri runtime. React rendered
`xterm.js`, called Tauri commands such as `pty_spawn`, and the Rust process used
`portable-pty` to spawn shell children. That was adequate for live terminal
panes, but it coupled shell lifetime to UI/runtime lifetime.

That coupling conflicts with the product goal: terminal sessions should feel
recoverable when the window closes, the frontend reloads, or the app process
crashes. Canvas nodes, terminal groups, and split panes should reconnect to
stable session IDs instead of spawning unrelated replacement shells.

## Recovery Tiers

| Tier | Target | Expected Behavior |
| --- | --- | --- |
| Window or frontend reload | Full live recovery | Existing PTYs continue running and panes reconnect by session ID. |
| Tauri app process crash | Full live recovery | A detached daemon keeps PTYs alive and the relaunched app reconnects. |
| OS reboot | Shape recovery | Workspace layout, terminal groups, cwd, command hints, and scrollback are restored; running processes are not. |
| OS reboot with live process state | Out of scope | CRIU-style checkpointing is too brittle for interactive developer shells. |

## Decision

Build a separate `terminal-workspace-daemon` Rust binary that owns all real PTY
processes. The Tauri app is a client/viewer:

1. On startup, Tauri checks for a user-local daemon over a Unix domain socket.
2. If the socket is unavailable, Tauri launches the daemon detached from the app
   process.
3. The daemon owns `portable_pty::MasterPty` handles, child processes, scrollback
   buffers, and session metadata.
4. Tauri requests session creation, attachment, write, resize, list, cwd, and
   kill operations over local IPC.
5. React and `xterm.js` render streams from daemon session IDs; unmounting a
   terminal view detaches the subscriber, not the PTY.

## Why Not tmux As Primary Backend

tmux is excellent at preserving live processes across client disconnects, but
its model is a grid multiplexer with windows and panes. Magic Canvas wants a
freeform strategic map, first-class terminal groups, linked file/session nodes,
and frontend-owned split layouts. Making tmux the source of truth would force
the product to constantly translate between a spatial canvas model and tmux's
layout model.

tmux remains useful as a later bridge:

- Import existing tmux sessions into Magic Canvas.
- Open a Magic Canvas terminal backed by a tmux pane for users who explicitly
  want tmux semantics.
- Provide export or handoff commands for terminal-native workflows.

## Why Not Zellij As Primary Backend

Zellij has a modern Rust implementation and session serialization, but it is
also opinionated about panes, tabs, modes, and plugin UI. Using it headlessly as
the primary backend would mean fighting its layout engine while duplicating the
same concepts in Magic Canvas.

Zellij remains useful as an optional integration target, especially for users
already working inside Zellij sessions.

## Why Not CRIU

CRIU can checkpoint some Linux process trees, but interactive PTYs, shell jobs,
SSH connections, file locks, editor state, network sockets, and GUI-adjacent
workflows make it a poor default for a desktop terminal product.

Reboot recovery should instead follow the tmux-resurrect/Zellij-serialization
model: restore session shape, cwd, command hints, scrollback, and workspace
layout, then start fresh shells.

## Daemon API Shape

Current local IPC methods:

- `status -> DaemonStatus`
- `ensureSession(id?, cwd?, command?) -> { id, reused }`
- `listSessions -> Vec<SessionSummary>`
- `writeSession(id, data) -> ok`
- `resizeSession(id, cols, rows) -> ok`
- `readSession(id, offset) -> PtyOutputChunk`
- `subscribeSession(id, subscriber_id) -> output stream`
- `unsubscribeSession(id, subscriber_id) -> ok`
- `snapshotSession(id) -> SessionSnapshot`
- `getSessionCwd(id) -> path`
- `killSession(id) -> ok`

Session metadata should include:

- Stable session ID.
- Current cwd where detectable.
- Initial cwd and launch command.
- Group ID and canvas node ID links.
- Current process ID.
- Status: running, exited, detached, stale, failed.
- Scrollback replay cursor or ring-buffer range.

## Persistence Model

Use two persistence layers:

1. Daemon memory for live process recovery.
2. Disk persistence for reboot/session-shape recovery.

The disk snapshot can be JSON first, then SQLite when queryability or migration
pressure appears. Store:

- Workspace UI state.
- Canvas nodes and links.
- Terminal groups and split layout.
- Session metadata.
- CWD and launch command hints.
- Bounded scrollback.
- Last known status and exit code.

Do not persist raw PTY handles or promise live process recovery after reboot.

## Security

Use a user-local Unix domain socket, not TCP. Place it under
`$XDG_RUNTIME_DIR/terminal-workspace/daemon.sock` where possible, and ensure the
socket directory is user-owned and mode `0700`. The daemon should reject access
from other users and avoid exposing shell control over HTTP.

## Implemented Shape

TC-009 established the daemon-backed path:

1. Stable runtime session IDs are derived from `tabId + paneId`.
2. React unmount and cancelled startup detach from the backend session instead
   of killing the PTY.
3. The Rust PTY engine exposes bounded scrollback, snapshots, output cursors,
   cwd lookup, resize, write, and explicit kill operations.
4. The daemon binds a user-local Unix socket and answers a versioned protocol.
5. Tauri can detect or launch the daemon, then proxy terminal operations over
   IPC.
6. The frontend terminal hook prefers daemon-backed sessions when reachable and
   falls back to embedded Tauri PTYs if daemon attach fails.
7. The standalone smoke verifies app-driven daemon launch, terminal I/O through
   daemon scrollback, daemon survival after killing the app window, and reattach
   to the same daemon PTY after relaunch.

## Remaining Hardening Targets

- Persist daemon session metadata and bounded scrollback durably enough for
  reboot/session-shape recovery.
- Validate socket ownership and reject cross-user access before treating a
  daemon socket as trusted.
- Complete stale-session UI states for reboot recovery: restartable, exited,
  failed, detached, and reconnecting.
- Explore tmux/Zellij bridge support only after the custom daemon path remains
  stable under release-app smoke coverage.
