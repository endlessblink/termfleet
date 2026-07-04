# Agent Instance Resurrection Reference Sketch

This note was moved from the `bina-ve-ze` checkout on 2026-06-30 because it
describes the TermFleet `TC-041` restart-survivable agent restore lane.

It is a reference sketch only. TermFleet must not add tmux as an implementation
dependency for `TC-041`; use the model, not the dependency:

- live reattach while the supervisor/PTY still exists;
- durable reconstruction after full reboot when process memory is gone;
- provider resume where possible, such as `codex resume <session-id>`;
- explicit `reconstructed` status when only saved context exists.

The original sketch used a local tmux-backed wrapper for Codex/Claude instances.
Runtime manifests lived under an ignored `tmp/agent-instances/` directory:

```bash
scripts/agent-resurrect.sh launch mobile codex docs/prompts/mobile-fix.md
scripts/agent-resurrect.sh attach mobile
scripts/agent-resurrect.sh record mobile 019f152c-573d-7c42-9042-a73dc370bb70
scripts/agent-resurrect.sh resurrect mobile
scripts/agent-resurrect.sh list
```

## What Resurrection Means

There are two different recovery levels:

1. **Live reattach**: if the agent was launched by `scripts/agent-resurrect.sh`, tmux owns the PTY. Closing the terminal does not kill the agent. Use `attach`.
2. **Session reconstruction**: if the PTY died, the original process is gone. Use `resurrect` to start a new tmux PTY from a recorded Codex session id (`codex resume <id>`) or from the original mission file.

The second path is not the same as tmux reattach. It restores context, not the dead process.

## Reference Habit

The sketch expected every parallel agent instance to:

1. Put the mission in a small Markdown file under `docs/prompts/` or `tmp/`.
2. Start the agent through the wrapper:

   ```bash
   scripts/agent-resurrect.sh launch <lane-name> codex <mission-file>
   ```

3. When Codex shows or logs the thread/session id, record it:

   ```bash
   scripts/agent-resurrect.sh record <lane-name> <codex-session-id>
   ```

4. Use `attach` during normal work and `resurrect` only after the tmux session is gone.

## Why This Was Captured

The Bina checkout had manual handoff files and dirty-file ownership warnings, but
no live agent process registry. `.omx/state/session.json` tracked the current
Codex process only, and Codex's process manager had no active chat entries in
that checkout. Already-dead terminals could only be reconstructed from logs,
dropoffs, and session ids.

For TermFleet, the equivalent durable contract belongs in the existing daemon,
session checkpoint, and agent metadata path documented in `MASTER_PLAN.md`
under `TC-041`.
