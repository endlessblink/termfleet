# TermFleet — status reliability and the Goal / Now rows: findings and redesign

Date: 2026-10-02 (Asia/Jerusalem). Author: Grok Bot for Noam. Scope: `devops/termfleet`, read-only code and data review. I did NOT run the app or reproduce a failure; every claim below comes from reading code, docs and the real sidecar files on this machine (counts only, no content read).

## 0. What I took "Go" and "Now" to mean — please correct me

Your request was voice-dictated, so "Go" is probably **"Goal"**. In the code every terminal card (map node, split-pane header, sidebar row) has stacked text rows: **Task**, **Goal**, **Now** (`MagicCanvas.tsx:5108`, "One stable reading order: Task, captured Goal, then live Now"; `keymap.ts:216` "Goal/Now/Context chrome"; `taskLine.ts:252` "Goal on top, current step under it"; placeholders "Task/Goal/Now not captured" in `stableHeader.ts:50`).

- **Goal** = what this session is about (long-lived). Resolved by `resolvePaneTaskLine` in `src/lib/taskLine.ts`.
- **Now** = what it is doing at this moment (short-lived). Resolved by `resolvePaneNowLine`.

Alternative reading, if I am wrong: "Go/Now" are task surfaces in the project TASKS panel ("Now Active / TASKS", `useMasterPlanTasks.ts`, `CanonicalAgentBoard.tsx`). I cover that in section 6 but with less depth. **Tell me which one you meant.** Everything below about status applies either way, because both sit on the same status layer.

## 1. How status is derived today

### Writers (hooks, outside the app)
- `scripts/termfleet-claude-status-hook.mjs` (714 lines), `termfleet-codex-status-hook.mjs` (452), `termfleet-opencode-status-plugin.js`. They fire on prompt/tool/stop/notification events and **read-modify-write one JSON file per pane** (`agent-status/pane-<fnv(paneId)>.json`) or per cwd (`<fnv(cwd)>.json` fallback). Race guard: `shouldWriteStatusCandidate` compares `turnEventAt` (`agent-status-lifecycle.mjs`), 12 lines; it protects ordering only between two writers, not a lost event.
- Record fields that matter: `turn` (working | idle | waiting), `now`, `mainTask`, `mainTaskSource` (6 values), `userTask`, `narration`, `todos`, `recent`, `updatedAt`, `turnEventAt`, `sessionId`, `paneId`.

### Readers (in the app) — a ladder of at least seven inputs
1. Sidecar file (`agentStatusSidecar.ts`, 821 lines): `sidecarFresh` TTL 30 min, 12 h if `waiting`.
2. HTTP "status worker" (`scripts/agent-status-summary-server.mjs`) — second source `"process"`.
3. Heuristic fallback from terminal transcript (`sessionTranscript.ts`, 528 lines; `agentStatusSummary.ts`).
4. Vendor session logs on disk (TC-060) — can be 338 MB and stalled a sweep (`statusPollLoop.ts:50-54`; now capped at 4 s).
5. Process table: `paneAgentProcess.ts`, `badgeLiveness.ts` (agent gone for 2 consecutive polls ⇒ force Idle).
6. Screen scraping of TUI markers: `operatorQuestionState.ts`, `sessionStatus.ts` `reconcileSessionStatus`.
7. PTY lifecycle (`statusForTerminal`: running/exited/failed).

Then a **polling loop** (`statusPollLoop.ts`, 505 lines; 4 s tick, active pane ≥3 s, background ≥8 s, concurrency 8) projects the result into the Zustand store (`statusPollProjection.ts`), **while a mounted `Terminal.tsx` (66 references to the same fields) also refreshes the same fields**. `keepNewerReportedStatus` exists because "two writers … took turns writing an old hook record over a liveness-corrected Idle, so the badge flipped Running↔Idle (TF-044)". The header text goes through `terminalHeaderViewModel.ts` (1,665 lines), `terminalHeaderDisplay.ts` (1,447), `terminalHeaderQuality.ts` (1,408), `terminalHeaderState.ts` (645, 5 s row-stability hold), `stableHeader.ts` (5 s hold), `taskIdentity.ts` (581), `taskLine.ts` (691).

Size of the status/label stack: roughly **10,400 lines** across about 20 files in `src/lib` plus ~1,200 lines of hooks. Status types: `WorkstreamStatus` (6 values), `WorkstreamStatusSummaryLifecycle` (7 values), `SessionLifecycle` (4 values), `AttentionState`, hook `turn` (3 values) — five overlapping vocabularies.

