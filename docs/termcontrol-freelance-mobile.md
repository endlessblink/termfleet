# TermControl Freelance Desk mobile — TF-078

## Current status and identity

Updated **2026-10-05, 04:39 UTC**: the original-dark ordinary-choice correction and its bridge
are deployed at `https://control.in-theflow.com/` through the existing protected
route. TF-078 remains **verifying** for owner/physical-phone acceptance and the
installed Claude acceptance. The external browser reaches the existing login;
authenticated production conversation inspection requires that existing sign-in.

The actual app is `termcontrol/app/index.html`, served by this repository's
`termcontrol/bridge/server.mjs` through `termcontrol.service`. Identity was
confirmed from the service, source and all seven supplied screenshots.
TalentDesk is a separate product. Its jobrunner/rejection work and other active
RoughCut, ImagineBox and agentkit work were untouched.

Implementation used the isolated clone
`/opt/example/local-path`, branch
`codex/termcontrol-mobile-freelance`, base
`73377910e817d8323396a545f7b8bb7b953a1b0d`. The owner rejected the first visual
candidate and explicitly approved deployment when ready to try it live.

## 2026-10-05 ordinary-choice correction: diagnosis and deployed proof

The exact new owner JPEG, Library `libfile_e6b3f365189c81919142527ab341a7b8`,
was materialized with its Library identity and inspected locally. Its highlighted
first ordinary option belongs to a three-question Claude form. It is a different
path from the custom-answer issue. The footer was also only navigation; its label
now says **Show answer choices** so it does not imply that navigation submits.

Read-only matching found one owner pane: its original question remains pending,
and no matching choice receipt/write audit was found. The existing six-second
gate rejects its hours-old `terminalVisibleTextUpdatedAt`. Desktop source confirms
that timestamp advances only when VT text changes. A fresh exact-pane `updatedAt`
now establishes observation of stable text, with the existing ten-second probe
cadence; global heartbeat alone cannot revive a stale pane. A post-input read
still requires content captured after that input. No desktop schema, core source,
branch or session was changed. Preserve these two existing timestamp semantics
when integrating the separate desktop branch.

The installed Claude 2.1.288 Select handler calls its answer callback on a digit
and advances a normal single-select question. The extra Enter was removed.
The same installed source shows a separate final review for multiple questions:
the adapter now renders its real answers and an explicit **Submit answers**
action with a distinct request identity. It does not automatically submit that
review or revive the first question. Daemon error replies are checked as errors;
terminal-write acknowledgment still is not provider acceptance.

Three focused guards fail before these fixes. The final **32 focused + 24
canonical** tests and TypeScript/Vite build pass. The disposable browser/HTTP
fixture clicks all three choices and the explicit final submit at 320/390/430/1280
px; it validates original header/footer bounds, duplicate/stale/error refusal
and confirmation only after the matching provider result. The provider is
synthetic: actual acceptance in the owner's installed Claude conversation was
not tested or claimed. No owner answer/calendar/task mutation was performed.

Five runtime files were deployed with per-file hash guards and backups:
`termcontrol/app/index.html`, bridge `screen.mjs`, `send.mjs`, `asks.mjs`, and
`server.mjs`. Bridge PID **3017411** is active. Installed version
**1791175109753-106037**, app SHA256
`416acb16f2191e26dceec6ff3ff5bf8b58306a60c2bb72354d5144d9798a6883`, matches
the tested source. Daemon PID **18932** and all **35** exact session IDs/PTY PIDs
were preserved. Login200/API401 and the disabled custom-answer flag were checked.
The owner's exact pane observation now passes read-only; the same original
question remains visible. Installed proof, baseline failures and backups are in
`/opt/example/local-path`.
Rollback must preserve receipt/audit history and concurrent work, restore only
these five guarded files, and restart only the TermControl bridge if needed.

Owner acceptance remains: refresh the existing protected phone page, retry the
ordinary option, finish the three questions and explicitly submit the review.
Keep TF-078 verifying until that actual provider/phone result is known. Free
answers remain disabled pending their separate installed-form acceptance.

## Owner-corrected scope: original dark shell

The owner rejected the broad light shell redesign. The original dark palette,
header, project-first fleet cards, and bottom view controls were restored from
the verified pre-deployment backup. The light inbox/search, top tabs and new
provider shell were removed. New visual rules target conversation content in
`main`: readable messages, Copy, native tables, inline questions and the recorded
day. RTL/input improvements and the backend safeguards remain.

