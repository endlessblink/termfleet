# TermFleet pressure-goal dropoff — 2026-08-16 13:42 Israel time

```text
You are continuing work in TermFleet on branch main. The active goal is to stop false pressure alerts and desktop recycles caused by normal WebKit memory usage. Do not reset the worktree, do not broad-kill processes, and do not recycle the user's canonical TermFleet app or daemon.

## Current task & next step
Keep the installed TermFleet desktop running without false pressure notifications or watchdog-triggered recycles — next: inspect the latest live incident sample, confirm the installed watchdog is still alive and synchronized, then wait for the user's explicit confirmation before closing the goal.

## User-visible success criteria
- Normal WebKit/desktop RSS growth must not create a pressure alert.
- Host-wide memory or I/O PSI alone must remain telemetry only; it must not notify, load-shed, recycle, or relaunch TermFleet.
- Only a confirmed blocked TermFleet/WebKit process may enter the guarded action path.
- The installed dock-launched runtime must use the synchronized watchdog.
- The desktop and canonical PTY daemon must remain alive; terminals must not be recycled as a side effect.
- The user must personally confirm the alert no longer appears. Do not mark the goal complete from tests or quiet logs alone.

## What was changed and verified
- The pressure watchdog now treats RSS-only readings as diagnostic, requires repeated blocked-renderer evidence before action, and keeps host PSI as telemetry-only.
- The source watchdog and installed watchdog currently matched exactly at SHA-256 `9f6310510d85362bfc0869424d58cdedd97672fa4b06ef5fc22bb8d1dffd2edc`.
- The installed release was rebuilt, promoted, and verified with `npm run verify:installed-release`.
- Watchdog, launcher, and recovery regression tests passed: 44 tests, all OK.
- Live monitoring observed normal samples through `2026-08-16T13:29:03+03:00`, with no new `pressure_started`, `desktop_recovery`, or `pressure_cleared` events in the current window.
- The desktop and watchdog were alive during the last observation; the latest observed desktop process was the canonical dock child and the watchdog was the installed libexec process.
- Historical pressure-start entries are from earlier dates and are not new failures. The old alert log contains unrelated Playwright load-shed records; do not misclassify those as a new TermFleet pressure alert.

## Harness and goal state
- The pressure objective is still active and was marked BLOCKED only because the user confirmation gate has repeated without a confirmation; resume it when the user responds.
- Do not call `update_goal complete` unless the user explicitly says the alert is gone/confirmed.
- The separate terminal persistence validation also exists in this worktree; its latest trusted installed matrix passed, but do not conflate that with the pressure goal.
- The directive-validation contract is READY for the persistence lane, but it is not a substitute for pressure-goal user confirmation.

## Files and dirty worktree
- Pressure implementation: `scripts/termfleet-pressure-watchdog.sh`.
- Installed copy: `/home/endlessblink/.local/share/termfleet/libexec/termfleet-pressure-watchdog`.
- Incident evidence: `/home/endlessblink/.local/state/termfleet/incidents.jsonl`, `incident-summary.md`, `pressure-alerts.log`, and `pressure-governor.json`.
- Persistence/harness changes are also uncommitted: `.directive-validation/`, `MASTER_PLAN.md`, `docs/regression-matrix.md`, `src/stores/workspace.ts`, `scripts/termfleet-desktop-launcher.sh`, `scripts/termfleet-doctor.mjs`, `scripts/termfleetctl.mjs`, `scripts/verify-termfleetctl.mjs`, `tests/test_auto_recovery.py`, `tests/test_doctor_ownership.py`, plus the directive guard and close-route matrix scripts/tests.
- Generated validation runs and `tests/__pycache__` are noise; preserve unrelated work and do not run broad cleanup.

## Environment / run state
Branch: `main` | Last commit: `f50402f wip: expand persistence validation handoff`
The canonical dock-launched TermFleet desktop, its user-local PTY daemon, and the installed pressure watchdog are running. Private validation runtimes used XDG isolation/Xvfb and must not be confused with the canonical runtime.

## Exact next checks
1. Run `date`, inspect the watchdog PID, compare the two watchdog SHA-256 values, and read only new incident events since the last observed timestamp.
2. If samples remain normal and there is no new pressure/recovery event, report that the technical evidence remains clean and ask the user to confirm.
3. If a new alert or recycle appears, classify it from the incident event and exact process ownership before changing anything; do not assume host PSI or RSS proves a TermFleet fault.
4. Only after the user confirms, call `update_goal` with `complete`; otherwise keep the goal active or blocked on that approval gate.

## Useful commands
- `sha256sum scripts/termfleet-pressure-watchdog.sh /home/endlessblink/.local/share/termfleet/libexec/termfleet-pressure-watchdog`
- `ps -eo pid,ppid,etime,stat,cmd | rg 'termfleet-pressure-watchdog|termfleet-desktop --child'`
- `tail -n 20 /home/endlessblink/.local/state/termfleet/incidents.jsonl`
- `jq -s 'map(select(.event=="pressure_started" or .event=="desktop_recovery"))' /home/endlessblink/.local/state/termfleet/incidents.jsonl`

Start by checking the current live incident stream and installed watchdog identity, then wait for the user's explicit confirmation.
```
