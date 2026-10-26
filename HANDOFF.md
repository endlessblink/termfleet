# HANDOFF — 2026-10-26 19:53 Monday (Israel time)

You are continuing work in **termfleet** (`/media/endlessblink/data/my-projects/ai-development/devops/termfleet`) on branch **main**. You are a Claude Code instance. The owner is **Noam** (Hebrew name נועם, never נוח). He reads on a phone and wants answers of 1-3 plain sentences: no jargon, paths or code. Never ask him to run commands. Before any command, say plainly whether it kills terminals.

---

## 0. URGENT — first thing (in flight when the session ended)

**At 19:45 the TermFleet desktop app's layout was reset to a single default tab.**

What the evidence shows:
- `~/.local/share/terminal-workspace/workspace.json` now has 1 tab: id 94f9dea5, "Terminal", with 0 terminals and 1 canvas node at the default 120,100. It was written at 19:45:22.
- At 19:45:14–21 the app spawned 4 fresh idle bash shells: terminal-cb20d699, f7be8b9d, bdc8ac9a, f543a3c6. The lifecycle log shows them as `spawned fresh`.
- 11 terminals are still running in the daemon (pid 2068834, since 24 Oct 20:57). They are not lost, but no tab references them. So `fleetPanes()` / `reconcileLivePanes` returns 0 panes.
  - TermControl and `termfleet-team list` therefore show no terminals or only one. This is Noam's complaint "it says it has one terminal live when there were many".
  - Noam's plain Claude session in Konsole also says "the agent list suddenly shows no terminals".
- The app process is pid 3902917 (`~/.local/bin/termfleet`), running since 25 Oct 19:36. It was NOT relaunched.

**Probable trigger (correlation, not proven):**
- At 19:44:45 and 19:44:57, a politic-fighter Codex agent (rollout thread `01a1793b-0743-7a31-b79a-850aeae66ab6`, file `...T19-21-14-01a1793b...jsonl` in `~/.codex/sessions/2026/10/26/`) ran `termfleet-child spawn --provider codex --cwd .../politic-fighter --dropoff /media/endlessblink/data/.dev-tmp/endlessblink/POLITICAL-HIT-RELEASE...`. That is a HANDOVER that replaces the caller's card.
- The app's handover handling lives in `src/lib/childRequestLoop.ts` (lines ~86-280; predecessor/replaces logic, "handoff-workspace-changed"). It may have reset the store.
- Another candidate is localStorage over quota: the storage file is 5.3 MB, and WebKit's quota is 5 MB (see memory note TF-048 "full localStorage").
- The root cause is NOT yet proven. Do not claim it.

