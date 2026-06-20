# HANDOFF — 2026-06-20 10:33 Saturday

```
You are continuing work in termfleet on branch `integration`
(worktree: .claude/worktrees/integration).

## Current task & next step
All active branch work is consolidated + verified on `integration`. Next: have the
user review, then merge `integration` → `main` (it's clean and NON-stale vs
origin/main). THEN tackle the open TC-033 piece: the live TASKS panel shows
"No task list captured for this run" because the authoritative todo-write emitter
is not wired.

## Files touched / in flight
Tree is CLEAN (everything committed). `integration` HEAD = d3d1a24 with three merge
commits: 75caffb (tc-release-hardening), bff67be (tc-034-project-grouping),
d3d1a24 (tc-033-tasklist). The one hand-resolved conflict was
src/stores/workspace.ts::reconcileProjectGroups (union of HEAD's pathBelongsToProject
+ emoji AND tc-034's dedup/remap) — re-read it if grouping misbehaves.

## Key decisions & gotchas
- Rollback tag `pre-integration-20260620` → the pre-merge live HEAD (7f96237). Use it
  if a merge needs undoing.
- CONCURRENCY: other Claude sessions are/were active on `tc-033-reliability` (live,
  the app the user RUNS) and `tc-033-tasklist`. Only their COMMITTED state was merged;
  their uncommitted edits stay with them. Work in worktrees, stage only your own files,
  never `git add -A`. Renaming productName→"TermFleet" earlier broke 10 GUI verifiers
  that search the window by title (already fixed to "TermFleet").
- Worktrees symlink node_modules to the main checkout (`ln -s ../../../node_modules`).
  Rust: reuse the shared target via
  `CARGO_TARGET_DIR=/media/endlessblink/data/my-projects/ai-development/devops/termfleet/src-tauri/target`
  to avoid a from-scratch (OOM-risky) build; `CARGO_BUILD_JOBS=2`.
- Playwright specs hardcode executablePath `/usr/bin/chromium` — symlink Playwright's
  chromium there if missing.
- DO NOT merge to main without the user's go-ahead (branch-safety rule).
- The full emoji picker (1914 emojis) is live in tc-033-reliability AND integration:
  src/lib/emojiData.ts + src/components/EmojiPicker.tsx, wired in WorkbenchSidebar
  (project menu = embedded; terminal menu = "more" button). Regenerate the dataset
  with scripts/generate-emoji-data.mjs (transient unicode-emoji-json dev tool, no
  runtime dep).

## The TASKS-panel-empty fix (TC-033 open lane)
The panel reads a `todo-write` marker from VISIBLE terminal output; Claude Code's
TodoWrite never emits it. Per MASTER_PLAN TC-033 notes this is BLOCKED on a backend
change: src-tauri/src/vt_grid.rs must extract+strip an invisible
`[[TERMFLEET_TODO_WRITE]]` marker from the daemon byte stream BEFORE rendering (today
onOutput is built from alacritty grid cells — TerminalCanvas.tsx:382-387 — so an
OSC/invisible form is consumed by alacritty and a plain-text form renders as garbage).
After that, add a global Claude TodoWrite hook + `cmd.env("TERMFLEET","1")` in
pty.rs. Until then the panel only shows model/heuristic-extracted items
(src/lib/taskLineup.ts::visibleTaskLineup).

## Env / run state
Branch: integration | Last commit: d3d1a24 Merge tc-033-tasklist into integration
Verified GREEN on integration: tsc, npm run build, cargo test 72 passed,
verify:rust-warnings, verify:public-audit, verify:oss-readiness, 57 Playwright specs
(canvas-all + reconciliation + map + emoji + tasklist). NOT run: live verify:canvas-live
(GUI, disruptive).
Running: user runs the app from the MAIN checkout on tc-033-reliability via
./run-native-vte-dev.sh.

Start by: cd .claude/worktrees/integration && git log --oneline --graph -8 to confirm
the three merges, then either (a) merge integration→main on the user's go-ahead, or
(b) implement the TC-033 vt_grid.rs todo-write marker strip so the TASKS panel fills.
```
