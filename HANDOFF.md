# TermFleet continuation — 2026-10-02 19:58 Jerusalem

Status: **in_progress** overall. TF-072 board repair is **complete/resolved** with actual installed bidirectional wheel proof. TF-069 grouping source is installed; brainiac and freelance now each have their own group. Assembly-line disappeared during final UI-only startup cleanup, so the original three-heading grouping read-back remains incomplete. Continue the newly uncovered TF-018 terminal-loss investigation safely. This is a handoff from Codex to Codex, not a helper task.

## First command and exact next work

Run `git status --short`, read this handoff and `/home/endlessblink/.codex/CONTINUATION_CONTRACT.md`, then `npm run issues -- check` and show TF-018, TF-069 and TF-072. Inspect source around `workspace.ts` hydration line2295 and live reconciliation2624 before doing anything to runtime. Do **not** relaunch or stop anything again until startup kill behavior is understood and guarded. The canonical daemon PID1515447 must survive. Current app PID1730900 runs the final release.

Concrete next candidate, already designed but NOT implemented: remove `daemon_kill_session` side effects from hydration/live-reconciliation branches which match timeless closed-session/provider sets, retaining their card-exclusion `continue`. Keep direct explicit close teardown intact. Reason: startup currently interprets unproven historical close records as fresh destructive authority over live PTYs; card exclusion can preserve prior closed-card protection without killing a live process. Regression-first proof: hydration/retry given a live session matching a closed ID/provider emits ZERO kill calls and still excludes its card; clicking close still persists the exact close record before killing only that exact clicked PTY, with sibling survival. Existing `tests/workspace-hydration.spec.ts` around1272 covers closed-card exclusion but does not audit kill calls. Add hydration and live-reconciliation mocks/audits, then read final candidate critically before mutation. This is a candidate, not an approved safety claim. Never weaken duplicate live writer protections.

## User requests, corrections and authorization

Original prior-instance user: “tasks dont load on the termfleet' status board view”. Later: “now the all projects appearns looks broken + all projects is not really usefull to me and I prefer a good looking project selector + a most used 5 prohects that updates + latest 5 projects that updte etc. use impacable design”. This instance began: “Read .../HANDOFF.md. It is a handoff from the previous instance: continue exactly where it left off, and start by confirming what you understood.” Then “go”, authorizing the previously pending UI-only dock relaunch.

New reports: freelance under content-creation: “again an incorrect group. freelance should be in its own group”; board screenshot: “cant scroll up and down here”; brainiac/assembly-line screenshot: “here too, each should be in their own project... diffrent project folder = diffrent group”. This last instruction overrides the old regression requiring a concrete project's original ownership to survive a genuine live move into a different separate folder. Preserve ancestor/ordinary nested browsing, scratch and no-live handover rules.

User most recently answered YES to: “The final scroll check keeps losing the board because the app switches back to Map. Can I use the TermFleet window for 30 seconds to verify scrolling up and down?” That check is DONE. They said “doesnt seem like you are doing anything” while wheel capture ran; immediately explained active capture, then reported successful actual top/bottom/top proof. Do not repeat the finished board check or interfere with their view without need. They know seven terminals disappeared and the cleanup cause is being investigated. No daemon restart or automatic resume has been authorized/performed. UI-only relaunch authorization persists but avoid one now because observed cleanup is destructive.

## Delivered implementation and evidence

