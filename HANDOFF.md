# Status Board repair and project selector — continuing work

## First command

Run `git status --short`, then read this handoff completely. The latest parser correction is tested but **not built or installed yet**. Continue with the release installation and native proof below. Do not restart the operator's app or daemon without confirmation.

## User request and definition of done

Original: “tasks dont load on the termfleet' status board view” with selected claude-and-conquer showing 886 global tasks but empty columns.

Later: “now the all projects appearns looks broken + all projects is not really usefull to me and I prefer a good looking project selector + a most used 5 prohects that updates + latest 5 projects that updte etc. use impacable design”. Screenshot showed overlapping cards in All projects.

Deliver a working project-specific board, attractive searchable project selector, persistent five most-used and five recent projects, correct selected-project totals and responsive non-overlapping cards. Use Impeccable design. Complete source/tests/build/installed-release/native visual proof and ultimately operator's actual dock window read-back. Current status **in_progress**, issue TF-072 **verifying**. Do not claim complete from browser tests.

## Implemented own files

- src/lib/masterPlanTasks.ts: recursively unwrap paired Markdown around IDs/title/status; PENDING -> todo. Latest correction handles changing table headers (ID/Title/Completed) and absent status cells instead of throwing on undefined.trim(). Blank non-table lines reset header. Real claude-and-conquer MASTER_PLAN now parses 137 tasks: todo74, inProgress17, done45, unknown1.
- src/lib/projectBoardHistory.ts new: validated localStorage termfleet.projectBoard.history.v1; selected root and visits/lastOpened; bounded100 history; frequent and recent each cap5 and exclude unavailable roots.
- src/components/ProjectPlansBoard.tsx redesign: selected-project-only, no All projects; searchable accessible popup; quiet Projects aside with Most used and Recent; record visits on open/switch, not five-second polling; selected totals; filters and refresh retained; refreshed discovery; persisted root fallback current workspace.
- src/components/ProjectPlansBoard.css new: restrained dark Rubik, blue accent, responsive cards no minimum980px or overlap; container queries850/600; actual shortcut counts displayed, no misleading bare5; focus styles pass own typography checks.
- src/hooks/useMasterPlanTasks.ts optional refreshKey dependency (other consumers unchanged).
- tests/project-plans-board.spec.ts new six tests: formatted IDs, short/changing table rows, selected totals/filters/picker, ranking/caps, persistence/no polling inflation, narrow geometry and screenshots. Latest fixture includes completed table reproducing real second crash.
- tests/canonical-agent-board.spec.ts stale source assertion changed from All project plans to aria-label Project plans. Shared agent-ops authority unchanged.

## Verification and failures found

Before latest correction: board + canonical11 =16 tests passed twice; npm run build passed; git diff --check passed. Browser visual child reviewed /tmp/tf072-board-desktop.png, narrow.png, picker.png: attractive readable, no overlap at760px. Fixed its misleading shortcut5 count feedback.

Latest correction: background ctx_shell job shell_fb4a853457a31c60 completed exit0: 13 passed19.3s using `npx playwright test tests/project-plans-board.spec.ts tests/canonical-agent-board.spec.ts tests/map-terminal-rendering.spec.ts --grep 'project|formatted|short rows|MASTER_PLAN task parser keeps summary' --reporter=line`. Includes six new tests, canonical glanceable label and parser plus selected existing map regressions. Run full new board+canonical suite once if needed (17 expected now), then build/install.

Typography verifier has three **pre-existing** failures in ApproveAllDialog (two full-box-border) and EarlierSessionsChip monospace. Own styles have no violations; do not broaden fix.

Native installed proof opened redesigned board but ZERO tasks, despite real readable UTF8 file69398bytes. Node actual parsing exposed undefined.trim from stale five-column header applied to later three-column completed table. Latest source correction fixes this. Thus old installed evidence is a failed live gate; do not resolve TF072 yet.

## Installed release — currently stale relative to latest parser