### Evidence from the real data (this machine, 2026-10-02 ~16:47 IDT)
`~/.local/share/terminal-workspace/agent-status/`: **1,477 records, never garbage-collected.**
| Group | Count |
|---|---|
| per-pane records | 1,452 (cwd-keyed: 25) |
| `turn=idle` | 1,170 (903 older than 7 days) |
| `turn=working` | 136, of which **109 older than 7 days** and only 2 updated in the last 30 min |
| `turn=waiting` | 24, of which 18 older than 7 days |
| no `turn` at all | 147 (pane records 133) |
| no `mainTask` | 551 (37%) |
| `mainTaskSource = opening-request` | 780 of 926 goals (84%) — i.e. the first thing you typed |
| `plan-explanation` / `goal-task` / `agent-goal` | 125 / 18 / 2 |

A "working" record that is 7 days old means the Stop event never arrived (Esc, Ctrl+C, crash, closed terminal, hook failure). The app's design deliberately has **no clock** (`sessionStatus.ts:1-17`): "the badge changes ONLY when the agent's own reported status changes". That removed flicker, but it means a missed event is **permanent** until the process-table check happens to fix it, and that fix only applies to panes that exist and are polled. I did not verify whether the UI shows any of these 109 as running; it depends on which are still bound to a live pane.

## 2. Why status goes wrong (root causes, ranked)

1. **No single owner.** `sessionStatus.ts` calls itself "THE single source of truth", but at least five other places also decide state (badge liveness override, newer-report rule, screen markers, poll projection, `Terminal.tsx` refresh, plus the separate TermControl bridge `termcontrol/bridge/session-status.mjs` / `liveness.mjs` for remote clients — a second implementation of the same logic). Every earlier fix (TF-044, 2026-07-28 waiting TTL, Esc/interrupt, 2026-09-16 sweep) added a rule on top rather than removing a writer.
2. **Pure-event state with a lossy event source.** Hooks are the only truth for "working"; several real transitions fire no hook (interrupt, crash, `/exit`, tool call longer than TTL — `statusPollLoop.ts:271`). Without a lease or "last seen", the UI cannot distinguish "working and quiet" from "dead and forgotten", so it needs ever more patches (process table, screen markers).
3. **Polling plus hysteresis instead of events.** Four timers read the same files (4 s status, 1.5 s child requests, 5 s master plan tasks, 2 s agent board, 1.2 s cwd). Two 5 s hold timers (`MIN_HEADER_HOLD_MS`, `HEADER_ROW_STABILITY_MS`) mean a correct change can take 5-9 s to show, and a wrong value is held. That reads as "slow and flaky" even when each part is "right".
4. **Truth is inferred from text.** Goal and Now are filtered through regex gates (`readsPlainly`, `readsAsActivity`, `qualityCheckGoalLabel`, comments like "the generic quality gate intentionally rejects prompt-shaped complaints" at `taskLine.ts:441-460`). Any shape nobody wrote a fixture for either leaks junk (`$dropoff`, numbered scrollback lines, truncated prose — listed in `cockpit-sidecar-corpus.spec.ts`) or gets rejected and shows "Task not captured". 37% of records have no goal at all.
5. **Read-modify-write JSON on disk, no event log.** Concurrent hooks (a pane can have prompt + tool + notification hooks in flight) overwrite each other; `turnEventAt` ordering protects only some fields. Nothing can be replayed, so a bug cannot be reproduced after the fact.
6. **Huge components own derivation.** `WorkbenchSidebar.tsx` (8.5k lines), `MagicCanvas.tsx` (10.6k), `SplitPane.tsx` each re-derive Goal/Now from raw fields (e.g. `SplitPane.tsx:1490`, `MagicCanvas.tsx:3794-4015`); only 1 `memo(` in `src`. Three surfaces can disagree for the same pane and nothing tests that they agree.
7. **Surface instability compounds the feeling.** Six `HANDOFF-sidebar-stability*.md` files (latest 2026-10-01) show repeated sidebar jumps, group placement and dropoff-reset bugs. When positions move, status reads as unreliable even when correct.

Good news already in the repo that I would build on: pane-keyed sidecars (TC-035), `turn` as the authoritative lifecycle, `turnEventAt` ordering, a live-corpus test (`cockpit-sidecar-corpus.spec.ts`), 173 spec files, `status-event-order.spec.ts`, `status-expiry.spec.ts`, `pty-attach-status.spec.ts`.

## 3. UX / design problems of the Goal and Now rows

