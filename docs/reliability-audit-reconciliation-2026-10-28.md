# TermFleet reliability audit reconciliation — 2026-10-28

This is **one audit**, with 22 findings, not 157 independent repair requests. The
source audit is preserved below in its registered wording and order. Status is
**in_progress**: several critical paths still have unsafe or unproven behavior.
This report changes no production behavior and authorizes no provider execution,
credential migration, deployment, public publication, or spending.

## Evidence boundary

The external audit examined public main `a772f7f` by static reading only. Its
“CONFIRMED” labels mean source-path conclusions, not reproduced runtime results.
That baseline is old, but its claims must be checked individually. Some remain;
some have narrower improvements; one 404 claim conflicts with baseline source.

Current inspection includes dirty working-tree changes. HEAD at initial capture
was `cddb2c0`; SQL owner saved the integrated changes as `7cec758` during review. A commit ID
alone does not identify the inspected running system.

**Direct read-back during this reconciliation:** headless browser, existing local
iframe sign-in, GET `/api/action-evidence?bot_id=provider-context-readback-only`,
HTTP 200, bridge PID **733856**, loaded **2026-10-28T06:31:23.140Z**. Loaded digest
**3728977ec34d6d6c7660bb0462266c7d9f93ced1f17da1f0f9f0a6148f385006** matched
the ten source files enumerated at `termcontrol/bridge/server.mjs:91`: server,
bots, side-reply, events-db, action-evidence, provider-context, readable-replies,
requirements, helper-link, and scripts/lib/bot-caller. This establishes loaded
provenance for those files, not behavioral correctness, physical owner identity,
or authorization to use Claude. The sign-in path itself is part of F02.

Installed manifest was read directly: release
`44c6674cbe13-aa4517a48763-304bf167188e-7b45e62702f5`, binary SHA
`aa4517a48763ec6bbdb9db7e6258722ca1010eb3d58e553d8a0a06d719f49875`, build
2026-10-28 08:21:26 +02:00. Quota owner independently reports installed verifier
PASS. Direct daemon status returns reachable PID **2068834**, build
`1:1792765418313`, eight live sessions and 1,927 persisted records. It remains the
old daemon: the installed Rust launch guard is **not loaded**. No daemon was
stopped. Counts are observations, not an assertion that all persisted entries are
active terminals.

Registry reference **termcontrol** path checker passed, snapshot
`594651a1558612c8345dc858805fe4419268a6466f81a588e9cdb7b6e58167c6`.
That checker establishes path consistency, not deployment or messaging permission.

All test counts below are explicitly attributed. This reconciliation performed
source inspection and read-only diagnostics; it did not rerun peers' suites,
build, start a model, submit a cloud task, or reproduce dangerous live writes.

## Classification and owners

**F07 source freeze, after focused verification:** confirmation source/tests/report
are saved in `ef93b54`, scoped task/regression documentation in `ffdd65b`, and
source-only registry evidence in `d0b0104` (registry reference termcontrol).
Final independent review found no remaining blocker within this narrow scope and
read the actual50/50 TAP output; it did not rerun the tests. Fresh authenticated
GET200 still returns PID1271056, loaded07:22:14.391UTC, fourteen-module digest
`345f8862a730761d5fd8fb6b238dd49106224839d7f0b76ce0977d72d2f3ebe7`.
Current frozen disk digest is
`5dae9c577f55db50f71fa727c9d521a58170f39cf309b925ae1b37cb47d4ffe5`;
requirements SHA is `2a175c7906bab5e114368f10fc2165aac5542c69364aff7969f2bf677c47afce`.
The mismatch explicitly proves this patch is not loaded. Parent-coordinated
bridge-only activation and repeat read-back are the next deployment gate; no
restart or real owner verdict was attempted. All157 source fragments remain
registered partial with their original wording; existing isolation approval
and cloud/native-transfer gaps remain unchanged.

**F07 activation completed, superseding its pending-load note:** parent explicitly
authorized this one bridge-only graceful activation. Preflight compared every one
of the14 loaded-source inputs with saved69d725e and the frozen digest; no production
source drift was present. Existing bots were idle with zero queued messages and no
inflight/provider-switch work. The existing SIGTERM drain ran with0 HTTP requests
in flight and2 streams; systemd restarted only termcontrol.service. Authenticated
GET200 now reports PID1537005, loaded2026-10-28T07:55:19.756Z and exact digest
`5dae9c577f55db50f71fa727c9d521a58170f39cf309b925ae1b37cb47d4ffe5`, matching
the reviewed disk. Unauthenticated action read returns401. All4 terminal
id/pid/runtime-run triples and10 bot conversation hashes are unchanged; durable
queues remain0/0. Daemon2068834/build1:1792765418313 is unchanged. No owner verdict,
credential change, model start request or daemon restart was performed. The50/50
isolated suite includes genuine targeted synthetic app verdict/retry/broken/401;
no real confirmation was forged to prove deployment. Owner phone interaction is
unverified. Actual outputs: `/tmp/termfleet-f07-activation.log`,
`/tmp/termfleet-f07-loaded-readback.json`, `/tmp/termfleet-f07-focused.tap`.

### Bounded remaining-work handoff after activation

Current six assignments remain partial, with these specific gates:

- R-19277: existing owner approval of the protected account/credential isolation
  plan remains unanswered. The stored question is preserved unchanged; no repeat,
  self-approval, migration or new authority. This is manual_action_required for
  implementing the protected broker/account cutover.
- R-19278 and R-19279: guarded application routes and concrete isolation design
  exist; universal enforcement needs the same approved protected broker/agent UID
  isolation and protected single-use exceptions. This is the same approval gate,
  not a reason to repeat it or keep inventing implementation activity.
- R-19266 and R-19267: the scoped85-percent fail-closed policy/standing no-Claude
  override was proven by the quota owner. All-route assurance still lacks protected
  credentials and isolated identities; installed Rust guard is not loaded in the
  retained old daemon. Safe daemon maintenance/cutover and physical phone proof
  are additional runtime gates, not proof supplied by this bridge activation.
- R-19438: protected billing-incapable submit/result broker is not implemented and
  requires the existing isolation gate. Separately, no provider-supported
  bonus-only stop or supported result-only reader has been proven. Disabled paid
  Usage credits do not prevent consumption of the regular plan allowance. Owner
  approval alone cannot supply those missing provider capabilities; no cloud
  submission, upload, credit use or billing change is authorized here.

These six requests are not all solved by approval alone. No further credential or
cloud implementation is authorized while it remains pending. Independent audit
work can still proceed without that approval: this context/audit worker retains
F05/F18 read-only diagnosis of false Delivered labels and duplicate retry typing,
then candidate/regression design after checking current send/server ownership.
No new F05/F18 production edits or acceptance trial has been started. F02 owner
auth isolation, legacy F07 evidence/display paths and native transfer remain open;
SQL/action and quota evidence ownership stays as documented in the matrix.
Automatic recovery notices are context, not new owner requests or permission.
Do not repeatedly reopen the protected migration because a timer nudges it.

**Later coordinated activation:** direct authenticated GET read-back now returns
PID **1086383**, loaded **2026-10-28T06:59:41.541Z**, twelve-module digest
**8057029ea258d2902895e9e13a2e5f8d7f26e9559a6e0bf90f5674080cf422b0**,
matching disk. SQL owner expanded the signature to include bot-events and send;
send SHA is `96035d99ce97b2b82f4719df8ab164b2a412962f85115faca5783f2c4c9b443f`.
This supersedes the earlier bridge load for those modules. Daemon2068834 remains
unchanged, per activation owner. F03 isolated behavior20/20 and loaded provenance
are verified; no live prompt was answered. F06's later bounded fix removes side
bulk-resolution and preserves tracked payload for main review (owner55/55), now
loaded, but no universal semantic classifier or all-request completion guarantee
is claimed. The F03/F06 rows incorporate this later activation while retaining
their missing behavioral proof and the original audit wording in the appendix.

