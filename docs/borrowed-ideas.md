# Ideas borrowed from other agent-team projects

Each entry says where an idea came from, what we take, and how we rebuild it in
TermFleet / TermControl. We rebuild from the idea, never by copying code:
guilds.run is AGPL-3.0 (copying its code would put TermFleet under AGPL);
OpenMausBot is Apache-2.0 (code reuse allowed with notice, but our stack differs).

Status: `building` · `planned` · `idea`

## Current goal (set 2026-10-12, widened same day; run without check-ins)

Make TermFleet + TermControl dependable for long-running agent work, with a clean
experience on phone and desktop. The owner's words: "right now the main issue is
reliability fails", then UI/UX, then "long running tasks without losing context".

Done means, in this order:
1. **Reliability.** Every known way a message, answer or agent gets lost, stuck or
   misreported is listed (issue registry, logs, live checks) and fixed or has a
   tested guard. Compare how guilds, OpenMausBot, Rakazo and gawkbot stay reliable
   (queues that survive restarts, cursors, retries, busy-agent handling) and adopt
   what fits.
2. **Long-running work without losing context.** An agent that runs for hours,
   hits its context limit, or survives a restart/reboot keeps its task, its notes
   and its conversation — and the phone shows what it is doing. Compare their
   memory / compaction / resume designs.
3. **Design, phone and desktop.** A calmer chat-app look (OpenMausBot is the
   reference the owner liked): contacts list, clean bubbles, clear status, in both
   TermControl (phone + desktop browser) and the TermFleet app.
4. **Features in progress:** shared agent rooms (built, being verified), one inbox
   for every agent's question, routines, read replies aloud.

Each step: tests pass, TermControl restarted (never the terminal daemon), checked in
a real browser at phone and desktop sizes. Only stop for something that spends money,
goes public, restarts running agents, or cannot be undone.

## Progress log (goal above)

2026-10-12
- Reliability audit: 93 issues, 63 "verifying" (written, never confirmed live). Keeper (terminal
  daemon) runs a 2026-10-08 build, so every keeper-side fix since then (TF-093 garbled text,
  TF-088 restore folder — already coded) waits for a keeper restart / reboot. Doctor now warns
  "Keeper code age" in plain words.
- Phone sent-log, 14 days: 211 messages. Found one real loss class: a photo + text typed into
  Claude whose Enter was swallowed sat unsent for 30 min (TF-095). Fixed: after sending, the
  bridge watches the next look at the pane and presses submit again (max 2) only while the input
  box visibly still holds that message. Tests: submit-confirm.
- Duplicate sends on slow networks: phone gave up after 8 s while the bridge had already typed;
  a retry typed again. Fixed with one id per draft (send-once). Tests: send-once.
- Wrong status: Claude's own per-process record (`~/.claude/sessions/<pid>.json`,
  idle/busy/waiting) now overrides hook/transcript guesses. Live before the fix: one pane
  waiting on the owner was shown "working". Tests: vendor-status.
- Stalled runs: "working" with no output and no conversation change for 20 min shows
  "No activity 25m — may be stuck" on the phone instead of a calm "working".
- Shared rooms live (see below).
- Memory meter: phone shows "Memory N% full" per agent, read from the agent's own record;
  matched Claude's `ctx:` and Codex's "Context N% used" on 19 live panes (Claude runs a 1M window,
  Codex leaves out a 12k baseline). Cards show it from 60%, amber from 80%.
- One inbox ("Answer all here"): every open question with its choices, one tap or J/K + 1–9 +
  Enter-for-recommended on desktop; pick-several questions link to the chat.
- Scheduled messages: "Schedule a message" in each chat (days + time); busy agent is waited for
  up to 2 h, closed agent skipped with a visible reason.
- Read aloud: on agent replies, device voice, Hebrew/English by text, code and links skipped.
- Design: owner said "design is still very bad" (screenshot at ~330 px inside TermFleet). Agent
  list rebuilt as a contact list: row named by what the chat is about (project is the group
  heading), coloured status under it, short time on the right, compact toolbar that fits 320 px,
  no empty Rooms box. Checked at 328 / 390 / 1280 px in dark and light.

## Where the goal stands (end of 2026-10-12 session)