- **Goal is mostly "what you typed first"** (84%). A first message like "go" or "continue the plan" produces a bad or missing goal (code has special cases for "go", "$done", "/done": `agentStatusSidecar.ts:540,582`, `taskLine.ts:663`, `sessionTranscript.ts:340`). Goals do not follow the work as it changes, and you cannot fix one.
- **Silent suppression.** When a candidate fails a gate, the row says "not captured", which looks like an app bug and hides what the system actually knew.
- **Now is prose-scraped.** It tries the agent's current step, then what it "said", then recent notes, then a templated tool name that expires after 30 s (`TOOL_TTL_MS`); when a turn ended it is blank by design. So Now is blank or stale exactly when you glance at an idle or waiting card.
- **No provenance or freshness on any row.** You cannot tell if Goal is the agent's declared plan, a guess from your first message, or a leftover. You cannot tell if Now is 2 s or 20 min old.
- **Three rows (Task, Goal, Now) with overlapping meaning** and extra rules about not repeating one under another (`resolvePaneNowLine(..., goalText)`; `terminalHeaderViewModel.ts:152-160`). Hard to predict, hard to test.
- **Different widths on each surface** (sidebar, map node, header) produce different truncation, so the same pane reads differently.

## 4. Proposed status model

### 4.1 One authoritative state machine per session
A pure reducer `reduce(state, event, ctx) → state` in one module, with **one instance per pane**, used by every surface through a single selector. The reducer lives where the PTY is owned (the daemon/Rust side, or one TS module if that is cheaper first) so that the phone/bridge reads exactly the same result.

States (one vocabulary, replacing the five):
`absent` (no agent in pane) · `starting` · `working` · `needs-you` (sub-kind: permission | question | blocked) · `idle` (turn finished) · `interrupted` · `ended` (process exited, ok) · `crashed` · `unknown` (we lost the thread).

Each state carries: `since`, `lastEventAt`, `lastEventSeq`, `source` (hook | pty | process | screen | operator), `confidence` (high | medium | low), `lease` (see below) and `reason` (a human sentence: "Stop hook, 2m ago").

Inputs (events, all carrying `paneId`, `sessionId`, monotonic `seq`, wall-clock `ts`):
- hook events: `prompt`, `tool-start`, `tool-end`, `notification`, `stop`, `session-start`, `session-end` (high confidence);
- PTY/daemon events: `spawn`, `exit(code)`, `agent-process-appeared`, `agent-process-gone` (high, authoritative for existence);
- operator events: keystroke / Esc / Ctrl+C sent to the pane (marks "might have changed; verify");
- screen markers (low confidence, **corroborate only**, never override a higher-confidence event);
- timer ticks (clock used for **decoration and probes**, never to flip a state silently).

Transition rules that fix today's failure modes:
- `working` holds a **lease** that every tool/prompt event renews. When the lease lapses while the process is alive the state does NOT flip; it becomes `working` + `quiet for 3m` (confidence drops to medium) and triggers one verification probe (process table, screen marker). When the agent process is gone ⇒ `crashed` or `interrupted` (if an Esc/Ctrl+C was sent just before), never "running". This fixes the 109 orphaned working records and the "no hook fires on interrupt" case without a flicker-causing clock rule.
- `needs-you` is steady (no lease expiry) but shows "waiting 12m" and confidence; abandoned prompts end through process-gone.
- `unknown` is allowed and honest: shown as a muted badge with "last seen 3d ago", instead of guessing Idle.
- Duplicate and out-of-order events are idempotent (compare `seq`, then `ts`); an event for an old `sessionId` is dropped; a new `sessionId` in the same pane starts a new run.
- A badge change requires a state change, not a text change; the 5 s hold timers are removed from the status badge (they stay at most for text-row transitions, applied in one place).

### 4.2 Events, not polling
- Hooks append one line per event to a **per-session JSONL event log** (append-only, atomic small writes; no read-modify-write) and/or send it to the daemon socket. The legacy `pane-*.json` sidecar keeps being written for compatibility and the live-corpus tooling, derived from the log.
- The app watches the directory (`notify`/inotify) and feeds events into the reducer. The 4 s poll stays only as a slow verification probe (30-60 s) and for process liveness.
- Retention: logs and old sidecars fall under the retention engine (TC-093); a reaper closes orphaned `working` runs (`ended: orphaned`).

### 4.3 One selector, many views
`selectSessionView(paneId) → { state, since, lastSeen, confidence, goal, now, reason }`. Sidebar row, map node, split header, status bar and the bridge read **only** this. A lint/test forbids reading `statusSummary` or the other raw fields in components. Old derivations (`badgeLiveness`, `keepNewerReportedStatus`, `reconcileSessionStatus`, the `Terminal.tsx` writer) are retired step by step, each behind the parity test.

### 4.4 Visible trust
Every card shows a state chip with a **last-seen timestamp**; low confidence is visually distinct (dashed/muted); a click on the chip opens "Why this status?" with the last events, the rule that fired and what would change it. This one panel will make future bugs diagnosable in minutes instead of via screenshots.

