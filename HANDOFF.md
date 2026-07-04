# Handoff - 2026-06-30 Tuesday

You are continuing work in **termfleet** on branch
**fix/canvas-perf-and-wrap-spill**.

## Current task & next step

TC-041 restart-survivable agent restore is now marked **DONE** in
`MASTER_PLAN.md`.

The misplaced `bina-ve-ze` reference artifacts have been moved into this repo:

- `docs/reference/agent-instance-resurrection-tmux-sketch.md`
- `docs/reference/agent-resurrect-tmux-sketch.sh`

They are reference-only. Do not turn them into the supported implementation path.

Done in this pass:

1. Added backend manifest/planner coverage for live attach, Codex durable
   resume, reconstructed fallback, auth-needed state, and metadata merge.
2. Extended session metadata with provider, launch profile, durable provider
   session id, mission/dropoff context, restore status, and restore failure.
3. Added `daemon_update_agent_recovery_manifest` and a best-effort frontend
   writer from agent workstream terminals, including structured
   `providerSessionId` / `sessionId` signals.
4. Extended `scripts/verify-restart-restore.py` so the real daemon verifier now
   covers agent resume and reconstructed fallback in addition to the existing
   live reattach and cold scrollback/cwd/size restore layers.
5. Surfaced restore state in the existing agent status chip and added a browser
   hydration regression proving a restored Codex lane survives two reloads as
   one tab and one map node with `restore · resuming` visible in map and split.
6. Added `npm run verify:agent-restore-visible`, a live Tauri dev smoke that
   seeds the desktop disk-layout file plus agent checkpoint, restores the map
   lane through the real app, verifies the fake Codex resume output in the daemon
   snapshot, captures screenshots, and proves typed UI input reaches the
   restored PTY.

Next optional hardening, not required for TC-041 completion:

1. Fold `verify:agent-restore-visible` into a broader release gate if the extra
   live Tauri runtime cost is acceptable.
2. Add a second live Tauri screenshot fixture for the reconstructed no-session
   branch. Backend and browser coverage already prove that branch; this would be
   redundant visual evidence.

## Key decisions

- Do **not** add tmux as an implementation dependency. tmux/tmux-resurrect is
  only the reference model: live PTY reattach while the supervisor is alive;
  after full PC restart, restore durable state and reconstruct/resume provider
  context.
- Do **not** claim exact restoration of in-flight commands, process memory,
  unsaved TUI state, SSH sockets, editor process state, or provider RAM.
- For Codex, prefer durable provider resume with `codex resume <session-id>`.
- If no provider session id exists, restore the visible lane from cwd, mission,
  dropoff/handoff context, launch command, and captured scrollback; label it
  `reconstructed`.
- Keep recovery state in metadata/runtime state, not terminal-buffer error text.

## Repo state warning

This checkout already had many unrelated dirty files before this handoff update.
Keep implementation diffs scoped and do not stage unrelated changes.

Planning files intentionally touched in this pass:

- `MASTER_PLAN.md`
- `HANDOFF.md`

## Proof expected for TC-041

- Live attach: existing PTY is reused when daemon survives app restart.
- Snapshot persistence: simulated PC restart restores layout, cwd, provider,
  launch command, scrollback snapshot, durable session id, and terminal size.
- Codex resume: fixture launches `codex resume <session-id>` in the restored cwd.
- Reconstructed fallback: no-session fixture restores mission/dropoff plus
  scrollback and displays `reconstructed`.
- Idempotence: repeated restart cycles do not duplicate terminals, map nodes, or
  workstream cards.

## Verification from this pass

- `npm run verify:agent-restore-visible` passed with
  `AGENT_RESTORE_VISIBLE_OK`; screenshots:
  `/tmp/tw-agent-restore-visible/01-restored-agent-map.png` and
  `/tmp/tw-agent-restore-visible/02-restored-agent-after-input.png`.
- `python3 scripts/verify-restart-restore.py` passed all three layers: live
  reattach, cold scrollback/cwd/size restore, and agent resume/reconstruct
  restore, ending with `PASS: terminals and agent lanes restore across app
  restart AND PC reboot`.
- `CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 cargo test --manifest-path src-tauri/Cargo.toml pty::tests -- --nocapture` passed 23/23.
- `npx playwright test tests/agent-workstream.spec.ts -g "restored agent lanes keep one visible map node" --reporter=line` passed 1/1.
- `npm run build` passed.
- `bash -n scripts/verify-agent-restore-visible.sh` passed.
- `git diff --check -- MASTER_PLAN.md HANDOFF.md package.json scripts/verify-agent-restore-visible.sh` passed.
