# HANDOFF — sidebar stability, permanent icons, helper-terminal marker

Written 2026-10-01 by a Claude instance that hit ~54% context. NO CODE WAS CHANGED. This is all discovery + design, mid-brainstorm.

## Original request (Noam's words, verbatim)

> when closing or operning a terminal the sidebar shouldnt change. the same positions shoud stay. it doesnt matter if a grop fell from 2 to 1 or went from 2 to 3. Also the icons are permanent and shouldnt change all the time + sub agents should have a signifier for them + the user can change the icons manually but not termfleet after an icon has been set. ask me if unclear or if you think diffrently.

## Later corrections / answers (verbatim where quoted)

Answers to my 3 questions:
1. Order: **"Order created, new at the end"** (NOT drag-reorder).
2. Sub-agents = **helper terminals** (the ones started via `termfleet-child spawn`, `Tab.childOf` in `src/lib/types.ts:163`). Not Claude's in-chat subagents.
3. Existing group icons: **"yes but if a group is being closed that emoji resets. also all emojis are optional not just the few you preselectd"**
   - Lock today's icons as they are now.
   - When a group is closed, its emoji is released/reset (a re-created group gets a fresh one).
   - Every emoji must be choosable (full searchable picker), not only the quick preset list.

After I presented the design in chat, Noam replied: **"ask me more qurestions"**. So the brainstorming gate is NOT yet passed — Noam has NOT said yes to the design. Ask more questions first (suggested list below), then re-present the design and wait for an explicit yes.

## Process state

- Skill in use: `superpowers:brainstorming`, classified BOUNDED (flow already exists in repo). Hard gate: no code until Noam approves the design.
- Per Noam's global rules: declare a plain-language cockpit task (TaskCreate/in_progress) for non-trivial work; say up front whether a command kills terminals; keep answers short and non-technical; run diagnostics yourself; final message = 1-4 plain sentences + "Next steps".
- Project rule (CLAUDE.md): before any bug/behaviour fix run `npm run issues -- check` and `npm run issues -- list`, show/create the matching issue BEFORE changing production code; update lifecycle + evidence; don't mark resolved without surface-specific proof.
- Normal acceptance is dock-only: `npm run release:install` then `npm run verify:installed-release`. But memory note "Launches from the DOCK, in dev mode" says the dock entry runs run-dev.sh -> tauri:dev; check `npm run doctor` "How it is launched" line first. ALSO memory "Frontend fix still happening? Rebuild dist first": run `npm run build` before claiming a frontend fix.
- Memory warns: editing .ts/.tsx with Edit/Write reformats the whole file and breaks source verifiers (verify-map-terminals) — patch existing source with a surgical python/script replace instead (lean-ctx blocks python heredocs: use a script file).
- Work directly on `main` (no branches). Other agents may run concurrently on this repo — stage only your own files.
- lean-ctx: native Read/Grep/Bash denied; use `mcp__lean-ctx__ctx_*` (load via ToolSearch select:). Edits: ctx_read mode=anchored + ctx_patch, or native Write/Edit (Write/Delete allowed natively).

## What I found (evidence from reading code)

### Icon instability — root cause identified
- Project (group) emoji are RE-DERIVED on every reconcile, with a collision-avoidance set that depends on iteration order of the current group list.
  - `src/stores/workspace.ts:931` `reconcileProjectGroups(...)`: for each group computes `generatedEmoji = projectEmojiFor(projectRoot ?? group.name, generatedEmojis)` (line ~955), then `emoji = group.emojiSource === "user" ? group.emoji ?? generatedEmoji : generatedEmoji` (line ~957). So any group NOT marked `emojiSource: "user"` gets its emoji recomputed each time; when a group is added/removed/reordered, the dedupe set changes and other groups' emoji shift. Also `ensureGroupForPath` (~line 978-994) and `stores/workspace.ts:4273` (`emoji: projectEmojiFor(normalizedRoot ?? name)` in project creation).
  - `src/lib/projectEmoji.ts:111` `projectEmojiFor(pathOrName, avoid)` — hash-based pick that avoids the `avoid` set.
