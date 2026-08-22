# TermFleet issue control system

This is the canonical control layer for bugs and regressions inside TermFleet.
It connects the existing regression matrix to one issue lifecycle, one evidence
policy, and one command-line review surface.

## Sources of truth

- `docs/issue-registry.json` owns issue identity, state, ownership, next action,
  and evidence history.
- `docs/regression-matrix.md` owns the detailed historical symptom, root cause,
  guard, and coverage record. Each issue links to its rows with `matrixRefs`.
- `docs/issue-error-matrix.json` owns the minimum evidence required for each
  failure surface.
- `MASTER_PLAN.md` owns project task status and release evidence.
- The external `agent-ops` queue remains the authority for shared cross-agent
  tasks; this registry must not replace it.

## Lifecycle

```text
reported -> triaged -> reproducing -> guarded -> fixing -> verifying -> resolved
    |          |            |          |         |          |            |
    +-------> deferred   blocked <-----+         +------> reopened <-----+
    +-------> wont_fix
```

Allowed transitions are enforced by `scripts/termfleet-issues.mjs`. A state is
not proof of completion: `resolved` requires the evidence required by the issue's
surface, while partial coverage keeps the issue in `verifying`.

## Evidence vocabulary

`source`, `focused-test`, `rust-test`, `build`, `browser-render`,
`daemon-smoke`, `installed-release`, `installed-restart`, and `live-desktop` are
deliberately separate. Source tests cannot stand in for installed or visual proof.

## Commands

```bash
node scripts/termfleet-issues.mjs check
node scripts/termfleet-issues.mjs list
node scripts/termfleet-issues.mjs show TF-001
node scripts/termfleet-issues.mjs create TF-004 --title "Describe the new failure" --surface logic --symptom "What users see" --guard "Focused test" --next "Reproduce it"
node scripts/termfleet-issues.mjs transition TF-001 reproducing --note "Live repro captured"
node scripts/termfleet-issues.mjs evidence TF-001 live-desktop --note "Dock verifier passed"
```

The command refuses invalid states, missing required fields, unknown evidence,
and premature resolution. It writes only the issue registry and keeps each
transition/evidence update in the issue's history.
