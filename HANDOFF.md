# Handoff — 2026-05-30 10:52 Saturday

You are continuing work in termfleet (terminal cockpit / multi-terminal ops workspace,
Tauri 2 + React + Rust + native GTK/VTE) on branch main.
Location: /media/endlessblink/data/my-projects/ai-development/devops/termfleet

## Current task & next step
Project was just extracted into its own repo at devops/termfleet (formerly
cc-linux-enhancments/terminal-workspace-tauri). next: run `npm install` then
`npm run tauri:dev:native-vte` to confirm the app still builds/runs in its new home
before resuming feature work.

## Files touched / in flight
- Fresh repo: 141 tracked files, working tree clean, 2 commits.
- MASTER_PLAN.md rebranded to "termfleet"; added TC-015 (per-node task badges) and
  TC-016 (multi-agent orchestration) to the backlog.
- node_modules/ and src-tauri/target/ are ABSENT (excluded from the move) — first
  build compiles Rust from scratch.

## Key decisions & gotchas
- termfleet is the ONLY surviving terminal project. Retired (recoverable from the
  cc-linux-enhancments monorepo git history): terminaltron, terminal-workspace,
  zellij-masterplan-tabbar. The web "magic-canvas" was deleted outright (was non-git;
  design is preserved in claude-mem Mar-2026 observations).
- Resume point for real work is TC-014 (terminal typing latency, IN_PROGRESS). The
  hard-won native-VTE path is DONE: native attach/input/lifecycle/restart-reconnect
  all verified. Remaining lag is frontend/xterm paint, NOT the daemon/PTY (p95 ~1ms).
- DO NOT add optimistic local echo or PTY echo suppression — explicitly rejected in
  TC-014 (breaks password prompts, SSH, readline, TUIs).
- First Rust build can be OOM-`Killed` under memory pressure; dev launchers already
  set CARGO_BUILD_JOBS=1 / CARGO_PROFILE_DEV_DEBUG=0. Use ./run-native-vte-dev.sh.
- Verifier scripts force native renderer + split mode via VITE_* env overrides so
  persisted localStorage can't turn release evidence into an xterm/map smoke.
- No CLAUDE.md/.claude in this repo yet — project guidance previously lived in the
  parent monorepo. Consider scaffolding one.

## Env / run state
Branch: main | Last commit: 57c3dfc "Rebrand plan to termfleet; add TC-015/TC-016 backlog"
Remote: NONE (local-only — no GitHub repo created yet)
Backup: monorepo cc-linux-enhancments at 99a2143 has 11 UNPUSHED commits incl.
        yesterday's work + the consolidation. Not pushed to GitHub.
Running: nothing relevant.

Start by: cd devops/termfleet && npm install, then npm run tauri:dev:native-vte to
verify the app launches from its new location.
