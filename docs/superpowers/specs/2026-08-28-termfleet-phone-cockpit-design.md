# TermFleet Phone Cockpit — Design

Date: 2026-08-28
Status: awaiting review
Author: Claude (brainstormed with Noam)

## Goal

Continue real work on any TermFleet agent pane from a phone: read what the agent has
been doing, reply to it, and answer its permission prompts — comfortably, on a small
screen, from anywhere, without exposing the home machine.

## Decisions already made

| Question | Decision |
|---|---|
| Phone view | Chat, **one chat per terminal pane** (not per project) |
| Reach | Phone → VPS → PC. VPS is the front door; the PC connects outbound |
| Powers (v1) | Read, reply, approve/deny. **No** launching, killing or raw keys |
| Agents (v1) | Claude Code **and** Codex |
| Alerts (v1) | In-app only: waiting panes sort to the top. No push |
| VPS role | **Blind relay** — end-to-end encrypted, server cannot read content |
| VPS-hosted agents | Not in v1, but "which machine" is first-class so it can be added |
| Multi-user | Not sold in v1, but shaped multi-tenant (accounts, per-machine pairing) |
| Client | Installable web app (PWA), Claude Code mobile visual language |

## Non-goals for v1

- Running agents on the VPS.
- Push notifications, billing, sign-up, or any paid-service surface.
- Starting, stopping, restarting or closing panes from the phone.
- A general terminal emulator on the phone.

## What is already true (verified 2026-08-28, not assumed)

These probes were run against the live machine; they are the foundation of the design.

1. **Per-pane identity exists and is live.** `agent-status/pane-*.json` records carry
   `cwd`, `sessionId`, `source` (`claude-*` / `codex-*`), `todos`, `now`, `mainTask`.
   25 panes updated in the last 24h.
2. **Every live pane resolves to a real conversation.** 10 of the 10 most recently
   updated panes joined to an on-disk transcript — Claude at
   `~/.claude/projects/<slug>/<sessionId>.jsonl`, Codex at
   `~/.codex/sessions/**/rollout-*-<sessionId>.jsonl`.
3. **"Waiting for you" is already recorded.** The Claude status hook writes
   `turn: "waiting"`, `turnReason: "permission_request"` on the `PermissionRequest`
   hook, and maps `permission_prompt` / `elicitation_dialog` / `agent_needs_input`
   notifications to `waiting`. The Codex hook has an equivalent path. **No screen
   scraping is needed.**
4. **Input can be delivered from outside the app.** The daemon's Unix-socket protocol
   already exposes `WriteSession { id, data }`, `InputStream`, `ReadSession`,
   `SnapshotSession`, `ListSessions`. The existing read-only CLI proves external
   clients can talk to it.
5. **The VPS front door exists.** Caddy + Cloudflare origin certs on `in-theflow.com`,
   a working deploy path, and a precedent app (`rc.in-theflow.com`).

## Architecture

Three components. Each is independently understandable and testable.

### 1. Pane Bridge (runs on the PC)

A small Node service, started with the desktop session, independent of the Tauri window.

Responsibilities:

- **Inventory**: enumerate panes by joining workspace state (tab → pane → daemon
  session id) with the pane status records. Emits: pane id, project name, provider,
  turn state (`working` / `waiting` / `idle`), current task line, last activity.
- **Feed**: for a given pane, read its provider transcript and normalise it into a
  provider-agnostic chat: `user` / `assistant` / `tool_call` / `tool_result` /
  `permission_request`, each with timestamp and a short summary. Tail-only, bounded
  (default: last 200 events, paginated backwards on demand).
- **Delivery**: send a reply or an approval into the pane's live PTY through the
  daemon's write path.
- **Uplink**: hold one outbound, authenticated, reconnecting connection to the Relay.

Explicitly NOT responsible for: owning terminal state, persisting anything the daemon
or the status records already own, or rendering.

**Provider adapters.** One interface, two implementations (`claude`, `codex`), chosen
from the pane record's `source`. Adding OpenCode later means adding a third file, not
touching the bridge. Each adapter answers: normalise this transcript; what does an
approval keystroke look like; is this pane safe to write to right now.

### 2. Relay (runs on the VPS)

Serves the phone app and matches phones to machines. Deliberately dumb.

- Serves the PWA over the existing Caddy on a new subdomain.
- Holds one socket per paired machine and one per connected phone; forwards sealed
  envelopes between them. Routes on envelope headers only (machine id, pane id,
  message id) — **never on content**.
