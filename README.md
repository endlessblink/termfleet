<img src="docs/assets/termfleet-cover-control-room.png" alt="termfleet - a terminal cockpit for multi-session operations" width="1280">

# termfleet

termfleet is a terminal cockpit for multi-session operations: live terminals,
recoverable PTYs, canvas-based workspace maps, and supervised agent workstreams
in one native Tauri app.

## Visual Tour

### Agent Cockpit

Supervise Codex, Claude, OpenCode, and shell workstreams from the same canvas
where terminal sessions live.

<img src="docs/assets/termfleet-agent-cockpit.png" alt="termfleet agent cockpit with workstream map, run status, provider controls, and operator follow-up panel" width="1280">

### Canvas Terminals

The production terminal surface uses a headless VT grid rendered through
Canvas2D, with split panes, file context, and a strategic map in the same
workspace.

<img src="docs/assets/termfleet-canvas-terminals.png" alt="termfleet split terminal workspace with Canvas2D renderer, PTY daemon status, file explorer, and map preview" width="1280">

### Recoverable Sessions

PTYs are daemon-owned, so the UI can restart and reattach to live sessions
instead of treating the app window as the owner of terminal processes.

<img src="docs/assets/termfleet-daemon-recovery.png" alt="termfleet daemon recovery view showing reattached terminal sessions, recovery timeline, and daemon-owned PTY status" width="1280">

## Restore Workspace Proof

TermFleet has two recovery layers:

- **App restart reattach:** the Tauri window can close or restart while the
  user-local daemon keeps PTYs alive, then the relaunched UI reattaches to the
  same sessions.
- **Cold restore:** if the daemon is gone, persisted workspace/session metadata
  comes back as restartable stale sessions instead of silently deleting the
  user's workspace shape.

Run the repeatable proof path before claiming recovery works:

```bash
npm run verify:restart-restore
npm run verify:standalone-daemon
```

`verify:restart-restore` checks the daemon/socket restore layers without a GUI.
`verify:standalone-daemon` runs the release app against an isolated private
runtime, captures app-restart and daemon-cold-restore screenshots under
`/tmp/tw-standalone-daemon-smoke/`, and proves post-restore input still reaches
the terminal. Recovery is a product feature, not a best-effort cache restore:
React unmounts detach, explicit close/stop destroys, and stale sessions remain
visible until restarted or closed.

## Local Agent Status Summaries

TermFleet can summarize live terminal and agent output into compact
Task/Path/Now header text. The app always has a deterministic fallback; for a
local small-LLM pass, the normal Tauri dev launcher starts the status-summary
server automatically:

```bash
npm run tauri:dev
```

The launcher uses `http://127.0.0.1:37819/status` and defaults the Ollama adapter
to `qwen3:4b` on this workstation. Override it when another tiny local model is
installed:

```bash
TERMFLEET_AGENT_STATUS_MODEL=gemma4:e2b-it npm run tauri:dev
```

Disable the sidecar with `TERMFLEET_AGENT_STATUS_DISABLE=1`. The app still shows
deterministic summaries if Ollama is unavailable or the sidecar is disabled.
Override the Ollama URL with `TERMFLEET_OLLAMA_URL`.

## Release Gate

Process survival is release-blocking. Before cutting a release candidate, run:

```bash
npm run verify:release
```

This gate includes the fast terminal reliability matrix, the daemon-survival
regression for build-id mismatches, socket-level restart/restore, daemon latency,
and the standalone release-app daemon smoke. App restarts and rebuilds must not
kill daemon-owned foreground processes; only explicit close/stop/restart,
`--fresh-daemon`, protocol incompatibility, or the operating system may do that.
