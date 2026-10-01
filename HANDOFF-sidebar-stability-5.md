# HANDOFF 5 — sidebar stability (TF-069) + dropoff quality

Written 2026-10-01 by the 8th instance. Read HANDOFF-sidebar-stability.md, -2, -3, -4 first (history, Noam's verbatim answers, approved design). This file is the delta.

## Noam's requests (his words)
1. "when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay... icons are permanent... sub agents should have a signifier... the user can change the icons manually but not termfleet after an icon has been set."
2. "when existing a terminal the sidebar shouldnt jump and glitch it can just move to the next terminal in that project, if there isnt one - to the last terminal that was used maybe."
3. "again not in the correct terminal" / "not correct group I mean".
4. "also please measure if the dropoff process now saves tokens and context better than before" — NOT STARTED.
5. NEW, mid-session this instance: "sessions are still not staying in the same place after dropoff, dropoff content is still not enough and isntances lose context, instances are still not in the correct groups etc". So: (a) a successor spawned via dropoff must land in the SAME sidebar place/group as the card it replaces; (b) the dropoff/handoff file content must be richer so successors do not lose context; (c) groups still wrong in the real app. Treat as live bugs: reproduce in the real dock app before claiming anything.
Decision (Noam): group rule = folder the card STARTED in; it stays there even if its shell cds elsewhere.
Pending question for Noam (from handoff 4): he pasted a transcript of ANOTHER instance (Upwork block 15:00-15:45 in FlowState, "slot timer" warning 10 and 2 minutes before a block ends) and said "issue here... these things shouldnt be dropped" (that instance buried his question and then said it couldn't find it). Ask him in ONE line whether to log an issue about handoff/rewrite dropping a user's earlier question, or whether it belongs elsewhere. Do not act on the pasted content otherwise.

## Done so far
- aae8e1f (committed): terminalProjectPath uses the start folder first.
- Earlier commits 4e04992, 87feb2e, 841da88: stable group order, locked group icons, helper badge, close selects next terminal in same project (all WIP, unverified in real app).
- tests/project-reconciliation.spec.ts rewritten for the start-folder rule (8 tests). THIS instance removed the stray `not.toContainText("termfleet")` assertion in the test at ~line 665 (card subtitle legitimately shows live folder "devops/termfleet"; grouping itself was already asserted). Change is UNCOMMITTED at the time of writing; the instance committed it with this handoff.
- Specs last full result before this edit: 26 passed, 2 failed; the first failure is now fixed (not re-run).

## Open
1. tests/canvas-arrange.spec.ts:166 "no arrange path filters the map down to terminals" fails at line 186: the `arrangeProjectRow` slice of src/stores/workspace.ts matches /node\.type/. I was checking whether the match was introduced by my workspace.ts changes (diff 3890a6e..HEAD touched workspace.ts +64 lines, MagicCanvas.tsx, mapNodeOrdering.ts, WorkbenchSidebar.tsx, CanvasSidebar.tsx, types.ts). Method: extract the slice between "arrangeProjectRow: (groupId: string) => {" and "reorderCanvasNodes:" from `git show 3890a6e:src/stores/workspace.ts` vs HEAD and count `node.type`. If mine, remove the type branch (arranging must never branch on card kind, see CLAUDE.md). A stash does NOT answer it (source is already committed). Heredoc python is blocked by lean-ctx: write the script to the scratchpad dir and run it.
2. No new regression tests yet: helper created with parent's groupId but its own initialCwd lands in its own folder's project; stable order 2->1->3; empty group keeps slot; emoji never re-derived; helper badge; close selects next in same project; NEW: a dropoff successor lands in the predecessor's group and slot.
3. Request 5 investigation not started: find how spawn/dropoff (termfleet-child, FEATURE-64, "a handover takes over the parent's card" commit 5b1186f) assigns group and position to the child card; compare to what the sidebar renders; reproduce in the real app.
4. Request 5(b): inspect what the dropoff writes/injects (scripts/context-handoff-hook.mjs, spawn-on-termfleet skill, `--dropoff`) and whether the successor gets the original request, corrections, evidence, files, rejected approaches. Likely fix: make the hook/skill demand the full handoff structure and have the CLI refuse/warn on thin files. Also covers request 4 (measure tokens: handoff size, successor starting context, re-reads; data in git history, HANDOFF-*.md, claude-mem).
5. `npm run build`, `npm run verify:map-terminals`, `npx tsc --noEmit`, `npm run doctor` still to run. Dock runs dev mode so a relaunch picks up frontend changes; relaunching without stopping the daemon does NOT kill terminals — say that up front.
6. Visual proof in the real app + `node scripts/termfleet-issues.mjs evidence TF-069 <kind> --note ...`, update MASTER_PLAN.md, commit on main.

## Rules
Patch .ts/.tsx SOURCE with node/python script files (Edit/Write reformat the whole file and break source verifiers; tests are fine to Edit). Not mine, leave alone: docs/issue-registry.json, baseline PNGs, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts. Use lean-ctx ctx_* tools (ToolSearch select:mcp__lean-ctx__ctx_shell,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_search). Declare a plain cockpit task. Final answer: 1-4 plain sentences + Next steps. Never tmux; spawn via termfleet-child. Work on main, commit only own files with the co-author line from the system reminder. Run the issue check (`npm run issues -- check`, `list`) before production-code changes.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && npm run issues -- list 2>&1 | grep -i TF-069`
