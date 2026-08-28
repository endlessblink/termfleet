---
name: challenge
description: Canonical fail-closed adversarial review protocol for TermFleet
---

# TermFleet challenge protocol

This protocol is the project-local source of truth for `$challenge-loop`.
The loop must not claim completion without a snapshot-bound independent review
and a final `HIGH / PASS` Sure record.

## Normal review

1. Establish the exact user-visible failure and write an acceptance matrix with
   stable item IDs.
2. Run `$sure`; confidence must be `HIGH` and status must be `HIGH / PASS`.
3. Capture `npm run verify:cockpit-goal-matrix` immediately before creating the
   bundle. The snapshot must carry its `PASS` result, artifact hash, capture
   time, pane count, and every pane's distinct visible Goal; missing, shared,
   derived, or generic Goals are a hard failure.
4. Create a normal bundle outside the worktree with `challenge_runner.py
   normal-init`, containing the current state, acceptance criteria, evidence,
   and the Sure record.
5. Verify the bundle with `challenge_runner.py normal-verify` before review.
6. Run the project challenge-review adapter. It must invoke a separate,
   read-only reviewer, bind the result to the exact snapshot hash and review
   count, and append the result only through `challenge_runner.py
   normal-append`.
7. On `REVISE`, repair every declared finding, create a new snapshot and Sure
   record, verify both, and repeat. Do not omit unresolved finding IDs.
8. Stop only at reviewer `PASS`, a genuine fail-closed blocker, or the
   enforced three-review limit. A reviewer `PASS` must contain no findings and
   passing evidence for every acceptance item.
9. After `PASS`, run a distinct final Sure gate bound to the passing snapshot;
   the Sure inspection record must explicitly include the fresh all-pane
   visible Goal matrix.

## Isolation and evidence rules

- The reviewer is independent of the main agent and has read-only access.
- Reviewer output must be exactly one JSON object with snapshot-bound evidence.
- Wrong snapshot hashes, duplicate or missing acceptance IDs, writable review
  contexts, malformed output, changed worktree state, and missing artifacts are
  `BLOCKED`.
- Synthetic tests are supporting evidence only; installed dock behavior is the
  acceptance surface for desktop changes.
- Never substitute the main agent's opinion for the isolated reviewer.

## High-risk review

For irreversible or sensitive changes, use the high-risk bundle path. The
immutable scope scan, evidence manifest, reviewer attestation, and hash chain
must verify before any reviewer is called.