### 4.5 Sidebar stability
Status changes the badge only; it never reorders rows or changes groups (consistent with the HANDOFF-sidebar rules). If you want an attention view, add a separate "Needs you (N)" strip or filter rather than re-sorting.

## 5. Proposed Goal / Now redesign

**Two rows, fixed semantics, always filled, always with provenance.**

- **Goal** = a `GoalRecord { text, source, confidence, pinnedByOperator }`.
  Precedence: (1) you pinned or edited it (click the row to edit; sticky); (2) agent-declared plan title / explicit goal command; (3) first meaningful request, summarised once and marked *inferred*; (4) project + branch + provider as a plainly labelled placeholder ("Claude in income-zen — no goal yet"). Sticky: only replaced by a higher-precedence source or by you. A small tag shows `you` / `agent` / `inferred`.
  Stop hiding rejected candidates: show them with the *inferred* tag instead of "not captured"; only a short deny-list (slash commands, "go", "continue", pasted paths) is excluded, and each rejection increments a diagnostics counter.
- **Now** = a typed activity `{ kind: tool | thinking | needs-you | idle | ended, text, since }` taken **directly from the latest event** (tool name + object via templates, no prose scraping): "Editing taskLine.ts · 12 s", "Waiting for your approval · 4 m", "Idle · finished 6 m ago · last: ran tests". It never goes blank: the last known activity stays, dimmed, with its age.
- Retire the third **Task** row (merge into Goal) and the "don't repeat" rules.
- All views take width from the same formatter, truncating the same way, with the full text on hover.

## 6. Task surfaces (if "Go/Now" meant the TASKS panel)
Observed: `useMasterPlanTasks.ts` re-reads project plans every 5 s; `CanonicalAgentBoard.tsx` every 2 s; the pane↔task link is by text matching (`taskIdentity.ts`), not by id. Proposed, pending your answer in section 0: watch plan files by event; give each pane an explicit task binding (`TERMFLEET_TASK_ID` or a "Work on this" action that sets the Goal source to *task:TC-123* with confidence high); one "Now" lane showing only tasks bound to live panes; unbound plan tasks stay in the list. This gives Goal a trustworthy source (the plan) and makes the TASKS panel and the card agree.

## 7. Tests (replay-first)

1. **Recorder + corpus.** A flag-gated recorder tees hook events, PTY lifecycle and process events into sanitised JSONL. Seed the corpus from the existing 1,477 sidecars (shape only) plus hand-built fault fixtures: duplicate event, out-of-order event, missing Stop (kill -9), Esc interrupt, `/exit`, two panes in the same cwd, hook crash mid-write, long tool call (> lease), 12 h waiting prompt, clock jump, session id change in the same pane, 300 MB session log read.
2. **Reducer tests with an injected clock** (no real time): table-driven transitions from section 4.1, plus property tests: "any permutation of independent duplicate events gives the same final state", "no sequence ends in `working` once the process is gone".
3. **Golden selector snapshots** per fixture: expected `{state, confidence, goal, now}`; changes require review.
4. **Cross-surface parity test**: mount sidebar row, map node and header on the same store; assert identical state/goal/now for every fixture.
5. **Live-corpus invariants** (extend `cockpit-sidecar-corpus.spec.ts`): no `working` record older than its lease without a live process; no placeholder goal when an inferred one exists; GC keeps record count under a cap.
6. **Soak/metrics**: counters for badge flips per minute, `unknown` minutes, disagreement between surfaces (should be 0), time from hook event to pixel (target < 1 s). Run in the long-uptime soak from TC-14x.

## 8. Suggested order
TC-171 (contract) → TC-172/173 (corpus + reducer) → TC-174/175 (events in) → TC-176/177 (liveness + lease) → TC-178/179 (single selector + parity test) → TC-180..182 (Goal/Now) → TC-185 (explainer) → TC-184 (GC) → the rest. Land the reducer **in shadow mode first** (computes alongside the old path and logs disagreements), then switch surfaces one at a time.

## 9. Not verified / open questions
- I did not read `WorkbenchSidebar.tsx` or `MagicCanvas.tsx` end to end; the 8.5k and 10.6k line files were only searched for status paths. I did not run the app or check which of the 136 `working` records are bound to live panes.
- Which meaning of "Go"? Goal row or the TASKS panel?
- Do you want an editable Goal (click to pin)? It is the single biggest fix for goal quality.
- Where should the reducer live: Rust daemon (shared with phone/bridge) or TS first?
- Agree that status never reorders the sidebar?
