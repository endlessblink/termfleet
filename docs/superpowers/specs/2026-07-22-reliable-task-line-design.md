# TC-060 — The task line is always true, always current, always readable

Date: 2026-07-22
Status: design (approved definition of "reliable"; implementation not started)
Supersedes the ad-hoc task-text work catalogued in `descriptions-approaches-and-research` memory.

## 1. The goal, in the operator's words

Every terminal card in the cockpit shows **one plain sentence that is true right now**.

Four invariants, all of which the operator selected as mandatory. A build that
violates any one of them is broken, even if the other three hold:

| #   | Invariant          | Meaning                                                                                                                                                                |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Never blank**    | `Task not captured` must never render. Every pane, always, gets a real sentence.                                                                                       |
| R2  | **Never invented** | Every word is either the agent's own, the operator's own, or a fixed template over a verified fact. No paraphrase, no model rewrite, no per-project hardcoded strings. |
| R3  | **Never stale**    | The line dies when the work it describes ends. No task text outliving its turn.                                                                                        |
| R4  | **Always plain**   | Readable by a non-developer: no file paths, flags, code, markdown, or pasted prompts.                                                                                  |

**Floor rule (operator, verbatim): "in the least — write the main user goal."**
When nothing better is knowable, show what the operator asked for. For a pane with
no agent at all, show what that terminal is actually doing (running command, folder,
branch) — the operator explicitly rejected hiding the row.

Reliability is measured, not asserted: a sweep over every live pane must produce
zero R1–R4 violations, and that sweep is the release gate.

## 2. Why it fails today (measured, not inferred)

Evidence gathered 2026-07-22 against the real machine.

1. **The Task row is only allowed to use agent-declared text.** `resolveTaskIdentity`
   (`src/lib/taskIdentity.ts:162-258`) accepts `mainTask`, `userTask`, and TodoWrite
   items and almost nothing else. Across 215 pane sidecars, `mainTask` exists in
   **28 (13%)**; a declared task of any kind in **79 (37%)**. Everything else falls
   through to `TASK_NOT_CAPTURED`.
2. **A usable activity string already exists and is forbidden.** The hooks write
   `now` (templated from the last tool call) for **196/215 panes (91%)**;
   `resolveTaskIdentity` never reads it.
3. **Rejection and ignorance are indistinguishable.** When the quality gate rejects
   real text (`terminalHeaderQuality.ts`), the render falls to the _same_ string as
   "no data" (`terminalHeaderViewModel.ts:1011`). Violates R2's auditability.
4. **Nothing expires.** The `Stop` hook refreshes `updatedAt` and carries `mainTask`
   forward; the sidecar TTL is 30 minutes (`agentStatusSidecar.ts:55`). A finished
   task keeps showing for up to half an hour. Violates R3.
5. **Shell panes have no path at all.** `statusSummary.task` is gated behind
   `tasksFromTodoWrite` (`taskIdentity.ts:230`), which is false for a shell. Violates R1.
6. **Hook-only ingest.** Nothing in `src/` or `src-tauri/` reads the session
   transcripts. Hooks only see what the provider hands them, only on some events,
   and only for sessions started after the hook was installed.
7. **Per-project hardcoded outcome strings** (`taskIdentity.ts:94-135`) — a direct R2
   violation still in the tree.

## 3. What is actually available (verified on this machine)

Sources the cockpit does not currently read. All are written by the vendor tools
themselves, with **no hook involvement**, so they cover hand-started, long-running,
and pre-existing sessions — the exact class that shows `Task not captured`.

**Claude Code** — `~/.claude/projects/<enc-cwd>/<session-id>.jsonl` (429 files present):

