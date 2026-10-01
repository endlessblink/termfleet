# HANDOFF 2 — sidebar stability (TF-069): continue from here

Written 2026-10-01 by the 5th instance. Read HANDOFF-sidebar-stability.md FIRST (full history, Noam's verbatim answers, approved design). This file is the delta.

## Noam's requests (words)
1. Original: "when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay... icons are permanent... sub agents should have a signifier... the user can change the icons manually but not termfleet after an icon has been set."
2. Close behaviour: "when existing a terminal the sidebar shouldnt jump and glitch it can just move to the next terminal in that project, if there isnt one - to the last terminal that was used maybe."
3. Latest (with screenshot): "again not in the correct terminal" then "not correct group I mean". Screenshot: a card titled "termfleet" (Running, Claude, "Task not captured", cwd /media/endlessblink/...) is listed under the FREELANCE-DESK heading in the By-project sidebar. It belongs under TERMFLEET's project. Earlier screenshot: freelance-desk cards under BOTSON, a botson card under IN-CONTROL-KERNEL.

## Done (committed in 4e04992, WIP) 
Stable group order (store `canvasSidebarGroupOrder`, `reorderSidebarGroups`, `syncSidebarGroupOrder`), locked group emoji in `reconcileProjectGroups`, helper ↳ badge + indent, map/sidebar read same emoji + order. tsc passes.

## Done this session (UNCOMMITTED, only src/stores/workspace.ts is mine)
- `removeTab` (workspace.ts ~3419): after closing the ACTIVE tab, selection now goes to next terminal in the SAME group (tabs order), else the one above in the group, else old list-neighbour fallback. Patched via scratchpad/patch-close.mjs. tsc OK. No per-tab "last used" record exists (only Group.lastActiveTabId), so the "last used" fallback is the old neighbour.
- `npm run verify:map-terminals` PASS. `npm run build` OK (dist rebuilt).
- `npm run doctor`: DOCTOR_FAIL (1 failure) — I only saw the grep of passing lines; run `npm run doctor` and read the failure line. Running app pid 2458729 is "newer than the binary build".

## Wrong-group evidence (the open bug)
Inspector (recreate: read ~/.local/share/terminal-workspace/workspace.json, compare tab.groupId group.projectRoot to tab cwd/initialCwd) found 4 mismatches of 19 tabs:
- tab in group cc-linux-enhancments with cwd .../bots+automation/botson
- tab in group showtime-bot with cwd .../bots+automation/freelance-desk
- tab in group freelance-desk with cwd .../devops/termfleet  <- the screenshot card (a Claude session, probably this very chain)
- a "Helper: Continue from HANDOFF-sidebar-stability.md" tab in freelance-desk with cwd termfleet (childOf missing in saved file)
Code: `reconcileProjectGroups` (workspace.ts ~937) assigns tab.groupId from LIVE cwd/git root via `terminalProjectPath` -> `bestProjectGroupForPath`; so by design a terminal should follow its cwd. Saved file may just lag, OR reconcile is not being applied/livecwds missing for these panes, OR the sidebar By-project buckets (`projectBucketsByManualOrder` in src/lib/mapNodeOrdering.ts, used by MapPanel in WorkbenchSidebar.tsx ~5230+/7815) use a different group source (e.g. node.groupId/canvas node group instead of tab.groupId). CHECK THE LAST FIRST: how a bucket decides a node's group vs tab.groupId. Then reproduce with live data (daemon/live cwd), fix, add test. Don't guess; decide truth = the terminal's real folder unless Noam says otherwise (ask him one short question only if truly ambiguous; recommended: group = real working folder).

## Remaining steps
1. Find and fix the wrong-group cause (above); add regression test (source-contract/unit; tests/* source gates are letter-for-letter; run verify:map-terminals and tests/canvas-arrange.spec.ts).
2. Regression test for stable order (2->1->3 terminals), empty group keeps slot, emoji not re-derived, helper badge, close-selects-same-project.
3. Fix the doctor failure if relevant. Memory says the dock launches dev mode (run-dev.sh -> tauri:dev) so a frontend relaunch may suffice; check doctor "How it is launched". Relaunching the app does not kill terminals unless the daemon is stopped — say so up front.
4. Verify visually in the real app (screenshot), update TF-069 evidence (`node scripts/termfleet-issues.mjs evidence TF-069 <kind> --note ...`, transition), update MASTER_PLAN.md. Commit on main, only own files.

## Rules
Patch .ts/.tsx with node script files (Edit/Write reformat whole file and break source verifiers). Not mine, leave alone: docs/issue-registry.json, baseline PNGs, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts. Use lean-ctx ctx_* tools (load via ToolSearch select:mcp__lean-ctx__ctx_shell,ctx_read,ctx_search). Declare a plain cockpit task. Final answer: 1-4 plain sentences + Next steps. Never tmux.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && npm run doctor 2>&1 | tail -15`