- The MAP has its OWN second copy of the same logic: `src/components/MagicCanvas.tsx` ~6894-6914 (`mapProjects` memo): sorts projects by map x/y position (`minX`, `minY`), uses `group.emoji` only if not already `used`, otherwise calls `projectEmojiFor(..., used)`. So map emoji can differ from sidebar emoji and shift when nodes move. Also read at MagicCanvas.tsx:3160, 4710-4757, 7816 and SplitPane.tsx:1635 (`projectEmoji: linkedProject?.emoji`).
- `Group` type: `src/lib/types.ts:438` (has `emoji`, `emojiSource: "generated" | "user"`, `projectRoot`, `lastActiveTabId`).
- Terminal icons: `TerminalAvatar` at `src/components/WorkbenchSidebar.tsx:1745` shows `tab.emoji` (unless "⬛") else a Phosphor TerminalWindow icon. Used at WorkbenchSidebar.tsx:5095 (SessionsPanel) and :8030 (MapPanel). `LinksView.tsx:251` also shows `session.tab.emoji`.
- Terminal right-click menu `TerminalContextMenu` (WorkbenchSidebar.tsx:1761) has quick emoji grid `TERMINAL_EMOJIS` (~1917) + a "More emoji…" button opening the full `EmojiPicker` (`src/components/EmojiPicker.tsx`, data in `src/lib/emojiData.ts`). I did NOT yet verify the PROJECT (group) context menu (`onOpenProjectMenu`, `ProjectContextMenu`?) offers the full picker — check it. Noam says all emojis must be pickable.

### Sidebar order instability — NOT yet pinned down
- SessionsPanel is `WorkbenchSidebar.tsx:2436`. Inputs: `tabs`, `groups`, `pinnedProjects`, `activeGroupFilter`, `liveTabs = liveTerminalTabs(tabs, liveSessionIds)` (:2505), `visibleTabs`. I did NOT find the code that sorts/groups the project sections yet (searches for `.sort(`, `orderedProjects` etc. found only `countLabel` at :250). NEXT: read SessionsPanel render body (~lines 4900-5200, the TerminalAvatar usage at :5095) and look for how project sections are ordered (pinnedProjects, recency, live-ness, count-based?). Also check `liveTerminalTabs`, `pinProject`, `unpinProject`, `projectSidebarExpandedSections`.
- Likely culprits to confirm: ordering by live-ness/recency/active tab, or groups with 0 live tabs disappearing/reappearing so positions shift. "doesn't matter if a group fell from 2 to 1 or 2 to 3" suggests ordering currently depends on count or activity.

### Helper-terminal (sub-agent) data
- `Tab.childOf?: { parentPaneId; parentTabId; requestId }` (`src/lib/types.ts:163`).
- Spawn plumbing: `src/lib/childTerminals.ts` (`planChildLaunch` sets `link`), `src/lib/childRequestLoop.ts` (creates the tab, `childPaneId = terminal-<tabId>-<activePaneId>`).
- Recent commits (FEATURE-64) already group helper cards under their parent on the MAP. The SIDEBAR currently has no marker/indent (not verified — check).

## Proposed design (presented in chat, NOT yet approved)

1. **Order stays put**: groups and terminals in creation order, new at the END; closing/opening never moves others. (Needs a persisted stable order key per group/tab, or rely on array insertion order if the arrays are append-only — verify; remove any recency/count sort in the sidebar.)
2. **Icons permanent**:
   - Pick a group's generated emoji ONCE at creation, persist it, and never re-derive in `reconcileProjectGroups` (treat any group that already has an `emoji` as locked; only compute when emoji is missing). Likely flip existing groups to locked state at migration time ("lock today's icons").
   - Only the user changes it afterwards (`emojiSource: "user"` semantic or a new `emojiLocked`).
   - When a group is CLOSED, its emoji is released (freed to the pool); a re-created group picks fresh.
   - Map must read `group.emoji` directly — delete the second derivation in MagicCanvas.tsx (~6900-6913) so map == sidebar.
   - Make sure the project menu offers the full searchable EmojiPicker, not just quick emojis.
