# Handoff — 2026-06-21 09:23 Sunday

You are continuing work in **termfleet** on branch **main** (TC-033: the cockpit
task/activity display — what each agent pane shows as its title + TASKS panel).

## Current task & next step
The reliable model is in place: title = real task → live running command → clean status;
plus a **recent-activity feed** (the AI's real actions) in the panel when there's no task
list. **Next (agreed with the user):** make the activity the **agent's own declared
words**, not inferred — add a Claude Code **`Stop` hook** that reads the agent's last
narration from `transcript_path` (in the hook payload) after each turn and writes a short
"what I'm doing" line into the status sidecar's `now`/`recent`, which the title/summary
already pick up. i.e. "the model writes in the log, the task summary picks it up."

## Files touched / in flight (all committed, tree clean)
- `scripts/termfleet-claude-status-hook.mjs` — the status hook (captures TaskCreate/
  TaskUpdate + tool activity + a rolling `recent` log). **This is where the new Stop-hook
  narration capture goes.** Registered in `~/.claude/settings.json` → MAIN checkout copy.
- `scripts/agent-status-summary-sidecar.mjs` — the no-model worker (sidecar → summary,
  emits `tasksFromTodoWrite`, `recent`).
- `src/lib/terminalHeaderDisplay.ts` — `preferRealTaskSummary` + `neutralHeaderTitle`.
- `src/components/SplitPane.tsx` AND `src/components/MagicCanvas.tsx` — BOTH render the
  title; user mostly views the MAP (MagicCanvas). Recent-feed UI is in MagicCanvas's
  `TerminalBodyTaskSidebar`; SplitPane's `AgentTaskSidebar` still needs the same feed.
- `run-native-vte-dev.sh` + `scripts/tauri-dev-with-status.sh` — both launchers.

## Key decisions & gotchas (high-value)
- **`TodoWrite` is deprecated** (Claude v2.1.142+) → agents emit **`TaskCreate`/`TaskUpdate`**.
  The hook captures those into `~/.local/share/terminal-workspace/agent-status/<fnv(cwd)>.json`.
- **NO local model (Ollama) for status** — too slow (qwen3 25s, thinking-mode); the user
  killed it twice. Default worker is the no-model sidecar worker.
- **The window kept looking "stale" but actually had the new code.** VERIFY VISUALLY:
  `DISPLAY=:0 import -window 0x04200003 /tmp/x.png` then Read it (crop+enlarge with
  `convert`). Don't assume stale; a normal pane proved the new code was loaded.
- **WebKitGTK disk-cache** served stale JS across relaunches → disabled in BOTH launchers
  (`WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED=1`). `npm run tauri:dev` uses
  `scripts/tauri-dev-with-status.sh` (not run-native-vte-dev.sh). `Ctrl+Shift+R` is eaten
  by the terminal; nudge a reload by touching `src/main.tsx`.
- I CANNOT kill the dev stack / daemon (classifier blocks it — protects live sessions).
  The user relaunches via `termfleet`. Daemon `855657` owns PTYs — never kill it.
- Cockpit is for **non-developers** — status must be plain. CLAUDE.md/AGENTS.md now
  instruct agents to record plans via `TaskCreate` in plain language.
- Commit only your own files (concurrent agents on this repo). Work on `main` (user pref).
- Status server runs on `127.0.0.1:37819` (sidecar worker); it spawns the worker per
  request so worker `.mjs` edits are live without restart; frontend edits need a reload.

## Env / run state
Branch: main | Last commit: 95e9c45 [TC-033] title: command is 'live' only if running AND recent (<60s)
Running: TermFleet dev app (window id `0x04200003`), vite :1420, daemon 855657, status
server :37819 (sidecar worker). App launched via `termfleet`.
Relevant memory files exist (tasks-panel-sidecar-join, status-title-no-local-model,
dev-window-stale-code-webkit-cache, work-on-main-not-branches) — auto-loaded.

Start by: open `scripts/termfleet-claude-status-hook.mjs`, add a `Stop`-event branch that
reads the agent's last assistant message from `payload.transcript_path` and writes a
short plain-language "now" line into the sidecar — then register the Stop hook in
`~/.claude/settings.json`. Verify by screenshotting the live window.
