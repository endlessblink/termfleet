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

## ROOT CAUSE (systematic-debugging, 14:00, traced on a live failure)

**The system has no positive proof that an agent is alive and progressing, and nothing but the bot's language model owns a request.** Every status shown and every bot decision is built from three proxies, and a dead agent passes all three:

| Layer | What it reported for the crashed politic-fighter Codex terminal (TUI pid 3663269, started 12:20) | Truth |
|---|---|---|
| Agent's own status hook (sidecar `turn`) | `working`, last written 12:45 | The agent can't write anything once its backend is gone, so the last claim stands forever |
| Daemon output growth (`producing`) | `producing=true, quiet=0s` | The error screen's ticking timer ("Reconnect failed … 1h 23m 35s") repaints every second |
| Screen reader (`snapshotSession`) | `ok`: a ruler of dots, no error text | It reads raw scrollback, not the drawn grid; Codex's cursor-drawn error isn't readable |
| Codex backend link | — | TUI holds only its own internal socket pairs; the shared daemon it used died after 13:05 (new daemon pid 302981 has no link to it) |

The consequence chain:
1. `bot-events.mjs` `stateOf()` = `producing || turn==='working'` → the pane reads **working forever**.
2. The "finished" wake-up fires only on a working→idle transition → **never fires** → the bot following it is never woken.
3. The watchdog only looks at `working` panes silent 30 min–2 h by the same proxies → **sees nothing** (producing=true).
4. The request ledger is a passive record; no code moves an item when its terminal dies → **request silently dropped**, the header still counts it, and the bot can't name it (it was never told).

Complaints this one cause explains: #5/#24 (fake activity), #10 watchdog, #12 dropped message, #13 "claims handled", #15 stuck terminal unnoticed, #16 wrong counts, #20 manager idles, #21 stuck terminals, #22/#25 bot doesn't know, #27 disconnects shown as working.

Fixes made so far today (Codex `--no-daemon`, quick-answer context, open list per turn) are **symptom-level**; three fix attempts without this cause = the debugging process says stop and change the architecture.

**Checks done before building (14:30):**
1. Normal silence inside a working turn, last 3 days (1,508 Codex rollouts, 386 Claude transcripts): p99 24–28 s; over 10 min only 4 times (Codex) and 46 times (Claude, long tool runs/subagents). "No record for 10 min mid-turn" is a reliable suspicion signal; pair it with "no PTY output" to avoid alarms on long builds.
2. The crashed terminal's own rollout stopped at 12:45:44 mid-turn (last `item_completed`, no `task_complete`) and stayed silent: signal 1 would have flagged it at ~12:56. (The record stopped 20 min before the 13:05 daemon restart, so the daemon died or hung earlier than the updater log suggests.)
3. The drawn-screen text lives only inside the desktop app (`vt_grid.rs screen_text`, attached grids only); the app's shared snapshot file was empty and 11 min stale. The bridge's raw-scrollback reader cannot see Codex screens. Screen reading is a secondary signal only, needing a headless VT in the bridge or the app publishing reliably.

**Independent audit of all 27 complaints (read-only, 14:40):** only #3 (reminder flood) is verified fixed with live data. Fixed but unverified: #2, #5, #11, #18, #24. Partial: #1 (Monitor tool still prompts), #4 (terminal name dropped from reminders, test fails), #7 (p50 163 s over 48 h; 32 s on 8 replies since 13:24), #8 (no ack for Codex bots), #16 (4,920 items "ready", 0 confirmed by Noam). Not fixed: #6/#25, #9, #10, #12, #13 (false "SQL verified" claim at 13:38), #14 ("נוח" at 10:37), #15, #17, #19 (22 Claude vs 22 Codex terminals since 09:00), #20, #21, #22, #23/#26, #27.

