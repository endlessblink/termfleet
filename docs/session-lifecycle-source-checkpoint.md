# Session lifecycle source checkpoint — 2026-10-05

Continuation from `236ff93` in the isolated `codex/desktop-mobile-integration` tree. This checkpoint supersedes the earlier list of *offline* lifecycle implementation gaps; it does not supersede native or installed acceptance requirements.

## Implemented and deterministically exercised

- `publishSessionObservation` routes trusted capture-time process/transport observations through the same per-pane transaction, persistent sequence, fsync JSONL append, atomic head and crash replay as hooks. No new HTTP endpoint or daemon socket was added. Observations never create or guess a missing conversation binding.
- `agent.started` registers a **process-lifetime token**, not a PID heuristic. A matching `agent.exited` records Ended (exit 0), Interrupted (observed SIGINT or exit 130), or Crashed (other known exit); the shell may remain alive. Exit is not turn completion. Wrong process, pane/conversation/run/epoch, duplicate source sequence and late previous-run observations are rejected.
- Esc/Ctrl+C are **intent**, not proof of cancellation. Only an explicit `interruption.observed` from the trusted source with the same process token and intent ID changes the turn. A running process can have an interrupted turn; late tools cannot revive it, while a new prompt can. A process-exit interruption separately marks the process ended.
- Transport disconnect/reconnect are durable metadata. Disconnect makes active state Unknown; reconnect increments epoch and requires fresh work evidence. Explicit completion/process exit is retained. Snapshot hydration handles the validated reconnect boundary, and replay repairs the head even when a duplicate observation is rejected.
- With explicit authority on, Codex/Claude sidecar lifecycle/Now are projected solely from the committed head; publication failure gives Unknown. OpenCode uses the same compatibility projection, and desktop/bridge do not promote legacy lifecycle when durable evidence is absent. With authority off, legacy display compatibility is preserved. This is controlled retirement of lifecycle/Now outputs, **not deletion of all legacy metadata readers or producer code**. Recovery/provider/task metadata remains available.
- `session-soak.mjs` provides an opt-in durable recorder (`TERMFLEET_SESSION_SOAK_DIR`, unset by default). Fixed ring: default four files, 1 MiB each, fsync data/cursor/directory, metadata-only hashed binding, status/parity and observation delay. No prompts, Task/Goal/Now, raw identity, process tokens or free-form reasons. It rotates partial tails and rejects contention explicitly. Recording failure is reported without invalidating an already committed primary event. This is a recorder implementation plus synthetic evidence, **not a live soak sample or latency SLO proof**.
- The packaged hook dependency graph includes the observation adapter and recorder; the copied temporary bundle still imports and publishes synthetic events.

## Trusted-source dependency — still real work, not just a proof label

No current native path calls `publishSessionObservation`. The existing PTY exit adapter is still ephemeral. `PaneAgentProviderOwner` currently exposes provider/PID, which does not supply a process birth token, a verified child exit while the PTY shell lives, or a cancellation acknowledgement. Inferring these from a missing scan entry, terminal text, or every Escape/Ctrl+C would recreate the original false statuses.

The adapter contract requires capture-time pane/session/run/epoch, one stable observer with a monotonic sequence for that run, and a process token including process birth identity. A source restart must preserve its sequence or explicitly establish a new binding. The publisher does not authenticate arbitrary callers; it is an internal trusted-source seam, never an untrusted browser/mobile route. A new process after Ended needs a new explicit binding/SessionStart; old hook events must not be relabelled as the new run.

**Therefore actual native producer wiring and durable PTY observations are still pending** until a scoped synthetic native fixture exposes the real lifecycle and cancellation signals. No process scan, real provider, daemon restart, app install, installed plugin modification or native flag activation was performed here.

## Fresh verification

- 625/625 unblocked source tests, including 14 new lifecycle/retirement/soak regressions, passed. Two previously blocked hook/HTTP specs remain excluded. Seven provisional guards first failed with unavailable observation/recorder implementations and the old null-head compatibility path; this is missing-contract reproduction, not a claimed live reproduction.
- `npm run build` passed again after shared snapshot changes (9.64 s build phase); the final log is retained with the follow-up artifacts.
- `CARGO_BUILD_JOBS=1 cargo check --offline` passed (2m16s), including the expanded Tauri resource graph. Rust source was not changed, so no new Rust behavior test is claimed.
- Map/typography source checks, Node syntax checks and `git diff --check` passed.
- Synthetic checks cover exact-token exit, input intent versus observation, late tool rejection, transport completion preservation, epoch hydration, crash replay repair, missing-head fail-closed desktop/bridge, OpenCode authority projection, recorder rotation/privacy and primary-journal survival on recorder contention.

## Bounded remaining gates

1. **Runtime fixtures on an approved host:** Node child spawning and loopback fixture ports (5189, 38217 and ephemeral ports), Chromium; execute retained hook/HTTP and rendered map/mobile/navigation guards using disposable data. Previous EPERM/endpoint failures and approval-review timeouts were not retried.
2. **Native source connection and acceptance:** disposable XDG/runtime and separate daemon/socket; capture authoritative process-birth/exit and cancellation signals, connect them to the observation seam without rewriting old-run bindings, and prove process exit with shell alive, Esc/Ctrl+C acceptance/refusal, reconnect/recovery and native Canvas2D focus. This includes the explicit pending code connection described above, not merely rerunning a test.
3. **Shadow and release acceptance:** keep authority off while collecting durable real parity/lease/latency evidence. Then separately review activation and immutable release/plugin promotion; verify the dock-launched desktop and phone, including the original still-unverified rendered Goal/Now map assertion. Broad TC-170–179/TC-202 remain open; do not claim full removal of legacy writers until these gates justify it.
4. **Canonical Git integration:** preserve/freshly verify the 26 original mobile WIP files and canonical HEAD, apply reviewed integration history, verify one clean canonical checkout, then retire isolated copies with the verified recovery bundles. No canonical overwrite or clone deletion occurred here.