Successful installation log /tmp/tf072-release-install.log. Current promoted release b0f3980a7907-c8614606f93b-523b9c9a0df1, binary SHA c8614606f93b5c2cb7287f375e1a186cbe6a1bc25a322b4df29f71530c296891. It includes redesign and first parser fix, NOT completed-table correction.

Reinstall exact safe command with direct exec_command (escalation previously auto-approved):
`mkdir -p /tmp/tf072-install-runtime`
`env XDG_RUNTIME_DIR=/tmp/tf072-install-runtime TERMFLEET_BUILD_LOCK_FILE=/tmp/termfleet-build.lock npm run release:install > /tmp/tf072-release-install.log 2>&1`
Private XDG_RUNTIME lacks session bus and avoids release script restarting watchdog/current UI. Build Rust1m26 +frontend11sec. No daemon changes necessary.

IMPORTANT ctx_shell `npm run verify:installed-release` reported frontend checksum mismatch while direct exec_command same command passed. Host/sandbox view discrepancy. Use direct exec for installed build/verify/read-back authoritative filesystem. npm run doctor showed old active UI PID13427, compatible daemon protocol, other checks okay. Old canonical daemon binary under releases/57736947a5c5-f7f8fbe66633-7ef8031e6af0. Preserve it and PTYs.

## Private native proof recipe already created

/tmp/tf072-native-proof.sh and /tmp/tf072-native-proof.log. Script creates private XDG_RUNTIME/DATA/STATE/CONFIG under /tmp/tf072-native, seeds workspace with preview tab (terminals[] so no PTY spawn), group claude-and-conquer, real project root /media/endlessblink/data/my-projects/ai-development/bots+automation/claude-and-conquer.

Uses TERMFLEET_CHILD_CONTEXT=isolated-smoke (essential; bare --child is unsafe shared routing), TERMFLEET_PROJECT_ROOTS real project, TERMFLEET_INSTALL_ROOT real ~/.local/share/termfleet, TERMFLEET_CMD readlink current/termfleet, installed libexec/termfleet-desktop-launcher --child. Opens actual board via xdotool ctrl+k, type Open project board, Return. Captures ImageMagick import and tesseract OCR.

Execute with direct exec escalation: `xvfb-run -a -s '-screen 0 1800x1100x24' dbus-run-session -- bash /tmp/tf072-native-proof.sh > /tmp/tf072-native-proof.log 2>&1`. EPERM sandbox first attempt; request marker already exists /tmp/codex-electron-host-runner-tf072-project-board.request and escalated run succeeded.

Old screenshot /tmp/tf072-native/board.png SHA2ae4caf1b89daea5e722c6e73de230da287dedfc15c78efd7fd4d4a785b88321 visibly selected correct project, attractive layout, zero cards. Script trap kills its UI launcher PID. Improve cleanup to specific isolated process group or private daemon PID: query JSON {type:status} only /tmp/tf072-native/runtime/terminal-workspace/daemon.sock and verify /proc/pid/environ exact private XDG_RUNTIME before kill. Never pkill app names or canonical daemon. Native private daemon might remain idle from previous run.

After reinstall rerun native proof; expect137 total,74todo17progress45done1unknown (done hidden until ShowDone). Capture picker too if possible. Parent MUST NOT view_image. Use disposable visual child returning text only path/SHA/findings/visible text/uncertainty/action. Existing /root/visual_board can be reused; /root/native_proof finished read-only recipe. /root/parser_fix finished first parser; /root/trace_board explorer unsupported model failed. New successor can create visual child as authorized by AGENTS.

## Issue/docs and dirty state

TF-072 in docs/issue-registry.json required source/focused-test/installed-release/live-desktop. Existing evidence source and16-tests. State verifying. rootCause currently empty and nextAction stale; CLI has only check/list/show/create/transition/evidence, no edit. Can mutate ONLY matching record fields using JSON preserving others. Add completed-table crash, current proof, matrix ref and nextAction. Record failed native then final passed native, keep verifying until actual operator window.

