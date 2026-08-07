# Handoff — 2026-07-29 17:32 Wednesday

You are continuing work in **termfleet** on branch **main**.

## Current task & next step

The cockpit card now shows a stable GOAL on top and a live "Now:" line under it — next:
have the operator relaunch from the dock and confirm on screen, then chase whichever card
still reads "No task declared" while its session clearly has a goal.

## Files touched / in flight

All of this session's work is COMMITTED and PUSHED (HEAD `2d3926f`). Touched:

- `src/lib/taskLine.ts` — the ladder. Goal rungs only (`declared` → `session-title` →
  `operator-request` → `opening-request` → `pending-question` → `running-command` →
  `shell-state`), plus `resolvePaneNowLine` for the second row and `preferPaneTaskLine`
  (rank-based, never downgrades).
- `src/lib/sessionTranscript.ts` — `openingRequest`, `pendingQuestion`, `looksLikeSlug`,
  `opensAsRequest` (the "is this a request or a reaction" rule used everywhere).
- `src/lib/agentStatusSummarizer.ts` — injectable readers, head/tail transcript reads,
  per-session opening-request cache, returns `{taskLine, nowLine}` on EVERY path.
- `src/lib/statusPollLoop.ts`, `statusPollProjection.ts`, `stores/workspace.ts`,
  `components/Terminal.tsx` — both lines written for every pane and persisted.
- `src/components/MagicCanvas.tsx` — the card: fixed two-line goal row + reserved "Now:" row.
- `src-tauri/src/commands.rs` + `lib.rs` — `session_transcript_head_read` (64 KiB head).
- Specs: `task-line*.spec.ts`, `cockpit-card-shot.spec.ts` (renders + screenshots a card),
  `cockpit-row-stability.spec.ts`, `pane-label-audit.spec.ts`, `terminal-attention.spec.ts`.

**Uncommitted files in the tree are NOT yours** — another session is doing icon/branding
work (`src-tauri/icons/*`, `index.html`, `render-icon.mjs`, `docs/*`). Never `git add -A`.

## Key decisions & gotchas

- **Goal row = goal sources only.** Momentary sources (current step, agent sentence,
  current tool, last finished step, note) are barred from it — that is what produced
  "Task: Updating the plan" changing every few seconds. They belong to `resolvePaneNowLine`.
- **The operator's own words get the lenient gate** (`qualityCheckUserAskLabel`), not the
  strict one: typos ("dont") and openers ("is there…") are theirs and are valid. The strict
  gate is for text scraped off a screen.
- **A reply is not a goal.** `opensAsRequest` rejects <4 words, short demonstrative
  openers, reactions with no action word, slash/`$` commands, harness blocks, pasted code,
  and ≥200-char pastes. That one rule guards the sidecar prompt field, the vendor
  `last-prompt` record, and both transcript scans.
- **The card renders in `MagicCanvas.tsx`, not `SplitPane.tsx`** — a whole round was wasted
  editing the wrong header. MagicCanvas also has TWO card headers: the agent-status block
  (`Working on`/`Path`/`Now`) and the terminal-status block (`Task:`); the operator sees the
  second.
- **Verify by RENDERING, never by unit test alone.** Three "relaunched, nothing changed"
  rounds came from shipping unrendered changes. `npx playwright test
  tests/cockpit-card-shot.spec.ts` draws a real card and writes
  `.captures/cockpit-card-goal-and-now.png` — look at it.
- Playwright's chromium had to be installed once (`npx playwright install chromium`).
- **13 failures in `terminal-summary-visual.spec.ts` are PRE-EXISTING** (identical on the
  pre-session baseline `e93885b`) — another session's in-flight header work. Same for
  `terminal-header-state.spec.ts:51` and ~9 in `agent-workstream.spec.ts`. Check a
  suspicious failure against a worktree of the baseline before "fixing" it.
- Normal operator use and acceptance are dock-only. The dock opens the immutable
  installed release; source changes do not count until `release:install`,
  `verify:installed-release`, and the installed restart smoke pass.
- To settle "is my code even loaded", run `doctor`: it compares the installed
  dock checksum with the current release build and fails when they differ.

## Env / run state

Branch: main | Last commit: `2d3926f` fix(cockpit): the goal row states a goal; the moment
lives on its own row
Running: the dock targets the immutable installed release; the PTY daemon owns the
terminals and survives relaunch.
Gates: `npm run verify:task-line` (54/54), `npm run audit:panes`, `npm run cockpit:why`
(per-pane goal + rung over the REAL records), `npm run doctor` (now reports "Task line
coverage").

Start by: running `npm run cockpit:why` and comparing its per-terminal goal against what
the operator sees after relaunching from the dock.