TF-072 original files:
- `src/lib/masterPlanTasks.ts`: recursive paired Markdown unwrapping for IDs/title, PENDING todo; differently shaped Completed header resets and absent status cell handling prevent undefined.trim; actual claude-and-conquer parses137tasks,45done,74todo,17inprogress,0blocked,1unknown.
- NEW `src/lib/projectBoardHistory.ts`: validated bounded100 localStorage history key `termfleet.projectBoard.history.v1`, selected root, visits/lastOpened, top5 most-used/recent only available roots; polling does not increment visits.
- `src/components/ProjectPlansBoard.tsx`: selected-project-only board, searchable selector, frequent/recent project navigation, selected totals, filtering, refresh, fallback persisted selection.
- NEW `src/components/ProjectPlansBoard.css`: restrained Rubik/dark responsive layout; scroll fix constrained grid rows/columns, minheight0, bounded main overflowyauto. Narrow<=600 sidebar natural capped220 first row, main remainder. Flex baseline had task pane8436/8770px inside800px workspace.
- `src/hooks/useMasterPlanTasks.ts`: optional refreshKey.
- NEW `tests/project-plans-board.spec.ts`:8tests including formatted/changing tables, selected totals/filter/selector, history caps/persistence/no polling inflation, narrow geometry and 80-task desktop/narrow wheel top/bottom/top with no document/horizontal scroll.
- `tests/canonical-agent-board.spec.ts`: source assertion for selected-project label.

TF-069 grouping:
- `src/stores/workspace.ts` only project reconciliation around1023 edited: confirmed live folder uses existing deepest matching group or, when separate from remembered owner in both ancestor directions and non-scratch, becomes projectCwd even if no group yet. Existing ensureGroupForPath creates own destination group. Unknown sibling projects and true original-launch-folder return now move. No-live ownership stable. Existing nested-root/git membership protections retained. Category-only earlier candidate was rejected as too narrow.
- `tests/project-reconciliation.spec.ts`:6new parameterized cases (freelance/scratch/ancestor/handover/nested/brainiac), exact brainiac stale assembly ownership with stationary assembly child; manual labels/emoji and repeated reconciliation/reopen stability. Updated older concrete-project excursion expectation per user override, active project context changes while viewport stays stable.

Proof: grouping baseline3expectedfail; final suite28cases:27passed,1browser context closed atpage.reload before assertions. A focused rerun of that case passed. Thus all28 behavior cases verified across run+rerun, no functional assertion failure. Board+canonical19passed. TypeScript check passed, frontend tsc/Vite finalbuild passed, `npm run verify:map-terminals` passed, independent grouping source review no blockers, git diffcheck passed. Typography has3pre-existing unrelated violations (ApproveAllDialog2borders, EarlierSessionsChipmonospace); do not broaden. No Rust source changes.

Final release installed/promoted: `5eb2b7fbba63-8827e431a86c-a3be2404a6a3`, binary SHA256 `8827e431a86ccaa441323e6d787fd16fd5d400e126e5300bb7b8bc0d169351d2`. Exact `/proc/1730900/exe` is that release. `npm run verify:installed-release` and host `npm run doctor` PASS. Build log `/tmp/tf072-final-release-install.log`; install exec54761 finished exit0. Used private `XDG_RUNTIME_DIR=/tmp/tf072-install-runtime TERMFLEET_BUILD_LOCK_FILE=/tmp/termfleet-build.lock` to avoid watchdog operating on canonical UI. Rust build took4m04s, frontend48.25s.

Actual user-approved dock wheel proof final:
- `/tmp/tf072-authorized-top.png` SHA `8d71fa7240a2ff2656c0f324a6bad6ec92f45af390fb02598d5f5c73cf3edd70`: claude-and-conquer heading137tasks45completed74/17/0/1, BUG-041 first, scrollbar top.
- bottom.png SHA `037342581074e8d0a15a5d82fff5a33c799b0adec4a615304c6e14749f5e372e`: fully visible last TASK-113 Keep BOTS.md current for fuel/form, scrollbar bottom.
- up.png SHA `e90054c2a92ee5a0b616109442c0e10d513b84db7bf416d1e746104cf517cab9`: heading/counts/toolbar/BUG041 restored, scrollbar top.
Independent disposable `visual_review` child text-only confirmed same selected project throughout, sidebar stationary, no overlap/horizontal clipping. Parent never view_image. Wheel220events delay15ms plus2/3sec settling. Earlier /tmp/tf072-final-board-up2.png and other up proof INVALID (Map from concurrent navigation), do not cite. Isolated native earlier `/tmp/tf072-native-scroll/{top,bottom,up}.png` also passed; actual final proof supersedes.

