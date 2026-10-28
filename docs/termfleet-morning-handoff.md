> Latest offline lifecycle continuation: see [session-lifecycle-source-checkpoint.md](session-lifecycle-source-checkpoint.md). Earlier remaining-source lists below are historical; native source connection and acceptance remain pending.

# Morning handoff — 2026-10-05

The isolated candidate extends `8a2195a`. It is **VERIFYING, not installed**.
The follow-up fixes shadow leakage, missing hook resource/copy dependencies, and explicit input-event wiring found during this handoff review.
No blocked commands were retried. No installation, app/daemon/bridge restart,
canonical overwrite, flag activation, publication or real provider session occurred.

## What is implemented

| Area | Source implementation | Evidence and limits |
| --- | --- | --- |
| Durable storage | One serialized transaction per pane; persistent sequence, append-only per-pane/conversation/run JSONL, fsynced atomic head/directory, replay after append-before-head crash, partial-tail delimiting, dead-owner lock recovery. Exact pane/session/run/epoch binding; late tools cannot revive Finished. | Synthetic concurrent-write, crash-tail, rebinding and ordering tests pass. No real installed-provider continuity proof. |
| Codex producer | Existing UserPromptSubmit, update_plan/create_goal, typed permission Notification, request_user_input before/after, tool and explicit Stop hook paths publish. Exact call IDs resolve questions when provided. | Pure hook builder and journal tests pass. Actual hook/worker subprocess suite is blocked. No fabricated SessionEnd producer or missing-ID answer inference. |
| Claude producer | Existing prompt, task/tool, PermissionRequest, AskUserQuestion and Stop paths publish; SessionStart/SessionEnd also publish. | Journal tests pass; actual subprocess/native hook continuity remains unverified. |
| OpenCode producer | Source plugin publishes vendor session/chat/todo/status/tool events, permission.asked/replied, question.asked/replied/rejected and non-error/non-summary assistant finish=stop completion. Foreign session events rejected. | Adapter/journal tests pass; Idle is not Finished. Source installer and bundled connector now symlink stable helper-equipped source; bundle includes the transitive hook/journal/shared modules. Arbitrary file-only copies without helpers remain legacy. No plugin install/repoint occurred. |
| Hook packaging | Tauri resource map and stable-copy manifest include the full imported graph, including journal/shared compatibility and existing handoff/owner helpers. Claude registration includes PreToolUse; packaged OpenCode uses the stable symlink. | A temporary copy of the actual resource map imports both hooks and journal, and its symlinked plugin publishes a synthetic durable event. No installer was executed. |
| PTY lifecycle | Actual frontend backend-exit callback emits exact-PTY/run-bound Interrupted for130, Ended for success/manual exit, Crashed otherwise. New PTY receives publisher-run UUID. | Pure exit adapter plus Rust compile pass. Desktop callback events are ephemeral, not appended by a durable process publisher. Existing PTYs were not recreated. |
| Desktop ingestion | Linux inotify head rename/close events, Tauri filename notification and async head reader; exact target/provider validation and PTY recheck; initial and30s verification reads; pending-read retry. | Rust watcher filename guard1/1 plus source tests pass. Actual Tauri/inotify/Canvas2D runtime path not exercised. No new daemon status-event socket implemented; chosen transport is file watcher → Tauri event. |
| Desktop consumers | Shared reducer/selector paths in map, split, sidebar, header, status bar and attention navigation; gated plan rail; stale Now retained; manual Goal precedence. | Actual header/badge versus bridge decisions pass. Rendered map/sidebar/status bar and native focus need acceptance. Legacy raw writers remain as compatibility paths. |
| Bridge/mobile | fs.watch head reader, shared snapshot projection, exact owned-pane manual Goal, authenticated same-origin `/api/session-events` SSE invalidation,15s fleet verification, escaped Task/Goal/Now cards and explicit completion. | Same synthetic head gives matching desktop/bridge text/state; actual card function runs in VM. HTTP SSE/backpressure/runtime, rendered phone and physical-device parity not yet proved. This is HTTP SSE, not a new daemon socket. |
| Shadow diagnostics | Bounded64 in-memory disagreement metadata, no prompt/activity text. | Metadata tests pass. No durable sanitized soak recorder/corpus or live disagreement/latency measurements collected. |

These are implemented source paths, not a claim that every status-epic item is
finished. Remaining **code work**, separate from permission: agent-process
disappearance while its shell PTY survives (currently lease expiry produces Unknown); explicit Esc/Ctrl+C intent→verify
observation; durable process/transport event recording; complete legacy writer
retirement/lint rule and durable sanitized soak recorder. Choosing actual native
process/input provenance requires a scoped synthetic native observation first;
do not substitute parsed output, silence or a guessed PID for an event.
TC-170–179/TC-202 and TF-032/TF-044 remain open/verifying. Installation alone does
not supply these missing producers or their proof.