**Still present** means a current source path retains the reported harm; actual
incident frequency can remain unknown. **Source-only fix** means a specific source
improvement lacks its required runtime proof. **Deployed verified** applies only
to a named exercised behavior, never automatically to an entire compound finding.
**Unknown** names the missing evidence or disputed claim. Mixed rows retain the
open finding rather than rounding partial proof up to completion.

Quota owner: Claude quota guard, terminal `73bd2cec…/34cd1dea…` (TF-124/F01,
TF-127/F10). SQL/action owner: Answers from real actions, terminal
`303621aa…/785143fe…` (F08/F19, work projection and formatting). Context owner:
Keep context when switching, terminal `01e799aa…/ccf82a9f…` (TF-125/F14/cloud).
“Unassigned” below means a repair owner has not been established; it is not a new
task assignment. Existing owners retain shared-code control.

## All 22 findings

| Finding / priority | Current classification and exact evidence | Proof and missing proof | Existing owner / regression and repair candidate |
|---|---|---|---|
| **F01 — S1** Claude launch/quota | **Deployed verified, scoped; all-route guarantee unknown/incomplete.** `scripts/lib/provider-launch-policy.mjs`, `docs/claude-provider-protection.md:16-49`; new JS launch gates and independent five-hour/weekly latches exist. Standing rule denies all Claude. | Quota owner: policy/boundaries/router **27/27**, Rust policy **2/2**, cargo check PASS; live HTTP403 with fresh durable receipt `c9fd5439-7d75-403f-8134-b9d4f0ba897b`, loaded policy SHA `b5bedb8c46a5852d92783de148cef385dcb89783bcfd74adb906e53eb78f06eb`, daemon identities unchanged. Actual provider-request counter absent; old daemon guard unloaded; same-UID credential/direct-binary bypass remains. | Quota owner evidence transferred here; protected-broker/identity migration is design only and existing approval R19277 stays pending. Regress missing/stale/future usage, 84/85, independent windows, stale reset and every cooperative launch; isolated fake-provider counter required before any all-route claim. |
| **F02 — S1** owner-auth forgery | **Still present.** `termcontrol/bridge/auth.mjs:59,64` accepts absent or client-forged iframe header and mints owner session. Same source behavior in baseline. | Existing embed tests cover iframe success/remote rejection, not a protected owner boundary. Current read-back used this same local embed route; therefore it cannot prove human approval. No credential or approval exploitation attempted. | Unassigned security repair. Protected desktop bootstrap nonce, differentiated session authority and password step-up; tests missing/forged headers, replay, expired nonce, embed-cookie approval refusal. Same-UID writable code/credentials requires OS isolation, not a header check. |
| **F03 — S1** uncertain answer reported sent | **Deployed verified in narrow scope, TF-131:** isolated failure reproduced before production changes and fixed source now loaded. `send.mjs` answerScreenChoice rejects null/undefined/blank reads in both polling phases and returns uncertain with failed audit. | Before fix6pass5fail; after fix screen suite12/12 and adjacent receipt/vendor/send-once suites20/20. Reloaded ChoiceReceipts blocks another tap. Independent review found no blocker. Direct authenticated PID1086383 twelve-file digest matches disk including frozen send SHA `96035d99ce97b2b82f4719df8ab164b2a412962f85115faca5783f2c4c9b443f`. No live prompt experiment; actual human interaction remains untested. | Context owner owns only this function and screen tests, SQL owner confirmed no overlap. F09/F18 remain separate and open; no claim this fixes general wrong-prompt or text-retry risks. |
| **F04 — S2** queued receipt never revisited | **Narrow repair deployed, TF-133; natural late-worker incidence untrialled.** Existing30-second botEvents cadence revisits at most20 pending bot delivery receipts per pass with cursor fairness; exact live target/provider/session and structured user-input marker required. | Red SQL regression before fix; focused13/13 and combined46/46 pass, including actual CLI timeout, late marker, dead/wrong-session/assistant/tool rejection, SQLite reopen and duplicate polls. PID1271056 loaded07:22:14.391UTC fourteen-file345f8862a730761d5fd8fb6b238dd49106224839d7f0b76ce0977d72d2f3ebe7 matches disk independently. Actual authenticated retrieval of synthetic late receipt preserves queued history and covers both request items with session/byte metadata. | Received means provider input recorded, not model attention or completion. Canonical task assignments/status are untouched; assignment delivery suffix remains a historical queued snapshot. Null-session/non-bot CLI receipts, hook consumption, marks outside bounded tail or older than queue recording remain uncovered. No real worker input or closed-session mutation. F05/F18 remain open. |
| **F05 — S1** spinner counted as delivered | **Still present.** `termcontrol/bridge/send.mjs:165-184`: text prefix OR scrollback growth; picture-only `:116-119` also reports delivered after Enter. | Source proves heuristic, not actual worker receipt. No real message sent to reproduce it. | Unassigned delivery repair with F04/F18. Label typing separately; actual delivery requires target-bound consumed marker. Spinner growth, coincidental prefix and picture-only tests must never yield confirmed receipt. |
| **F06 — S1** side reply closes work | **Bounded source fix now loaded; semantic completeness unknown.** SQL owner removed side bulk markAnswered and preserves full tracked payload with actual queued receipt for authoritative main review. This supersedes the initially confirmed `bots.mjs:1804` path. | Owner final combined55/55 PASS; direct PID1086383 digest includes current bots. No claim every instruction is understood or completed; queued receipt is not worker acknowledgement. | SQL owner owns fix. PASS_ON:no regression with plain question and mixed multi-point imperative preserves open state and main obligation. Actual model semantic response and all request coverage remain unproven. |
| **F07 — S1** false completion/owner confirmation | **Deployed source verified for confirmation subpaths; whole finding remains open.** New locks and owner-attributed done require a verified signed, explicit positive verdict for the exact delivered request, newer than its delivery and from its bot chat; exact signed app verdicts are preserved. Agent-written `--noam-said` cannot confirm. CLI lock+done is atomic. Generic or ambiguous free text remains unbound. Arbitrary existing-file evidence, rejected-tool legacy marks and open legacy asks labelled Answered remain outside this patch. | TF-136: isolated original regression17/18 failing before production changes; review found mixed-batch/backdated-revision bypasses (18/20 before guards) and app retry regression (20/21 before correction). Final50/50 includes actual disposable authenticated headless verdict HTTP, repeated Works200 retaining original confirmedBy/lockedAt, broken reopening and unauth401; no real owner confirmation, provider call or live prompt input. Parent-authorized bridge1537005 loaded07:55:19.756UTC, fourteen-module5dae9c57 matches reviewed disk; authenticated200/unauth401.4 terminal triples and10 bot conversations unchanged, queues0/0, daemon2068834 unchanged. No real owner verdict submitted. | Context/audit worker owns narrow confirmation validation, coordinated with SQL owner (no overlap). New writer-generated recordedAt prevents caller backdating; mixed revision+confirmation batches refuse before append. Locked history is not retroactively revalidated; valid replay is a no-op. Activation/read-back complete for this source slice; physical owner trial and remaining F07 evidence/display paths stay unverified. F02 and same-UID source/key/direct-ledger edits are not isolated by this guard; generic genuine approvals without a signed target cannot be inferred. Keep remaining F07 evidence/legacy-display repairs open. |
| **F08 — S1** wrong conversation/helper attribution | **Deployed verified for exact correction; broader routes still open/unknown.** New `scripts/lib/bot-caller.mjs`, `termcontrol/bridge/helper-link.mjs` and coordinated caller changes replace parts of the old path. Historical wrong parent and shared-tool inherited identity were observed. | SQL owner: caller/helper/projection/formatting integration **71/71**; exact Hebrew worker same-session revalidated, authenticated observer correction200 followed:true and headless sidebar waiting-on-one-agent proof. Our current ten-file digest includes caller/helper modules. General arbitrary shell/hook identity consumption, reused pane, --near and >20-helper episode proof not all established. | SQL owner. Preserve live worker; no respawn. Regression explicit bot vs conflicting inherited pane/thread, unknown no-cwd-guess/no persisted binding, reused conversation rejected, 25 helpers retained, exact owner scope. Do not equate one repaired observer with universal identity safety. |
| **F09 — S1** stale approval types into another prompt | **Deployed provenance and isolated behavior verified in bounded scope, TF-132.** Claude permission dispatch now requires the permission independently parsed from the fresh daemon screen to have the same ID. Dated, undated and hook-only synthetic fallbacks cannot authorize a key. | Before fix, isolated actual HTTP bridge/daemon fixture returned200 and wrote Enter into a draft and shell for dated/undated vendor status. After guard29/29 focused checks pass: zero writes/no reserved receipt on refusal, unknown screen503, different menu409, recognized permission sends one digit, native typed-answer flow preserved. Independent review found no blocker. Independent authenticated GET200: PID1271056 loaded2026-10-28T07:22:14.391Z, fourteen-module SHA345f8862a730761d5fd8fb6b238dd49106224839d7f0b76ce0977d72d2f3ebe7 equals disk including savedb9b44bc guard; serverSHA76670f44da555527fd42967f84d6f71214c556342f324a3bcc05d320f7a02c02. SQL owner coordinated one graceful bridge activation; daemon2068834 unchanged. No real prompt input or provider/cloud call. Isolated29/29 checks prove bounded behavior, not atomic compare-write or universal context/financial isolation. | Context owner owns only seven-line server answer guard and disposable fixture; SQL owner confirmed no overlap. Actual human interaction remains untried. Vendor fallback may mask an MCP screen and conservatively refuse; unknown layouts require terminal review. Snapshot validation is not atomic compare-and-write; daemon-side identity-bound input remains open. No universal wrong-prompt guarantee. |
| **F10 — S2** stale waiting/reminder cards | **Deployed verified on served fixture UI; incident/physical-device proof missing.** Shared prompt lifecycle, exact identity/revision retirement in `5314c11`, server wiring in `985a420`. | Quota owner: lifecycle/reminder/headless **35/35**, actual served HTML with intercepted fixture APIs **2/2** at390/1600 widths; HTML SHA `d26a4b01d01fa19624b1dcf6961fab07a11a74236fd16e13985a9380a2b471eb`. Latest quota/prompt/token suites55/55. No actual Desk history touched; no physical phone trial. | Quota owner completed scoped change; context owner accounts remaining proof. Tri-state unknown/disconnected must retain history without active controls/reminders; reconnect restores same approval; delayed observation cannot retire replacement. Preserve existing ready trial, do not manufacture approval. |
| **F11 — S2** helper death not reported | **Still present / coverage incomplete.** Old closed-transition/followed-helper recovery claims require separate proof; new exact helper-link repair does not itself supply a durable death supervisor. | No proven working→missing→missing episode with one wake naming left-open requests. | Unassigned recovery repair, coordinate SQL helper owner. Two-observation close transition, exactly one target-bound wake and left-open IDs; followed helper must not be excluded. |
| **F12 — S2** crash loses queued work | **Still present in abrupt-crash scope; narrower graceful fix deployed.** Current bots preserves ordered queue including duplicates and shutdown side guard; this is not append-on-push durability for every in-memory structure. | SQL owner real isolated graceful service restart PASS; provider-context restart fixtures pass. No SIGKILL/power-loss proof for queue, side pending, handed/waitedFor/helperSeen or heap-before-RSS guard. | SQL owner owns graceful queue changes; crash durability unassigned. Journal on acceptance before reply, replay target-bound work idempotently; spawn second instance without closeDown and verify exact ordered messages once. Inspect sanitized service heap flags before asserting1GB cap. |
| **F13 — S1** untestable ready evidence | **Still present in legacy routes; structured path source improvement; 404 subclaim disputed/unknown.** `requirements.mjs:581-591` optional structured contract; `:493-498` local links allowed; `bot-testing.mjs:11` misses done/finished/works. Structured fields require expected/artifact match `:582-583`. | Baseline requirements `:504` and current `:505` reject non2xx; test `requirements-ledger.test.mjs:453` expects404 rejection. Need exact alternate browser-receipt path before accepting blanket404 claim. PC reachable is not phone reachable. | Unassigned readiness repair with SQL projection owner. One required normalized Try/expected/artifact contract across all callers; validate every actual Try URL and intended-device accessibility; reject mismatched good-evidence/bad-Try and local-only phone links. |
| **F14 — S1** provider context loss | **Deployed provenance + offline behavior verified, residuals still present.** `provider-context.mjs:55-145` captures all retained public records/ledger/attachments and stops over64KiB; bots `:1042-1137` persists reversible transaction, verifies receipt before continuation and preserves retry. New rows retain attachments. | Context owner commit `acb228e`; focused context/runtime **26/26**, prior combined provider/UI/restart35/35 and independent31/31 reported. Real fake Codex subprocess receives long stdin and resumes receipt session; no paid model trial. Current loaded digest includes module. **Still present:** defaultFill bots `:571-574` checks preferred provider; freshStartHandover/handoverText `:582-608` retains12-message clipping outside switch transaction; payload `provider-context:132-137` does not separately carry sideNotes; new target session, not target-old-session+delta. | Context owner. Existing bot controls only; native transfer freshness failure remains unresolved. Test side notes arriving during transfer and no missing delta; active-vs-preferred fill; interrupted external action idempotency; source lineage/compaction and envelope size. No promise of identical understanding, complete absent history, native migration, or zero duplicated external actions. |
| **F15 — S1** busy/prompt helper auto-closed | **Still present / exact live incidence unknown.** Time-since-record and idle cleanup must not be treated as proof of crash; recovery input can affect busy work. | Historical46 silences is not remeasured. Need current pending-tool/PTY-progress and approval-screen keepalive fixtures, plus actual safe episode read-back. | Unassigned recovery repair. Separate unknown/busy/stuck, consult pending tool and current screen before cleanup; say check rather than close. Regress15min pending tool kept, live PTY output kept, trust/approval prompt never auto-closed or typed into. |
| **F16 — S2** held messages lost/misrouted | **Still present with narrower stranded improvement.** `orchestrate.mjs:159-165` destructively takes then sends without rollback; send `:76-79` wakes sleep; no full conversation binding. `held-messages.mjs:119+` now archives stranded rows/reports sender. | Stranded handling does not prove consumption or protect wrong provider/session. No real held messages moved by this audit. | Unassigned delivery repair. Atomic lease/putBack on errors, bind provider/session, expose uncertain typed separately from received, bounded expiry/report. Fail send→rows retained; shell/reused target→zero writes; sleeping policy explicit. |
| **F17 — S2** status file name mismatch | **Still present.** `orchestrate.mjs:29-30`, `scripts/termfleet-team.mjs:103` use literal pane filename; `scripts/lib/agent-status-paths.mjs:44-45` uses FNV name. | No deployed fix or passing exact reader/writer fixture established. | Unassigned small reader repair, coordinate team CLI owner. Reuse paneStatusPath; round-trip writer→both readers, untaken-item guard sees exact pane and never falls back to folder. |
| **F18 — S1/S2** duplicate typing on retry | **Source-only fix; deployment pending.** A stable draft ID reserves a private on-disk receipt before possible terminal writes; uncertain outcomes remain reserved across process restart. Proven prewrite refusal permits retry. No automatic writeSession transport retry. Body/terminal conflicts refuse; ordinary sends without stable IDs refuse rather than bypass protection. | TF-137 baseline isolated1pass5fail before repair in `/tmp/termfleet-f18-red.tap`. Final focused24/24 in `/tmp/termfleet-f18-focused.tap`: actual disposable authenticated HTTP bridge SIGKILL/restart repeats no text; real two-process same-key race and process exit after fake text; failed Enter/unknown acknowledgement/picture attempt, local pane race, malformed receipt, completion rename failure and explicit prewrite retry. Independent read-only review found no narrow blocker. No actual terminal input or model call. | Context/audit worker, shared ownership checked; no active peer owns send/server. Same-key reservation is cross-process; different-ID same-pane serialization remains process-local and is not claimed. Native CLI sends/keys/choice receipts bypass this ordinary-draft helper. Existing first-use power-loss directory-parent durability, durable receipt retention/inspection lifecycle, physical owner retry and arbitrary same-UID tampering remain unproven/open. This is not proof of terminal consumption or semantic execution. |
| **F19 — S1** evidence absent/forgeable | **Deployed verified for scoped action evidence; generic ingestion vulnerability still present.** New action-evidence retrieval, tool/delivery outcomes and side/main evidence wiring exist. Generic `server.mjs:622-630` events/log remains before auth `:633`, without Origin/content-type protection. | SQL owner: evidence/reply/auth-route/restart30/30 + action-log12/12; actual fake Codex success/failed/unfinished; live scoped200, unauth401, crossbot exclusion. These prove new read route, not authenticity of legacy event input, all scheduling reasons, retention or Claude-only hook coverage. | SQL owner retains module; ingestion repair requires coordination. Authenticate producers, own Origin+JSON for browser requests, explicit trusted event provenance; distinguish observed/reason/hypothesis/missing. Foreign-origin text/plain stores nothing; unknown action reason stays unknown; timed prune without reopen. |
| **F20 — S3** cached-token accounting | **Still present.** `token-monitor.mjs:11,16,20,42`: Codex cached input absent; Claude cache included in input, exported as aggregate input. | Exact100–300× magnitude not remeasured; no quota derivation demonstrated from these totals. | Unassigned monitoring repair. Store uncached/cache-read/cache-create/output separately with provider semantics; fixture10 input+3million cache remains10 input and explicit cache count. Migration must not reinterpret historical aggregate as uncached. |
| **F21 — S2** contradictory work counts | **Still partial; specific old header claim obsolete.** Current app `index.html:3145` separates ready/done; `bot-request-panel.mjs:11` still excludes done/locked from active projection. Legacy terminal rail `index.html:3062,3081` combines open/answered/done labels; it is not the removed bot asks panel. `scripts/bot-scorecard.mjs:29,49` counts historical transitions and only today/yesterday Codex folders. | SQL owner71/71 integration and16/16 collapse tests; latest owner reports source commit `7cec758` plus live card/format/projection proof PASS. Exact expected totals for all old paths and physical phone remain unproven. Dashboard is not in ten-file startup digest. | SQL projection owner. Explicit active/to-try/confirmed totals; historical transitions labeled separately. Real-ledger ready→confirmed/reopen tests, legacy terminal labels and >2-day mixed-provider scorecard coverage. |
| **F22 — S2/S3** uncapped reads/stale terminal count | **Still present for bounds/fallback; blanket PNG claim contradicted.** `tail.mjs:55,60-63` reads full growth and retains oversized newline-free fragments; server `:183-190` uses unaged listPanes/pendingAsk when daemon unavailable. `monitor-cockpit-pane-screens.mjs:104-108,123,188` already prunes native PNGs, including in baseline; whether optional monitor runs is unknown. Ordinary hook writes use fixed temp+rename names, with orphan failure cleanup incomplete. | Direct daemon status8 live versus1927 persisted shows why record count cannot mean live count, not proof of historical234/6 incident. No pressure/retention experiment. Existing tail tests cover small growth, not huge deltas. | Unassigned bounded-reader repair. Cap bytes/fragment size and visibly resync, restrict fallback to known ownership and label unavailable; define active-reference-safe retention before deletion. Synthetic huge-growth/daemon-down/aged-file fixtures must bound allocation and preserve recovery material. |