Own doc additions: MASTER_PLAN.md near top TF072 in_progress (source/tests16/build/browser screenshot evidence; installation/native pending stale); docs/regression-matrix.md TF072 before3.31; docs/issue-registry.json record via CLI. These files have other agents' unrelated edits; DO NOT stage whole. Update own sections with latest evidence and status, separate own hunks if committing.

Preexisting dirty: MASTER_PLAN.md, docs/issue-registry.json, docs/visual-baselines/tc-008-terminal-typed-command.png and tc-009-terminal-split-right.png, scripts/verify-clipboard-paste.sh; untracked .kilo/, HANDOFF-feature-64.md, docs/reviews/, tests/scratch-eval.spec.ts. Preserve all. HEAD changed concurrently during work to b0f3980a7907, don't revert. Own source/test files listed above are safe stage independently.

## Constraints/context already loaded

Read continuation contract, runtime-truth, regression-planner/verifier skills fully. Read skill router route for impeccable project selector dashboard design, teach-impeccable/frontend-design/design-taste skill, .impeccable.md existing context. No deps added. Canonical Obsidian TermFleet note read; no vault mutations. Shared agent queue belongs external configured agent-ops and is separate from project Watchpost plan board.

Use lean-ctx compose before understanding, ctx_read/search/shell; direct exec where host-native proof/escalation needed. ctx_shell permanentblocked node-p and semicolon note should not retry. Follow issue system. Keep exactly one everyday present-continuous task if tool available; no update_plan/task tool discovered, don't invent goal.

Current user app untouched. Ask confirmation ONLY after new release and private native proof pass before relaunching actual user UI because user's persisted preference requires disclosure/confirmation of terminal/SSH/runtime loss risks. Explain UI brief interruption, daemon/PTYS preserved, reconnection still checked. Never ask user to run development launcher. Actual dock window proof remains gate; authorized safe other work proceed autonomously. Can async question and continue docs. Do not falsely claim complete.

Read ~/.codex/RTK.md before commits (read parent): rtk prefix commands. Lore trailers Constraint, Rejected, Tested. Commit ownfiles only. User HARD40% context handover requires same-provider termfleet-child spawn --provider codex --cwd repo --dropoff absoluteHANDOFF; one successor then stop, no tmux. Project note state command via external notes.py is required, not yet done; may need escalation outside writable root. Do not write memories except explicit userrequest.

Memory read actually used MEMORY.md1134–1141 only, rollout itself not opened. Final append exactly one block as last content:
<oai-mem-citation>
<citation_entries>
MEMORY.md:1134-1141|note=[project plan and shared queue boundaries]
</citation_entries>
<rollout_ids>
01a03ef0-2d45-7b93-8022-39e33cb3c87b
</rollout_ids>
</oai-mem-citation>

## Next actions in order

1. Review latest parser diff/tests briefly, run full board+canonical suite and build/install safe private-runtime command.
2. Direct installed-release verify and doctor; preserve running user UI/daemon.
3. Rerun isolated native proof and text-only visual review, verify real137tasks and selector. Fix anything found then rerun relevant guard.
4. Update TF072 evidence/rootCause/matrixRef/nextAction and own docs, current project note. Keep unresolved user-window gate explicit.
5. Obtain confirmation for actual UI relaunch with risk explanation; then dock surface read-back without daemon stop. If no answer final manual_action_required with exact dock check.
6. Commit own changes with Lore trailers once verifier rules satisfied; do not stage unrelated dirtydocs wholesale. Final1–4shortplain sentences + Next steps exactcommands/checks, in_progress/manual_action_required/complete and memoryblocklast.

Latest user update: “I found the remaining loading failure: a differently shaped ‘Completed’ table crashed parsing for the whole project. The fix now reads the real project’s 137 tasks. The redesigned selector and updating project shortcuts are ready; I’m finishing the installed-app checks.”
