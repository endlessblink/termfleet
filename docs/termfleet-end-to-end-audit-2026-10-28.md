# TermFleet / TermControl delay and token audit — 2026-10-28

Audit status: reviewed across host resources, terminal transport, bot execution,
progress delivery, request intake, completion controls, instructions and usage
measurement. Repairs remain **in_progress**. This is diagnosis, not production
acceptance or a claim that all reported problems are fixed.

## What the evidence establishes

There is more than one problem. A runaway host process caused substantial memory
pressure; separate software paths drop progress messages and manufacture work from
machine instructions. These findings explain plausible parts of the reported
experience. They do not establish that every delay or unclear answer has one cause.

| Priority | Finding | Evidence | Current state |
| --- | --- | --- | --- |
| Immediate | Runaway path lookup consumed about 21 GiB and a full CPU core for over two hours | PID374425, `readlink -f /opt/example/local-path`, parent Codex2436155; RSS21913240 KiB | Exact lookup process terminated; its parent conversation and terminal daemon retained |
| High | Codex bot messages are read but omitted from running chat | Fake Codex stream: one intermediate message parsed, zero visible messages and zero running `said` entries; final reply delivered | TF-149; reproduced, not fixed |
| High | Progress command can report success without delivery | `termfleet-say` prints a success line; actual display depends on recognizing a top-level command summary, truncated to140 characters | TF-150; source/extraction proof, authenticated delivery unverified |
| High | Generated launch text becomes owner requests | Synthetic launch produced five owner items and blocked the first Stop | TF-115; reproduced, not fixed |
| High | Token measurements cannot yet establish savings | Current measurement contract distinguishes cumulative thread snapshots from observed intervals; interval correction is concurrently dirty/source-only | TF-147; no allowance or billing attribution established |
| Medium | Instructions/tool output create substantial context load | Global+repository instructions and continuation/tool rules total38673 bytes on disk; three selected lean-ctx descriptions total11725 characters | Size is proven; its contribution to tokens, latency or answer quality is unquantified |

## Host and running services

Observed at approximately17:08–17:24 Asia/Jerusalem (UTC+02:00).

Before intervention, memory was78 GiB total,60 GiB used,17 GiB available;
swap57/58 GiB used. The runaway process had21913240 KiB RSS and99.9% reported
CPU usage. Its exact command was a path lookup, not a work-producing build.
The target is a self-referential-looking relative symlink:
`~/.local/bin/claude -> claude/versions/2.1.241`; a bounded `stat` of the target
returned “Too many levels of symbolic links.” Do not rerun unbounded canonicalization.

Only PID374425 received SIGTERM. A subsequent process lookup found it gone.
Available memory first rose to38 GiB, then42 GiB; swap use later fell to46 GiB.
Memory pressure10-second averages fell from some9.89/full7.69 to0.00, with a
later sample0.05. These are host measurements, not a measured per-task speedup.
The broken Claude path remains unrepaired and could trigger another bad lookup.

The bridge is active: PID1257104, start16:31:13 IST, zero recorded systemd
restarts, approximately560 MB service memory. The terminal daemon is reachable:
PID2068834, six live sessions. Its1963 persisted session records are historical
inventory, not1963 running agents. Neither service nor the desktop was restarted.

At the later scheduling check, `vmstat` showed83% CPU idle. Agent weight20 is
a contention weight, not a CPU quota: idle CPU remains usable. Raising all
terminal priorities does not address model wait time or unnecessary continuations,
and is not supported by current CPU evidence. No blanket priority, model or
reasoning-setting change was made.

## Missing updates: two independent paths

### Bot brains

`termcontrol/bridge/bots.mjs`:

- `parseBrainLine()` returns `{ text }` for a completed Codex agent message.
- `runBrain()` collects that text and forwards the event.
- `Bots.brain()` records `said`, activity and session events, but omits `text`
  from the running message history and chat.

An isolated fake executable emitted a progress message, waited for a release
marker, then emitted a final message. While waiting, the parsed message existed,
the bot remained working, and neither running chat nor `said` contained it.
After release, one final reply appeared. This establishes an in-process delivery
gap without making a model request; it does not establish the loaded bridge's
exact source digest or a physical-phone result.

`runBrain()` also defaults to30-minute total and10-minute idle deadlines.
Its idle timer resets on stdout activity, not on a useful message delivered to
Noam. A process can therefore remain active without providing a visible update.
The deadlines are not themselves proof of a hang.

### Terminal fallback

`scripts/termfleet-say.mjs` only writes “Shown to Noam.” to stdout.
`termcontrol/bridge/feed.mjs` reconstructs the text from a tool summary;
`termcontrol/bridge/adapters/codex.mjs` truncates summaries to140 characters.
Short top-level calls are recognized. Nested/batched calls can fail recognition;
long calls can display truncated text. Successful exit is not a delivery receipt.
The terminal adapter separately supports structured assistant messages, so this
does not prove that all terminal commentary is dropped.

## Request intake and completion

`scripts/termfleet-child.mjs` generates launch instructions containing Goal,
Full instructions, bot registry and checkout context. `ownerTextOf()` in
`termcontrol/bridge/requirements.mjs` and `injected()` in
`scripts/termfleet-asks.mjs` do not distinguish that generated origin.
`captureItems()` records synthetic instructions; `stopProblem()` treats their
untaken items like outstanding owner requests.