## Runtime truth and terminal-loss findings

Canonical daemon PID1515447, started~8days ago, compatible old binary release `57736947a5c5-f7f8fbe66633-7ef8031e6af0`, buildId `1:1790252608707`, protocol1. Socket `/run/user/1000/terminal-workspace/daemon.sock`. UI-only frontend updates use old daemon; preserve it. Current UI1730900 replaces1455941 which replaced1276861. Approved launcher `/home/endlessblink/.local/bin/termfleet-desktop --dock`. Exact window `0x02a00003` decimal44040195. Display`:0`, XAUTHORITY `/run/user/1000/xauth_Xycgun`, canonical runtime `/run/user/1000`. Last window moved to primary at0,72 size1920x1008 for screenshots (was second monitor2080,54 causing import capture errors). Navigation board icon relative19,236, map19,160. CtrlK failed when terminalfocused and typed phrase into a terminal earlier; use nav icons.

Fresh final prelaunch snapshot `/tmp/tf072-final-before-live.json` contains32exact daemon-live IDs/PIDs, every PID present. Raw before/after sessions JSON `/tmp/tf072-final-{before,after}-sessions.json` contain COMMANDS: never print/read output those fields or raw private transcripts. Only project sanitized IDs/PIDs/cwd/lifecycle. After final authorized UI-only close/relaunch7PIDs disappeared;25survived. Seven IDs:
- terminal-0d559b12-55e3-467b-96c2-be5b2eb2e35a-688106ac-d3d9-462a-8b08-f752411d06fb PID1544145
- terminal-7cde20ed-3264-4948-8ba6-c1ce83499fd2-112f5a06-bf4b-42cd-a906-09cb8230c3be PID1314767 (assembly-line)
- terminal-a244f0e1-1a36-4acf-87f3-73be04d0ddb1-966a6e9e-b18a-4e4f-8386-b88d7ec4092e PID1630332
- terminal-aa50c349-07c0-4503-9786-3f3edffe2283-3d7bab16-4f13-4f05-8d2b-064d030f766f PID1549497
- terminal-b61a5f82-c972-4d5b-9c46-183fffcf543b-15a67636-4bd0-4d14-a970-7ecf074e5a99 PID1674459
- terminal-d1ec16b7-bc99-4706-bd36-a431d275dfde-f0f5afbf-310e-4ac7-8ed9-936f00cd973e PID1345196
- terminal-da6caf07-834d-4cdc-b811-eda14e4becc0-f852653a-8a16-405c-ba9b-23c86438909c PID1329147

Read-only group_trace investigation: `~/.local/share/terminal-workspace/sessions/terminal-lifecycle.jsonl` has intentional-kill->kill-requested->killed for all7 at16:46:31.475–16:46:32.487UTC, assembly16:46:31.862. Lexicographic exactIDorder matches startup loops. All7now in workspace.closedSessionIds (1191total). Hydration workspace.ts2295/2301 and live reconcile2624/2626 call daemon_kill_session userRequestedtrue for closedID/provider matches. Ledger each7freshspawn once, recoverable untilstartupkill, no priorclose/respawn/kill markers. No matching originaluserclose marker in app-output. Before snapshots did NOT capture workspace closedrecords; existing backups do notinclude7IDs. Therefore exact destructive calls proved, original operator authorization of records NOT proved. Do NOT claim malicious/unauthorized action or stale record certainty. Candidate described above separates startup exclusion from destructive authority; explicit directclose at3571–3648 remains.

Earlier relaunch lost4unsubscribed registryentries; snapshots lacked liveness and exit timing then. Do not make exhaustivepreservation claim for that run. Do not blindly resume any provider conversation. One live pane per conversation, exact per-pane sessionId sidecar required. Current records:
- freelance tab026c100c-7027-4fc1-a13b-99b6798da8b7, projectCwdfreelance, own group project-1ml4jm namefreelance, initialcontent-creation.
- brainiac tabc989c083-b57f-4691-a22e-24ff0b93fb91, livePID1304907 cwdbrainiac, nowprojectCwdbrainiac, own group project-ku5syu namebrainiac. Beforestaleassemblygroupihljbq.
- assembly tab7cde20ed-3264-4948-8ba6-c1ce83499fd2 formerlyownassemblygroupihljbq, childOf23f40338..., nowabsent becausekill. Noresurrection attempted.

