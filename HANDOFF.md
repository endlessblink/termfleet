# Dropoff — 2026-08-20 11:13 Israel time

```text
You are continuing work in termfleet on branch main.

## Current task & next step
Make the installed dock visibly render reliable, distinct Task, Goal, and Now rows — next: reproduce the screenshot's `Now: Status unavailable` in the dock-launched app and trace the exact rendered-state source that bypasses the passing telemetry gate.

## Files touched / in flight
Uncommitted changes are in `src/components/SplitPane.tsx`, `src/components/MagicCanvas.tsx`, `src/lib/terminalHeaderViewModel.ts`, `scripts/verify-live-task-goal-now.mjs`, `tests/cockpit-row-stability.spec.ts`, `tests/terminal-header-view-model.spec.ts`, and `MASTER_PLAN.md`. `HANDOFF.md` is being refreshed by this dropoff.

## Key decisions & gotchas
The user’s newest screenshot is the acceptance truth: Goal is polluted by a Memory Writing Agent prompt and Now still says `Status unavailable`; do not claim success from source tests or the JSON trace alone. Agent and map paths were changed so Task uses a distinct active step and otherwise says `Task not captured`; shell split was then changed to use its active task step instead of Goal. The live trace verifier was changed to distinguish a missing Task from a captured-but-invalid Task, and it reported `LIVE_TASK_GOAL_NOW_OK terminals=16`, but the visible dock still fails, proving that verifier coverage is incomplete or the screenshot is from another render path. Preserve the canonical PTY daemon and live sessions; restart only the dock app. Do not reset the dirty worktree, commit unrelated files, or run tests during this handoff.

## Env / run state
Branch: main | Last commit: 6d8d530 chore: seal trusted validation receipt
Running: installed dock release was rebuilt and verified with checksum `7527175501d25d60d2d829a50c5c251137d6300456603503e4aaccd1659b423d`; the dock was relaunched; the canonical daemon was preserved. Worktree has seven modified tracked files and no commit containing the current fix.

Start by: inspect the dock screenshot's pane/render path for `Status unavailable` and compare it with the pane record that produced the passing trace, then add a failing visual regression before changing production code.
```
