# Cockpit label quality matrix

What counts as a BAD Task row / Now Active line, stated as rules rather than taste.
Built from a live sweep of every pane on this machine (2026-07-25): 146 of 239 panes
rendered something a non-developer could not use. Every class below is a real shape
that shipped, with the pane it came from.

Read this before proposing any change to header text. Add a row when a new class is
found in the wild — and add its check to `tests/pane-label-audit.spec.ts` in the same
change, or the class comes back.

## The two lines and what each promises

| Line           | Promise                                                                                        | Wrong even if true                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Task**       | What is being done **in relation to what the user asked for**. Survives the agent going quiet. | The current keystroke, a tool name, a result, the folder name |
| **Now Active** | What it is doing RIGHT NOW. Expires.                                                           | A finished result, a next-step instruction, the task restated |

When the pane is a regular shell rather than a supervised agent, the same promise still
holds: the compact header must keep the current moment visible next to the path. Hiding
that row made a real shell look idle even when its task and activity were available.

The Task row's wording is the operator's own (2026-07-25): _"it needs to understand the
main goal — the task is what is being done in relation to what the user asked for."_ That
is why the operator's ask outranks the momentary step, and why the folder name — which
answers neither half of that sentence — is not an acceptable answer at all. With nothing
known the row says **"No task declared"** or **"Goal not captured"** when a rejected
process step is still active: still never blank, but visibly a gap rather than filler
that reads like content or a false idle state.

**The activity line is defined POSITIVELY.** It must read as an action in progress
("Locating the master frame reference") or a stated outcome ("Fixed the compressor
timeout"). Everything else is rejected without being named. This replaced a blacklist of
imperative verbs: "Locate the master frame reference and asset" reached a live pane only
because `locate` was not on the list, and a blacklist of English verbs never converges.
A whitelist fails CLOSED — an unknown verb costs a good title, it never admits a bad one.
Non-activity text is REJECTED, never reworded (TC-060 R2), and the Task row keeps the
full wording.

## Class A — fabricated / contentless

The line is well-formed English and still says nothing. This is the class that got
missed the longest, because every junk-shape check passes it.

| Class                                | Live example                                                                                                          | Rule                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A1 folder template                   | `Sitting at a command prompt in hermes`, `Working in termfleet`                                                       | REMOVED 2026-07-25. Never acceptable — with nothing known the row says `No task declared`                     |
| A5 stored filler outranks live truth | A poll stores a folder-template line; the header then prefers it over the pane's own task list and the operator's ask | A line whose source is the last rung is treated as "nothing known" and must never be re-stored over real text |
| A2 invented activity                 | `Sitting at a command prompt` on a pane whose task list is on screen                                                  | If the pane has a task list, the task list wins                                                               |
| A3 nudge as task                     | `make high`, `add it`, `do it`, `next`                                                                                | Verbatim operator words are welcome, but a nudge is not a task                                                |
| A4 placeholder                       | `Task not captured`, `Activity not captured`                                                                          | Honest last resort only. Never while a real task is known — including a known-but-expired one                 |

## Class B — right shape, wrong content

| Class                        | Live example                                                            | Rule                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B1 operator checklist        | `Steps - Log out and back in.`, `Next steps: …`                         | That is what the HUMAN may do next. Not activity                                                           |
| B2 instruction, not activity | `Confirm Tailscale is actually running`, `Clean up and commit.`         | Activity is a gerund (`Confirming …`) or a stated outcome (`Fixed …`). A bare imperative is an instruction |
| B3 result as activity        | `CI is green and the PR is clean.`, `All 13 new regression tests pass.` | Allowed ONLY on a settled pane stating its outcome. Never on a working pane                                |
| B4 stale scraped guess       | `Building Rust backend` still shown after the build ended               | A command-derived guess expires with the command. Once status is unavailable it must not be the title      |
| B5 echo                      | Task and Now Active identical                                           | One of them must say something new, or the second is hidden                                                |
| B6 regression step with a product object | `Adding a regression for folder detection`                    | Keep the named object as `Keeping folder detection reliable`; keep the regression work on Now              |

## Class C — unreadable to a non-developer

| Class                     | Live example                                       | Rule                                    |
| ------------------------- | -------------------------------------------------- | --------------------------------------- |
| C1 tool identifier        | `Using mcp__plugin_context-mode__ctx_execute`      | No raw tool ids                         |
| C2 command line / env var | `Running: HERMES_HOME=~/.hermes/…`                 | No env vars, no absolute paths, no urls |
| C3 file name              | `Editing release.py`, `… a task in master_plan.md` | No source file names                    |
| C4 ticket id              | `-fast-track started: T-055 RTL/LTR cleanup.`      | No internal ids                         |
| C5 test tally             | `Changed-test suite passed: 15 files, 142 tests.`  | No test counts                          |

## Class D — damaged text

| Class                   | Live example                                                         | Rule                                                        |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| D1 split mid-sentence   | `07s, both calm single-button cards.` (a `0.07s` decimal split)      | A sentence boundary is a terminator FOLLOWED BY WHITESPACE  |
| D2 starts mid-sentence  | opens on a digit, a connective (`and`, `both`, `so`), or punctuation | Reject regardless of how clean the tail reads               |
| D3 mangled by stripping | `Staging is clean — no , no , no .`, `the art redesign .`            | A space before a comma or full stop means text went missing |
| D4 dangling end         | ends on `and`, `with`, `to`, `,`, `:`                                | Cut-off line                                                |
| D5 label leftover       | `Md: N/A, quick production fix.`                                     | A markdown label is not a line                              |

## Where each class is enforced

- **Shared text gates** — `src/lib/terminalHeaderQuality.ts`. Classes B1, B2, C1–C5, D1–D5.
  There are TWO title gates and a rule must be in the right one — or both:
  `qualityCheckTrustedActivityLabel` (model/summary text) and `qualityCheckActivityLabel`
  (the live `now` line as it becomes the title). The activity-shape whitelist
  (`readsAsActivity`) is in both, plus the task-derived title in
  `terminalHeaderViewModel.ts` — the three routes text can take to the big title.
- **The ladder** — `src/lib/taskLine.ts`. Classes A1/A2/A5: the last rung says
  `No task declared`, every caller must offer the ladder everything it knows first
  (`terminalHeaderState.ts` passing only the folder caused the 2026-07-25 report), and a
  stored last-rung line is treated as "nothing known" rather than allowed to win.
- **Live activity** — `src/lib/terminalActivity.ts`. Class B4: `durableActivityIsLive`
  is the single freshness rule; all three consumers use it.
- **Expiry** — `src/lib/agentStatusSidecar.ts` + `statusPollProjection.ts`. Class A4: an
  expired record still answers "what is this about"; only "doing now" expires.
- **Capture** — `scripts/termfleet-*-status-hook.mjs` + `src/lib/agentNarration.ts`
  (byte-parity pinned by test). Class D1 starts here.

## How to check, always

```bash
npm run audit:panes      # renders EVERY pane on this machine through the real view model
```

It fails on the classes above and writes the full table to `.audit/pane-labels.txt` —
every pane's Task row and Now Active line, so they can be READ. The failure list alone
is what let this accumulate: a check nobody wrote is a class nobody sees.
