# TC-054 — Reliable map-terminal auto-resume (design)

Status: DESIGN (awaiting approval) · Confidence: HIGH · Author date: 2026-07-13
Related: TC-035 (per-pane keying), TC-017 (headless-VT), memory `project_termfleet_daemon_wedge_recovery`.

## Goal
100% of map terminal nodes come back **connected to their correct session and live** after a
daemon recycle / OOM / reboot — including agents the user started **by hand** in a terminal, not
only agents launched through TermFleet's agent button.

## Root cause (confirmed by reading the code)
The full cold-restore/resume machinery already exists and works — it is only ever *armed* for
agent-button sessions.

1. Map node session id is deterministic and persisted: `runtimeSessionId = terminal-<tabId>-<paneId>`
   (`Terminal.tsx:477`). Reattach keys are fine.
2. Manually-run `claude`/`codex` **are** detected live: the status hooks
   (`scripts/termfleet-codex-status-hook.mjs`, `termfleet-claude-status-hook.mjs`) fire inside any
   agent running in a TermFleet PTY and write `{cwd, sessionId, userTask}` to
   `~/.local/share/terminal-workspace/agent-status/pane-*.json`. Proof: a hand-started hermes pane
   file holds `sessionId: 019f5a71-…`. That `sessionId` reaches the frontend as
   `signal.providerSessionId` (`Terminal.tsx:337-338`).
3. On every signal with a `providerSessionId`, the frontend already *tries* to persist a resume
   manifest (`Terminal.tsx:1277-1282`).
4. **The blocker:** `persistAgentRecoveryManifest` early-returns unless the pane was launched as an
   agent workstream — `Terminal.tsx:937`: `if (!ptyId || workstream?.kind !== "agent") return;`.
   So for a hand-started agent the manifest is dropped despite having the live conversation id.
5. Because no manifest is written, the daemon tags the session as an ordinary shell. On cold
   restore `plan_agent_restore` (`pty.rs:1046`) sees `recovery_kind != AgentTerminal` and returns
   **"Reconstructed" = re-run the plain shell** (scrollback replay only, no resume). That is why
   `< 100%` come back live.

Everything downstream already works once a manifest exists:
- `update_agent_recovery_manifest_in_dir` **always** sets `recovery_kind = AgentTerminal`
  (`pty.rs:1242`) and writes under `default_persist_dir()` (survives recycle — `cgroup.kill` only
  kills processes, not disk files).
- `plan_agent_restore` resumes AgentTerminal sessions: uses `sanitized_resume_command` if present,
  else for **codex** synthesizes `codex resume <provider_session_id>` (`pty.rs:1078-1099`). There is
  **no** equivalent id-only fallback for claude.
- The chosen command is spawned as the session command on cold restore (`pty.rs:414-419`).

## The fix (small, additive — reuses all existing machinery)
1. **Lift the gate to "live-detected agent," not "launch-time agent."**
   In `persistAgentRecoveryManifest` (`Terminal.tsx:932`), when a `providerSessionId` is present
   (i.e. a hook proved an agent is actually running in this pane), record the manifest even if
   `workstream?.kind !== "agent"`. Keep the current early-return only when there is *neither* an
   agent workstream *nor* a detected `providerSessionId`.
2. **Supply `provider` on the manual path.** The manifest needs `provider` (codex vs claude). The
   status signal already knows which hook produced it (codex vs claude); thread that provider into
   the signal → manifest payload. Without it, `plan_agent_restore`'s codex fallback can't fire.
3. **Give claude an id-only resume too.** Either (a) frontend sets
   `sanitizedResumeCommand = "claude --resume <providerSessionId>"` on the manual path, or (b) add a
   claude branch in `plan_agent_restore` mirroring codex (`claude --resume <id>`). Prefer (b) so the
   daemon is self-sufficient and the rule lives in one place.
4. **Key the manifest by the cold-restore lookup id.** Cold restore does `load_persisted(dir, &id)`
   where `id` is the session being ensured = `runtimeSessionId` (`terminal-<tab>-<pane>`). The
   manifest MUST be written under that same id. Today the call uses
   `livePtyId ?? attachToPtyId ?? runtimeSessionId` (`Terminal.tsx:1278`). Verify that for map panes
   `livePtyId === runtimeSessionId`; if it can differ, always persist under `runtimeSessionId` (or
   under both) so the reopen finds it.

## Why this reaches 100%
Every agent pane emits status signals while alive (hooks fire periodically — proven by the existing
pane json). With the gate lifted, each such pane records a resume manifest keyed by its stable id.
On the next recycle/reboot, cold restore finds the manifest and spawns `codex resume`/`claude --resume`
instead of a bare shell. Panes with no agent stay plain shells ("live" = a working shell), which is
already correct.

## Edge cases / side effects to guard
- **False positive:** never tag AgentTerminal without a real `providerSessionId` from a hook — a bare
  shell must not try to "resume." (The gate keys on providerSessionId presence, so safe.)
- **Live pane double-resume:** `plan_agent_restore` returns `LiveAttached` first when a live pty
  exists (`pty.rs:1038`), so a still-running agent is reattached, never re-resumed. Safe.
- **Stale id:** codex session id changes per run; the hook emits the *current* one each signal, so
  the manifest is refreshed continuously. Latest signal wins.
- **claude regression:** if we forget step 3, codex resumes but claude panes still cold-restore bare.
  Step 3 is required for "all."
- **Auth-required:** existing `NeedsAuth` branch is preserved — don't auto-run resume when the last
  known state was auth failure.

## Verification plan
- Extend `scripts/verify-agent-restore-visible.sh` to cover a **hand-started** (non-workstream)
  codex and claude pane: start agent by typing, wait for a status signal, kill+relaunch the daemon
  (`--fresh-daemon`), assert the pane cold-restores into `codex resume`/`claude --resume` and shows
  the prior conversation (not a bare prompt).
- Unit: `plan_agent_restore` returns `Resuming` with the right command for (codex, id-only),
  (claude, id-only), and `Reconstructed` for a shell with no providerSessionId.
- Manual: on the real 20-node map, recycle the daemon and confirm every agent pane returns live.

## Stopgap (optional, no code change)
For the current live agents, inject a manifest now via the daemon socket / `daemon_update_agent_recovery_manifest`
using the `sessionId` already in each `agent-status/pane-*.json`, so they survive the next restart
before the feature ships.

## Out of scope (tracked separately)
TC-055 dead-process eradicator — deep agent-in-tree scan + idle gate before reaping leftover servers.