## Prioritized repair candidates, not approval to execute

Additional exact source anchors from the delegated read-only review:
F04 `termfleet-team.mjs:330-341`, `delivery.mjs:191-243`,
`watchdog.mjs:75-83`; new `stall-wake.mjs:15-32` wakes an owner but does not
reconcile delivery. F11 `bot-events.mjs:212-223,283-303` and
`helper-recovery.mjs:18-23` do not persist a closed-with-open-work episode.
F12 `bots.mjs:1324-1329` remains memory-first, `:1960-1965` clears durable replay
fields before replay, `:1982-2001` saves the full queue on graceful shutdown;
server `:1576-1581` defaults to1536MB RSS, but current V8 heap flags are unknown.
F15 `session-status.mjs:169-175` still uses stale record time;
`helper-recovery.mjs:33-37` has prompt guards, while
`idle-cleanup.mjs:116-164` lacks a fresh screen check before closure.

F20 is category loss, not proof of a particular cost inflation. Explicit provider
cost is retained. Codex cached input is a subset of total input, so a repair must
not add it again; `token-monitor.test.mjs:81` currently asserts the flattening.
F22 PNG pruning was present even at the audit baseline; absence of an always-on
monitor remains a runtime question. These corrections preserve, rather than
silently rewrite, the original audit words below.

