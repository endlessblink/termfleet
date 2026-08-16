# Dropoff — 2026-08-16 10:40 Sunday

```text
You are continuing work in TermFleet on branch main.

## Current task & next step
Keep explicit terminal closes gone after restart while untouched terminals return exactly as before — next: use only the installed validation bridge to start a fresh run, record one turn, and verify it before any success claim.

## Files touched / in flight
Uncommitted work spans the terminal close/restart behavior, workspace persistence, installed restart smoke, task/goal labels, pressure safeguards, and their focused regressions. The project validation contract and adapter are also newly configured under the validation setup. Preserve all unrelated dirty work; do not reset or broadly discard files.

## Key decisions & gotchas
Explicit user closes are the only source of durable suppression: sidebar X, pane X, and /exit must affect only that terminal. Untouched terminals must survive UI restart and return; the daemon owns PTYs independently of the UI. Acceptance is the installed dock-launched release, not a development launcher or source-only check. The validation bridge is the only allowed work path: use its start, then turn for each work cycle, then verify; direct runner calls must remain blocked. Technical PASS does not close the goal because the user alone approves the visible result. Do not run broad process kills or alter the live user TermFleet session.

## Env / run state
Branch: main | Last commit: 4f92d9e Fix terminal close and restart ownership
Running: the installed TermFleet app and user-local PTY daemon are active; unrelated local containers are also running.
The latest bridge cycle completed start → turn → verify and passed build, close-route regressions, Rust tests, restart/restore, installed-release identity, and installed restart/close-route checks. A fresh run must be created for the next work cycle; do not reuse a stale checkpoint.

Start by: launch a new start request through the installed directive-agent bridge using the project adapter and a new run directory.
```
