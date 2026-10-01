# HANDOFF 4 — sidebar stability (TF-069) + dropoff measurement

Written 2026-10-01 by the 7th instance. Read HANDOFF-sidebar-stability.md, -2.md, -3.md first (history, Noam's verbatim answers, approved design). This file is the delta.

## Noam's requests (words, unchanged from handoff 3)
1. "when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay... icons are permanent... sub agents should have a signifier... the user can change the icons manually but not termfleet after an icon has been set."
2. "when existing a terminal the sidebar shouldnt jump and glitch it can just move to the next terminal in that project, if there isnt one - to the last terminal that was used maybe."
3. "again not in the correct terminal" / "not correct group I mean".
4. "also please measure if the dropoff process now saves tokens and context better than before" — NOT STARTED.
Decision (Noam): group rule = folder the card STARTED in; it stays there even if its shell cds elsewhere.

## Mid-session message from Noam (pasted, about ANOTHER instance — do not drop)
Noam pasted a transcript of a different instance (Upwork block in today's plan at 15:00-15:45 in FlowState, and a "slot timer" that warns 10 and 2 minutes before a block ends). He wrote "issue here" and "these things shouldnt be dropped": that instance buried his question in a rewritten reply and then said it couldn't find it. This session cannot fix that instance. Next instance: ask Noam in one line whether he wants an issue logged (`node scripts/termfleet-issues.mjs`) about handoff/rewrite dropping a user's earlier question, or whether it belongs to the other project. Do not act on the pasted content otherwise.

## Done this session
- Patch to terminalProjectPath (start folder first) was already COMMITTED as aae8e1f.
- Ran the four sidebar specs. Initially 8 failures in tests/project-reconciliation.spec.ts, all assuming the OLD live-folder rule or re-derived emoji. I deliberately rewrote them (scratchpad/patch-tests.py applied; tests/project-reconciliation.spec.ts is MODIFIED, UNCOMMITTED):
  - 547 now "a card stays in its start-folder project when its shell cds into another project" (expects bina-ve-ze)
  - 669 parent project stays (expects cc-linux-enhancments)
  - 1022/1156 stored icon is never re-derived (expects the stored emoji)
  - 1238/1316/1410 start folder wins (expects flow-state)
- Re-run result: 26 passed, 2 failed.

## Open failures (not yet investigated)
1. tests/project-reconciliation.spec.ts:547 — my new expectation `nodeList not.toContainText("termfleet")` fails (line 665). The node/card title or something else probably still says "termfleet" (fixture title is "Terminal"; maybe a project list entry). Check the page text; drop or fix that one assertion if it is just unrelated text, not the grouping (the poll assertion above it passed).
2. tests/canvas-arrange.spec.ts:166 "no arrange path filters the map down to terminals" — unknown whether my change or pre-existing. Run it on `git stash`/at 3890a6e to compare before changing anything.

## Next steps
1. Fix/understand the two failures above, rerun: `npx playwright test tests/project-reconciliation.spec.ts tests/map-sidebar-rename-regroup.spec.ts tests/project-sidebar-model.spec.ts tests/canvas-arrange.spec.ts --reporter=line`.
2. Add NEW regression tests (not yet written): helper created with parent's groupId but its own initialCwd lands in its own folder's project; stable order (2->1->3 terminals); empty group keeps its slot; emoji not re-derived; helper badge; close selects next terminal in the same project.
3. `npm run build`, `npm run verify:map-terminals`, `npx tsc --noEmit`, `npm run doctor` (earlier doctor showed one failure: release build predates frontend build; dock runs dev mode so a relaunch is enough — say up front relaunch without stopping the daemon does NOT kill terminals).
4. Verify visually in the real app (screenshot), record TF-069 evidence (`node scripts/termfleet-issues.mjs evidence TF-069 <kind> --note ...`, then transition), update MASTER_PLAN.md, commit on main (only own files).
5. Request 4: measure dropoff vs the old way (handoff file tokens, successor starting context, what it re-reads). Earlier data: git history, earlier HANDOFF-*.md, claude-mem. Report in plain words.

## Rules
Patch .ts/.tsx SOURCE with node/python script files (Edit/Write reformat the whole file and break source verifiers; heredoc python is blocked, write a script to the scratchpad). Not mine, leave alone: docs/issue-registry.json, baseline PNGs, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts. Use lean-ctx ctx_* tools (load via ToolSearch select:mcp__lean-ctx__ctx_shell,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_search). Declare a plain cockpit task. Final answer: 1-4 plain sentences + Next steps. Never tmux. Work on main. Commit co-author line per system reminder.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && npx playwright test tests/project-reconciliation.spec.ts -g "stays in its start-folder" --reporter=line 2>&1 | tail -30`