**Second root cause found by the audit (#6/#25, the "bot doesn't know" family):** the startup context hook queries the event log with no time filter and gets the 20 oldest rows (25.10 20:03), the rows hold no text (only lengths and tool names), and it reads `BOT_NAME` while the bridge sets `TERMFLEET_BOT_NAME`. So the "cross-session memory" every bot is supposed to have delivers nothing.

**Architecture fix (needs Noam's go):**
- A. **Positive liveness**: an agent is "working" only with fresh proof of progress from its own conversation record (new transcript/rollout entries) within N seconds — never from byte growth or a stale hook claim. Read the screen from the rendered grid (the app already has it: `grid_*`/cockpit snapshot), not raw scrollback.
- B. **A request supervisor in code** (bridge, every 30 s): each open request is a state machine (new → delivered → progressing → done/needs-Noam) checked against A. On "no progress" or "dead" it acts deterministically: wake the owning bot with the exact fault, re-dispatch once, then surface to Noam. The UI shows the supervisor's state, not agent claims.

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

## Afternoon findings (15:00–16:00) — why bot-started terminals fail

A read-only investigation of 93 helper terminals that bots started between 19 and 26 Oct (from helpers.json, chat.jsonl, transcripts and journals). 75 were closed on purpose after finishing. These are the real failures:

| Cause | Cases | Proof | Status |
|---|---|---|---|
| Claude's "trust this folder?" was never answered. The screen reader dropped cursor moves (`ESC[nG`), so the question read "Isthisaproject…", and Claude 2.x shows the menu without numbers. A later message's Enter picked "No, exit". | 8 died, 12 "NOT started" | Real screen bytes of a fresh Claude; Down+Enter accepted live on a throwaway | Fixed, c0b6dc8 |
| The shared Codex app-server daemon was restarted by its updater, and every TUI attached to it died ("Reconnect failed"). | 4 (11:30, 11:42, 11:43, 12:45) | Rollout last-write times, screens, daemon logs | Fixed 13:49 by the `--no-daemon` wrapper. 0 cases since. One pre-wrapper Codex is still exposed. |
| A dead agent was reported as "working" to its bot and to `termfleet-team`. Close refused it, and it counted toward the 3-terminal limit. | 2 | politic-figther_dev was told its dead helper was working for 2 h+ | Fixed, 7e8882b ("stuck" from the conversation record) |
| The terminal service was replaced on 24 Oct at 20:57. Helpers are not tagged as agent terminals, so they come back as plain shells. | 3 | Transcripts stop at 20:56; the daemon started at 20:57; 71/93 have `recoveryKind:null` | Open: tag helpers at spawn |

Ruled out with data: OOM kills (0), bot-turn scopes killing helpers (helpers live in their own pane cgroups), the 3-terminal limit (0 refusals), sleep (0), and auto-cleanup closing a busy terminal (0).

Images (every path checked on real data):
- Claude bot turn: sees images (140/142 opened).
- Codex bot turn: gets the path as text only, with no `-i`.
- Quick reply: gets no path at all. This is the main gap.
- Bot → helper terminal: partial (Codex opened 4/34).
- Direct pane chat and Ctrl+V: see images.

Next, in order:
1. Quick reply and Codex image delivery.
2. Tag helpers for resume.
3. Codex folder-trust.
4. Auto-replace a stuck helper. Agent-Manager's healthcheck agent is building this on `stateOf === 'stuck'`.

## Fixed later on 26 Oct, each with proof (commits on main)

| Commit | Complaint | What was proven, and how |
|---|---|---|
| 7e8882b, a8b9456 | #15, #20, #21 | A dead helper is shown as "stuck", and its bot is woken once to replace it. Tested on unit tests, and on the live digest, which said a dead Codex was STUCK. |
| c0b6dc8, 2e4d2ec | #28 | The screen reader now keeps spaces and line breaks. Claude and Codex trust questions are answered. Proven live on throwaway agents. |
| dbabfc2, 3f0d839 | #23, #26 | Pictures reach the quick reply, Codex bots and helper terminals. Proven on a local stand-in endpoint, and end to end on throwaway Claude and Codex. |
| 9119f70 | — | Helper agent reports are no longer recorded as Noam's requests. A test was added. |
| 5eb1b04 | #19 | Bot helpers start in Codex unless the task needs Claude. Data: 41 of 43 Claude starts were unneeded. |
| 7d45355 | #1 | Haiku helpers accept edits inside their own folder. Data: Haiku ran ask-first 31 of 31 times. Takes effect after the app release and a relaunch. |
| e1c8dc6 | #4 | Reminders name the terminal that is asking. |

Known limit: Codex quick replies cannot use a forked copy. `codex exec resume --ephemeral` was shown to write into the original conversation; the probe's lines were removed and a backup is in `.backups/`.

## Proof required before calling any step done
- Measured before/after numbers (start time, reply time, failed hand-offs per day) from the bots' own chat records.
- Noam confirms on the phone. Nothing is "fixed" until he says so.