## Shadow means collection, not replacement

Desktop selector activation is localStorage
`termfleet.experimental.sessionAuthority = on`; bridge and compatibility-hook
activation is environment `TERMFLEET_STATUS_AUTHORITY=on`. Both remain off.
In default shadow, the legacy path still owns displayed status/Task; v2 records
snapshots and disagreements. Source follow-up prevents hooks from changing legacy
turn/reason and prevents watcher collection from changing legacy provider,
conversation or Task rail. A repeated head preserves local exit/reconnect state;
explicit activation can apply that same head without waiting for another event.

`8a2195a` had unconditional compatibility-turn derivation; this follow-up corrects
it. Two focused tests failed before the gate and now pass. This is not a promise
that the whole candidate is bit-for-bit identical to canonical: intentional
legacy status/Goal/title fixes in the candidate still apply if later installed.
The installed application itself is unchanged by this isolated work.

## Two remaining Goal/Now defects

| Defect | Current answer |
| --- | --- |
| Legacy screenshot-path instruction promoted into Goal | **Fixed in source and its original pure assertion passes.** Reject raw absolute artifact paths from sidecar metadata before shortening. Ordinary image-marked user requests remain valid. |
| Durable shell map activity becomes Awaiting command/Search or stale prompt text | **Source precedence corrected; rendered acceptance still open.** Live durable title wins and bypasses stale title stabilization. Original `map shell header uses durable activity instead of stale transcript summary` remains a browser fixme. Its full title/Now/no-task-rail assertions are not claimed passing. |

Other original pure fixmes (pre-Working narration, authored checklist shortening,
older-run scoped todo) are active/pass. Shared v2 Now no longer uses prose to
invent Goal and retains dimmed last action on lease expiry. This does not replace
proof of the exact rendered legacy map defect.

## Navigation and New Agent

- Ctrl+Alt+PageUp/PageDown: focus-based MRU with frozen order while modifiers are
  held; resets on release, pointer action or blur. Background output never promotes
  a tab. Current MRU is tab/card-based and restores its selected pane; independent
  MRU for every split pane is not implemented.
- Ctrl+Alt+Home: explicit approval, input and completion-awaiting-review targets;
  no automatic focus; completion acknowledgement is per conversation and survives
  telemetry/persistence. Both legacy and gated v2 selectors exist.
- Ctrl+Alt+N / CommandPanel: New Agent dialog with provider/folder/new-folder,
  mission/isolation/profile; submit-time validation, explicit chosen-project
  grouping, placement below its stack/new project to the right. Dedicated isolation
  fails closed without an existing Git folder. No user project directory was created.
- Current source guards pass. Earlier10 synthetic browser checks and104 Canvas
  checks belong to the pre-v2 integration receipt; they do not verify the current
  changed candidate. Native Canvas2D shortcut focus and real filesystem/provider
  success/refusal need the private native fixture and later installed acceptance.

## Exact blocked attempts and categories

All commands below used
`/opt/example/local-path` as cwd.
Raw retained command/exit/output receipts are exported as
`termfleet-morning-handoff/blocked-command-receipts.json`; no retry was made here.

1. Expanded source command was `node_modules/.bin/playwright test
   --config=/tmp/termfleet-v2-unit.config.mjs` plus32 relevant specs. Exact argv was
   built by sorting the spec filenames from
   `../desktop-mobile-integration-tc202/status-header-tests.log`, then appending
   `tests/unified-session-state.spec.ts` and
   `tests/unified-session-projection.spec.ts`. Its receipt contains the exact
   Python wrapper. Result:599 pass /1 skip /21 failures. Actual child operations
   are `spawnSync("node", [hook-or-worker-path])` and status server
   `node scripts/agent-status-summary-server.mjs node scripts/agent-status-summary-sidecar.mjs`
   with synthetic XDG data and port38217. Worker diagnostic returned
   **`spawnSync node EPERM`**; tests saw empty stdout/JSON parse failures. Server
   tests timed out with **server did not announce an endpoint**; no successful
   child-server/HTTP result exists. These failures are retained, not waived.
2. Browser command: `node_modules/.bin/playwright test
   --config=/tmp/termfleet-integration-combined-browser.config.mjs`.
   Result: **config.webServer could not start, exit1**. Its exact child command,
   also diagnosed directly, was `node node_modules/vite/bin/vite.js --host
   127.0.0.1 --port 5189 --strictPort --config
   /tmp/termfleet-integration-vite.config.mjs`. Direct result:
   **listen EPERM: operation not permitted 127.0.0.1:5189**.
   Browser assertions were not reached. No new Chromium/Canvas result is claimed.