1. **Owner and status authority (F02/F07/F19):** close implicit owner authority,
   bind real confirmation to exact delivered work, and prevent untrusted events
   from being cited as observed action evidence. First write negative fixtures
   that prove no session/confirmation/event can be forged. Preserve existing
   phone/password and desktop access while designing the protected boundary.
2. **Input and delivery transaction (F03/F09/F18, then F04/F05/F16):** a target
   conversation and fresh prompt fingerprint must match immediately before any
   key; after text is typed, uncertainty is durable and cannot trigger automatic
   duplicate text. Prove zero writes on stale/unknown prompt and one text write
   across Enter failure, retry and restart. Use isolated fixtures, never an
   operator's actual prompt as an experiment.
3. **Recovery and context (F11/F12/F14/F15/F17):** preserve accepted work before
   acknowledging it, distinguish unavailable observations from closure, and
   carry side-note/delta state without rerunning completed actions. Coordinate
   shared bots/team/server regions with the existing SQL owner first.

Stabilize these bounded paths; this audit does not justify a whole-system rewrite.
The architecture already has useful durable ledgers and exact-scope evidence,
but overlapping legacy paths still overstate what those records prove.

## Audit ingestion and bookkeeping defect

One source message **f8b0e74f2498** became **157** registered fragments
R19478–R19634. Direct read-back verifies all157 exist, retain words, and are
**partial**, with none missing/new. They remain source material under this one
report; no heading, architecture line or sentence is a separate repair. No
fragments were deleted, merged destructively, or marked fixed/ready by this audit.

