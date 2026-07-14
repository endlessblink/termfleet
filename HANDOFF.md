# Handoff — 2026-07-05 15:56 Sunday

You are continuing work in **termfleet** on branch **fix/canvas-perf-and-wrap-spill**.

## Current task & next step
Cockpit pane headers: every terminal must show, in plain non-technical language,
the user's goal (Task row) + what the agent is doing/its outcome (title). A local-model
pipeline now generates these; the operator keeps finding quality failures.
**Next: implement the operator-approved two-step pipeline in
`scripts/agent-status-summary-server.mjs` — Analyzer (extract core_action/main_object/
status from noisy context) → Translator (plain-English user sentence) — with
`qwen2.5:7b` as default model (pull it first: `ollama pull qwen2.5:7b`) and env
fallback tiers (qwen2.5:7b → gemma4:e4b → gemma4:e2b via `TERMFLEET_CONTEXT_TITLE_MODEL`).**

## Files touched / in flight
- `scripts/agent-status-summary-server.mjs` — the whole contextual pipeline lives here
  (schema-constrained chat calls, few-shots, validator + single-field repair,
  deterministic truncation, confidence threshold 0.45, per-pane cache/queue/last-good,
  disk-scrollback tails). Committed.
- `scripts/termfleet-gate.mjs` (`npm run gate`) — the operator's rules as a per-pane
  floor-check. Committed. **Script green ≠ done: the only acceptance gate is the
  operator approving what they see** (memory: user-approval-is-the-only-gate).
- `src/lib/statusPollLoop.ts` — central store-driven poll for ALL panes (component
  polling silently stopped for background panes). Committed.
- `src/lib/agentNarration.ts`, `terminalHeaderViewModel/Quality/Display/State`,
  `Terminal/SplitPane/MagicCanvas` — header contract + gates. Committed.
- `scripts/termfleet-codex-status-hook.mjs` — Codex sidecar hook; **user must run
  `/hooks` in a fresh Codex session and Trust the entry** (still pending).
- ` M src/stores/workspace.ts` — NOT mine (concurrent session); leave unstaged.

## Key decisions & gotchas
- **Model quirks (hours lost):** gemma4:e4b is a thinking model — WITHOUT
  `think:false` its thinking eats the whole `num_predict` and `response` comes back
  EMPTY (`done_reason: length`). `think:false` + `format` verified WORKING on e4b
  despite research warnings. Re-verify on qwen2.5:7b (non-thinking; param may differ).
- **Serialize Ollama calls** (queue in server): burst timeouts got cached as empty
  for the full TTL → every pane went generic "forever". Empty results expire in 10s.
- **JSON-schema maxLength is NOT decode-enforced** — deterministic truncation
  (clause cut → word cut → strip orphan punctuation) owns length.
- **Never feed our own placeholders to the model** ("Idle until next prompt" →
  it echoes nonsense). `realContext()` filters them. Composer placeholder suggestions
  ("Find and fix a bug in @filename") are firewalled from asks.
- **Remaining known hole (operator-flagged, unfixed):** Claude panes' hook narration
  displays RAW as title (e.g. my own jargon sentence "That last miss was the smoke's
  own thin input…"). Sidecar summaries carry confidence "high" so raw narration passes
  the light gate. Fix: sidecar narration should be model INPUT only — force such panes
  through the endpoint (like completed-list panes already do) or drop sidecar-narration
  display confidence.
- Frontend HMR dies silently after app relaunches — when "tests pass but user sees
  old behavior", compare the tauri-dev window's start time vs last frontend change
  (`ps -o lstart`), relaunch with `./run-native-vte-dev.sh` (daemon keeps terminals).
- Status server restart: `kill $(lsof -t -i :37819)` then
  `nohup node scripts/agent-status-summary-server.mjs &` — safe, never touches PTYs.
- Debug per-pane: `npm run gate`, `npm run cockpit:snapshot`, and the server log
  prints `status <paneId> -> model: …` / `heuristic(<reason>)` per request.
- **Report style (memory-enforced):** concise; never claim "works/passed" — state
  "N/M pass the floor-check; your verdict decides"; every operator complaint becomes
  a gate rule.

## Env / run state
Branch: fix/canvas-perf-and-wrap-spill | Last commit: 47d3824 composer placeholder fix
Running: tauri dev app + vite:1420, status server :37819 (repo script), Ollama with
gemma4:e4b warm; PTY daemon owns all terminals (survives everything).
Operator research (full transcripts in this session): two-step pipeline design,
model tiers, few-shot styles — the pasted Python in the last messages is the spec.

Start by: `ollama pull qwen2.5:7b`, then port the two-step Analyzer→Translator into
`contextTitleFor()` in scripts/agent-status-summary-server.mjs, restart the server,
and run `npm run gate` — then ask the operator for their verdict on the board.
