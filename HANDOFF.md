# Dropoff — 2026-08-16 12:51 Sunday

```text
You are continuing work in TermFleet on branch main.

## Current task & next step
Prove restart persistence and explicit-close suppression without touching the user's live terminals — next: create a genuinely isolated installed-runtime validation workspace, run the close/restart matrix there, and obtain the trusted verification artifact.

## Files touched / in flight
Uncommitted changes cover terminal close/restart ownership, complete terminal counting, installed restart verification, pressure safeguards, doctor/CLI ownership reporting, the directive-validation adapter/contract/config, and the local stop guard. Also in flight: scripts/verify-installed-close-route-matrix.sh, scripts/directive-codex-stop-guard.mjs, tests/test_directive_validation_guard.py. Preserve unrelated dirty work; do not reset or broadly discard files. Remove generated tests/__pycache__ and do not commit validation run artifacts unless the harness requires them.

## Key decisions & gotchas
Explicit user closes (sidebar X, pane X, and /exit) must remain dead after restart; only an explicit user restore may clear that tombstone. Untouched live terminals must survive restart and return to their original groups; no old terminal may be revived and no live terminal may disappear. The daemon owns PTYs independently of the UI. The user's visible count is not the daemon-only count: daemon status reported 35 while the persisted workspace had 46 panes, so never report a total from one state source alone. Acceptance is the installed dock-launched release, not a dev launcher or source-only test.

The close-route matrix is destructive and must run only with isolated XDG runtime/data/config/state plus an isolated installed-app identity; never run it against the canonical daemon or the user's 47 live terminals. The previous directive-validation run timed out and has no trusted-verification.json. The local stop guard now converts that missing artifact into a clear INCOMPLETE block instead of ENOENT; do not bypass the guard or claim validation success without the artifact. Use the validation bridge's start/turn/verify flow, with a fresh run directory. Technical PASS does not close the goal; the user alone approves the visible result.

## Env / run state
Branch: main | Last commit: 12f2e99 wip: dropoff handoff — terminal validation continuity
Running: the installed TermFleet app and user-local canonical PTY daemon are active with the user's live workspace; do not stop, recycle, or attach destructive tests to them. The latest focused checks passed: pressure watchdog 28 tests, auto-recovery 16 tests, directive guard + auto-recovery 18 tests, frontend build, installed-release verification, and installed restart verification. The latest trusted validation run is incomplete because trusted-verification.json is missing.

Start by: inspect the existing installed close-route matrix and validation adapter, then define and prove the isolated XDG/runtime boundary before launching any destructive validation.
```
