# HANDOFF 3 — sidebar stability (TF-069) + dropoff measurement

Written 2026-10-01 by the 6th instance. Read HANDOFF-sidebar-stability.md and HANDOFF-sidebar-stability-2.md first (history, Noam's verbatim answers, approved design). This file is the delta.

## Noam's requests (words)
1. Original: "when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay... icons are permanent... sub agents should have a signifier... the user can change the icons manually but not termfleet after an icon has been set."
2. "when existing a terminal the sidebar shouldnt jump and glitch it can just move to the next terminal in that project, if there isnt one - to the last terminal that was used maybe."
3. "again not in the correct terminal" / "not correct group I mean" (screenshot: a "termfleet" card under the FREELANCE-DESK heading).
4. NEW (this session): "also please measure if the dropoff process now saves tokens and context better than before" — NOT STARTED. Compare the handoff/dropoff flow (HANDOFF.md + `termfleet-child spawn --dropoff`, scripts/context-handoff-hook.mjs, spawn-on-termfleet skill) against the earlier way: measure tokens of the handoff file, the successor's starting context size, and what the successor re-reads. Find "before" data in git history / earlier HANDOFF-*.md files / claude-mem; report numbers in plain words.

## Noam's decision this session (asked him, he answered)
Group rule = "Folder it started in (Recommended)": a card stays in the project it was opened in even if its shell later cds elsewhere. Rejected: follow live folder; start-folder-but-draggable (can add later).

## Done
- Committed earlier: 4e04992 (stable group order, locked emoji, helper badge), 87feb2e (close selects next terminal in same project, in workspace.ts removeTab).
- Wrong-group root cause found: `reconcileProjectGroups` -> `terminalProjectPath` (src/stores/workspace.ts ~916) used the shell's LIVE cwd first, so any shell that cd'd (or child helper) moved the card to another project. Live data confirmed: tabs d3cd9b (init botson, shell in cc-linux-enhancments) and 991a33 (init freelance-desk, shell in showtime-bot) are grouped by live cwd. Bucketing (src/lib/mapNodeOrdering.ts projectBucketsByManualOrder) uses tab.groupId by id — it is fine.
- PATCH APPLIED (UNCOMMITTED unless the commit below succeeded): terminalProjectPath now uses `node.terminalCwd ?? tab.initialCwd` first, live cwd only if no start folder. Patched with scratchpad/patch-group.mjs (node script, not Edit). `npx tsc --noEmit` clean; `npm run verify:map-terminals` PASS.

## Not done / next steps
1. Run `npx playwright test tests/project-reconciliation.spec.ts tests/map-sidebar-rename-regroup.spec.ts tests/project-sidebar-model.spec.ts tests/canvas-arrange.spec.ts` — some may assume live-cwd regrouping and need updating to the new rule; update them deliberately, do not weaken blindly.
2. Add regression test: card stays in start-folder project after setLiveCwd to another folder; helper created with parent's groupId but its own initialCwd lands in its own folder's project. Also tests for stable order (2->1->3 terminals), empty group keeps slot, emoji not re-derived, helper badge, close-selects-same-project.
3. Existing already-misgrouped tabs fix themselves on next reconcile (restore/addTab/any setLiveCwd). Check.
4. `npm run doctor` showed ONE failure: "release build predates the frontend build by 11m" (dev-mode dock per memory => likely just needs relaunch; run `npm run build` first per memory frontend-fix-not-visible-rebuild-dist; check doctor "How it is launched"). Say up front whether a command kills terminals (relaunching the app without stopping the daemon does NOT).
5. Verify visually in the real app (screenshot), update TF-069 evidence (`node scripts/termfleet-issues.mjs evidence TF-069 <kind> --note ...` then transition), update MASTER_PLAN.md, commit on main (only own files).
6. Do request 4 (dropoff measurement).

## Rules
Patch .ts/.tsx with node script files (Edit/Write reformat whole file and break source verifiers). Not mine, leave alone: docs/issue-registry.json, baseline PNGs, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts. Use lean-ctx ctx_* tools (load via ToolSearch select:mcp__lean-ctx__ctx_shell,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_search); heredoc python is blocked — write a script file to the scratchpad and run it. Declare a plain cockpit task. Final answer: 1-4 plain sentences + Next steps. Never tmux. Work on main.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && git log --oneline -3 && npx playwright test tests/project-reconciliation.spec.ts 2>&1 | tail -20`
