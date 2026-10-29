# Codex helper completion delivery

Status: **in_progress**. Exact candidate `26914f7f29cf8217e49b90286bb9d6756fd63382` is integrated
on base `4b0d52ca3aba01054d7ecf24a2334974629bc0da` with fresh focused35/35
source coverage. It has not been loaded by production; TF-145 remains verifying.

Codex `task_complete` ends a turn; it does not establish task success. Completion
identity includes owning bot, helper incarnation, provider, session, turn and event
kind. Identical output in separate turns remains separate. Process-local working
samples cannot reset this identity. Closeability is a separate once-per-result event;
historical event text requires fresh turn, approval, assignment and unsaved-work checks
before closing, even when the recorded snapshot was clear.

New helper registration captures an explicit source cursor, or a registration time
when the source is not available yet. New terminal creation captures its boundary
before spawning, preserving fast completions before the first poll. Legacy helper
entries establish a first-observation baseline and do not replay prior history.
Large initial histories checkpoint a bounded baseline scan at its original end.

The bot state atomically stores the identity, bounded result preview, exact source
reference, pending queue obligation and source cursor. File and directory fsync happen
before acceptance is returned or a follow is retired. Pending outbox reconciliation
repairs an interrupted memory enqueue without restarting. Queue entries remain strings;
receipt IDs come from exact accepted entries, never arbitrary marker substrings.
Trusted IDs travel through the running batch, inflight state and explicit retry.
Publication completes before a delivered receipt is saved.

Uncertain execution, interrupted publication and provider-transfer snapshots retain
the entire mixed batch, including owner messages, for explicit Retry. They do not
automatically replay model execution. Existing non-event provider/queue handling is
preserved. This provides idempotent durable admission under the existing **single
bridge writer** assumption, not cross-process coordination or exactly-once model effects.

Compatibility limits are explicit: each observation reads at most 8 MiB and returns
at most four completions; each record must be at most 1 MiB, including non-lifecycle
records. A valid oversized record, missing lifecycle identity, source replacement,
truncation or incomplete record stays unresolved and retryable, visible in the bot
summary. Nothing is silently acknowledged. Model-bound previews are at most 2048
characters; exact results remain referenced by transcript path and byte offset.

Verification commands:

```sh
node --test termcontrol/test/codex-completion-delivery.test.mjs termcontrol/test/helper-link.test.mjs termcontrol/test/bot-caller.test.mjs
node --test termcontrol/test/bots.test.mjs termcontrol/test/provider-context.test.mjs termcontrol/test/prompt-lifecycle.test.mjs termcontrol/test/stuck-reaches-chat.test.mjs termcontrol/test/held-stranded.test.mjs termcontrol/test/bot-close.test.mjs
git diff --check
```

The focused suite proves lifecycle parsing, bounded scans/backlogs, registration,
flickers/concurrent checks/reconstruction, distinct same-text turns, closeability,
approval protection, publication faults, persistence boundaries, queue recovery,
follow retirement, real provider-verification merging with a fake runner, and explicit
retry. It makes no live model calls. The broader suite currently passes 85/87 on both
candidate and unchanged baseline: existing Claude configuration expectation and
send-route old-prompt-retirement failures remain unchanged. Separate existing event
and follow suites retain their baseline repeated-question/caller-fixture failures.

Integration must preserve unrelated dirty source files and use only the isolated
candidate's unique commit. No service restart, worker input, real model experiment or
provider/security policy change is authorized by this document. The existing legacy
runtime admission/effect reconciliation and activation gates still apply. After an
authorized integration/release, prove the loaded source fingerprint, durable queue
reconstruction, fresh helper/follow/prompt behavior and actual automatic wake counts.
Read input, cached-input and output counters separately before and after; fixture
counts do not establish production tokens, billing or savings.
