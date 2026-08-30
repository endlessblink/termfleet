# Dropoff — 2026-08-31 00:38 Israel time

```text
You are continuing work in termfleet on branch main.

## Current task & next step
Make dock launch restore every preserved pane's exact Codex/Claude conversation while killed panes stay absent — next: change the ownership gate to resolve the exact owning daemon pane and rebind the visible saved pane to it instead of returning only `owned elsewhere` and skipping recovery.

## Files touched / in flight
The worktree is heavily dirty and shared; do not reset, stash, mass-stage, or revert anything. This recovery slice has uncommitted work in `src/App.tsx`, `src/lib/agentReconnectRuntime.ts`, `src/stores/workspace.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/pane_process.rs`, `src-tauri/src/pty.rs`, `tests/agent-reconnect-button.spec.ts`, `tests/startup-recovery-critical-path.spec.ts`, `tests/workspace-hydration.spec.ts`, `tests/map-terminal-rendering.spec.ts`, `docs/regression-matrix.md`, and `docs/issue-registry.json`. `HANDOFF.md` is this dropoff. Many of those files also contain unrelated prior work, so inspect scoped diffs before editing or committing.

## Key decisions & gotchas
The user's hard acceptance is dock-only and visual: every preserved pane must show the actual resumed conversation, not a shell prompt with a correct task card; intentionally killed panes must remain absent. Never count daemon PTY attachment, scrollback, a written resume command, or a provider process without the exact conversation ID as recovery. The latest dock test on immutable release `5514cde0ebd3-9f09f6911a8e-6217964410dd` still failed. Lifecycle receipts at launch time show the decisive pattern: nearly every saved pane was skipped as `saved conversation is owned elsewhere`; only one was `already-running`, one had no exact identity, and one was missing locally. `agent_conversation_has_other_owner` currently returns only a boolean and ignores its `pane_id` argument; it finds live transcript/lock owners but cannot tell the frontend which daemon pane owns them. This leaves the exact Codex process running under a hidden/legacy PTY while the visible card attaches to an idle shell. Examples proven live: FlowState conversation `01a04bce-d6f4-7df0-9d4c-1bd77f61d376` is PID 864122 under daemon child/root 1511739 on pts/12; Lifeboat conversation `01a04362-4000-7041-81dd-a381f96f56e9` is PID 2841604 under daemon child/root 1511703 on pts/8. Both descend from canonical daemon PID 1433959. The remaining architecture fix is owner resolution + exact pane rebind/transfer, not weakening duplicate-writer protection or blindly typing another resume command.

Earlier fixes in the dirty tree must be preserved: exact identity requires two matching daemon `ListSessions` observations and direct daemon ownership; recovery success requires stable exact provider+session confirmation; post-paint background hydration runs once; legacy `terminal-<tab>-terminal-map-<tab>` sessions can rebind only through an explicit saved canvas link; canvas normalization preserves the explicit saved pane rather than replacing it with the active pane; idle-shell replacement requires a proven shell root twice and records failure receipts; transient resume failures may retry while terminal missing-session failures remain terminal. The visual screenshots also proved direct saved-session shell fallback (FlowState exact session `01a04bce...`) and legacy map/split divergence (TermFleet exact session `01a04c3d-7beb-72d2-a6b3-9d5ecfc99166`).

Do not restart or replace daemon PID 1433959: it owns the live conversations. Do not hijack the desktop; the user launches from the dock. A visual subagent violated its read-only assignment and modified files during the first release promotion, causing a transient `un: command not found`; it was stopped. Verify current diffs rather than trusting that worker's claims. Issue TF-018 is `verifying` but the latest live dock failure means it should return to `fixing` before more implementation. The regression matrix has a new 3.6c row for task-card-plus-idle-shell recovery. `$challenge-loop` and `$sure` HIGH gates remain mandatory; no completion without the final pane-by-pane dock visual matrix.

Fresh proof already passed before the latest live falsification: 53 focused recovery Playwright tests, 185 Rust library tests, focused legacy-map binding, exact saved-pane normalization, idle-shell safety, durable failure receipt, `npm run build`, `verify:map-terminals`, `verify:restart-restore`, and `verify:standalone-daemon`. These prove guards, not dock acceptance. The installed binary checksum verification passed for release `5514cde0ebd3-9f09f6911a8e-6217964410dd`.

## Env / run state
Branch: main | Last commit: `5514cde fix(termcontrol): make the command descriptions say something`
Running: dock app PID 3182977 from release `5514cde0ebd3-9f09f6911a8e-6217964410dd`; wrapper PID 3182962; canonical daemon PID 1433959; screen monitor PID 771273; pressure watchdog active. Current pane-health JSON is stale (last written 23:07, old 12 expected / 6 live / 2 dead / 4 unknown), so use fresh lifecycle receipts, daemon session/process ownership, cockpit capture, and new visual proof instead of that stale file.
Task state: in_progress. Installed release is current but live acceptance failed. User asked to continue in a fresh chat because this chat became huge.

Start by: add a read-only backend command that returns the exact owning provider PID and its canonical daemon session/pane ID for a provider conversation, then write a failing regression showing a visible saved shell rebinds to that live owner without starting a second writer.
```

# Normal operator use and acceptance are dock-only.
