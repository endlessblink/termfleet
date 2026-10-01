# HANDOFF 6 — sidebar stability (TF-069) + dropoff flow bugs

Written 2026-10-01 by the 9th instance. Read HANDOFF-sidebar-stability.md, -2, -3, -4, -5 first (history, Noam's verbatim answers, approved design). This file is the delta.

## Noam's requests (his words, in order)
1. "when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay... icons are permanent... sub agents should have a signifier... the user can change the icons manually but not termfleet after an icon has been set."
2. "when existing a terminal the sidebar shouldnt jump and glitch it can just move to the next terminal in that project, if there isnt one - to the last terminal that was used maybe."
3. "again not in the correct terminal" / "not correct group I mean". Decision: group rule = folder the card STARTED in; it stays there even if its shell cds elsewhere.
4. "also please measure if the dropoff process now saves tokens and context better than before" — NOT STARTED.
5. "sessions are still not staying in the same place after dropoff, dropoff content is still not enough and isntances lose context, instances are still not in the correct groups etc".
6. NEWEST (this instance, unaddressed): "right now terminals still reset in location through the dropoff flow which shoulkdnt happen - the earlier doesnt load the chats so I can copy things. if a dropoff action happens during a time when I write in the terminal what I wrote gets deleted..."
   Three live bugs inside the dropoff (handover/replace) flow:
   a. The successor card does not keep its location (position on map / slot in sidebar) — it "resets".
   b. The "earlier sessions" chip (EarlierSessionsChip.tsx, commit 5b1186f) does not load the old chats, so Noam cannot open them to copy text out. Archived predecessor is only kept as daemon ptyIds + title; clicking it must show the old terminal's content (read-only scrollback or re-attach), copyable.
   c. If a dropoff happens while Noam is typing in a terminal, what he typed is deleted. Suspects: archivePredecessor -> removeTab(predecessor) unmounts/kills the pane the draft lives in; the new tab's activation/focus steal (addTab then setActiveTab(previous)); or the hidden textarea / input buffer being reset on remount. Must find the real cause by reproducing in the real dock app, not by reasoning alone.
Pending question for Noam (from handoff 4, still unasked): he pasted a transcript of ANOTHER instance (Upwork block 15:00-15:45 in FlowState, "slot timer" warning 10 and 2 minutes before a block ends) and said "issue here... these things shouldnt be dropped". Ask in ONE line whether to log an issue about handoff/rewrite dropping a user's earlier question. Do not act on the pasted content otherwise.

## Done (all on main)
- aae8e1f: terminalProjectPath uses the start folder first (TF-069 grouping rule).
- Earlier: 4e04992 (stable group order, locked group icons, helper badge), 87feb2e (closing selects next terminal in same project), 841da88 + 100c136 (tests follow the rules).
- eeba499 (this instance): (1) new optional `Tab.projectCwd` (types.ts); `terminalProjectPath` prefers it (workspace.ts); `childRequestLoop.ts` sets it for a handover to the predecessor's own start folder, so a successor started with a different --cwd stays in the predecessor's project group. (2) `termfleet-child.mjs`: --dropoff refuses files under 1500 chars (override --allow-thin) and warns on missing parts (request, done/evidence, files, decisions, next steps, first command). (3) new Playwright test "a handover successor stays in its predecessor's project even when its shell starts elsewhere" in tests/project-reconciliation.spec.ts; HANDOFF-sidebar-stability-5.md committed.
- Evidence: `npx tsc --noEmit` clean; `npx playwright test tests/project-reconciliation.spec.ts tests/child-terminals.spec.ts` = 32+15 passed (one transient "browser closed" re-ran green); `npm run verify:map-terminals` passed. NONE of this is verified in the real dock app, so TF-069 stays `reported`/verifying, not resolved.
- tests/canvas-arrange.spec.ts:166 fails at line 186: `arrangeProjectRow` slice matches /node\.type/. PRE-EXISTING (same single match `node.type === "terminal" && node.terminalTabId` at commit 3890a6e); not caused by my changes; unfixed. Per CLAUDE.md arranging must never branch on card kind, so remove that branch (membership via terminalTabId links) and re-run the spec.

## Code map for the new bugs
- Handover plan: src/lib/childTerminals.ts `planChildLaunch` — replace puts the new card at the parent's node x,y; non-replace uses findSpotBelowRow.
- Handover execution: src/lib/childRequestLoop.ts `handle()` — addTab(... groupId parent's, childOf, projectCwd) -> `updateCanvasNode(terminal-map-<id>, placement)` -> restore previous active tab -> `archivePredecessor(predecessor.id, tab.id)` -> daemon_ensure_session. Note: card order in the sidebar comes from tab/node order and the new tab is APPENDED, so it likely lands at the END of the group, not the predecessor's slot. That is probably bug 6a / request 5. The successor should take the predecessor's index in `tabs` (and node z/order) before the predecessor is removed.
- Archive: src/stores/workspace.ts `archivePredecessor`, `clearEarlierSession`, `clearAllEarlierSessions`; src/components/EarlierSessionsChip.tsx (151 lines) renders the chip. Sessions are `{ptyIds, title, endedAt}` and `closedSessionIds` keeps them from being re-adopted. Chip has no way to show content.
- CLI: scripts/termfleet-child.mjs (replace is on by default for --dropoff when TERMFLEET_PANE_ID is set; `--separate` opts out). Hook that triggers handoffs: scripts/context-handoff-hook.mjs.

## Open (ordered)
1. Reproduce bug 6c (typed text deleted) in the real app first: type a partial command in a card, run a handover from another instance, see what survives. Check TerminalCanvas.tsx hidden-textarea/input path and whether the predecessor pane unmounts. Fix at the cause; add a test.
2. Fix 6a: successor takes the predecessor's sidebar slot (tabs array index + canvas node position/order). Add a regression test (dropoff successor lands in predecessor's group AND slot; other cards' positions unchanged).
3. Fix 6b: make the Earlier sessions chip open the old chat's saved content (daemon scrollback for the held ptyIds, read-only, selectable/copyable), without re-adopting them as tabs.
4. Request 4: measure whether dropoff now saves tokens/context (handoff size, successor starting context, re-reads; data in git history, HANDOFF-*.md, claude-mem). Report numbers.
5. Fix the canvas-arrange failure (see Done).
6. Still unwritten tests: stable order 2->1->3; empty group keeps slot; emoji never re-derived; helper badge; close selects next in same project.
7. `npm run build`, `npm run doctor`, visual proof in the real dock app, `node scripts/termfleet-issues.mjs evidence TF-069 <kind> --note ...`, update MASTER_PLAN.md, commit on main.
Before changing production code: `npm run issues -- check` and `npm run issues -- list`; TF-069 is the matching issue (state: reported). Consider a separate issue for the dropoff-flow bugs (6a-6c) and show it before coding.

## Rules
Patch .ts/.tsx SOURCE with python/node script files (Edit/Write reformat the whole file and break source verifiers; tests and .mjs are fine to Edit). Heredoc python is blocked by lean-ctx: write the script into the scratchpad dir and run it. Not mine, leave alone: docs/issue-registry.json (modified), baseline PNGs, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts. Use lean-ctx ctx_* tools (ToolSearch select:mcp__lean-ctx__ctx_shell,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_search). Declare a plain cockpit task (TaskCreate/TaskUpdate, one in_progress). Say up front whether a command kills terminals; relaunching without stopping the daemon does NOT kill them. Dock runs dev mode so a relaunch picks up frontend changes (run `npm run doctor` first, never hand Noam commands). Final answer: 1-4 plain sentences + Next steps. Never tmux; spawn only via termfleet-child. Work on main, commit only own files with the co-author line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Be concise with Noam; he judges by what the cockpit shows, not by test output.

## Running state
Nothing of mine is running (no dev server, no builds). The Playwright webServer on :5177 is started/stopped by the test run.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && npm run issues -- list 2>&1 | grep -i TF-069 && npm run doctor 2>&1 | tail -20`