## Issues/docs/git/process state

TF-072 nowresolved with source,19tests,finalinstalled,actualbidirectional visualevidence. TF-069 remainsverifying otherordering/icon/helper concerns beyondslice; final grouping browser-render evidence clearly partial3headinggate. TF-018 remainsfixing; latestlive-desktop evidence records7startupkills andunprovencloseauthority. Issuecheck71records5surfacesPASS. `docs/issue-registry.json` has mixed concurrentchanges plusours; DO NOTstagewhole file. Preserve andcontinueeditingthroughissuesCLI; its tasknextActionfields maystillneedupdating(noCLIpatch command). Registryuncommittednotcompleteartifacthistoryuntilscopedcommit.

MASTER_PLAN top sections refreshedTF069inprogress,TF072complete,TF018inprogress. RegressionmatrixTF072green actualwheel,TF069partial. Owncode/tests/docs committed at handoff (see latestgitlog); HANDOFF includes exactpendingwork. No push/PRrequested/performed.

Unrelateddirty: visual-baselines tc008/tc009 PNGs, scripts/verify-clipboard-paste.sh, untracked.kilo/HANDOFF-feature64/docs/reviews/tests/scratch-eval.spec.ts. Do notrevertorstage. Workers aredone/idle:group_trace (workspace+reconciletests, runtimefindings),scroll_fix(boardCSS+tests),visual_review(text-only source/screenshots),visual_board(earlierunusable). No ongoingbuildprocess. Check actualgitstatus forconcurrentedits.

Memory used MEMORY.md1134–1141 forprojectplan/sharedqueueboundary, rollout01a03ef0-2d45-7b93-8022-39e33cb3c87b; ifusingthis memory includeexactmemorycitationinfinal. No memorywriteauthorized. Projectnotehelper summaryshouldreflect finalboardcomplete/groupingpartial/TF018diagnosis. Durabledecisions canonicalvault; sharedqueueagent-ops separatefromlocalMASTER_PLAN.

## Constraints and suggested skills

Follow localAGENTS.md, continuationcontract, LEAN-CTX.md; context40%hardhandoffCodex->Codex via `termfleet-child spawn --provider codex --cwd <repo> --dropoff <absHANDOFF>`, one successor never tmux. Keep exactlyoneeverydaypresentcontinuouscockpittaskwhenatoolavailable; no plan/tasktool currentlyexposed, do notinventgoals. Preferleanctxctx_compose/read/search/shell, hostexec escalationforactualruntime/GUI (previousread/installUIactionautoapproved). Do notexposecredentials/env/auth/rawtranscripts.

Regressionplanner+verifier skills mandatory beforefix/commit, sourcefirstfalseablecandidate beforetrial. Read `.agents/skills/termfleet-regression-planner/SKILL.md`, verifierSKILL.md; latesthandoffskill `/home/endlessblink/.agents/skills/handoff/SKILL.md` read, AGENTSoverridesitsminimal/temp-onlypreferencebyexpansiverepoHANDOFF; temporarycopyalsosaved. Routingexactspawn-on-termfleetNO_MATCH, commandexistsat~/.local/bin/termfleet-child. Existingdesignskillwasusedforboarddon'tredesignagain. Parentneverviewimage continuingtask, use disposabletext-onlyvisualchild. Nooptimisticecho/PTY suppression, daemonownsPTYs, rendererCanvas2D, keepunrelateddirtywork. CommitsLoreConstraint/Rejected/Testedtrailers. Final1–4shortplainsentences plusNextsteps exactchecks; donotcallgroupingcompleteuntilrequiredliveproof.