- Stores: accounts, machines, pairings, public keys, and delivery metadata. **Never
  chat content, never terminal bytes.**
- Multi-tenant from day one: everything is keyed by account, even with one user.

### 3. Phone app (PWA)

Two screens, Claude Code mobile visual language — dark, calm, monospace only where it
carries meaning (code, diffs, paths), generous touch targets, single-column.

- **Fleet**: a list of panes. Waiting-for-you pinned at the top with a clear marker,
  then working, then idle. Each row: project, provider, current task line in plain
  language, relative last-activity.
- **Chat**: the pane's conversation. Assistant text as prose; tool calls collapsed to
  one line each, expandable; diffs in a horizontally scrollable code block. A composer
  at the bottom. When the pane is waiting on a permission prompt, the composer is
  replaced by the actual choices as buttons (Yes / Yes, and don't ask again / No),
  labelled with what is being asked.
- Optimistic send with an explicit delivered/failed state — never a silent drop.

## Security model

- **End-to-end encryption.** Phone and Pane Bridge hold a shared key established at
  pairing; the relay sees only envelopes. Pairing is a short code shown in the desktop
  cockpit and typed on the phone, confirmed on the desktop.
- **Nothing inbound at home.** The bridge dials out; no port forwarding, no VPN needed.
- **The bridge is the security boundary.** The daemon socket has no authentication of
  its own — anything that can reach it can type into an agent. The bridge must
  therefore authenticate every command, refuse anything outside the v1 verb set, and
  log every action.
- **Visible and auditable.** Any phone-originated reply or approval appears in the
  desktop cockpit, attributed to the phone, and lands in an audit log.

## The dangerous part, handled explicitly

Sending text into a live interactive agent is the one operation that can corrupt a
session. Rules:

1. **A reply is only delivered when the pane's recorded turn state is `idle` or
   `waiting`.** If it is `working`, the phone shows the message as queued and holds it
   until the state changes, or lets the user cancel.
2. **Approvals are never guessed.** An approval is only offered when a
   `permission_request` is the live state, and the keystroke sent is the one that
   provider's adapter declares — not a heuristic read of the screen.
3. **One in flight at a time per pane.** A second send is refused until the first is
   confirmed delivered.
4. **No raw key passthrough in v1.** No Ctrl-C, no arrows, no escape sequences.

## Data flow (reply)

Phone composes → sealed for that machine → Relay routes by machine id → Bridge opens
it, checks pane state and verb → daemon `WriteSession` → PTY. The agent's response
lands in its own transcript, the bridge tails it, and the new events flow back the
same way.

## Testing

- **Adapter tests** against real recorded transcripts (fixtures taken from live
  sessions): a Claude permission request, a Codex approval, a long tool-call run, a
  session with no assistant text yet.
- **Bridge contract tests**: inventory join correctness across all live panes; refusal
  of writes while `working`; refusal of unknown verbs.
- **Relay tests**: forwards without decrypting; rejects envelopes for unpaired
  machines; survives a machine reconnecting.
- **End-to-end**: a real pane put into a permission prompt, approved from a phone-shaped
  browser, verified by the tool actually running.
- **Regression floor**: the existing verifiers must stay green; the bridge must not
  become a second source of pane truth.

## Phasing

1. **Read-only fleet + chat.** Inventory, both adapters, PWA, relay, pairing. Proves
   the hardest part (correct, readable history) with zero write risk.
2. **Reply.** Composer, queueing while working, delivery confirmation, audit trail.
3. **Approve.** Permission prompts as buttons, per-provider approval keystrokes.
4. **Polish for daily use.** Backwards pagination, offline/reconnect states, install
   prompt, desktop-visible "phone attached" indicator.

## Open questions

- Where the Pane Bridge should eventually live: a separate process now, or folded into
  the Rust daemon later (the daemon already owns PTYs and outlives the app). Design
  keeps the seam so this is a move, not a rewrite.
- Whether the desktop should refuse a phone reply while the operator is actively typing
  in that same pane.
- Codex approval keystrokes need confirming against a live prompt before phase 3.

## Acceptance

Noam can, from his phone, away from the house: see which agents are waiting on him,
open one, read enough to know what it wants, answer it, and watch it continue — without
touching the desktop, and without anything at home being reachable from the internet.
