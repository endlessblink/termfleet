# Isolated session authority v2 checkpoint

Baseline: `da3d5cb`, branch `codex/desktop-mobile-integration`. This is a source
candidate in the isolated integration checkout. Default authority remains shadow.
No canonical overwrite, release/plugin installation, application/daemon/bridge
restart, or real agent call occurred. Canonical HEAD remains
`73377910e817d8323396a545f7b8bb7b953a1b0d`; fresh comparison confirms all 26
original WIP hashes unchanged and TF-078 identical. Final clean canonical-tree
reconciliation remains an acceptance gate, not a completed result.

## Implemented producer and consumer contract

`shared/sessionState.mjs`, `sessionEnvelope.mjs` and `sessionSnapshot.mjs` are one
pure reducer, validated envelope and selector shared by desktop and Node bridge.
Identity is pane + provider conversation + publisher run + attachment epoch.
Duplicate IDs, old sequences, foreign bindings and competing lifecycle writers
cannot replace accepted state. Physical reattach requires fresh evidence in a new
local epoch. Leases rebase from persisted wall time into each consumer's injected
monotonic clock; reading a head cannot renew Working. Expiry means Unknown.

Finished requires explicit hook Stop or a non-summary vendor turn completion.
Idle, silence, process exit and tool output cannot manufacture it. Backend PTY
exit code 130, successful/manual exit and other failures project Interrupted,
Ended and Crashed respectively, fenced to the exact PTY and bound conversation.
Approval/input question IDs must match before resumption; unrelated answers,
loose Working and an unanswered Stop leave the pending question intact.

Task, Goal and Now retain separate full text and provenance. Operator Goals are
sticky; about-what outranks opening requests and agent Goals. Plans update only
from explicit task tools; unrelated stale sidecars cannot roll back a completed
item. TaskUpdate preserves plan order. Now preserves the last captured action
with a stale marker. No activity prose is promoted into a missing Goal.

`scripts/lib/session-event-journal.mjs` serializes per-pane transactions with a
short exclusive lock, persistent sequence and an append-only JSONL per pane,
conversation and run. It fsyncs the append, atomic head and directory. After a
crash between append and snapshot, committed records replay before the next
sequence is assigned; a partial tail is delimited without rewriting the log.
Dead lock owners are recoverable; live/unknown orphan locks fail closed with a
reported error. New conversation/run requires UserPromptSubmit or SessionStart;
late tools from the previous binding cannot roll it back. Native PTY creation
supplies a UUID publisher run; existing PTYs are not restarted to obtain one.

