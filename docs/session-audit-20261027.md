# Session audit: stranded instructions and unchecked live presentation

2026-10-27. Audit findings and proposed fixes; no production change or deployment.

## Result and limits

The audit confirms stranded delivery metadata and two enforcement gaps: terminal closure is not coordinated with pending instructions, and editable frontend files can reach production without visual approval. It does not reconstruct every Agent-Manager action: the original closing actor, precise closure time, original unstyled screenshot, and full incident chronology remain unverified. The reported design failure is the owner's observation; the publication bypass is independently confirmed in current source.

The registry reference `termcontrol` and supplied snapshot SHA-256 `d6fbce99e013451ca671d36be1a7a44a8665fc2d783be5d082dbf5115b975ab9` matched the path checker. The identity and runtime entries identify the existing owner-operated TermControl platform, served from this shared checkout. At inspection, termcontrol.service was active as PID 252435, executing this checkout's bridge, started at 17:09:11 IST. The independent terminal daemon was reachable as PID 2068834 with three live sessions. Local login returned HTTP 200; this is availability evidence, not authenticated visual acceptance. The bridge's loaded module revision was not established.

No dashboard files, services, queues, terminals, credentials, or private transcripts were changed or exposed. Concurrent dashboard edits belong to another agent and were preserved.

## 1. Instructions were accepted into a queue without a durable delivery outcome

Content-free live inspection at approximately 15:14 UTC found five held messages for terminal `terminal-8c14d86a-f060-4854-af56-e67c17e3d5f1-54127e35-b648-4c1b-841e-f1b1df2cfe77`, absent from the daemon's live sessions. Their enqueue timestamps span 15:08:45.860–15:10:34.229 UTC. This establishes stranded instructions, without assuming their contents or who closed the terminal.

The code explains how this remains unresolved:

- `termcontrol/bridge/orchestrate.mjs:159–165` uses a supplied alive snapshot before holding busy Codex messages. It does not coordinate enqueue with a pending close or refresh exact conversation identity under a shared gate.
- `scripts/termfleet-team.mjs:317–332` reports CLI success for `{ok:true, received:false, queued:true}` and assigns requirements with a queued suffix. Queue acceptance is explicitly not receipt, despite the stronger assurance that delivery follows when the turn ends.
- `termcontrol/bridge/server.mjs:424` drains on a 15-second timer. `held-messages.mjs:63–76` silently skips absent targets; its three-minute bound only helps live working panes. Dead targets have no terminal failure outcome.
- `scripts/lib/team-close.mjs:114–174` checks activity, prompts, ownership and unsaved work but not queued or in-flight instructions. Self-close and the idle drain can race.
- `held-messages.mjs:72–76` removes work before sending and restores it only on a returned error. An unconfirmed `{ok:true, delivered:false}` removes the work; an exception can also lose it. The immediate drain in `orchestrate.mjs` has a related failure window.

There already is a daemon liveness check before actual typing in `send.mjs:82–85,138–148`. Adding another isolated liveness check would leave the queue/close race and missing receipt semantics intact.

### Proposed enforcement

Use a durable delivery ID and explicit queued, sending, received and failed states. Preserve work until the existing receipt mechanism confirms the exact delivery. An uncertain receipt must remain distinct from a safe-to-retry failure, so recovery cannot execute the same instruction twice. Transfer responsibility only after receipt; show queued status honestly beforehand.

Introduce one per-pane coordination boundary shared by enqueue, drain and managed close. Under that boundary, refresh daemon liveness and conversation identity, reject a closing target, and prevent managed close while incoming work remains queued or unacknowledged. Recheck in the final self-close step. A target that exits unexpectedly produces `target_closed`, retains the original work and returns responsibility to the sender. Do not silently reroute by project folder or revive an explicitly closed conversation.

Falsifiable regression cases: closure before enqueue; closure after enqueue; concurrent close and idle drain; changed conversation identity; returned error; thrown error; unconfirmed receipt; exact receipt; restart during delivery; and approval-waiting terminals that must never receive blind typing. Existing busy batching, prompt and successful-send protections must continue passing.

## 2. Visual review is advisory because publication precedes it

`termcontrol/bridge/server.mjs:82,124–136,1399` serves `app` directly from the shared checkout and reads files on each request. Its no-store headers and mtime-based version make edited bytes available without an immutable build or promotion boundary. A save can therefore publish unfinished or mixed-version frontend content before testing occurs.

The existing report protection is useful but checks a different thing. `bots.mjs:1463–1485` calls `bot-testing.mjs` before publishing a claimed completion report. It requires a testing action, a working link and a browser receipt. `browser-receipts.mjs` stores only a URL hash and timestamp, strips the URL fragment, and has no asset hash, screenshot, viewport or reviewer verdict. It cannot distinguish application hash routes or prove styling. This check also does not control static-file serving.

The current dashboard browser test checks layout widths, overflow, list contents and composer behavior. Screenshots are optional; neither its assertions nor a screenshot alone establish visual quality. These are another agent's current changes, not evidence of what was tested before the original incident.

### Proposed enforcement

Reuse `TC_APP_DIR` to serve an immutable, reviewed bundle outside the working checkout. Keep the last accepted bundle live while candidate changes are staged privately. Promotion must require a manifest of all served assets and a review receipt tied to that exact hash, the exact route including its fragment, phone/desktop viewport sizes and an independent review verdict. Any subsequent asset edit invalidates approval. Promote the whole bundle atomically, never individual files.

The review must verify required CSS, fonts and scripts loaded, the intended authenticated view rendered, primary controls are usable, and no raw fallback list or overflow replaces the designed surface. Use headless/private-screen capture followed by independent visual inspection; do not take over the owner's screen. Missing styles should yield a known styled error state while retaining the last good release. Ordinary textual chat remains allowed: a blanket text ban would break legitimate communication and would not solve deployment enforcement.

Regression cases: checkout edits cannot change served production bytes; missing CSS fails promotion; a receipt for another hash/route fails; a failed visual review leaves the prior bundle live; partial/concurrent asset changes cannot mix releases; rollback works; and ordinary chat remains available. Keep the existing link/report protection alongside this publication gate.

## 3. A repeated Stop call bypasses one existing report check

Baseline command:

```sh
node --test termcontrol/test/bot-testing.test.mjs termcontrol/test/browser-receipts.test.mjs
```

Result: seven passed, one failed. The repeated-Stop regression failed at `bot-testing.test.mjs:47` with `Cannot read properties of null (reading 'decision')`. `scripts/termfleet-asks.mjs:462` returns early for `stop_hook_active` before the testing check at lines 463–466. The separate bridge publication backstop tests passed, so this is not evidence that all report checks are absent.

Proposed correction: separate the non-bypassable publication requirement from recursive reminder suppression. Repeated unchecked reports must still be denied while reminders remain bounded. Verify both failure and successful browser-linked report paths before changing this guard.

## Baseline evidence and implementation boundary

An independent read-only code reviewer reproduced two delivery failures with a disposable queue: an absent target is skipped and retained indefinitely; a live target returning `delivered:false` empties the queue. Existing held-message tests do not cover terminal closure, unconfirmed delivery or thrown-send loss. These observations and the 7/8 report-check result are baseline diagnosis, not acceptance of the proposed fixes.

The requested audit and concrete proposals are delivered here. Implementation, regression additions, independently validated confidence, authenticated visual review, authorized promotion and live read-back are still outstanding. Do not mark the owner's dashboard requests fulfilled from this audit. The separate dashboard owner should retain ownership of its current integration changes.
