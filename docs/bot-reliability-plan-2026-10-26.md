# TermControl bots — e2e review and fast-fix plan (2026-10-26)

Source complaints: Obsidian "Complaints Tracker" (27 items; #7, #12, #13, #15, #20, #21, #24, #27 are the ones this plan targets).

## What was measured (live, today 12:30)

| Area | Measurement | What it means |
|---|---|---|
| Machine | load 19.5 on 24 cores; 104 node, 22 codex, 17 cargo/rustc processes | Everything competes for CPU; bot turns run with idle-class disk priority (`ionice -c3`) so they lose every contest |
| Agent start | `claude mcp list` (health-checks every server one by one) = 37 s; ~19 tool servers per Claude start; lean-ctx timed out in that check (connected in the last bot run); playwright/chrome-devtools start through `npx …@latest` | Startup is heavy. NOT proven: that this is what makes terminals "not start" / "stuck on update" — that needs a timed start of a real terminal |
| Bot turns | Claude bots run `claude -p` fresh per message without `--strict-mcp-config`; Agent-Manager's last run log confirms all 19 servers + every SessionStart hook load each turn | Measured cost: first sign of life 6-17 s median (not 37 s). How much of that is startup vs. the model is not yet split out. Reply 19-86 s median, p90 up to 4 min |
| Hand-off to terminals (7 days) | 26 "NOT delivered", 12 "NOT started", 21 "terminal is gone" | ~1 in 20 hand-offs silently fails; the bot is told, but nothing retries |
| Request queue (7 days) | 1,944 items still `new`, 852 `partial`, only 39 `assigned`; 11,958 open items older than a day | Every message is split into items, nobody drains them, so real asks drown. "Not checked and queued enough" |
| Watchdog | Looks every 15 min, only after 30 min silence, only for panes marked `working` | A terminal stuck on a startup prompt (marked idle/unknown) is never caught; detection takes 30-45 min |
| Bridge | Killed by SIGKILL once (1.7 GB peak, 1 GB heap cap); pane list = 234 records for **6** live terminals, 109 ms sync per call; status folder holds 30,691 files / 7.5 GB | Slow phone view, stale terminals counted as real (complaint #18) |
| Codex disconnects (#27) | All Codex terminals share one background service; it restarted ~11:54 and auto-update ran 12:05 | Likely cause of "Server connection could not be restored" (hypothesis, not yet proven) |
| Tests | 171 test files; full run exceeds 10 min; 9 failures seen, incl. "bot brain cannot edit" (bots can now Edit/Write) | The safety net is slow and red, so regressions ship |

## Measured follow-up (13:00–13:25) — where bot time really goes

Model endpoint pointed at a dead local port for every probe, so no cloud model call was made.

| Measurement | Number |
|---|---|
| Bot start to ready, today (19 tool servers) | 3.3 s (same with Agent-Manager's 62 MB history resumed) |
| Same, only the bot's browser tool (`--strict-mcp-config`) | 1.7 s |
| Same, also without user-level settings | 0.6 s (not shipped: would drop safety hooks, skills, plugins) |
| Bot turn length (journal, 33 turns) | median 59 s, p90 6 min; turns over 5 min = 59% of busy time |
| Per tool call inside bots (3 days of transcripts) | `termfleet-asks …` 2–4 s median, `termfleet-team send` 6.6 s, `start` 7.8 s (p90 66 s), `ask` 124 s (blocks the bot's only lane) |
| Same commands run directly | 50–170 ms |
| lean-ctx PreToolUse `rewrite` hook | ~0.6 s every shell step, every agent (no switch turns it off) |
| lean-ctx PostToolUse `observe` hook | ~0.6 s every step; 4 ms with `LEAN_CTX_DISABLED=1` |
| Correction | the earlier "lean-ctx wrapper adds 1.4 s" was a one-off; re-measured at ~10 ms |
| Leaks | a bot scope from Sat 13:25 still holds a lean-ctx daemon (360 MB + 4.4 GB swap); the bots' Chrome lives inside one bot turn's scope |

**Shipped 13:25 (bridge restarted, terminals untouched):** Claude bot turns now start with `--strict-mcp-config` and `LEAN_CTX_DISABLED=1`. Expected: ~1.7 s faster start per turn and ~0.6 s less per tool call. Off switch: `TC_BOT_FULL_TOOLS=1` in the bridge's environment. Lost for bots: the two context-mode search tools (WebFetch remains).

**Biggest remaining levers, by measured size:**
1. `termfleet-team ask` and other waits block the bot's single lane for minutes; Noam's next message waits behind them. Make waits asynchronous (follow + event) instead of in-turn.
2. lean-ctx `rewrite` hook: 0.6 s per step for every agent. Update lean-ctx (3.10.0 → 3.11.4 available) or skip the hook for non-shell-heavy agents. Global change, so it needs Noam's OK.
3. Codex bots still load every Codex tool server (incl. `npx …@latest`).

## Plan — in order, each step small and reversible

### Phase 1 — make starts fast (biggest win, ~1 day)
1. Bot turns: add `--strict-mcp-config` and a minimal settings file (only the hooks a bot needs). Target: first sign < 3 s, reply median < 15 s.
2. Terminals started by bots: launch with a lean tool profile (lean-ctx + browser only) instead of all 18 servers; heavy tools (Blender, Resolve, Unreal, Higgsfield, reddit…) only for projects that use them.
3. Pin versions: replace every `npx …@latest` with an installed local copy (bots already do this for playwright).
4. Fix or drop lean-ctx's MCP startup (30 s timeout on every start).
5. Remove `ionice -c3` from bot turns; keep low priority only for background builds.

### Phase 2 — never lose a hand-off (~1 day)
6. Hand-off becomes a job with retries: not delivered → retry twice → start a fresh terminal → only then tell Noam.
7. Startup prompt detector runs on every new terminal for its first 2 minutes (trust prompts, "hooks need review", login, update screens) and answers/escalates within 30 s.
8. Watchdog every 2 min instead of 15; checks all panes that hold an assigned item, not only `working` ones; "silent" = 5 min for a fresh hand-off.

### Phase 3 — a real queue (~1 day)
9. One dispatcher per bot: open items are picked up in order, max N terminals per bot, the rest wait visibly ("3 queued").
10. Stop splitting every sentence into a request; only real asks become items. Archive the 11,958 stale items.
11. Agent-Manager (complaint #20) works from that queue instead of going idle.

### Phase 4 — keep it healthy (ongoing)
12. Prune status folder (keep 7 days), drop dead panes from the bridge list, raise bridge heap or stream its reads.
13. Pin Codex auto-update to off-hours so it never restarts the shared service mid-work; prove/deny the #27 link.
14. Split the test suite: a 60-second "bots core" gate that must be green, the slow GUI suite nightly. Fix the 9 failures.

## Proof required before calling any step done
- Measured before/after numbers (start time, reply time, failed hand-offs per day) from the bots' own chat records.
- Noam confirms on the phone. Nothing is "fixed" until he says so.