`requirements.mjs:146-150` fallback splits nonfiller lines/sentences into items;
`:127-144` numbered/bullet handling is another split path. Whole pasted-block
unwrapping `:163-172` can defeat the later exclusion, and bots capture directly
at `bots.mjs:1302,1438-1442`. Candidate: classify report/context before splitting,
preserve the immutable whole source and derive22 finding anchors as a projection,
not157 demands. Regression this exact report stays one audit with all words,
headings not tasks; embedded requests and genuine multi-action owner messages
must remain discoverable. Current grouped UI is partial mitigation, not repaired
capture semantics.

The normal CLI's failure was traced without changing behavior: original
`mkdirSync` for canonical `.lock` raised **EROFS**, syscall **mkdir**;
`requirements.mjs:186-199` catches every mkdir error and eventually reports
“ledger busy.” A separate unique directory probe succeeded, so that probe alone
was insufficient evidence for the actual CLI execution boundary. Existing CLI
with authorized sandbox escalation succeeded. No lock removal, alternate ledger,
identity spoofing, direct ledger editing or sandbox bypass occurred. Platform
candidate: preserve EROFS/EACCES distinctly, retry only EEXIST contention, and
provide a narrowly authenticated legitimate write route. Test permission error
returns immediately and never tries stale-lock removal.

R19638 read-back is **context**: Noam directly tagged Freelance-desk_dev, it
answers itself; Agent-Manager does not duplicate it. Existing online credits only,
no additional charges. No audit of or message to that bot was performed here.

## Explicit unfinished boundaries

Native terminal transfer, source freshness/dropoff recovery and universal
conversation ownership are not completed by bot provider switching. No native
successor or Claude model was launched. The launch guard does not provide
credential isolation; existing approval R19277 is preserved, not re-asked.

Cloud work remains preparation only. Supported same-session CLI submission is
not completed-result retrieval. No cloud session/upload/spend or billing change
was made. Account paid-credit disabling and bonus-only stopping are different:
no enforceable bonus-only cutoff or isolated billing-incapable broker has been
proved. See the existing `claude-cloud-review-boundary.md` proposal; prompts and
balance polling are not capability isolation. Physical phone checks, real-model
semantic preservation and safe loading of the new daemon guard remain unverified.

## Original registered audit words

The appendix below preserves each registered fragment verbatim and in original
order under the single source message. Fragment boundaries were introduced by
the defective capture path; original whole-message whitespace cannot be inferred
from them. This appendix does not upgrade the source audit's static claims to
runtime facts.

<!-- ORIGINAL-AUDIT-FRAGMENTS -->

<!-- R-19478 -->

TermFleet reliability audit — 2026-10-28

<!-- R-19479 -->

What was audited: github.com/endlessblink/termfleet, branch main, commit a772f7f (2026-10-26 20:36, "wip: dropoff handoff"; it changes only HANDOFF.md).

<!-- R-19480 -->

The checkout is a fresh public clone in a cloud container.

<!-- R-19481 -->

Method: static reading of the code and git history only.

<!-- R-19482 -->

Running the repo's code or tests was refused by this session's permissions, so no finding below was reproduced by running it.

<!-- R-19483 -->

"CONFIRMED" means the code path is unambiguous when read.

<!-- R-19484 -->

"HYPOTHESIS" means a runtime fact is still missing; that fact is named.

<!-- R-19485 -->

Every CONFIRMED item marked ✔ was re-read by me directly after the sub-audits reported it.

<!-- R-19486 -->

What this checkout cannot show:

<!-- R-19487 -->

uncommitted changes on the PC, the installed release, running services, systemd units, logs, ledgers or status files;

<!-- R-19488 -->

external hooks under ~/.claude / ~/.codex, and the authenticated phone view.

<!-- R-19489 -->

Runtime numbers quoted below come from the repo's own docs (mainly docs/bot-reliability-plan-2026-10-26.md) and were not re-measured.

<!-- R-19490 -->

Restrictions honoured: no money spent, no model sessions started, nothing published, pushed, merged, deployed or deleted.

<!-- R-19491 -->

No repo code was executed.

<!-- R-19492 -->

Architecture and authority map

<!-- R-19493 -->

Owner (phone PWA / desktop "Agents" iframe)

<!-- R-19494 -->

│ HTTPS, cookie session (auth.mjs) ── /embed mints an owner session for any loopback caller (F-02)

<!-- R-19495 -->

TermControl bridge (termcontrol/bridge/server.mjs, one Node process, ~15 timers)

<!-- R-19496 -->

├─ Bots (bots.mjs): one drain lane per bot, `claude -p --resume` / `codex exec resume`

<!-- R-19497 -->

│ ├─ side responder (side-reply.mjs): runs while the lane is busy, no tools

<!-- R-19498 -->

│ └─ bot state: <config>/bots/<id>/{bot.json, chat.jsonl, helpers.json, actions.jsonl}

<!-- R-19499 -->

├─ Request ledger (requirements.mjs): ~/.local/share/termfleet/requirements/ledger.jsonl (append-only, R-n)

<!-- R-19500 -->

│ └─ legacy #n "asks" re-parsed from transcripts (scripts/termfleet-asks.mjs), cached in ~/.cache

<!-- R-19501 -->

├─ Event store (events-db.mjs): SQLite agent_events, metadata only

<!-- R-19502 -->

├─ Pollers: bot-events (30 s), watchdog (15 min), helper-recovery (30 s), idle-cleanup (60 s),

<!-- R-19503 -->

│ held-messages (15 s), terminal-health (120 s), routines, rooms, sleep

<!-- R-19504 -->

└─ CLIs used by agents: termfleet-team (send/start/ask/close), termfleet-child (spawn), termfleet-asks

<!-- R-19505 -->

│ write into PTYs via the daemon socket; identity from env + /proc + cwd heuristics

<!-- R-19506 -->

Rust PTY daemon (src-tauri/src/daemon.rs, pty.rs): owns PTYs, snapshotSession, cold-restore/resume

<!-- R-19507 -->

Desktop app (Tauri/React): map, child-request poller (childRequestLoop.ts), screen snapshots

<!-- R-19508 -->

