# Progress and exact corrections — 2026-10-28

Status: in_progress, shared agent-ops BUG-90. Production bridge activation and
ordinary owner-facing result remain pending; no universal token-savings claim.

Changes committed:

- 355afae / TF-115: generated private helper filenames carry explicit machine
  provenance. Intake excludes the marked generated shape and control envelopes,
  retaining genuine adjacent words, quoted examples, goals and attachments.
  Legacy unmarked wrappers are not guessed or bulk-cleaned.
- a964b65 / TF-149: a following work/different-text event establishes intermediate
  Codex text as progress. Completion claims/cards retain final publication checks.
  Matching progress promotes into one final visible reply without rewriting disk
  history. A lone untyped message is held until its role becomes clear.
- 31e6b2f / TF-151: clear short corrections bypass side-model paraphrase and go
  verbatim through the existing inbox once. Ordinary status/thanks/questions,
  attachments and explicit replies retain their routes. Delivery receipts remain
  queued or failed, never inferred read. Failed inbox fallback preserves the
  original text and reports whether next-turn retention succeeded. The side
  prompt permits requested verified paths and preserves exact names.

Candidate and falsifier were fixed before each acceptance run: intermediate
progress must be visible while a fake provider is held; final publication must
appear once; correction words must reach the inbox before any side response.
Initial progress regression1pass/2fail; completion-claim/bookkeeping follow-up
3pass/2fail; short correction regression11pass/1fail. These failures were observed
before their respective fixes.

Final combined checks87/87:

```
node --test termcontrol/test/bot-progress.test.mjs termcontrol/test/bot-side-reply.test.mjs termcontrol/test/bot-caller.test.mjs termcontrol/test/helper-request-origin.test.mjs termcontrol/test/asks.test.mjs termcontrol/test/requirements-ledger.test.mjs termcontrol/test/requirements-lock.test.mjs termcontrol/test/asks-not-requests.test.mjs termcontrol/test/bot-progress-server.test.mjs termcontrol/test/bot-unanswered-history.test.mjs
```

After the final ordinary-followup exclusion, side/server16/16 reran green.
Disposable real bridge, fake executable/daemon, synthetic account, headless
Chromium390/1400: intermediate progress visible before release and one visible
final after release. HTTP sends preserve finetune, finecut לא, and
התכוונתי לfinetuned with queued receipts. Fixture inbox consumption is synthetic,
not proof that a real model understood a correction. No provider inference,
real terminal input or real browser access was performed for these tests.
Helper goal/session compatibility22/22 and syntax/scoped diff checks pass.

Boundaries: earlier in-flight side prose may still reference older names; exact
transport does not prove the main model's semantic answer. This change does not
search for or establish the actual user project location. Ordinary live task
acceptance is still required. No main inference or paid audit trial was started.

`npm run doctor` found one separate stale desktop build failure and one keeper-age
warning; installed dock release verified, daemon retained. This bridge change
does not fix desktop release alignment. Broader known fixtures remain separate:
Claude deny-list expectation fails unchanged HEAD, requirements-bridge diagnostic
is preceded by caller-context refusal, four Claude child-launch fixtures produce
no request (cause unverified). These were not weakened.

Activation owner: existing TermFleet terminal a5ce7ba3-2c21-4183-96f9-74618b98772c.
Only that owner reloads the bridge after natural completion and source review;
daemon and conversation identities must remain unchanged. Latest requested
candidate31e6b2f; live loaded digest still needs read-back. Automatic review denied
real-browser inspection; user button approval remains pending. Disposable
headless verification is independent of that approval.
