# TC-202 desktop navigation candidate — 2026-10-04

Historical initial candidate receipt. Current integration proof and corrected
baseline failures are in `desktop-mobile-integration-tc202.md`.

Status: **VERIFYING; isolated candidate, not installed or merged.** Baseline:
`73377910e817d8323396a545f7b8bb7b953a1b0d`. This adds desktop navigation and
specific status-authority corrections; TC-170–179 remain open.

## Operator behavior

- Ctrl+Alt+PageDown / PageUp: cycle the operator's recently focused terminals.
  The cycle freezes while modifiers are held and resets on modifier release,
  pointer interaction, or window blur. Background output never promotes a pane.
- Ctrl+Alt+Home: visit explicitly reported approval, waiting input, then completed
  work awaiting review. No automatic focus. Reviewing a completion acknowledges
  that event in its conversation. Importance is unknown; it is not inferred.
- Ctrl+Alt+N and CommandPanel: open New agent terminal. Choose provider, project
  folder, optional new folder, mission, Git isolation, and launch profile.
  Folder validation/creation only occurs on submit. Dedicated isolation requires
  an existing Git folder; it fails closed when unavailable.
- A terminal joins the chosen project even when another project filter is active.
  Within that project it goes below the existing stack. New projects go right of
  the existing terminals; only the new node moves to avoid collisions.

## Status corrections and evidence boundaries

1. Expired goals and missing status previously became confident Idle. They now
   become low-confidence Unavailable while retaining pane-owned durable context.
2. Delayed reports could redirect through a reused PTY or successor tab. Results
   now require the same tab, pane, active run, and provider conversation snapshot.
3. Older reports could replace newer Task/Now while retaining only the status.
   The whole newer summary is preserved. Conversation changes clear old task
   context and preserve explicitly manual requests.
4. Terminal runtime updates rebuilt a partial object, dropping Task/Now and review
   acknowledgements. They now preserve existing metadata before applying telemetry.
   The browser acknowledgement regression failed before this correction.
5. Codex rollout files containing only session metadata were classified Thinking.
   Unknown/metadata-only/malformed tails now return Unavailable. A synthetic Rust
   regression failed with Working before this fix. No private conversation text
   was used in a test fixture or copied into evidence.
6. Static task lists without an explicit turn event no longer imply Working or
   Idle. Node and TypeScript readers agree. Stop and permission events provide
   completion timestamps and waiting reasons for attention navigation.

Additive shared contract: `Tab.lastUsedAt` means operator focus/use, with missing
values unknown. `statusSummary.sessionId`, `updatedAt`, `completedAt`, and
`waitingReason` (`approval` or `input`) describe a reported event. Terminal
`reviewedCompletionAt` and `reviewedCompletionSessionId` acknowledge an event per
pane and conversation. Review acknowledgement survives persistence and output.
Controllers are local to each window. The mobile worker may consume this contract;
no mobile source was edited here.

This is not the complete v2 event reducer, lease/sequence model, or shared mobile
status authority. Native process absence and aborted/completed log distinctions
still need the broader TC-170 epic. OpenCode completion without an explicit
completion event does not enter attention just because a pane is Idle.

## Verification

All browser and hook fixtures are synthetic; no real agent, user project folder,
session restart, release installation, or daemon mutation was performed.

- Final focused Playwright suite: **155 passed**. Command: Playwright CLI with
  `/tmp/termfleet-navigation-unit.config.mjs`, selecting status-authority,
  terminal-navigation, new-agent-terminal, session-status, badge-liveness,
  status-poll-loop, status-poll-workstream-mirror, agent-status-local-sidecar,
  codex-status-hook, command-bar-focus.
- Expanded hook/status suite adding agent-status-sidecar: **179 passed, 3 failed**.
  The same three failures reproduce using unchanged baseline scripts extracted
  with `git archive HEAD scripts`: last completed task instead shows the first
  declared goal, and two about-what Goal fixtures return undefined. Tests were
  neither disabled nor weakened. These are still open under TF-032.
- Desktop-navigation browser suite: **4 passed**, Chromium, isolated port 5189:
  modal/cancel/focus, held MRU order/persistence, explicit project/placement, and
  attention without automatic focus plus persisted completion acknowledgement.
  Browser fallback is not native Canvas2D focus acceptance.
- `npm run build`, `verify:map-terminals`, `verify:typography`, Node syntax check,
  and `git diff --check`: passed.
- `CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 cargo check --offline --lib
  --manifest-path src-tauri/Cargo.toml`: passed.
- Rust lifecycle module: **9 passed, 1 ignored** (the live probe was not run).
- Candidate doctor fails the expected plugin-path check: the installed OpenCode
  plugin points at canonical source, not this clone. Canonical read-only doctor
  has one warning and no failures. Neither is proof this candidate is installed.
- Visual evidence: `desktop-terminal-navigation-tc202/new-agent-dialog.png` in the
  task evidence directory. It shows the browser dialog, not the dock application.

Required next verification is approved installation/relaunch followed by native
Canvas2D shortcut focus, dialog filesystem/provider/error behavior, and exact
pane/conversation continuity. No claim is made that all live sessions survived a
restart; none was performed. Native folder creation has an existing filesystem
check/create race; no rollback deletes or overwrites user content.

## Git reconciliation

Canonical checkout is
`/opt/example/local-path`.
It contains concurrent uncommitted TermControl/mobile work, including the shared
plan, registry, and regression matrix. It was inspected read-only and never
staged, reset, cleaned, or edited by this candidate.

Candidate is the isolated branch `codex/desktop-terminal-navigation` in the task
directory. Source/tests and evidence/docs are separate commits so source can be
integrated without overwriting concurrent plan changes. Patch and Git bundle
artifacts preserve the candidate before eventual clone removal.

One final clean canonical checkout remains a delivery gate: first finish and
preserve the mobile work, integrate the source commit, reconcile shared docs by
content, verify integration, then remove only the unneeded candidate checkout
after recovery and usage checks. A green candidate does not authorize discarding
another worker's changes. TC-201's earlier clean state is historical, not current.
