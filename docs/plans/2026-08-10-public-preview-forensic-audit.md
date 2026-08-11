# TermFleet public preview forensic audit

Date: 2026-08-10

## Baseline

- Branch: `main`, 13 commits ahead of `origin/main`, 0 behind.
- No staged changes were present at inventory time.
- The worktree contained 32 tracked modified paths and 11 untracked non-cache paths.
- Two untracked Python cache directories were generated output and were removed:
  `scripts/__pycache__/` and `tests/__pycache__/`.
- No reset, stash, checkout, push, tag, release, deployment, daemon restart, or
  live-state migration was performed.

## Preserved workstreams

### Release and operational hardening

`scripts/install-release.sh`, `scripts/termfleet-desktop-launcher.sh`,
`scripts/termfleet-pressure-watchdog.sh`, `scripts/termfleet-background-run.sh`,
`scripts/termfleet-io-governor.mjs`, `scripts/install-host-pressure-protection.sh`,
`scripts/install-io-governor.sh`, the three `systemd/` units, and their focused
tests are preserved as one host-pressure and release-install workstream.

### Daemon, PTY, and recovery safety

`src-tauri/src/daemon.rs`, `src-tauri/src/platform_process.rs`,
`src-tauri/src/pty.rs`, `src-tauri/src/vt_grid.rs`,
`scripts/migrate-session-ids.mjs`, `scripts/verify-restart-restore.py`,
`scripts/verify-standalone-daemon-smoke.sh`, and the related Rust/source tests
are preserved as the daemon ownership, duplicate-resume, persistence, and
reattach workstream. The migration script is not being run against live state.

### Cockpit task identity and visual behavior

`src/components/MagicCanvas.tsx`, the `src/lib/task*` and terminal-header files,
`index.html`, and the related Playwright tests are preserved as the task-label,
header, map-card, and startup-animation workstream.

### Evidence, documentation, and task board

`MASTER_PLAN.md`, `docs/regression-matrix.md`, `package.json`, and all existing
release/evidence documentation remain user-owned. Their historical claims will
be checked against fresh final-commit evidence before any checklist item is
changed.

## Current live-state boundary

Read-only `npm run doctor` reports one canonical daemon listener under
`/run/user/1000` plus four isolated verifier daemon processes/listeners under
`/tmp/tw-terminal-headers-live-all`. It also reports duplicated historical
provider IDs, legacy command-derived IDs, a running dock app older than the
installed release, and a Codex session-record format warning. The canonical
daemon, dock app, PTYs, provider conversations, and verifier processes remain
untouched because replacing or stopping them would be disruptive.

## Intended commit sequence

1. Correct and regression-test read-only daemon/doctor classification without
   changing live ownership or session data.
2. Complete only release-documentation, CI checksum, and packaging changes that
   are supported by fresh evidence.
3. Record final-gate results and update the parser-compatible task board.
4. Prepare the local portfolio page and launch kit only if the release verdict
   is honest enough to present.

Each commit must include its focused regression and exact verification evidence;
no existing commit history will be rewritten.