The new screenshot showed a Read …/HANDOFF…md startup instruction as a giant
card title. It is now secondary inspectable context inside the conversation,
while the list retains its original project-first structure. Proven loader/hook
or explicitly marked transcript metadata stays collapsed with exact source and
debug Copy. Literal code/genuine answers and actionable errors stay meaningful.
Pending-answer navigation opens/focuses choices without sending; pending and
failure feedback scrolls into view. A screenshot cannot prove which real choice
was pressed or its final delivery, so that acceptance remains open.

### Last used contract

Explicit owner card/direct-link/history navigation records `POST /api/visit`.
Reload/reconnect, polling, agent output and heartbeat do not count as use.
Authenticated owner history persists in bridge `visits.json` across phones and
restart. The route rejects unknown/closed panes and writes no PTY input.
`GET /api/panes` publishes `lastUsedAt` in epoch milliseconds; unknown values
remain null and stable map-order ties are used. No past visits were fabricated,
no existing timestamps were reset. Exact desktop focus integration still needs
a verified per-pane owner-use field from its separate worker; existing activity
fields are not used as focus. Shared desktop core files were untouched.

## Native information and minimal adapter

| Information | Native mobile surface | Authority and limits |
| --- | --- | --- |
| Agent sessions, work state and requests | Original fleet, header, inline question | Existing per-pane bridge inventory/feed; provider identity remains visible |
| Scheduled fixed blocks and cached calendar events | Chronological agenda | `.state/live-timeline.json` and `.state/timeline-calendar.json`; read only |
| Open Today/overdue/week/later/undated items | Complete separate buckets | Existing export values; no inferred booked times |
| User/agent messages and pasted tables | Prose, lists, native rows, Copy | Escaped source transcript, narrowly filtered notices |
| Single-select questions, final review and permissions | Real request-bound buttons | Existing exact request identity, current rendered VT and durable receipts |
| Own answer | Dedicated saved editor in verified synthetic tests; disabled live | Installed Claude form/result acceptance remains pending |
| Unsupported forms and diagnostics | Terminal or disclosure | No fabricated native actions or submissions |

The bounded read-only adapter recognizes Freelance Desk by its existing
folder/generator marker. It rereads its export and calendar cache; it does not
run the generator, query Calendar, create tasks/events or conceal absent
FlowState coverage. All buckets and source provenance are retained.

## Answer contract and remaining decline diagnosis

The previous Type-instead control focused the generic composer and posted
unbound `text` without entering the native Other field. That could miss the
question. The supplied decline record establishes the outcome, not the exact
real keystroke sequence that caused it.

`POST /api/send` binds `{pane, askId, choice}` or `{pane, askId, answer}`, checks
current identity again before dispatch, and rejects generic text while a
request is open. Two-question identity includes the question index. Durable
receipts reserve before any terminal write; repeated clicks, reconnects,
concurrent requests and bridge restarts cannot repeat a recorded action. Only
an explicit pre-dispatch refusal permits retry. Hash/state/timestamp receipts
store no answer text and must be retained during rollback.

Raw ANSI scrollback cannot establish form focus. The custom Claude helper
requires the desktop's existing fresh exact-pane VT text, selects a verified
Other field, verifies a newer editable snapshot, pastes/read-checks the exact
answer and submits Enter once. It sends no Escape. Back/Escape/browser Back in
the phone editor are local and preserve the request draft. Very long answers
outside visible read-back and unknown layouts fail closed.

**Live custom answers are disabled by default.** Feed capability and server
refusal enforce this; a production-safe negative HTTP test proves no terminal
write. `TC_VERIFIED_CUSTOM_ANSWERS` was confirmed absent/off in the existing
service. Enabling it is not part of this deployment. A separately consented
disposable installed-Claude single/two-question flow must verify the exact
native form and final tool-result first. Custom Codex/OpenCode and multi-select
remain unsupported. The installed decline issue is not marked fixed from a
fake terminal.

A terminal write acknowledgment stays labelled as awaiting agent confirmation.
Only a matching transcript result containing the actual answer confirms it.
A declined request and uncertain delivery remain visible; the browser's saved
history is never proof of agent acceptance.

## Exact scoped files

