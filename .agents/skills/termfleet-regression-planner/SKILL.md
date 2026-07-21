---
name: termfleet-regression-planner
description: Automatically turn every TermFleet bug report, behavior correction, repeated failure, or risky fix into a regression-first implementation plan with the smallest guard that covers the real failure surface. Apply implicitly without requiring the user to name the skill for terminal input, Canvas2D rendering, map behavior, project status, daemon or PTY persistence, desktop packaging, and anything described as broken again.
---

# TermFleet Regression Planner

Create the guard before the fix and keep the plan visible in the cockpit.

## Workflow

1. Declare one plain-language plan step as in progress.
2. Reproduce the failure or preserve the available artifact. Record the user-visible symptom, the runtime surface, and the expected behavior.
3. Read `docs/regression-matrix.md`. Reuse an existing row and guard when they cover the same failure mode; otherwise add a row.
4. Lock the failure with a regression that fails for the right reason before changing production code.
5. Match the guard to the failure surface:
   - Pure decisions or state transitions: focused unit or Playwright spec.
   - Canvas drawing or browser layout: focused pixel or browser spec.
   - GTK, WebKit, clipboard, focus, TUI, or input routing: live desktop verifier; source assertions alone remain partial coverage.
   - Daemon, PTY, scrollback, or restart behavior: Rust test plus the relevant live restore verifier.
   - Packaged or installed app behavior: rebuild, relaunch, and inspect the packaged surface; a frontend build is insufficient.
6. Preserve the hard constraints in `AGENTS.md`, especially daemon-owned PTYs, per-pane session identity, no optimistic echo, and no transport errors in terminal output.
7. Keep the implementation slice narrow. Reuse existing helpers and verification scripts; add no dependency for a regression guard.
8. Continue automatically with the `termfleet-regression-verifier` workflow before claiming completion. Never ask the user to invoke it or start another session.

## Coverage Rules

- A guard must fail when the original defect is reintroduced.
- A source-contract regex cannot prove runtime behavior.
- A mocked browser cannot prove GTK, WebKit, daemon, restart, or packaged-app behavior.
- Mark coverage partial when the exact failure surface is not exercised.
- Add the root cause, guard, and coverage level to `docs/regression-matrix.md` for a new bug class.
- Record the final verification commands and evidence in `MASTER_PLAN.md` before marking the task done.