3. **Helper terminals**: small badge on the icon + indented under the parent in the sidebar; icon itself still user-settable.
4. Assumption flagged to Noam: "icons" = group icons; confirm whether terminal icons also change.

## Questions to ask Noam next (he asked for MORE questions — ask ONE at a time, use AskUserQuestion, plain words)

Suggested, pick the ones that matter:
- Terminal icons: do the icons that change = the group icons, the terminal icons, or both? (Terminals with no emoji show the generic terminal glyph — should every new terminal get a permanent auto-picked emoji too, or keep the plain glyph until the user picks one?)
- Closing a group: what does "closed" mean to you — removing the group from the sidebar entirely, or just closing all its terminals (group stays)? (Determines when the emoji is released.)
- Empty groups: when a group's last terminal closes, should the group row stay in its slot (empty) or vanish? Vanishing shifts everything below it.
- Where do new groups appear — always bottom, even if the new terminal is in an existing project's folder? And pinned projects: do they stay on top or also follow creation order?
- Helper terminals: badge style (small robot/branch glyph? "↳"?), and when the parent closes, should helpers stay in place indented under a gone parent, or become top-level in the same slot?
- Collisions: two groups may now share an emoji only if the user picks it — OK to allow duplicates when the user picks, but should auto-picked ones stay unique at pick time?
- Existing duplicates today: if two groups already show the same emoji, lock as-is or fix once?
- Should the same stable order also apply to the map's project list and the fleet list, or sidebar only?

After answers: re-present a short design in chat, get an explicit YES, then create/record the issue (`npm run issues -- check/list`), implement, `npm run build`, verify in the dock app, add a regression test, update MASTER_PLAN.md/issue evidence.

## Files touched

NONE by me. Git status at session start (not mine, leave alone): M docs/issue-registry.json, M docs/visual-baselines/tc-008-terminal-typed-command.png, M docs/visual-baselines/tc-009-terminal-split-right.png, M scripts/verify-clipboard-paste.sh, ?? .kilo/, ?? HANDOFF-feature-64.md, ?? tests/scratch-eval.spec.ts. This HANDOFF-sidebar-stability.md is mine (uncommitted).

## Running processes / ports / builds

None started by me.

## UPDATE (second instance, same day) — new answers + ordering root cause

Issue check ran: `npm run issues -- check` PASS (67 records); list shows TF-044..TF-068 as latest. No issue exists yet for this work (create one, next free id TF-069 may be taken by docs/issue-registry.json edits — check), before any code.

### ORDER ROOT CAUSE FOUND
`src/lib/projectSidebarModel.ts` `compareProjects` (line ~80) sorts: current (selected) group first, then pinned, then terminal COUNT descending, then name. Groups split into `inUse` (current/pinned/count>0) and category `sections` (DevOps, Productivity…, via `projectCategoryForPath`, `CATEGORY_ORDER`). That is exactly why groups jump when a count goes 2→1 or 2→3, and when a group becomes empty it falls from `inUse` into a category section. `buildProjectSidebarModel` is called from `WorkbenchSidebar.tsx` ~line 2574 (SessionsPanel). Fix = sort by a stable creation/user order, not count/current.

### Noam's answers to my second round of questions (verbatim where quoted)
- Empty group (last terminal closed): **"Stay in place"** — row stays in its slot, shown empty, nothing below moves.
- Permanent order: **"1 but the user should be able to change and rearrange that - if he does the group swaps position and he can change the order of terminals in the same group but not seperate a terminal from one group to another in the by project section in the manual it should be more dynamic"**. I asked to clarify; he picked: **by-project view = FIXED rules; manual view = dynamic.** Meaning:
  - "By project" view: one flat list, creation order, new at end (no pinned/selected jumping, no category sections). User may drag a group to swap places, and drag terminals to reorder WITHIN their own group, but NEVER move a terminal to another group.
  - "Manual" view: free/dynamic — terminals may be dragged between groups. (Find where the sidebar has these two views; not yet located. Check what "manual" currently is in WorkbenchSidebar.tsx / workspace store.)