3. Two out-of-sandbox host approvals for the isolated expanded tests timed out
   during automatic review. This is **approval-review timeout**, not a completed
   unsafe-action refusal, owner rejection, or successful host run. Retained
   thread receipts do not expose the exact escalation argv; it is not invented.
4. Live inventory command: `node --test
   termcontrol/test/mobile-control-regression.test.mjs
   termcontrol/test/inventory-parity.test.mjs
   termcontrol/test/opencode-adapter.test.mjs`. Two files pass; inventory file
   fails and requires a reachable real daemon/live persisted inventory absent
   here. Category: **missing live prerequisite**, not a sandbox approval denial.
   Separate two-file source run passes. An earlier unsupported
   `--test-isolation=none` attempt ran no tests; that flag was removed.
5. Read-only `node scripts/termfleet-doctor.mjs`:1 failure,0 warnings.
   Category: **installed plugin path points to canonical rather than candidate**.
   No install/repoint occurred. This is not a failure of the source reducer.

Native acceptance was **not attempted**, so it is pending authorization/access,
not a recorded rejected command. Source tests and Rust compilation succeeded.
Do not classify all remaining runtime checks as denied or claim approval fixes
unimplemented code.

## Fresh proof and Git recovery

Base checkpoint8a2195a:604 unblocked source pass, final50 producer/consumer pass,
frontend build, offline Cargo check, watcher Rust1/1, mobile source files2/2,
map/typography/syntax/diff guards. Final morning follow-up:64 focused and611 expanded
unblocked source pass, build11.28s, fresh offline Cargo check and
map/typography/syntax/diff guards pass. Packaging/input guards first reproduced
three failures; the actual temporary packaged import exposed an additional missing
handoff helper, also corrected.
The same two blocked hook/HTTP specs remain excluded. Rust source is unchanged;
the earlier Rust1/1/check applies to it. No counts are added together as distinct tests.

Candidate chain after canonical7337791:
`c81da18` preserve26 mobile WIP → `6439d78` navigation/dialog → `a10c91d`
Goal/ownership/missing-evidence fixes → `da3d5cb` integration receipt → `8a2195a`
durable authority/consumers → shadow/packaging/input follow-up recorded by this handoff commit.
Branch is `codex/desktop-mobile-integration`; isolated tree is committed/clean at
export. Original8a bundle/patch/manifest and21 hashed evidence files remain intact
in `session-authority-v2-evidence`. Follow-up independent bundle, patch series,
logs and manifest are exported in `termfleet-morning-handoff` with final commit ID.

Canonical stays at73377910e817d8323396a545f7b8bb7b953a1b0d with its26 original
WIP files preserved and TF-078 unchanged. It is not clean. Do not retire temporary
checkouts before final canonical acceptance and verified independent recovery.

## Smallest pending owner actions, in order

- [ ] Authorize **one host-run session limited to the isolated candidate and
  synthetic/tmp data**, allowing Node child processes, loopback ports5189/38217
  (and ephemeral loopback ports for synthetic mobile fixtures), and Chromium.
  Re-run the two excluded hook/HTTP specs and rendered map/navigation/mobile
  guards with unchanged assertions. This needs no installation, canonical write,
  real agent call or owner-daemon restart. Use the retained configs/receipts;
  do not use live5177 or broaden access to private provider transcripts.
- [ ] Authorize a **private native synthetic acceptance run**: private Xvfb,
  disposable XDG data/runtime and separate daemon/socket, rebuilt candidate;
  exact Canvas2D shortcuts, lifecycle/watcher/provider fixture and dialog refusal
  checks. Canonical `verify:canvas-live`/`verify:standalone-daemon` scripts provide
  private-profile scaffolding but do not by themselves test all TC-202 shortcuts
  or missing process/input producers. No existing conversation may be resumed twice.
- [ ] Complete the listed process/input/recorder source gaps against that observed
  synthetic signal, then collect shadow disagreement/lease/latency soak proof.
  Do not activate v2 merely because source tests pass.
- [ ] **Only after acceptance**, separately authorize release/plugin promotion,
  actual dock/phone acceptance and canonical Git reconciliation. Recheck canonical
  HEAD/WIP hashes, preserve new work, integrate reviewed commits, verify the sole
  canonical tree clean, then retire unused clones with recovery retained.
  No installation/restart/promotion is requested or performed by this handoff.
