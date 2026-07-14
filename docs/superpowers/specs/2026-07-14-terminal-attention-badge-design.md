# Terminal attention badge — design

## Context

The cockpit header has two jobs: say **what** a terminal is doing (the Task / Now
Active text) and say **whether it needs the operator**. The first is hard and
partly unsolved (see memory `descriptions-approaches-and-research`). The second is
easy and was never surfaced clearly — it hid inside a small colored status dot and
collapsed into the meaningless word "Working." A non-technical viewer watching the
cockpit could not tell, at a glance, which terminals were blocked on them.

This adds a distinct, always-present, model-free **attention badge** answering one
question: *does this terminal need me, is it busy, or is nothing happening?* It is
orthogonal to the task text, so it stays honest even when the task reads "Task not
captured," and it replaces the "Working" fallback wording.

## The three states

Derived purely from `TerminalHeaderState.status` (already computed by
`buildTerminalHeaderState` from observable signals — prompt-waiting detection in
`workstreamActivity.ts`, running processes, idle shell). Five header statuses
collapse to three viewer-facing states:

| Badge | Header status | Color token | Meaning |
| --- | --- | --- | --- |
| **Waiting for you** | `waiting`, `blocked` | `--accent-warning` (amber) | A prompt wants input (y/n, press enter, login, API key), or an agent finished its turn and is waiting for your next message. You are the blocker. |
| **Running** | `working` | `--accent-success` (green) | A command or agent turn is actively working now. |
| **Idle** | `idle`, `done` | `--text-tertiary` (grey) | Empty prompt, nothing running, nobody waiting. |

## Components

- `src/lib/terminalAttention.ts` — pure `attentionBadgeFromStatus(status)` returning
  `{ state, label, color }`. Single source of truth for wording + color. Unit-tested.
- Render sites (small pill = colored dot + label, placed next to the SHELL tag):
  - `MagicCanvas.tsx` — map node card.
  - `SplitPane.tsx` — split-pane header (upgrade the existing status dot with a label).
  - `WorkbenchSidebar.tsx` — session + map-node sidebar rows.

Each site already has `terminalHeader.status` / `header.status` in scope, so the
badge is a small additive render — no new data flow.

## What it replaces

The vague "Working" wording that appeared as a title/now fallback. The badge now
carries the live state; the task line is free to show the task or "Task not
captured" without also having to answer "is it busy?".

## Testing

- Unit test: `attentionBadgeFromStatus` maps each of the five statuses to the right
  label (waiting/blocked→"Waiting for you", working→"Running", idle/done→"Idle").
- Rendering: extend `map-terminal-rendering.spec.ts` to assert the badge label
  appears on a map node for a waiting fixture and a running fixture.

## Out of scope

- The task/description text problem (tracked separately; do not reopen model/no-model).
- Per-node color-only mode (words everywhere for now; revisit if map nodes crowd).