- Helper terminal whose parent closed: **stays in place with its helper marker** (keeps slot + badge).
- Icons: **group icons only** (terminals keep plain glyph until user picks one).
- Noam then added: **"more qurestions as needed"** — i.e. keep asking whatever is still unclear before designing.

### Still-open questions worth asking (one or two at a time via AskUserQuestion)
- Pinned groups: now that order is creation-order, does "pin" still do anything (keep on top?) or get dropped in the by-project view?
- Where do the category sections (DevOps, etc.) go — removed entirely in by-project view?
- Existing groups today have no creation order: lock the CURRENT on-screen order as the starting order? (Recommended yes.)
- Does the stable order also apply to the map's project list / fleet list, or sidebar only?
- Duplicate emoji: auto-picked stay unique at pick time, user-picked may duplicate?
- Does the "selected group" highlight remain (visual only, no reordering)?
- Helper badge style (suggest small "↳"/robot glyph + indent under parent).
Then re-present the full design in 4-6 plain sentences and wait for an explicit YES. No code before that.

### State
No source files changed by either instance. Only this HANDOFF file is mine and uncommitted (commit it alone). The brainstorming gate is still NOT passed.

## First command to run

`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && npm run issues -- check && npm run issues -- list` (project rule), then read SessionsPanel render body in `src/components/WorkbenchSidebar.tsx` around lines 4900-5200 to find the ordering code, then ask Noam the next question.

## UPDATE 3 (third instance) — DESIGN APPROVED. BUILD IT.

### Noam's final answers (third round)
- Pin + category sections (DevOps etc.): **Remove both** in the by-project view (one flat list, own order).
- Starting order: **Lock the current on-screen order** (new groups appended at the end).
- Scope: **Yes, everywhere** — sidebar, map, fleet list all read the same order + icons.
- Helper marker: **Indent + small ↳ badge** (keeps slot + badge even if parent closed).
- Then I presented the full design (order fixed/creation-order, drag group to swap, reorder terminals only inside own group in by-project view, manual view free; group icons permanent/locked now, released when group closed, full emoji picker, auto-picks unique / user picks may duplicate; helpers indented with badge) and Noam replied **"yes"**. Brainstorming gate PASSED. He also sent a screenshot: by-project view shows terminals under the WRONG project heading — "freelance-desk" cards under the BOTSON heading, and a "botson" terminal card under the IN-CONTROL-KERNEL heading (red arrow at the botson card). So ALSO fix: a terminal must appear under its OWN project (check how buildProjectSidebarModel assigns tabs to groups — likely by group id vs cwd/projectRoot mismatch; reproduce from live data before fixing; note one terminal's cwd is bots+automation/botson while its group is in-control-kernel — inspect which is truth, don't guess).

### Next steps (in order)
1. Declare a plain cockpit task (in_progress). Say up front if a command kills terminals.
2. `npm run issues -- check && npm run issues -- list`; create a new issue (next free TF id) for "sidebar order/icons/helper marker + terminals under wrong project"; record before touching production code.
3. Implement: sort in `src/lib/projectSidebarModel.ts` (`compareProjects`) -> stable order key persisted on Group (migrate: lock current on-screen order); drop pinned/current/count sorting and category sections for by-project view; drag swap groups + within-group terminal reorder; `reconcileProjectGroups` (workspace.ts ~931) stop re-deriving emoji (lock existing; release on group close); delete 2nd derivation in MagicCanvas.tsx ~6894-6914; project menu must offer full EmojiPicker; helper ↳ badge + indent via `Tab.childOf`; map + fleet list read same order/icons.
4. Patch .ts/.tsx surgically (script file, not whole-file reformat — see memory formatter-breaks-source-verifiers). Work on main; stage only own files (other agent changes exist: issue-registry.json, baselines pngs, verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, tests/scratch-eval.spec.ts are NOT mine).
5. `npm run build`, regression test, `npm run release:install`, `npm run verify:installed-release`, check `npm run doctor` launch mode; verify in the real app with a screenshot; update issue evidence + MASTER_PLAN.md.

### State
No source changes yet. Only HANDOFF-sidebar-stability.md is mine (commit it alone). First command: `cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && npm run issues -- check && npm run issues -- list`