- `{"type":"ai-title","aiTitle":…}` — a short plain-English title Claude writes for
  the session ("Debug stuck process", "Investigate e2e redirect to free content
  section"). Exactly the required register; costs nothing; not invented by us.
- `{"type":"last-prompt","lastPrompt":…}` — the operator's request verbatim. This is
  the floor rule's source.
- `tool_use` blocks with timestamps — the current action.
- `{"type":"mode",…}`, `cwd`, `gitBranch`, `sessionId` per record.

**Claude Code live registry** — `~/.claude/sessions/<pid>.json`:
`pid, sessionId, cwd, name, nameSource, status, statusUpdatedAt, version`.
First-party, pid-keyed, carries an authoritative `status`. Independently confirmed as
the right source by `claude-busy-monitor`, which calls these "Claude Code's own probe
files; no race-prone proxies" and reads `busy / shell / idle / waiting` straight from them.

**Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl` (2056 files):
`event_msg/task_started` and `event_msg/task_complete` (with `turn_id` and
`last_agent_message`) give a **real turn boundary without hooks** — the missing R3
signal. Also `user_message`, `agent_message`, `turn_context` (cwd, turn_id),
`thread_goal_updated`.

**The process table** — for every pane the daemon already owns the PTY. `ps` shows the
agent and its conversation id on the command line (`codex resume <uuid>`,
`claude --resume <uuid>`) and, via the `+` foreground flag, the command a plain shell
is actually running. This is the pane→session mapping that needs no cooperation at all.

**Coverage measured over the 215 real pane records:** 209 (97%) yield a true
description from the transcript route (title 93, operator request 186, current tool 208) versus 79 from today's declared-task route. The 6 remainders carry no session id
— they are shells, which the process route covers. **100% is reachable.**

## 4. Wording quality — measured, not assumed

A read-only prototype resolved real panes end to end. What it produced:

| Source                              | Sample output                                                                              | Verdict                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Claude `activeForm`                 | "Researching how other tools always know what a terminal is doing"                         | ✅ ideal                             |
| Claude `ai-title`                   | "Investigate e2e redirect to free content section"                                         | ✅ ideal                             |
| Codex `mainTask` (plan-explanation) | "The visual package has been rebuilt from official trailers, visually audited, relabeled…" | ❌ prose status report, not a task   |
| Claude registry `name`              | "flow-state-0d"                                                                            | ❌ derived slug                      |
| Operator request                    | often "[Image #1]"                                                                         | ⚠️ needs image-placeholder stripping |
| Templated tool call                 | "Reading gridRenderer.ts"                                                                  | ✅ acceptable as activity            |

Conclusions that constrain the design:

- Claude has two first-class short sources. **Codex has none** — it emits prose only
  (no `update_plan` in the sampled session; `thread_goal_updated` fired once in 3000
  records). Codex must be handled by first-clause truncation of its own sentence plus
  the AGENTS.md self-declaration rule, and must never be paraphrased.
- R4 is enforced by _source selection and rejection_, never by rewriting. If a
  candidate fails the plain-language check, drop to the next rung — never edit it.

## 5. Design

### 5.1 One owner

Resolution moves into the component that already owns every pane and its PTY: the
Rust daemon. It computes one `PaneTaskLine` per pane and pushes it; the split header,
sidebar, and map render it verbatim. No view recomputes anything. (Same conclusion the
badge work reached in `badge-stable-20260714`; the task text never got the same
treatment.)

### 5.2 The ladder

Stop at the first rung that yields text passing the plain-language check. Every rung
records its provenance and its own expiry.

| Rung | Source                                                                              | Expires when                                 |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| 1    | Agent-declared current task (`activeForm` of the in-progress task)                  | that task leaves `in_progress`, or turn ends |
| 2    | Session's own title (Claude `ai-title`; Codex `thread_goal_updated`)                | session ends                                 |
| 3    | Operator's last request, verbatim, image placeholders stripped — **the floor rule** | next request supersedes it                   |
| 4    | Current tool call, templated                                                        | next tool call, or 30 s of silence           |
| 5    | Live registry `status` + running command from the process table                     | process exits                                |
| 6    | Shell state: running command, else folder + branch                                  | always true by construction                  |

Rung 6 cannot fail, which is what makes R1 an invariant rather than an aspiration.

### 5.3 Provenance and expiry

`PaneTaskLine { text, source, capturedAt, expiresAt, provider }`. The UI shows the
source on hover. Distinct render for "known but rejected" versus "nothing known" —
they must never collapse into one string again (root cause #3).

Turn boundaries come from the transcripts, not the sidecar TTL: Claude `Stop` /
Codex `task_complete` demote rungs 1–2 immediately; the 30-minute TTL is deleted.

### 5.4 Removals

`taskIdentity.ts:94-135` hardcoded per-project strings, and the `tasksFromTodoWrite`
gate that starves shell panes.

## 6. Verification — the reliability gate

`npm run verify:task-line` sweeps every live pane and fails on:

- any empty line, `Task not captured`, or placeholder (R1)
- any text not byte-identical to its cited source, or any hardcoded-string match (R2)
- any line whose `expiresAt` has passed, or that survives its turn-end event (R3)
- any line containing a path, flag, code fence, markdown heading, or slash command (R4)

Plus a golden-file test over recorded transcript fixtures for both providers, and a
doctor check that fails when a vendor format drifts (see §7).

## 7. Failure modes and durability

| Risk                          | Handling                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor JSONL format drift     | Real: public docs claim no title field exists, yet `ai-title` is present in v2.1.216. Every reader is a versioned, fallible probe; doctor fails loudly when a probe stops matching, and the ladder degrades to the next rung rather than blanking. |
| Resumed / compacted sessions  | Read only the tail; `compacted` records are skipped; the session id from `codex resume <uuid>` keeps the mapping across resume.                                                                                                                    |
| Two panes on one conversation | Already forbidden; the line is keyed by `runtimeSessionId`, never by cwd.                                                                                                                                                                          |
| Reboot / cold restore         | Pane→session survives via the daemon meta file's `providerSessionId`; the transcript is on disk, so the line is recoverable with no live process.                                                                                                  |
| Scale                         | ~17 live panes today, 215 historical records, some rollouts 11.7 MB. Tail-read a bounded window, index by session id, refresh on file-change events rather than re-scanning.                                                                       |
| Subagents                     | `isSidechain` records are excluded so a subagent's tool call never becomes the pane's task.                                                                                                                                                        |
| Stale on-disk records         | 17 of 59 daemon meta files have no cwd; the pane universe is `workspace.json` (17 tabs), not the meta directory.                                                                                                                                   |

## 8. Explicitly out of scope

Local-model summarization (rejected twice), paraphrasing the operator's words, and
reintroducing per-project string tables. R2 forbids all three.
