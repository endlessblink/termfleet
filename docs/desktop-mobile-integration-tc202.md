# Desktop + mobile integration candidate, 2026-10-04

This supersedes the earlier TC-202 handoff's open three-test failure list. It is
an isolated integration candidate, not a release or completed end-to-end delivery.
Canonical source and all live desktop/daemon processes remain untouched.

## Preservation and integration

Baseline `73377910e817d8323396a545f7b8bb7b953a1b0d`. The completed mobile worker's
current `docs/termcontrol-freelance-mobile.md`, TF-078 plan and registry were read.
Its original-dark restoration, disabled custom dispatch, protected route, and
deployment receipts remain intact. No mobile worker was asked to write again.

`c81da18` preserves all 26 canonical modified/untracked files. Recovery files and
SHA256 manifest are in the task's `termfleet-integration-recovery/` directory.
`6439d78` integrates desktop source from `35ab9c5`. Shared plan and regression matrix
were merged against the common base; registry entries were merged by issue ID,
rejecting overlapping edits. TF-078 is retained. All 23 non-shared mobile files
are byte-identical to the preservation manifest. All 26 canonical WIP hashes were
rechecked unchanged after integration and tests.

## Task / Goal / Now corrections

| Value | Evidence and correction | Verification |
| --- | --- | --- |
| Task | Preserve manual requests; exact pane/run/conversation guards reject late results. Completed task-list titles no longer use the first task auto-captured as a legacy prompt. An actual distinct operator request still outranks a completed checklist. Imperative requests ending in `?` remain requests; bare clarification questions remain rejected. | Combined status and presentation suite; directive-question and last-completed-task tests. |
| Goal | Codex Stop after `$about-what` records `mainTaskSource: about-what`, not a turn-local plan explanation. Same-conversation prompts/tools preserve that explicit source; a new conversation replaces it. Legacy Stop records migrate only with explicit about-what/narration provenance. Command echoes no longer create a generic review Goal or resurrect an earlier turn's raw prompt. Manual/bound/stored context remains separate. | Pure hook reducer follow-up/tool/new-conversation regression; worker Goal recovery and rendered header tests. |
| Now/status | Missing/expired evidence and metadata-only Codex tails become low-confidence Unavailable. Transport Running/Reconnected alone does not mean agent Working or Idle. Older complete summaries cannot replace newer text. Runtime output preserves Task/Now and completion acknowledgements. | Status authority, poll, header, Rust lifecycle, and browser acknowledgement tests. |
| Provider ownership | Poll exact live PTY identity, independently of the stable sidecar key. A confirmed provider replacement clears the displaced provider's session/task/review fields; unknown/error observations retain attribution rather than guessing. Manual asks remain. | Six browser fixtures: confirmed/unknown/error process observations × fresh/stale sibling-provider sidecar. |

Shared additive fields: focus-only `Tab.lastUsedAt`; summary `sessionId`,
`updatedAt`, `completedAt`, `waitingReason`; pane review acknowledgement timestamp
and conversation ID. Mobile recent-use implementation is retained; the candidate
does not claim mobile already consumes a shared v2 desktop status selector.

## Original three failures: exact diagnosis and reproduction

Unchanged baseline scripts were extracted with `git archive HEAD scripts` and
run with the same three tests; all three failed identically. This established
provenance, not permission to ignore them:

1. `all tasks complete: title is the last task, never the raw shell command`:
   expected Ship the feature, got Build the parser. The first task became the
   legacy prompt and outranked the last completed task. Both summary readers now
   prefer the completed task only when that prompt is the first task's auto-copy.
2. `worker preserves a pane's about-what Goal when later plan text matches a folder
   heuristic`: expected the pane's Keep-this-terminal Goal, got undefined.
   The real pure reducer also discarded it on follow-up because plan-explanation
   was not durable. Explicit about-what provenance fixes that loss.