Agent status hooks (scripts/*-status-hook.mjs) → agent-status/pane-<fnv(paneId)>.json

<!-- R-19509 -->

External: agent-ops MASTER_PLAN (canonical cross-agent board), repo MASTER_PLAN.md (impl backlog)

<!-- R-19510 -->

Lifecycle step Authoritative state (owner) Persisted / recovered Retry What the owner sees on failure Does progress match evidence?

<!-- R-19511 -->

Receipt chat.jsonl line (bridge) File.

<!-- R-19512 -->

The bot's in-memory queue is lost on a crash and saved only on SIGTERM, capped at 20 none 👀 stays forever partly

<!-- R-19513 -->

Interpretation captureMessage splitter (bridge / hook) ledger.jsonl none.

<!-- R-19514 -->

A busy ledger means a silent [] nothing no: every sentence becomes an item

<!-- R-19515 -->

Tracking ledger fold, plus legacy #n asks ledger file plus transcript cache none contradictory counts no (F-07, F-08)

<!-- R-19516 -->

Assignment assign event from termfleet-team ledger none a "NOT delivered" line, only on a hard send failure no: queued counts as assigned

<!-- R-19517 -->

Delivery daemon writeSession ack sent.log audit only EPIPE only the phone says "Delivered" when scrollback grew no (F-05)

<!-- R-19518 -->

Acknowledgement [delivery D-…] mark in the worker's record checked once, within 25 s none "NOT read yet", forever no (F-04)

<!-- R-19519 -->

Execution status hook plus record mtime sidecar files helper-recovery nudge, once a recovery line, or nothing for closed/followed helpers partly (F-11, F-15)

<!-- R-19520 -->

Verification the agent's own termfleet-asks done/ready call plus a PC-side link probe ledger the bot report is held ≤2× "testing report is held" no (F-07, F-13)

<!-- R-19521 -->

Deployment release:install (outside the bridge) — — — not traced by the bridge at all

<!-- R-19522 -->

Live read-back none in code.

<!-- R-19523 -->

Issue notes say "authenticated production read-back unavailable" — — — no: 80/116 issues are parked in verifying

<!-- R-19524 -->

Owner answer signed owner-words, lock owner-words.jsonl — nothing; escalations are never rendered no (F-07) Prioritized findings

<!-- R-19525 -->

S1 = can spend quota against the owner's rule, falsely report completion or acceptance, or act on the wrong terminal.

<!-- R-19526 -->

S2 = loses or strands work silently, or shows contradictory status.

<!-- R-19527 -->

S3 = misleading metrics, inefficiency, or hygiene.

<!-- R-19528 -->

ID Symptom Cause (status) Evidence Reproduction (fixture) Repair Regression test Uncertainty

<!-- R-19529 -->

F-01 Claude keeps being used past 85% No 85% guard exists anywhere (CONFIRMED ✔).

<!-- R-19530 -->

Usage is read for display only.

<!-- R-19531 -->

A passed resets_at becomes "100% remaining, renewed", with no new reading.

<!-- R-19532 -->

Missing or stale data is ignored.

<!-- R-19533 -->

Reactive switching happens only after Claude's own rejection (=100%).

<!-- R-19534 -->

18 launch/continue paths are unguarded, including bot turns, fallback to Claude, retryDue/returnIfReset (timestamp-only), resumeInterrupted, helper-recovery, routines, /api/spawn, /api/provider, termfleet-child/team start, daemon cold-restore claude --resume, and handoff usage-limits.mjs:31-36,38-45; bots.mjs:305,370,881,892,944-949,1305-1368,1602-1616,1668-1691; server.mjs:632,1013-1037; pty.rs:2366; termfleet-child.mjs:334-358; termfleet-team.mjs:370-406 claudeUsageFrom({rate_limits:{five_hour:{used_percentage:90,resets_at:<future>}}}), then build Bots with a fake run and send a message.

<!-- R-19535 -->

run is called one fail-closed claudeAllowed() called by every launcher (E-1) usage-limits.test.mjs: missing → {ok:false,reason:'usage unknown'}; 11-min-old → 'usage stale'; 85 → refused; 84 → allowed; passed reset without a newer reading → 'reset not verified'.

<!-- R-19536 -->

bots.test.mjs: fake run never called at 90% what writes usage/claude.json and how often (outside the repo)

<!-- R-19537 -->

F-02 "Owner approval" can be forged by any local agent /embed refuses only when Sec-Fetch-Dest is present and ≠ iframe.

<!-- R-19538 -->

A loopback request without the header gets an owner session (CONFIRMED ✔).

<!-- R-19539 -->

Any provider flag or prefs file is also writable by agents (same OS user) auth.mjs:55-71, auth.mjs:24-31 loopback GET /embed with no header → 302 plus cookie require a per-boot secret held by the desktop for /embed.

<!-- R-19540 -->

Approvals and quota exceptions need a password step-up on a password session (E-2).

<!-- R-19541 -->

Do not rely on Sec-Fetch-Dest: curl -H forges it GET /embed from loopback without the secret → 404.

<!-- R-19542 -->

A POST exception with an embed cookie → 403 none for the code.

<!-- R-19543 -->

Real enforcement against same-UID agents is impossible at app level (see C-4)

<!-- R-19544 -->

F-03 Owner sees "Sent", but the prompt was never answered answerScreenChoice writes the digit.

<!-- R-19545 -->

If the screen read then fails (screenOf → null), !open(null) counts as success and a receipt ok:true is recorded (CONFIRMED ✔) send.mjs:308-332, liveness.mjs:114-128 call with screen:async()=>null.

<!-- R-19546 -->

Returns {ok:true}, writes ['1'] null → {uncertain:true}, never \r (E-3) assert r.uncertain && !r.ok, writes deep-equals ['1'], receipt ok:false —

<!-- R-19547 -->

F-04 "Saved in the queue; no confirmation the worker read it", forever The real ack signal (the mark in the worker's record) is checked only inside the CLI's single 25 s / 90 s window.

<!-- R-19548 -->

Nothing re-checks delivery:"…:queued".

<!-- R-19549 -->

The watchdog skips dead/idle panes.

<!-- R-19550 -->

No retry (CONFIRMED).

<!-- R-19551 -->

The Hebrew line is a model paraphrase of termfleet-team.mjs:316-332 output; no literal string exists delivery.mjs:200-230; termfleet-team.mjs:316-333; watchdog.mjs:79-80 ✔ assign an item with delivery:'D-1:queued', write [delivery D-1] to the record, wait.

<!-- R-19552 -->

Nothing changes a receipts pass in the request supervisor (R-7) requirements-ledger.test.mjs: the pass sets received:true; a closed pane with no mark → one wake and a not-received event whether Claude writes queued_command at enqueue or at consume (affects F-05 too)

<!-- R-19553 -->

F-05 Phone says "Delivered" for a message the agent never got landedInTerminal = first 60 chars on screen or scrollback grew.

<!-- R-19554 -->

A busy agent's spinner makes it true (CONFIRMED) send.mjs:165-187; index.html:5597 send to a pane whose scrollback grows → delivered:true rename to "Typed"; "Delivered" only after the mark is found (R-7) assert scrollback growth alone gives delivered:false —

<!-- R-19555 -->

F-06 Quick reply closes owner requests When the side responder's model says PASS_ON: no, markAnswered sets the ledger items to answered.

<!-- R-19556 -->

The main bot is told "already answered, do not repeat" (CONFIRMED ✔) bots.mjs:1552,1586-1598 a fake side reply returning PASS_ON: no → the item status becomes answered side replies append a note, never change status (E-4) bot-side-reply.test.mjs: status unchanged after PASS_ON: no how often instructions are misread as questions (needs the ledger)

<!-- R-19557 -->

F-07 Items show "done" / "Noam confirmed" without the owner (a) lock --noam-said "<agent text>" on non-screen items writes status done, "Noam confirmed" (CONFIRMED ✔).

<!-- R-19558 -->

(b) ownerConfirmation accepts any signed owner message id, not one about this item or after ready.

<!-- R-19559 -->

(c) done --evidence /etc/hostname passes, because evidence is not tied to the item.

<!-- R-19560 -->

(d) #n marks are parsed from tool-call input, so CLI-rejected marks still show "✓ Done".

<!-- R-19561 -->

(e) Open transcript requests render as "Answered" ✔ termfleet-asks.mjs:645-661,164,172; requirements.mjs:49-52,354-365,582-614; index.html:3023-3024 run lock R-1 --noam-said ok on a ready non-visual item → done, "Noam confirmed" --noam-said can only append a note.

<!-- R-19562 -->

Owner confirmation needs a message in this chat, after statusAt.

<!-- R-19563 -->

Count #n marks only on tool_result exit 0 (E-5) requirements-ledger.test.mjs: --noam-said → no confirmedBy, status stays ready; an older message id → throws; asks.test.mjs: a rejected done 3 leaves #3 open —

<!-- R-19564 -->

F-08 Worker attributed to another conversation Several confirmed pieces: (a) a bot's explicit identity is dropped whenever a pane was resolved for the caller ✔.

<!-- R-19565 -->

(b) Codex callers with no known pane are bound to "the only Codex window in the same folder", and that guess is persisted ✔.

<!-- R-19566 -->

(c) helpers carry no sessionId, so a reused pane's new conversation still reports to the bot.

<!-- R-19567 -->

(d) --near parents by folder prefix.

<!-- R-19568 -->

(e) the helper list used by events is cut to the last 20 entries ✔ termfleet-team.mjs:289; codex-pane-owner.mjs:118-139; bots.mjs:403,757; termfleet-team.mjs:68-76; childRequestLoop.ts:48-55 resolveCaller with env {TERMFLEET_BOT_ID, CODEX_THREAD_ID} and one Codex window in the cwd → returns that pane and writes a binding E-6 resolveCaller test: paneId===undefined and binding file unchanged; helper {paneId:'p',sessionId:'A'} vs pane {sessionId:'B'} → no wake; 25 followed entries → the started helper's finish still wakes HYPOTHESIS for (b): whether Codex exec tool shells re-export CODEX_THREAD_ID.

<!-- R-19569 -->

The repo's HANDOFF-before-2026-10-02-dropoff.md:58 shows it set without a pane

<!-- R-19570 -->

F-09 Possible keystrokes into the wrong prompt On the Claude vendor-status path, an approval is answered with \r and no live-screen match.

<!-- R-19571 -->

A stale vendor status turns Enter into "submit the draft" or "pick option 1 of a different menu" (code CONFIRMED, impact HYPOTHESIS) asks.mjs:44-57; adapters/claude.mjs:89; send.mjs:287-293; server.mjs:1185-1188 fixture: vendor status waiting, screen = input box → Enter is written require screenStillAsks(fresh) for :vendor: ids, else 409 vendor-permission-ask.test.mjs: guard false for '' and the input-box screen how often vendorStatus lags

<!-- R-19572 -->

ID Symptom Cause (status) Evidence Repair Regression test Uncertainty

<!-- R-19573 -->

F-10 Card "No longer open in the terminal" while the chat says "Waiting for your answer" Two sources.

<!-- R-19574 -->

The card settles from the screen only, and an unreadable screen (null→'') counts as "gone" after 2 looks ✔.

<!-- R-19575 -->

"Waiting" comes from record-based pendingAsk.

<!-- R-19576 -->

Reminders never check whether their card settled.

<!-- R-19577 -->

The next good read appends a new card, wake and push (CONFIRMED) bot-events.mjs:197-218,229; server.mjs:178,216,410; index.html:3874,5097 tri-state screen: null = unknown, so away is unchanged.

<!-- R-19578 -->

asking = waiting ∨ onScreen ∨ recordAsk.

<!-- R-19579 -->

Un-settle a recently away-settled card in place.

<!-- R-19580 -->

Render settled-card reminders as past (E-7) stuck-reaches-chat.test.mjs: 6 looks, readScreen→null, attention set → not settled.

<!-- R-19581 -->

Flap → cards.length===1, one wake which surface the owner saw.

<!-- R-19582 -->

The incident's chat.jsonl is needed

<!-- R-19583 -->

F-11 Helper dies or closes; its bot never knows; items stay "assigned" No →closed transition handling.

<!-- R-19584 -->

A followed helper's stuck wake is gated off by !h.followed.

<!-- R-19585 -->

helper-recovery requires alive (CONFIRMED) bot-events.mjs:47,176,237,257; helper-recovery.mjs:18,21 wake once per episode on working/stuck/waiting → closed (2 looks), naming leftOpen; drop the !h.followed gate bot-events.test.mjs: working → [] → [] gives exactly one wake naming the R-ids —

<!-- R-19586 -->

F-12 Lost updates after a bridge crash/SIGKILL In memory only: bot queues, sides.pending, waitedFor, handed, helperSeen.

<!-- R-19587 -->

saveQueue runs on SIGTERM only.

<!-- R-19588 -->

The memory guard is 1.5 GB RSS against a documented 1 GB heap cap, so V8 dies first (CONFIRMED code; heap cap HYPOTHESIS, the unit file is not in the repo) bots.mjs:536-549,1121,1694-1713; server.mjs:384,1453-1466 append-on-push queue file; persist helperSeen restart-safe-replies.test.mjs: second Bots instance without closeDown still answers the queued message the systemd unit and heap flags

<!-- R-19589 -->

F-13 Owner asked to check things he can't check Try links are probed from the PC.

<!-- R-19590 -->

localhost/LAN links pass.

<!-- R-19591 -->

A 404 counts as a browser receipt.

<!-- R-19592 -->

A Try line in the note is not checked when the evidence holds another link.

<!-- R-19593 -->

No expected result is required.

<!-- R-19594 -->

Terminal ready needs no Try.

<!-- R-19595 -->

Reply gate wording misses "done/finished/works" (CONFIRMED) requirements.mjs:441-510,588-596; bot-testing.mjs:11,20,42; termfleet-browser.mjs:39 reject loopback/LAN for phone items, check every Try link, require expect:, require HTTP 2xx for receipts bot-testing.test.mjs: localhost → block; 404 in note plus good evidence → error; no expect: → error which links the owner actually tried

<!-- R-19596 -->

F-14 Context lost on provider switch, chat says "carried the conversation over" switchTo always starts a new session on the target.

<!-- R-19597 -->

Handover = last 12 messages × 1,500 chars, open asks × 800, memory 6,000, all truncated silently.

<!-- R-19598 -->

Picture paths are not stored on chat rows.

<!-- R-19599 -->

changeProvider deletes bot.retry, the message the chat promised to answer, and bot-provider.test.mjs:85 enshrines it ✔.

<!-- R-19600 -->

Side notes are lost on a mid-turn switch.

<!-- R-19601 -->

A limit switch reruns the same text with no "cut off" note, so it can start a duplicate helper.

<!-- R-19602 -->

The fill check reads bot.provider, not active (CONFIRMED ✔ for switchTo/changeProvider) bots.mjs:507-526,915-949,1101-1112,1367,1381,1586-1588; memory.mjs:17,90-93 E-8; resume the target's own earlier session plus a delta; a [handover: N of M, K cut] header; re-queue the retry; prefix the cut-off note; post "carried over" only after the first reply restates the open ids bot-provider.test.mjs: L85 → the next run text contains the pending request; limit→backup→reset reuses the old Claude id; handover header present semantic understanding cannot be proven by tests, only checked against stated open ids

<!-- R-19603 -->

F-15 Busy agents told "crashed, close it"; helpers at prompts auto-closed (a) Stuck = 9 min with no record write, ignoring PTY output and in-progress tool calls.

<!-- R-19604 -->

The project's own data shows 46 Claude silences over 10 min in 3 days.

<!-- R-19605 -->

stuckNote says "Close it", and helper-recovery types into the busy agent.

<!-- R-19606 -->

(b) reasonToKeep never reads the screen, so a bot helper at a trust or approval menu with an idle hook is auto-closed after 5 min ✔ (CONFIRMED) session-status.mjs:163-178 ✔; orchestrate.mjs:94-96; helper-recovery.mjs:7,23-46; idle-cleanup.mjs:115-130,181-191 ✔ a pending-tool_use threshold of 60 min; the note says "check it"; idle-cleanup takes a screenAsks callback (E-9) session-status.test.mjs: pending tool, 15 min → 0.

<!-- R-19607 -->

idle-cleanup.test.mjs: screen asks → kept, "Waiting for you" live false-positive count

<!-- R-19608 -->

F-16 Held messages vanish or go astray delegate takes held rows, then sends without putBack on error ✔.

<!-- R-19609 -->

deliverHeld treats "typed" as done, with no receipt and no sender report.

<!-- R-19610 -->

A dead pane's held file lives forever.

<!-- R-19611 -->

Rows carry no sessionId/provider, so after a restore they could be typed into a shell or another conversation (H).

<!-- R-19612 -->

Paused (sleeping) terminals are woken by sends orchestrate.mjs:158-165 ✔; held-messages.mjs:56-66 ✔; send.mjs:77-80,95 putBack on error (E-10); store {sessionId,provider} per row; expire after 1 h with a report held-messages.test.mjs: send {error} → rows still held; a shell target → nothing typed real pane-id reuse with a different provider

<!-- R-19613 -->

F-17 Status files misread by two tools Writers name files pane-<fnv(id)>.json.

<!-- R-19614 -->

orchestrate.sidecarOf and termfleet-team untakenItems read pane-<id>.json ✔, so Goal/Task fields come back empty and the "you hold untaken items" hand-off guard fails open for terminal agents orchestrate.mjs:29-31; termfleet-team.mjs:100; agent-status-paths.mjs:45 use paneStatusPath(id) (E-11) orchestrate.test: a sidecar written via paneStatusPath is read back; untakenItems({selfId}) returns the item —

<!-- R-19615 -->

F-18 Duplicate typing on retry Text write ok, then Enter throws → error → sendOnce forgets the id → a phone retry types again.

<!-- R-19616 -->

sendOnce is in memory, so a restart re-types.

<!-- R-19617 -->

The in-flight lock is per process (CONFIRMED; cross-process interleave H) send-once.mjs:20; server.mjs:354; send.mjs:49,134-136 return {uncertain:true} after any successful text write; a per-pane lock file send-once.test: Enter throw → no second text write on retry —

<!-- R-19618 -->

ID Symptom Cause (status) Evidence Repair Test

<!-- R-19619 -->

F-19 Explanations can't cite evidence SQLite stores metadata only (lengths, tool names).

<!-- R-19620 -->

No bot or side responder ever queries it.

<!-- R-19621 -->

No column separates fact, declared reason, hypothesis and unknown.

<!-- R-19622 -->

The history hook is Claude-only and returns nothing for bots.

<!-- R-19623 -->

Pruning happens only at open.

<!-- R-19624 -->

Append errors are swallowed as "feed unavailable".

<!-- R-19625 -->

POST /api/events/log is unauthenticated with no Origin/content-type check, so a local browser page can forge events that agents then read as context (CONFIRMED ✔; exploitability depends on the browser's private-network protection) events-db.mjs:27-40,110-158; server.mjs:493-497,577-602 ✔; side-reply.mjs:29-79; termfleet-sql-history-hook.mjs:29-55 an assertion event type {kind:observed|declared_reason|hypothesis|missing, ref, claim, source} holding pointers only to ledger, agent-ops or MASTER_PLAN ids (no status column, so no competing task system); POST requires application/json and the own Origin; the side responder gets the last 30 min of events for its helpers; hourly prune events-db: text/plain with a foreign Origin → 403, nothing stored; prune with no reopen

<!-- R-19626 -->

F-20 Token "input" overstated ~100–300× Claude inputTokens = input + cacheRead + cacheCreation, summed per turn, sent as Langfuse input.

<!-- R-19627 -->

Codex drops cached_input_tokens.

<!-- R-19628 -->

Nothing derives quota from it (good), but any reader of these numbers is misled (CONFIRMED ✔) token-monitor.mjs:8-22,42,61 store {input,cacheRead,cacheCreation,output} separately (E-12) brainTokenUsage(...)[0].inputTokens===10 && .cacheReadTokens===3e6

<!-- R-19629 -->

F-21 Counts contradict The bot header "done" counts only unverified ready items and drops when the owner confirms.

<!-- R-19630 -->

Side rail "N done" includes unmarked requests.

<!-- R-19631 -->

The scorecard scans Codex only, two date folders (CONFIRMED) bot-request-panel.mjs:5; index.html:3061-3095; bot-scorecard.mjs:32-49 "to try" vs "done" labels; include done/locked bot-ledger-panel.test.mjs without mocking asks

<!-- R-19632 -->

F-22 Bridge memory spikes; "234 terminals for 6" Incremental tail reads all growth with no cap.

<!-- R-19633 -->

With the daemon down, every stale pane record is returned and pendingAsk runs on each.

<!-- R-19634 -->

Status files, .tmp files and PNGs are never pruned (CONFIRMED) tail.mjs:54-55; server.mjs:178-186; claude-status-hook.mjs:103-105; webview_snapshot.rs:41 cap growth reads; limit to workspace-owned ids when the daemon is down; retention job tail.

### TF-137 / F18 — Retaining a failed send without typing it twice — VERIFYING

Candidate: reserve a stable draft ID on disk before any possible terminal write, retain uncertain results after text/Enter or acknowledgement failure, and release only explicit proven prewrite refusals. The same request cannot change body or terminal; normal HTTP requests require a stable ID. Reservation is fsynced before dispatch, completion is replaced atomically; partial/corrupt receipts fail closed. No message body is stored in the receipt. The local pane lock is acquired before asynchronous preflight, and writeSession requests are not retried internally on transport failure.

Actual red baseline: `/tmp/termfleet-f18-red.tap` (1 pass, 5 fail before production repair). Actual focused command: `node --test termcontrol/test/send-idempotency.test.mjs termcontrol/test/send-idempotency-http.test.mjs termcontrol/test/send-once.test.mjs termcontrol/test/typed-answer-live-screen.test.mjs termcontrol/test/typed-answer-numbered-row.test.mjs termcontrol/test/vendor-permission-http.test.mjs` — 24/24 PASS, `/tmp/termfleet-f18-focused.tap`. Includes a real disposable HTTP bridge killed with SIGKILL and started again using the same temporary receipt directory, synthetic account, fake Unix daemon and same draft; exactly one text write and one failed Enter attempt. Concurrent actual Node processes dispatch the same key once. Unknown throws, incomplete receipts and injected completion-rename failure retain uncertainty. No real prompt input, provider or cloud call. Node syntax and scoped whitespace checks pass. Independent review found no blocker for process restart semantics.

Live activation/read-back pending: add send-once to the startup digest (15 modules); freeze reviewed source, require idle bots/empty queues and unchanged daemon/conversation identities, then use existing graceful bridge-only reload. No desktop release/daemon replacement is required for this bridge-only JavaScript slice. Preserve existing quota/cloud approval gates, all original audit words and F07/F09 evidence.

Boundaries: cross-process exclusion covers the same draft ID, not different IDs sharing a pane. Other native send/key/choice paths are outside this helper. Interrupted pending receipts remain uncertain indefinitely; no automatic resend, deletion or retention policy. A new receipt directory's parent entry is not fsynced, so first-use machine power-loss durability is not claimed. Failed-write evidence is uncertainty, never confirmation of consumption. Physical owner trial and all-route identity/security remain open.
