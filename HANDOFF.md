# TermFleet continuity handoff — 2026-08-16

Paste everything inside the block into a fresh agent after restarting the chat.

```text
You are continuing a long-running reliability investigation in the TermFleet repository on branch main. Do not start over, do not reset the worktree, and do not touch or recycle the user's canonical TermFleet app or daemon: the user has approximately 47 live terminals in that workspace.

USER-APPROVED GOAL
Make terminal persistence reliable from every direction:
- Terminals the user leaves open must survive app restart, daemon restart, and cold restore.
- They must return to their original groups/panes and remain usable.
- A live terminal must never silently disappear.
- A terminal explicitly killed by the user must stay dead across every later restart.
- Old terminals must never be revived merely because they existed in an old snapshot.
- Sidebar X, pane X, and /exit are all explicit user-close routes.
- Only an explicit user restore action may clear a close tombstone.
- The installed dock-launched runtime, not a source build or dev launcher, is the acceptance surface.
- The user alone approves the goal as complete.

CURRENT RESULT
The latest independent validation is no longer missing its artifact: it finished and wrote trusted-verification.json, but the verdict is BLOCKED. Six isolated installed close/restart cycles passed across sidebar-x, terminal-x, and slash-exit, repeated twice each. Build, close-route Playwright coverage, restart/restore, installed-release identity, and the close-route matrix passed. One Rust unit test failed: pty::tests::kill_terminates_detached_descendant_that_drops_pane_marker, with “detached child pid was not printed.” This is the current blocker; do not call the whole goal complete.

WHY THE HOOK MESSAGE APPEARED
The earlier wrapper killed the validation process at 120 seconds while the installed matrix was still running, so no artifact existed at that moment. The run was then allowed to finish with a longer timeout. The local Stop guard correctly changes a missing artifact from an ENOENT crash into a clear incomplete/block message. If the old hook text says “artifact missing,” it is stale output from before completion; inspect the active run's artifact and verdict before acting.

IMPORTANT STATE/EVIDENCE
- Active validation run: .directive-validation/runs/20260816-fresh-close-count
- Its trusted artifact exists and has ok=false because only the detached-descendant Rust test failed.
- Installed matrix evidence in that artifact shows all six isolated cycles passed and used the installed release.
- The matrix is isolated: private temporary XDG runtime/data/state directories, private Xvfb display, private dbus session, private daemon socket, fake Codex fixture, and cleanup of its own process group.
- Existing successful trusted runs from the same implementation state include fresh-close-restart, goal-close-restart, route-matrix, and harness-contract-refresh-20260816, but do not substitute an older artifact for a fresh result without checking its baseline and freshness.
- The user's visible terminal count is not the daemon-only count. A prior daemon status reported 35 while persisted workspace state showed 46 panes; never report a total from one state source.
- Explicit-close tombstones already have focused regression coverage and the focused auto-recovery suite passed 16/16.
- Directive stop-guard plus auto-recovery tests passed 18/18.
- Pressure watchdog tests passed 28/28; host-wide PSI is telemetry-only and must not recycle TermFleet.

FILES AND CHANGES IN FLIGHT
- .directive-validation/adapter.json: required checks and installed close-route matrix.
- .directive-validation/contract.json: persistence objective, success criteria, and failure signals.
- .directive-validation/config.json: directive-agent integration and run mappings.
- scripts/directive-codex-stop-guard.mjs: clear fail-closed handling when trusted verification is absent.
- scripts/verify-installed-close-route-matrix.sh: six isolated installed close/restart cycles.
- scripts/termfleet-desktop-launcher.sh, scripts/termfleetctl.mjs, scripts/verify-termfleetctl.mjs, scripts/termfleet-doctor.mjs: installed/runtime ownership and counting diagnostics.
- tests/test_directive_validation_guard.py and tests/test_doctor_ownership.py: regression coverage.
- MASTER_PLAN.md: task evidence and current status.
- Existing production persistence changes are already in the worktree/history; preserve them and inspect before editing.
- Generated validation run directories and tests/__pycache__ are noise; do not broadly delete or reset them.

EXACT NEXT ACTION
1. Read the failed Rust test around pty.rs and reproduce only that test in isolation, then run it repeatedly to determine whether it is an environment race or a real regression.
2. Do not weaken or skip the test. If it is flaky, make the test deterministic or fix the underlying process-observation race, then add/retain a regression proving detached descendants are cleaned up.
3. Run the focused Rust test first, then the full Rust library suite, then rerun the directive-agent validation with a fresh run directory and a timeout long enough for the six isolated desktop cycles.
4. Confirm the new trusted artifact has ok=true and all required checks passed. Also run git diff --check and inspect the scoped diff.
5. Only after fresh evidence, rebuild/promote the installed release if production code changed, verify the dock-launched runtime, and report remaining user-visible acceptance. Never mark the goal complete without the user's approval.

KNOWN COMMAND SHAPES
- Focused Rust test: cargo test --manifest-path src-tauri/Cargo.toml --lib pty::tests::kill_terminates_detached_descendant_that_drops_pane_marker -- --nocapture
- Full Rust library suite: cargo test --manifest-path src-tauri/Cargo.toml --lib
- Frontend build: npm run build
- Installed release verification: npm run verify:installed-release
- Installed restart verification: npm run verify:installed-restart
- Harness protocol: invoke the installed directive-agent bridge with JSON actions start, continue/verify, then inspect trusted-verification.json; never call the underlying runner directly for the project.
- The destructive close matrix may run only through scripts/verify-installed-close-route-matrix.sh, with its private runtime/display isolation intact.

FIRST MESSAGE TO USER AFTER RESUMING
“The isolated persistence matrix completed: all six installed close/restart cycles passed. The remaining blocker is one detached-child Rust test that failed to observe its child PID; I am investigating that test before claiming the app is fully protected.”
```