**The good layout still exists on disk, with 51 tabs and 51 canvas nodes:**
- Live file: `~/.local/share/io.github.endlessblink.termfleet/localstorage/tauri_localhost_0.localstorage` (sqlite ItemTable, key `terminal-workspace.v1`, UTF-16LE JSON). It is dated 25 Oct 19:36, the last WebKit flush.
- Backups made: `.backups/app-storage-51tabs-1953.localstorage` and `/media/endlessblink/data/.dev-tmp/endlessblink/ls-copy.sqlite`. The 1-tab state is saved at `.backups/workspace-1tab-after-reset.json`.
- Danger: closing the app will probably make WebKit flush its in-memory 1-tab state over the good file. Keep the backup and restore it after the app is closed, before the relaunch.
- Tabs created after 25 Oct 19:36 (today's helpers) are not in that copy. Their live sessions need tabs added; see `scripts/recover-sessions.py` (it targets the old dev storage path; adapt it to the release path above).

**Recovery plan (needs Noam's go, because it closes his app window):**
1. Tell him: closing TermFleet does NOT kill terminals; the daemon keeps them, and they reattach after relaunch.
2. Close the app process only. Never kill the daemon.
3. Restore the 51-tab storage file from the backup.
4. Add tabs for the live sessions that are missing.
5. Noam relaunches from the dock.
6. Verify with `node scripts/termfleetctl.mjs sessions list --json` and the fleet list.

Also find and fix the cause so it cannot recur. If it was the handover path, reproduce it safely with a throwaway handover.

Open Noam items about this:
- R-18206 (#43): "termfleet keeps opening terminals and keeping them open instead of killing when finished + it says it has one terminal live when there were many". Also part of it: 7 agent terminals were started by helper agents, not by bots — Moves review 1-4, Flagged animations redo, Release sweep, and an old Codex from 00:08. No bot owns them, so nobody closes them, and bots don't count them.
- #44 "/dropoff" (this handoff).

---

## 1. Original request (Noam, verbatim) and later words

First message:
> "run a deep e2e review of how termcontrol bots are fucntioning. you can refrence my comlaint list in obsidian. right now they are doing things super slow, the terminals that they are running crash, dont start, get stuck on update, not being checked and queoud enough etc. I need a plan to quickly fix everytthging to make this system reliable and fassssst. I need agents to work fast and reliably to actually deliver."

Later, in his words:
- "find root causes and not sypmptoms"
- "you must use the proper skills"
- "I wanted a concise answer!"
- "why are you building what you are building" / "how have you proved that it is the correct choice"
- "/sure so get sure on high"
- "create a goal and dont stop"
- "only make syure that evertything is passing on high"
- "and all agents / terminals / control agents and whatever should be able to see images I paste"
- "run an agent that will inquire why terminals opened by control agents crash over and over"
- "My name in hebrew is נועם"
- "what about terminals that need to update claude / codex when they are opened and crash because of that?"
- "it is still really failing compared to a clear claude code instance" / "you can compare both and the productivity of the termcontrol one is really really low"
- "haiku should be used only for seraches"
- Asked whether the strongest model should be used: "when I work with sonnet it works great. I think something is broken in how termfleet is using it"
- Chose **"Bundle the messages"**. Later evidence reversed it: it was turned off because Codex turns never ended (see section 3).
- Chose **"Lighter tracking"** (remind once, list only when he writes, one link as proof).
- "[Image #11] horrible exprience", "[Image #12]": the politic bot's animations were never changed; "רק מבזבזים טוקנים" (just wasting tokens).
- "so fix all of this e2e"
- "https://control.in-theflow.com/login why do you keep opening this window?" (fixed, see section 3)
- "termfleet keeps opening terminals and keeping them open instead of killing when finished + it says it has one terminal live when there were many" (OPEN, section 0)

**Goal set by Noam via /goal (a Stop hook enforces it):**
1. Every terminal a bot opens starts, never silently dies, and is shown truthfully. A dead one is detected from proof and replaced, without flooding any chat.
2. No request is dropped.
3. Every agent sees the images he pastes.
4. All 27 complaints are done one by one: trace, prove the root cause, /sure HIGH, fix, verify live, check the full suite shows no new failures, mark with evidence.
5. Nothing is called done without proof. Answers are 1-3 sentences, and work doesn't stop until done or blocked on him.

The complaints tracker is in Obsidian: `/home/endlessblink/home-data/app-data/sync/Dropbox/OBSIDIAN_SYNCED/MAIN VULT/🚀 My Projects/🤖 AI Development/🛠️ DevOps/termfleet/Complaints Tracker.md`. It was updated today for #1, 4, 9, 10, 12, 13, 14, 15, 17, 19, 20, 21, 22, 23, 24, 26, 27, plus new #28 (trust prompt) and #29 (crash investigation).

The plan doc, with all evidence, the baseline and a verifiable plan, is `docs/bot-reliability-plan-2026-10-26.md`.

---

## 2. House rules / constraints (do not break)

- **/sure gate:** every code edit needs `termfleet-sure "1. Root cause: … 2. Confidence: HIGH 3. … 4. Fix: … 5. Side effects: …"` first. It re-locks on every Noam message, and sometimes needs a second try.
- **No cloud LLM calls.** For tests, use dead endpoints:
  - Claude: `ANTHROPIC_BASE_URL=http://127.0.0.1:9`.
  - Codex: `-c model_provider="dead" -c model_providers.dead.base_url=...`.
  - `codex exec resume --ephemeral` WRITES into the original rollout. That was proven, and Life-Boat's rollout was repaired from a backup. Never resume a real conversation for tests.
- **Shell restrictions:** heredocs, `node -e`, `python3 -c`, `bash -lc`, `case`, `truncate` and `rm -rf` are blocked. Write scratch scripts in the session scratchpad and run them with node/python3. `grep` is rewritten to rg (a pattern containing `(` breaks); use `grep -F`.
- **Never `sleep` in the foreground.** Use `run_in_background`.
- **Mid-task replies go out with `termfleet-say "<text>"`**, and Noam's items are marked with `termfleet-asks ready|partial|answered|context <id> …`. ready/done need a real link; a path with spaces fails.
- **Commit only your own files.** Other agents work in the same tree: Agent-Manager's healthcheck Codex agent (terminal f69edd4c, recovery work, `terminal-health.mjs`) and SQL-hook agents. For a shared file, stage HEAD plus your hunk (`git hash-object` + `update-index`).
- **Bridge restarts do NOT touch terminals:** `systemctl --user restart termcontrol.service`.
- **TermFleet app frontend changes** need a release build from a clean worktree. Set `CARGO_TARGET_DIR` and symlink `src-tauri/target`, then run `bash scripts/install-release.sh`. Noam relaunches from the dock; terminals survive a relaunch (the daemon is reused).
- **Run tests from the repo root:** `node --test termcontrol/test/*.test.mjs`. It takes over 30 minutes; run it in the background with `timeout 3600`. Some tests spawn `termcontrol/bridge/server.mjs` from cwd and fail when run from `termcontrol/`.
  - The old-commit worktree for comparison is `/media/endlessblink/data/.dev-tmp/endlessblink/tf-head-1526` (commit a5773e7).
  - A pgrep-based wait loop matched itself and never ran; don't use `pgrep -f` on your own command text.
- **Do not hand over or spawn successors** unless Noam asks. He asked for this one with /dropoff.

---

## 3. Done today (all committed on main, live after bridge restarts) — with proof

- **a5773e7, 7e8882b, a8b9456, 828c454:** stuck detection from the agent's own conversation record (20 min).
  - `stateOf` returns `stuck`; close is allowed; `waitForReply` returns.
  - The bot digest says STUCK and drops closed terminals.
  - bot-events wakes the bot once ("crashed: close and replace") and lists the terminal's unfinished requests on finish or crash.
- **Codex `--no-daemon` wrapper** at `~/.local/bin/codex` (not in the repo). It stops the shared app-server restarts that killed 4 Codex terminals.
- **c0b6dc8, 2e4d2ec:** the screen reader keeps spaces and lines (cursor moves read as layout). Claude's unnumbered trust menu is answered with Down+Enter; Codex's "Trust this folder? 1." is answered with its number. Both were proven on throwaway agents.
- **dbabfc2, 3f0d839:** pictures reach quick replies, Codex bots (`--image=`) and helper terminals. Picture lines are pasted alone first, which attaches them in Claude and Codex. Proven end to end on throwaway agents.
- **9119f70, 52b42fa, 45ae1bc:** agent reports and picture-prefixed teammate messages are no longer recorded as Noam's requests.
- **5eb1b04:** bot helpers start in Codex unless the task needs Claude. **2d8c80d:** Haiku is used only for searches.
- **7d45355 (app release installed):** Haiku helpers run with acceptEdits. Takes effect after the app relaunch.
- **e1c8dc6:** reminders name the terminal. **71fbaba:** the name נועם is in the bot brief, and fact F-042 is in Noam's facts file.
- **3071c7a:** a broken hand-off promise wakes the bot.
- **128ba73:** terminal names (`--name`, or derived from the task).
- **334d5d4 then e4d0aae:** holding messages for busy Codex agents was tried and backfired. 65 messages were stuck because Codex turns lasted 1.5 h+. Holding is now opt-in (`TERMFLEET_HOLD_BUSY=1`). The bot's 7 lost instructions are in its steer inbox (`~/.config/termcontrol/bots/d557f3283bc8/steer/001793032685204-termfleet-held-notice.json`); not yet consumed at 18:43. The full texts are in `~/TermFleet/bots/politic-figther_dev/undelivered-to-613b486f.md`.
- **4838cc7 (Noam chose lighter tracking):**
  - The Stop items gate fires once per finish.
  - The requests list is shown only when Noam writes, max 5, never on resume.
  - The brief says ship first, one link, no proof files.
- **Codex config (`~/.codex/config.toml`, not in the repo; backups in `.backups/`):**
  - `check_for_update_on_startup = false`. The update prompt froze 3 terminals and lost 2 conversations.
  - `model_auto_compact_token_limit` 100k → 200k, against compaction thrash.
- **3928365:** `scripts/bot-scorecard.mjs`. Baseline for politic-fighter over the 24 h to 18:54: 381 commits (57% proof/process), 324 new requests, 161 finished, 632 "partial" re-marks, 127 stop-gate blocks.
- **e2acc66:** the bots' browser refuses to open TermControl, which had popped up a login window 3 times.

**Measured facts to reuse:**
- Bot pipeline vs a plain Claude session: first edit 7.3 vs 3.6 min; 52% vs 0% non-code commits.
- Helper time: 28% making proof, 1% deploying.
- 534 stop-gate blocks.
- Noam's words are under 2% of what workers read.
- politic-fighter has 54 git worktrees.
- Codex sub-agent threads (24 h, politic): 129 subagent and 199 guardian_review.
- Investigator scripts live under `/media/endlessblink/data/.dev-tmp/endlessblink/claude-1000/inv*/`.

---

## 4. Open problems (priority order)

1. **Section 0:** layout reset (restore, then root cause). Orphan agent terminals nobody owns or closes.
2. **Re-measure.** A background job was scheduled at about 20:55, but it belongs to this session and may be gone. Re-run `node scripts/bot-scorecard.mjs --since "$(date -d 'today 18:52' +%s)000"` and compare with the baseline. If the numbers don't move, find the next cause.
3. **Full test suite comparison:** never completed cleanly. Run it from the root in the background on HEAD and on `tf-head-1526`.
   - Known failures that exist without my changes: the "failure 6" ledger test (broken on HEAD by another agent's commit), the watchdog tests in bot-events, the term-ask-pinned browser test, and bot-picture-send.
   - Some browser tests are flaky under load.
4. **#13 false "done" claims:** root cause not found. The reused-screenshot hypothesis was tested and refuted.
5. **The politic bot's own rules** in its bot.json ("check every side branch and worktree", "a link I opened myself") add sweeps. That is Noam's call.
6. **Codex sub-agent fan-out:** a candidate `[agents] max_threads` key exists in the binary, unverified. MEDIUM confidence; not done.
7. **Complaints still needing live verification:** #2, #5, #11 (the bot-provider test fails on old code too), #18 (map count = running count, 6 = 6, verified earlier today), #6/#25 (owned by another agent's SQL work).

## 5. Running processes

- termcontrol.service (bridge, port 7810), restarted at about 19:40.
- Daemon pid 2068834 and app pid 3902917.
- The other agents' terminals: healthcheck f69edd4c, the politic-fighter Codex/Claude helpers, and Noam's Konsole Claude in politic-fighter.
- No test run of mine is running (stopped at 19:50).

**Start by:** running `termfleet-say` to tell Noam you're picking up the TermFleet layout recovery. Then run `python3 /media/endlessblink/data/.dev-tmp/endlessblink/claude-1000/-media-endlessblink-data-my-projects-ai-development-devops-termfleet/18c594ef-b0cd-429e-bd2c-3d87d8654248/scratchpad/ls_peek.py` to re-confirm the 51-tab copy. Then ask Noam for his go to close and reopen TermFleet with the restored layout, saying plainly that his running terminals survive it.