Codex/Claude hooks publish from their real hook payloads and derive compatibility
turn state from the accepted journal. OpenCode's source plugin uses the same
publisher for real plugin events, including permission.asked/replied,
question.asked/replied and assistant message completion. Idle alone is not
Finished; error/summary/foreign-session message updates cannot complete a turn.
Event schema references: [official plugin events](https://opencode.ai/docs/plugins/)
and [official SDK message types](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/v2/gen/types.gen.ts).
The supported installer symlinks the source plugin, resolving its helper. An
independently copied standalone plugin without the helper remains legacy; that
packaging mode does not provide v2. This task did not repoint the installed plugin.

Linux inotify watches atomic head renames; Tauri events carry filenames only.
Frontend ingestion validates the entire snapshot, checks exact provider/pane,
and rechecks PTY after asynchronous reads. Concurrent notifications schedule a
follow-up read. Initial and 30 s verification probes cover missed events/new panes.
The snapshot drives the workspace projection; task-rail replacement is gated by
activation, so shadow mode does not silently switch the legacy Task rail.

Header, sidebar, split, map, status bar and attention navigation have opt-in shared
selector paths. The map bypasses legacy title/Goal/Now holds in authority mode.
The bridge watches heads and reads the same selector; authenticated same-origin
SSE invalidates the phone fleet, with 15 s verification retained. Mobile cards
render the shared Task/Goal/Now, including stale last action and explicit
completion, with escaped text. PTY transport status stays a separate diagnostic.
Pinned operator Goals also reach the bridge through exact owned-pane workspace metadata, rather than folder matching.
Bounded in-memory shadow disagreements retain at most 64 metadata records and no
prompt/activity text. They compare legacy status/text decisions, not pixel output.
Desktop and bridge flags are independent, default-off; neither was changed here.

## Fresh proof

- 281 focused tests pass over state, projection, actual header/badge, journal,
  consumers, OpenCode adapter, navigation and legacy Goal/Task fixtures.
- Expanded unblocked source subset: **604 pass**. Exact argument list is exported
  as `expanded-command.json`. It explicitly excludes `agent-status-sidecar.spec.ts`
  and `agent-status-end-to-end.spec.ts`, which previously failed infrastructure
  restrictions. This is not a claim that the complete blocked suite passed.
- After final durable-write and hook-shebang corrections, journal/consumer/Codex
  producer subset: **50 pass**. The hooks also pass direct `node --check`.
- Actual mobile card function executes in a synthetic VM fixture; bridge and
  desktop hydrate one synthetic durable head with matching fields/lifecycle.
  This establishes source/decision parity, not browser/native visual parity.
- `npm run build` passes after the final frontend edits (10.30 s).
- `CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR=<existing isolated cache> cargo check --offline`
  passes; focused `cargo test --offline session_events::tests::head_names_exclude_paths_journals_and_temporary_files --lib`
  passes **1/1**, with 232 unrelated tests filtered out. No daemon smoke was run.
- Map/typography source verifiers, Node syntax and `git diff --check` pass.
- Node mobile-control and OpenCode-adapter test files pass **2/2** in the current
  runner. The separate inventory-parity file fails: it requires a reachable live
  daemon and live persisted inventory, unavailable in this execution environment.
  No real daemon was started to satisfy it.

## Original five fixmes and remaining gates

1. Pre-Working transcript purpose: stale image-paste narration fallback removed;
   original assertion active and passing.
2. Screenshot-path instruction: reject raw absolute artifact paths from legacy
   sidecar metadata before compacting; ordinary image-marked user requests remain
   valid. Original assertion active and passing.
3. Raw checklist compaction: validate the authored first sentence before shortening;
   preserve full raw text. Original exact compact-label assertion active and passing.
4. Older-run scoped todo: integrated ownership guard already passes; original
   assertion active without an additional production change.
5. Durable shell map title: source now prefers the live durable title and bypasses
   the stale stabilization hold for that title. The original browser assertion
   remains a fixme pending actual rendered proof; it is not claimed passing here.

The earlier expanded attempt remains **599 pass / 1 skip / 21 infrastructure
failures**, including subprocess `spawnSync node EPERM` and localhost `listen
EPERM`. Isolated Vite/Playwright startup on port 5189 was blocked; two host approval
requests timed out. No alternate route was used to evade those restrictions.
Earlier 10 browser / 104 Canvas / 52 mobile results belong to the previous
integration artifact and do not verify this candidate. Fresh read-only doctor reports one failure and zero warnings: the installed OpenCode plugin points to canonical rather than this candidate. The earlier missing Codex-turn warning is absent in the fresh result; no reinstall occurred.

Before activation: run the blocked actual hook/worker and rendered map/mobile
suites, isolated native Canvas2D focus and synthetic PTY continuity, then collect
shadow disagreements and soak/lease metrics. Verified Esc/Ctrl+C input intent and
agent disappearance while the shell PTY stays alive need native evidence; current
source only distinguishes actual backend exit outcomes and captured SessionEnd.
Legacy raw writers remain gated compatibility paths, not fully retired/lint-banned.
Do not mark TC-170–179 or TC-202 complete from this checkpoint.

Canonical Git promotion and retirement of temporary checkouts follow verified
acceptance and the separately authorized integration step. Preserve the full
independent Git bundle/patch and recheck canonical HEAD/WIP immediately before
promotion. Native/install proof cannot be supplied by this source artifact.

## Morning shadow correction — 2026-10-05

Handoff review found that8a2195a derived compatibility turn unconditionally.
The follow-up separates collection from activation: default-off hooks retain
legacy turn/reason; watcher retains legacy provider/session/task rail. Same-head
reads preserve local process/reconnect observations; explicit activation can
project a previously collected head. Two shadow regressions failed before the fix;
61 focused and608 unblocked source tests plus build11.14s/source guards pass.
Blocked commands were not retried. Exact implementation versus backlog, errors,
minimum owner actions and recovery are in `termfleet-morning-handoff.md`.

Morning source completion also includes all hook/journal/shared bundle dependencies,
Claude pre-tool typed input capture and OpenCode rejected-question resolution. The
actual temporary packaged graph imports and its plugin publishes a synthetic head;
no installation occurs. Final64 focused/611 unblocked source, build11.28s and fresh
offline Cargo check pass. Earlier61/608 are intermediate receipts, not latest totals.
