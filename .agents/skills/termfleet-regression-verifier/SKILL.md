---
name: termfleet-regression-verifier
description: Verify a TermFleet fix sequentially on the failure surface that matters before completion, commit, push, or merge. Use when proving terminal, map, Canvas2D, task-status, daemon, persistence, release, or packaged desktop behavior and when deciding whether regression coverage is complete or only partial.
---

# TermFleet Regression Verifier

Prove the user-facing claim with fresh evidence from the narrowest relevant guard through the required integration surface.

## Verification Loop

1. State the exact claim being proved and identify the command or observation that would falsify it.
2. Read the matching row in `docs/regression-matrix.md`; do not substitute an easier surface for the listed failure surface.
3. Run checks sequentially and read each result before continuing:
   - Run the focused regression first.
   - Run `npm run build` for frontend changes.
   - Run the relevant canonical verifier from `package.json`.
   - Run `CARGO_BUILD_JOBS=1 cargo check` and focused Rust tests for backend changes.
   - Run `git diff --check` and inspect the final scoped diff.
4. For Electron or Tauri verification blocked by the sandbox, request the host runner with `/tmp/codex-electron-host-runner-<name>.request`; do not downgrade the proof silently.
5. For desktop-only behavior, rebuild and fully relaunch the real app before inspecting it. Confirm the running binary contains the change when stale embeds are possible.
6. For session recovery, verify the exact pane and conversation identity. Never resume one conversation in two live panes.
7. Update `MASTER_PLAN.md` with the exact fresh commands, results, and visual artifact when the task requires one.
8. Report failures honestly. Keep the task open and label coverage partial if the required live or packaged surface was not exercised.

## Canonical Routing

- Terminal renderer or input: `npm run verify:canvas-all`; add `npm run verify:canvas-live` for runtime claims.
- Map or pane identity: `npm run verify:map-terminals`; use the focused map spec for the changed contract.
- Daemon or PTY persistence: `npm run verify:standalone-daemon`, the relevant restart or reattach verifier, and focused Rust tests.
- Status, task, or installed-runtime wiring: the focused status suite plus `npm run doctor`; inspect the real desktop surface when visible behavior is claimed.
- Release or packaging: run the matching release verifier and prove the relaunched packaged application.

Do not call a change safe to merge from green tests alone when the original failure was visual, runtime-only, restart-sensitive, or packaged-app-specific.
