# Native lifecycle and mobile integration — 2026-10-05

This checkpoint supersedes the native-producer and blocked-runner statements in
`session-lifecycle-source-checkpoint.md`. Linux native collection is now connected.
The authority/compatibility flags retain their default-off settings.

## Implemented source

The daemon's exact PTY/provider ownership and inherited pane binding select the
provider process. A pidfd, process start ticks and boot identity pin its lifetime;
heads older than process birth are rejected. Native observations serialize through
the packaged Node journal publisher. Input intent captures identity before the
write and is queued only after successful delivery. Transport events use the same
captured binding. Escape/Ctrl+C alone never claim cancellation. Codex cancellation
requires an explicit timestamped `turn_aborted` from an open rollout carrying the
exact conversation ID. Late-open rollout discovery rechecks process birth.

A non-child pidfd exit proves Ended, without inventing a wait status or Crashed.
Claude/OpenCode cancellation requires their own explicit evidence; this patch does
not infer it from keypresses. Observers currently live in the desktop process;
the journal survives it. The shared daemon was not changed or restarted.

The original full shell-map durable activity guard is active again. The visible
Now resolver now accepts fresh quality-checked activity when Goal/Task are absent,
while preserving the original no-stale-prompt/no-fabricated-task assertions.

## Runtime evidence

Evidence directory: `../termfleet-native-runtime-handoff/` (outside tracked source).
The private Xvfb/Tauri/Canvas2D fixture uses its own daemon socket, XDG paths and
synthetic provider named codex.mjs. It does not run or resume owner conversations.
Its23 assertions cover held MRU forward/reverse, attention, New Agent open/cancel,
Goal/Now, typed waiting/answer, Escape non-cancellation, explicit Codex interruption,
new turn, Finished sticky against late tools, pidfd exit and surviving parent shell.
The rollout opens after native binding, exercising the final discovery change.

Commands/results are recorded in the handoff, including Cargo checks and focused
Rust tests; combined source/hook guards; mobile32 focused/24 canonical checks;
frontend build; map/typography guards; original map rendered guard; and phone HTML
render from the native journal. Phone network is synthetic; this is not physical
phone/auth/SSE acceptance. Developer Tauri is internal proof, not installed dock
acceptance. New Agent actual provider launch and failure continuity, real-provider
shadow soak, non-Codex cancellation and installed dock acceptance remain open.
TF-044 and TF-047 remain verifying.

## TermControl preservation and Git

The current deployed choice-answer patch (revision1791175109753-106037) is included,
not just the old26-file baseline. The worker's receipt reports32 installed checks,
24 regressions and35 preserved sessions; actual Claude/phone acceptance remains
pending, and custom free text stays disabled. See `termcontrol-freelance-mobile.md`.
The27 current canonical WIP paths were captured with hashes and a binary patch.
Shared docs merge from c81da18; issue records merge by ID, preserving worker states
and history including TF-078. Canonical promotion checks exact precondition hashes
before writing, retains a recovery commit and full candidate bundle, and performs
no public push, installed release promotion or shared process restart.

Final integrated validation:656 source/hook/HTTP tests passed (7.5s);32 mobile focused
and24 canonical passed; native23 and phone HTML1 passed after the latest mobile
merge; build9.72s, Cargo check1.13s and native Rust2 passed; issue/map/typography and
diff checks passed. Earlier unchanged navigation/provider browser10 and original
map rendered1 proofs are retained. Commands: the saved source-command JSON plus
agent-status-sidecar/agent-status-end-to-end; mobile commands in
`termcontrol-freelance-mobile.md`; `npm run build`, `npm run issues -- check`,
`npm run verify:map-terminals`, `npm run verify:typography`,
`CARGO_BUILD_JOBS=1 cargo check --offline --manifest-path src-tauri/Cargo.toml`,
`cargo test --offline --manifest-path src-tauri/Cargo.toml session_native`, and the
archived private native run.sh / phone Playwright config.