The synthetic launch created five items and blocked the first Stop. A retry with
`stop_hook_active=true` was allowed, so an unlimited same-finish loop is **not**
established. `<hook_prompt>` is also accepted by both filters in isolation;
whether actual hook feedback re-enters owner intake remains unverified.
Current request-list observation also contained generated registry/path instructions.

## Token use and unclear answers

The resource fault cannot explain token billing on its own. Synthetic owner items
establish unnecessary bookkeeping and a continuation opportunity, not its account
cost. The audit itself also incurs context/tool overhead.

The installed token-drain skill points to `scripts/codex-tokens`, but that file
does not implement its documented interval/JSON arguments. Its source recursively
finds usage records, labels first input as fixed overhead, adds reasoning to
output, and assumes a cache price factor. Those operations are unsuitable for
the skill's current conservative measurement contract. No totals from that script
were used. A separately named analyzer was blocked by the tool allowlist; no
allowlist or protection setting was changed.

The current bot interval-recorder correction passes focused tests but is being
edited concurrently. Existing cumulative81M/140M observations in project records
must not be called post-cutover consumption. No new paid trial, quota estimate or
claimed saving is part of this audit.

The instruction stack is large and contains multiple output/continuation rules.
This is a plausible contributor to process-heavy or cryptic answers, but causal
proof is absent. `readable-replies.mjs` changes whitespace; it does not rewrite
meaning, so paragraph wrapping cannot fix unclear reasoning. This review did not
read private conversations or infer answer quality from them.

## Verification receipts

All tests below are baseline diagnosis, not approval evidence for a repair.

- `node --test termcontrol/test/token-monitor.test.mjs termcontrol/test/codex-completion-delivery.test.mjs termcontrol/test/requirements-ledger.test.mjs termcontrol/test/bot-question-scheduling.test.mjs`:64/64 pass; `/tmp/termfleet-audit-baseline.tap`.
- `node --test termcontrol/test/bot-side-reply.test.mjs termcontrol/test/bot-events.test.mjs termcontrol/test/readable-replies.test.mjs termcontrol/test/requirements-lock.test.mjs`:36/37 pass; `/tmp/termfleet-audit-delivery-baseline.tap`. Failing case: repeated same question after an answer expects two cards, gets one. These files are concurrently changing; do not attribute this failure to the audit.
- `node --test docs/termfleet-audit-baseline.test.mjs`:3/3 diagnostic assertions reproduce missing progress, synthetic owner items and hook-envelope acceptance; `/tmp/termfleet-audit-synthetic.tap`. These assertions deliberately document defects; keep this diagnostic outside acceptance suites and update it when the defects are repaired.
- `node docs/termfleet-audit-extraction.mjs`:bounded extraction/classification examples; no model calls.
- `npm run issues -- check`:registry valid before audit changes; rerun after recording this audit.

Relevant source SHA256 at observation: bots`d15ef211219e59b9292d989f1fcb05f83ea3533074cfb4a94828c042f3ecdc5c`, requirements`919f41dcd67ae8a05a3cd51f3cc18fccbab135c4f82730c9d5608345dbe9ecf9`, feed`a20e6406b12bfeddbe8ab60c67c12025fbe4cc3ad512786071ba7d0ffc320c68`, Codex adapter`0889120b1f3ebe5a41c5f32e962b3fe82c2bf53edd972de2f2d8733d1f493f70`, asks`d670a2f1a9f49b2bc246c9ec6666b18dbd8d25dcdc6bf0ae1a5b71395c9ea0d8`, say`ed7e012ed5c2d0b2726e6014a9f43b6837c24ad5105d2d592cd1465a346c5e41`.

## Concrete repair candidates and falsification checks

1. **Publish bounded Codex progress before completion.** Preserve message identity,
   distinguish progress from final publication, and deduplicate final delivery.
   A fake stream must show an update while still running, exactly one final, and
   retain existing action/approval guards. Then prove authenticated chat delivery.
2. **Give progress publication a real pane-bound receipt.** Nested, long and batched
   calls must either produce exact durable text or report failure. A successful
   shell exit alone must never certify visibility.
3. **Separate machine launch origin from owner requests.** Use explicit provenance,
   not a blanket filter for words such as Goal. Genuine user requests containing
   those words must still be captured. Generated wrapper and hook-envelope fixtures
   must add no owner obligations, with real task assignment preserved.
4. **Finish current interval-meter deployment and observe ordinary work.** Coordinate
   with its existing owner, retain terminal/conversation identities, use a proven
   drain, and compare aligned same-session intervals with unknown baselines excluded.
5. **Bound path lookups and repair the Claude symlink after verifying the installed
   executable.** Never guess a replacement or stop the parent conversation.
6. **Consolidate duplicated instruction/tool preambles only after ownership review.**
   Preserve requirements, approvals and verification. Exact reconstruction proves
   lossless size reduction; it does not prove account savings or answer improvement.

No production code was changed for these candidates. Unrelated dirty work was
preserved. No visible browser, desktop takeover, daemon restart, model experiment
or installation was performed. Authenticated live chat, physical-phone behavior,
installed release equivalence, actual token savings and improved task completion
time remain unverified.