1. Reliability — ledger below. Everything reachable from the phone bridge is fixed or guarded;
   the rest is keeper-side (waits for the owner's chosen reboot) or another agent's open work.
2. Long runs — memory meter, stall flag, persisted rooms/schedules/drafts, reboot rehearsal
   19/19 resume. Handover words: waiting on the capsule rework's first live run.
3. Design — phone/desktop-browser TermControl rebuilt (contact list, chat header, bubbles,
   Needs-you box, inbox), which is also the agents tab inside TermFleet. The desktop terminal
   panel stays as approved on 2026-10-09; its session list already uses the same
   title / status-dot / topic layout.
4. Features — rooms, one inbox, scheduled messages, read aloud: all live. Live check against
   the running service at phone and desktop size (local sign-in, sends blocked so no agent got
   anything): 19 live agents listed, all 19 with a memory reading; room created, opened and
   deleted; read-aloud on a real reply; schedule created and deleted; inbox opened (nothing
   waiting at the time); no page errors. Test room/schedule leftovers cleaned up.

## Reliability ledger — every known way work gets lost, stuck or misreported (2026-10-12)

Sources: issue registry (93 issues), sent.log (14 days), service journal, live pane checks,
doctor. State key: FIXED = live now with a test · GUARD = test/detector added, cause outside
our reach · KEEPER = fix built, runs after the keeper restarts (owner chose to wait for a
reboot) · OPEN = not yet fixed.

Messages
- Photo/long-paste message left unsent in the input box (TF-095) — FIXED (re-submit only
  while the box visibly holds it).
- Retry after a slow network typed the message twice — FIXED (one id per draft).
- Phone pending messages vanishing when a new one is sent — FIXED earlier (sent queue).
- Keystrokes lost when the keeper link drops; live view drops on a garbled keeper message
  (TF-016) — KEEPER/OPEN (desktop transport; needs the keeper restart to re-test).
- Handover successor misses the owner's newest words; handover adds a card (TF-076, TF-074)
  — another agent is replacing the mechanism (owner records kept in a handoff capsule; not yet
  committed, never run live). Live proof owed on the next real handover.
Answers to questions / permissions
- Plain choice not advancing Claude, extra Enter, stale question revived (TF-078, TF-029) —
  GUARD (fresh-screen check before every key, one-answer receipts, multi-pick verified per
  step); owner's live confirmation still pending.
- Pick-several questions unanswerable from the phone — FIXED earlier (ticks/own answer/Submit).
- Model questions without choices on phone (TF-050), OpenCode answers (TF-043) — verifying.
Status truth
- Waiting agent shown as "working" (live 2026-10-12) (TF-044) — FIXED for Claude (agent's
  own status record). Codex/OpenCode still from hooks + rollout.
- Hung "working" run looks calm — FIXED (stall flag after 20 min of no activity).
- Codex chats reporting to the wrong card (TF-060), header provider wrong (TF-073), task line
  lost (TF-065/089/058/094) — verifying/OPEN (desktop).
Restore / long runs
- Chat resumed in the wrong folder after reboot (TF-088) — KEEPER (folder from the chat's own
  transcript, already coded).
- Card vanishes on relaunch (TF-091), terminals stuck "starting" (TF-019), hidden after an
  unexpected exit (TF-004) — verifying.
- One chat in two terminals (TF-056) — verifying (auto-close of older copies).
- Agent near its memory limit gives no warning — FIXED (memory meter, amber from 80%).
- Reboot survival, measured 2026-10-12: reboot rehearsal on copies of all live checkpoints
  with stand-in agents — 19/19 open panes resume their own conversation, 0 plain, 0 lost
  (rehearsal script fixed: a blank XDG_DATA_HOME crashed it).
- Rooms / schedules / sent drafts across a bridge restart — FIXED (saved to disk; pending room
  answers are picked up again after a restart; tested).
Rendering
- Duplicated text after a split multi-byte character (TF-093) — KEEPER.
- Claude input garbled when it wraps (TF-071), scroll-up breakup (TF-059), Codex stray chars
  (TF-063), OpenCode repaint (TF-040) — OPEN/verifying (desktop renderer).
Releases / staleness
- "The fix didn't take" because the keeper runs older code — GUARD (doctor now says so in
  plain words with both build dates).
- Phone shows last week's page — FIXED earlier (no-store + version check).
Tests
- 10 phone browser tests had failed on every run since earlier redesigns moved controls into
  menus (view switch + mic into the composer "+", copy into each message's "⋯", the
  "why unavailable" note behind a toggle, system notes into "Details"). FIXED 2026-10-12: the
  tests now open those menus the way a person does; no assertion was dropped. One real
  regression this caught in my own work: new toolbar buttons were 40 px, below the 44 px
  touch rule — fixed. Full suite: 150/150 + run.mjs 67/67 (concurrency 4; the touch-flick and
  ordinary-choice tests are timing-sensitive under full parallel load).
- New guards added this round: rooms, submit-confirm, send-once, vendor-status (+stall),
  context-fill, inbox, routines, page-syntax.

## Reliability techniques from the four projects (research 2026-10-12)

Adopted: agent's own status record as the truth and the gate (gawkbot); hold-don't-interrupt +
explicit failure (gawkbot/OpenMausBot); idempotent sends (OpenMausBot sendId, rakazo clientNonce);
activity-based stall watchdog that never flags a human wait (OpenMausBot turn-watchdog).
Next candidates, in order:
1. Turn done = transcript offset taken before sending + `end_turn` with no later user record
   (gawkbot) — for room answers and the inbox.
2. Durable per-agent queue (queued → dispatched → settled/cancelled), restore only undispatched
   rows after a restart (OpenMausBot steer-queue).
3. After a crash, classify each send as before/after acceptance by whether its user line reached
   the transcript; resend only "before" (OpenMausBot resume-recovery).
4. Resume a chat only when no process holds it AND its log has been quiet 3 minutes (gawkbot) —
   the "one chat in two terminals" class.
5. Fake agent CLIs with failure modes (hang, exit early, permission prompt, malformed output) +
   recorded real transcripts as fixtures (OpenMausBot, guilds, rakazo) — proves all of the above
   without live model calls.
6. Long runs: a fixed hand-off at a context threshold, capped (guilds run chains, OpenMausBot
   turn-continuation) — TermFleet already hands over; show context fill on the phone first.

## Shared agent rooms — building (2026-10-12)

- **Source:** guilds.run "Group chat" (docs/concepts/group-chat.md); OpenMausBot "Channels".
- **What it is:** one conversation holding the operator and several agents.
  `@name` picks who answers; a message naming nobody goes to every member.
- **Rules we keep from guilds:**
  - A tag is resolved once, when the message is posted; later renames do not reinterpret history.
  - An agent's answer only wakes another agent when it @-mentions it.
  - A hop limit stops agents passing a thread back and forth forever.
  - A busy agent is not skipped: the message waits for its next finished answer.
- **Our version:** TermControl stores rooms and delivers each message into the member's
  live terminal with the room's recent history. When that agent finishes, its final
  answer is posted back to the room. Phone and desktop browser first; TermFleet map later.
- **Later (from guilds):** when nobody is tagged, a small, fast decision picks the right
  member instead of waking all of them. guilds and OpenMausBot both use a hosted
  "Jev" model; we would use a local model or a plain rule.

## Read replies aloud — planned

- **Source:** OpenMausBot "Bots that talk back".
- **What it is:** a speaker button on each reply and an "auto-read" switch, so overnight
  results can be heard. OpenMausBot rewrites markdown into speakable text first.
- **Our version:** local text-to-speech on the TermControl phone app (no cloud keys by default).

## Save a team as one file — idea

- **Source:** guilds.run "Recipes"; OpenMausBot "Share a team" (portable Markdown with YAML front matter).
- **What it is:** a set of agents (project, provider, standing instructions) and their rooms,
  saved as one file and restored in one step. Never includes chat history or secrets.

## Outside control over MCP — idea

- **Source:** OpenMausBot "Orchestrate over MCP".
- **What it is:** a bounded control surface other agents can use: list agents and rooms,
  read transcripts, send work, wait for an answer, interrupt. Deliberately excludes
  approvals, deletion, settings and credentials.
- **Our version:** wraps what `termfleet-child` and TermControl's bridge already do.

## Inspectable runs — idea

- **Source:** guilds.run "Deeply inspectable" and Prompt Studio.
- **What it is:** for any answer, see exactly what the agent was sent and what it did.
  Our agents already keep full transcripts; this would link a room message to the exact
  transcript turn that produced it.

## Routines (scheduled messages to an agent) — idea

- **Source:** Rakazo "routines"; guilds.run routines (a due routine waits while the agent is busy,
  it is delayed, never doubled or dropped).
- **What it is:** "every weekday at 08:00, ask the Freelance Desk agent for today's plan" —
  set from the phone, its answer lands in the chat (or a room) like any other reply.
- **Our version:** TermControl keeps the schedule and sends through the same path as a typed
  message; a busy agent gets it when it is next free.

## Separate computer per agent — idea (low priority)

- **Source:** Rakazo "Team Computers and Private computers"; OpenMausBot per-bot cloud desktop.
- **What it is:** a risky agent works inside an isolated container so it cannot touch the real
  machine. TermFleet would open such a terminal as a normal card.

## One inbox for every agent's question — planned

- **Source:** gawkbot (Sustainable Use License: source-available, NOT open source; take ideas only,
  never code). Its "notch" and iPhone app show every bot's open question in one list.
- **What it is:** answer all waiting agents from one screen without opening each chat:
  move between questions, pick an answer with one tap, take the recommended answer,
  or reply in your own words / by voice.
- **Our version:** TermControl's "Needs you" panel becomes a full inbox with each question's
  choices inline. TermFleet desktop gets keyboard answering: J/K to move, 1–9 to pick,
  Enter for the recommended answer, R to reply in words.

## A sound for each kind of event — idea

- **Source:** gawkbot (distinct cue for a question, an approval, an error, a finished job;
  phone haptics too).
- **What it is:** know what happened without looking. Must be quiet by default and easy to mute.

## Owner's outside research (Perplexity, 2026-10-12)

- Exact prompt + tool calls + memory changes per answer: guilds.run strongest by design;
  OpenMausBot keeps local transcripts, action logs and memory journals with edit/undo.
- Versioned personas with diffs and rollback: guilds.run Prompt Studio, and **Agenta**
  (dedicated open-source prompt-versioning tool) lead.
- Shared group chat with @-only answers and no loops: OpenMausBot rooms, guilds.run tagged chat.
- Per-agent small memory with change history: OpenMausBot (MEMORY.md + log + journal), guilds.run.
- Dashboard to inspect and improve running agents: all of them; guilds.run and OpenMausBot most.

## Approval cards — already have

- **Source:** OpenMausBot permission broker.
- TermControl already answers permission prompts and questions from the phone.
