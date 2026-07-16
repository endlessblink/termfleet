# Reliable Multi-Terminal Header Contract

This note distills the terminal-header research into TermFleet-specific rules.
It is intentionally implementation-facing: future fixes should change tests and
verifiers against this contract, not reintroduce terminal-output heuristics.

## Contract

Terminal card headers render from structured pane/run state only.

Allowed semantic sources:

- `taskLineup` / TodoWrite-derived task state
- `mainUserAsk`
- `statusSummary` when it is structured and pane-scoped
- durable activity metadata
- explicit provider/runtime events
- project/path state owned by the workspace store

Disallowed semantic sources:

- visible canvas text
- xterm/headless-VT scrollback
- shell prompts
- typed but unsubmitted prompt fragments
- package script names
- command output such as `npm test`, `Worked for...`, or `Goal achieved`
- last visible terminal lines

Terminal output can be displayed, copied, searched, and included in verifier
diagnostics. It must not be promoted into `Task`, title, `Now`, workspace, or
path labels unless it came through an explicit structured event.

## Field Meaning

- `Workspace`: the actual project/repo identity for this pane, never a stale
  project from another pane.
- `Task`: the durable user ask or task-list item for the pane/run.
- Title / `Now`: the current activity happening in that pane/run.
- `Path`: the full structured path for the pane. The visible label may truncate,
  but diagnostics must preserve the full path.

`Task` and current activity are separate streams. A long durable task should not
be duplicated as the title unless it is genuinely the active task-list item and no
more specific current activity exists.

## Missing Data

Missing structured data must be explicit:

- `Task not captured`
- `Activity not captured`
- `Workspace not captured`
- `Path not captured`

Do not hide missing data behind vague labels such as `Working`, `Thinking`,
`Awaiting terminal output`, `Ready`, or `Idle` while the pane appears active.

## Isolation

Every update must be scoped by pane/run identity. Cwd/project-level state is not
enough because multiple cards can share a repo or shell path. A card must not read
another pane's task, project label, activity, or terminal buffer.

## Verifier Bar

High-confidence proof requires the real visible cockpit surface:

```bash
npm run verify:terminal-headers-live-all
```

That verifier must inspect every rendered terminal card through
`cockpit-snapshot.json`, compare the rendered labels to same-pane structured
state, and save full-window plus per-card screenshot evidence.

The verifier should fail on:

- missing captured task/activity for active panes
- stale command leakage into title/now
- task labels containing implementation details or shell commands
- cross-pane project/task leakage
- prompt terminals rendered as idle
- ready prompts rendered as working
- long paths losing their full structured path

Helper tests are necessary, but they are not sufficient for this failure class.

## Label Quality Gate

The header view model also applies a deterministic quality gate before any
structured value is allowed into `Task`, title, or `Now`.

Reject as low quality:

- raw prompt echoes such as `what now?`, `why is this`, or `can you...`
- typo-heavy prompt fragments such as `dont`, `ahve`, `brok`, or
  `descriptuin`
- command labels such as `npm test`, `npm run ...`, `npx ...`, `git ...`, or
  package-script names
- implementation details such as machine-local absolute paths, `src/...`, `tests/...`,
  `scripts/...`, or source filenames
- vague active labels such as `Working`, `Thinking`, `Ready`, `Awaiting
  terminal output`, or `Running terminal command`
- gibberish/keyboard-smash text
- a long title that duplicates the durable task

When a structured value fails the gate, the view model must show the explicit
fallback (`Task not captured` or `Activity not captured`) and expose the reject
reason in diagnostics. It must not replace the bad label by guessing from
scrollback.

Known user complaint phrases are allowed to be polished only by narrow,
deterministic mappings. For example, prompts about “high quality descriptions”
map to `Improve cockpit header descriptions` as the durable task and to specific
activities such as `Reviewing header description quality` or `Improving header
descriptions`.

## Current Proof

2026-06-30 proof for the quality gate:

```bash
npx playwright test tests/header-project-label.spec.ts tests/terminal-header-state.spec.ts tests/terminal-header-quality.spec.ts tests/terminal-header-view-model.spec.ts --reporter=line
npm run build
APP_BUDGET=700 TERMINAL_HEADERS_LIVE_ALL_OUT=/tmp/tw-terminal-headers-live-quality npm run verify:terminal-headers-live-all
```

Results:

- focused Playwright header/state suite passed 56/56
- frontend build passed
- live Tauri/Xvfb verifier passed with
  `TERMINAL_HEADERS_LIVE_ALL_OK terminals=4`

Saved evidence:

- `docs/verification/terminal-headers-live-all-quality-2026-06-30-report.json`
- `docs/verification/terminal-headers-live-all-quality-2026-06-30.png`
- `docs/verification/terminal-headers-live-all-quality-2026-06-30-card-01-prompt.png`
- `docs/verification/terminal-headers-live-all-quality-2026-06-30-card-02-stale.png`
- `docs/verification/terminal-headers-live-all-quality-2026-06-30-card-03-idle.png`
- `docs/verification/terminal-headers-live-all-quality-2026-06-30-card-04-long-path.png`