3. `worker finds the original sidecar after a pane is restored with a recovered
   id`: expected captured purpose, got undefined. Full hooks under Codex's shared
   app-server rightly refuse an unowned synthetic pane; this fixture produced no
   sidecar. Worker tests now write fixtures via the real pure reducer, without
   ownership scans/closures. Production ownership checks were not relaxed.

After fixture isolation, tests 1/2 plus a new explicit-source regression failed
before the correction; restored-ID lookup passed. The corrected combined suite
passes. There is still no claim of installed hook ownership acceptance.

Broader baseline reproduction also found legacy neutral-title and directive-`?`
failures. These are corrected. The prior contradictory test expecting Working
from transport attachment was updated to enforce Unavailable; four presentation
assertions likewise now enforce honest missing evidence while retaining exact
Task/title assertions. A legacy test expecting generic Reviewing-current-changes
from a slash command now explicitly rejects it, consistent with the original
no-fabrication guard.

## Actual controls and folder behavior

- Ctrl+Alt+PageDown/PageUp: next/previous MRU terminal, based on operator focus;
  modifiers hold one stable cycle. Output and status never reorder it.
- Ctrl+Alt+Home: explicitly reported approval, other waiting input, then completion
  awaiting review. No automatic focus. Completion acknowledgement is per pane and
  conversation and survives output/reload. Importance is not inferred.
- Ctrl+Alt+N or CommandPanel New agent terminal: provider, folder or known project,
  optional new folder, mission, shared/dedicated Git, terminal/headless profile.
  Opening/canceling writes nothing. Submit validates availability and folder;
  dedicated Git requires an existing ready Git folder. Errors remain visible.
  Chosen folder overrides stale project filters. Same-project terminals stack
  below siblings; new projects go to the right, moving only the new node.

## Proof and remaining gates

- Combined relevant hook/status/Task/Goal/Now/navigation suite: **595 passed,
  4 existing fixmes skipped**, no failures. The four pre-existing fixmes are:
  `terminal purpose ignores pre-working stale transcript lines`, `does not promote
  a screenshot path instruction into the Task row`, `compacts raw checklist task
  text for the visible Task row`, and `stale scoped todo-write summary does not own
  a newer run`. They remain limitations, not completed guards.
- Integrated browser navigation/dialog/attention + provider authority: **10 pass**,
  synthetic panes, isolated port 5189. Screenshot is browser fallback, not native.
- `verify:canvas-all` on temporary fixture copies changing only hardcoded app URLs
  to isolated port 5189: **104 pass, 1 existing fixme** (map shell header durable activity versus stale transcript). The first unadapted run
  failed infrastructure fetches at 5177; it was not accepted as product evidence.
- Preserved mobile focused tests **28 pass**; canonical mobile verifier **24 pass**.
- Final frontend build, map/typography source verifiers, Node syntax, issue system
  and diff checks pass. Integrated offline Cargo check passes. Rust lifecycle module
  previously passed 9 with 1 live probe ignored; its source is unchanged here.

The broader TC-170–179 reducer, lease/sequence model, complete cross-surface parity,
and mobile shared selector remain open. Legacy transcript inference elsewhere is
still present and the four fixmes make the boundary explicit. Installed/native
Canvas2D focus, actual provider launch/FS errors, and live pane/conversation
continuity need an approved release/relaunch; no installation or restart occurred.
The mobile worker's reported 35-session preservation is its existing deployment
receipt, not a desktop-candidate restart test.

Canonical integration proposal: compare all 26 current hashes and HEAD again;
first commit only those verified mobile WIP paths, then integrate desktop and
follow-up source commits. Apply shared documentation by three-way/content merge,
retaining the mobile receipt and issue history. If the preservation commit differs
in metadata from c81da18, compare its tree rather than forcing a fast-forward.
Require an exact tree comparison with this tested candidate before delivery. Do not force checkout, reset, stash unknown WIP, push,
restart, or remove active checkouts. A recovery bundle and patch series must remain
available independently before retiring either temporary clone. One final clean
canonical tree and end-to-end live acceptance are still delivery gates.