Deployed runtime (12): `termcontrol/app/index.html`; bridge
`adapters/claude.mjs`, `adapters/codex.mjs`, `asks.mjs`, `choice-receipts.mjs`,
`desk.mjs`, `noise.mjs`, `paths.mjs`, `screen.mjs`, `send.mjs`, `server.mjs`, `visits.mjs`.

Regression files: `termcontrol/test/chat-rendering.test.mjs`,
`desk-contract.test.mjs`, `desk-http.test.mjs`, `desk-mobile.test.mjs`,
`experience-mobile.test.mjs`, `native-choice-http.test.mjs`, `visit-history.test.mjs`, `recent-mobile.test.mjs`,
`conversation-noise.test.mjs`. Existing conversation-noise/transcript-path and
canonical mobile guards also ran.

Documentation: `termcontrol/PRODUCT.md`, `termcontrol/DESIGN.md`, this document,
`MASTER_PLAN.md`, the TF-078 issue record and regression-matrix row.
Desktop React/Tauri/Rust implementation, authentication and deployment route
configuration were not changed.

## Fresh verification and delivery

Final focused suite (32 tests) and canonical verifier:

```sh
node --test termcontrol/test/desk-contract.test.mjs termcontrol/test/desk-http.test.mjs termcontrol/test/native-choice-http.test.mjs termcontrol/test/desk-mobile.test.mjs termcontrol/test/chat-rendering.test.mjs termcontrol/test/experience-mobile.test.mjs termcontrol/test/conversation-noise.test.mjs termcontrol/test/claude-transcript-path.test.mjs termcontrol/test/visit-history.test.mjs termcontrol/test/recent-mobile.test.mjs
npm run build -- --configLoader runner
npm run verify:termcontrol-mobile
git diff --check
node scripts/termfleet-issues.mjs check
```

**32 focused + 24 canonical pass**; installed source hashes match the exact tested
runtime files. TypeScript/Vite build passes with existing
chunk/import warnings. The runner loader avoids writing through the installed
dependency symlink. Host browser execution was required by the sandbox.
Synthetic 320/390/430/1280 px previews were inspected, including the original fleet,
inline questions, native day, copy/refusal, saved bilingual draft and reduced
keyboard viewport. Tests cover repeated choice, reconnect, stale question,
submission failure, no false confirmation, 44 px controls and no horizontal
overflow. No legacy live terminal-input probes were run.

Real HTTP fixtures launch an isolated bridge, fake Unix daemon, transcript and
fresh VT snapshot. They prove exact two-question delivery and refusal of
unverified custom dispatch. This is strong contract proof, not installed-Claude
or physical Android/iOS/Safari acceptance.

The current original-dark synthetic next-question screenshot is Library
`libfile_51a8e62019208191bdebb009e92d7785`, local
`.captures/termcontrol-mobile/choice-oct05/next-question-390.png`.
Original-dark fleet/conversation/day/keyboard/failed-choice views at all requested
widths were inspected. The earlier light review PDF is historical and rejected;
it is not evidence of the accepted design direction. Private screenshots stay
local and are excluded from shared previews.

## 2026-10-04 restoration proof and bridge-only rollback

The owner explicitly ordered live restoration. Six scoped runtime files were
checked against the previously deployed hashes, backed up and integrated.
Only the TermControl bridge restarted. The final installed app version is
**1791149423696-105112**, SHA256 `9be31cfe8536f7b69240cb7c7467066b8b9772bcc0a5ee4b94c4bbc92db74c36`; tested source hashes match.
Daemon PID 18932 and all 35 pre-update session IDs/PTY PIDs are unchanged.
The existing protected route/auth remains intact. The runtime custom-answer
flag is off and receipts/audits are retained. No real answer or planning mutation,
credential/network change, desktop/daemon restart, push or new exposure occurred.

Proof and the prior light-file rollback backup are in
`/opt/example/local-path`.
The original pre-first-deployment dark source remains in `deployment-v2/backup/`.
Rollback must compare current hashes and preserve later WIP/receipt history;
restore only scoped app/bridge files and restart only TermControl if required.
Never reset authentication, the daemon, desktop or planning records.

Next acceptance: refresh the actual phone page, verify restored shell,
choice/pending/refusal feedback, Copy/day and owner recent-use order; coordinate
an exact desktop focus field separately. Physical keyboard/Safari and a
separately consented installed-Claude Other-field/final-result flow remain open.
TF-078 stays verifying; custom dispatch stays disabled.
