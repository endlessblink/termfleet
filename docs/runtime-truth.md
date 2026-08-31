# Runtime truth — read this before diagnosing anything

Where the app's real state lives, and which sources lie. Every entry exists
because an agent reported something false by reading the wrong one.

## 1. Ask the daemon what is running. Never the saved files.

```bash
node scripts/termfleetctl.mjs status --json          # daemon pid, build id, counts
node scripts/termfleetctl.mjs sessions list --json   # sessions; `sources` contains "live" for running ones
```

A live session's `command` is what its pane is actually running right now
(`/bin/bash`, `codex resume <id>`, `claude --resume <id>`).

**Do not** judge "did this pane come back?" from
`~/.local/share/terminal-workspace/sessions/*.meta.json` or `.scrollback`. Those
are flushed lazily, so shortly after a relaunch they still describe the
*previous* run — including a stale `restoreStatus` and `restoreFailureReason`.
Reading them is how two working, resumed panes were reported as broken.

Use the persisted files only for panes with **no** live session, or to read a
conversation id.

## 2. A new release does not reach the terminals until the daemon is stopped

`daemon_ensure_running` reuses any reachable daemon **regardless of build id**
(`daemon.rs`) — deliberately, because replacing it kills the operator's live
agents. So:

- `npm run release:install` + relaunching from the dock changes the **window
  only**. Backend fixes (`pty.rs`, `daemon.rs`, restore/resume logic) keep
  running the OLD code.
- To exercise a daemon-side fix the daemon process must end: stop the app and
  the `termfleet --terminal-workspace-daemon` process, or reboot.
- Check before believing anything: daemon start time vs release promotion time.

This cost a full round of "the fix is installed" / "it behaves exactly the same".

**Stop it with `npm run stop:all`, never by hand.** That script SIGTERMs (then
SIGKILLs) every owning process, verifies they are gone, and refuses to report
success while the socket still answers. It never unlinks the socket: deleting a
socket whose daemon was still alive is what produced a daemon split-brain — two
daemons, two socket listeners, and every running agent unreachable from the app.
A stale socket file is fine; the launcher connects, is refused, and proceeds.

## 3. Logs that already exist

| What | Where |
| --- | --- |
| Structured incidents (launch, exit, watchdog recovery, pressure) | `~/.local/state/termfleet/incidents.jsonl` |
| Human incident summary | `~/.local/state/termfleet/incident-summary.md` |
| Launcher decisions + daemon startup | `~/.local/state/termfleet/desktop-launch.log` |
| The cockpit's own stdout/stderr | `~/.local/state/termfleet/app-output.log` (+ `.1`) |
| Per-pane agent status sidecars | `~/.local/share/terminal-workspace/agent-status/` |
| Live cockpit health poll | `agent-status/termfleet-pane-health.json` |

A clean exit is recorded as `desktop_exit ... status=0 daemon=preserved`. A
watchdog-forced restart is `desktop_recovery` — an exit with no recovery event
means nothing killed it.

**Still not covered:** a stall where the process looks healthy but the UI is not
painting. The pressure watchdog samples every 5s and catches a *blocked*
process, not a busy one. Detecting that needs a heartbeat from the app itself.

## 4. Agent resume rules (TC-054 lineage)

- Recovery is **per pane**, never per folder. The durable key is
  `terminal-<tabId>-<paneId>`; the conversation id lives in that pane's sidecar.
- On cold restore, a pane whose checkpoint is an agent terminal is respawned
  **directly into** `codex resume` / `claude --resume` / `opencode --session`.
  Resume commands are never typed into a live terminal — that pastes visible
  junk and can produce a second writer.
- Duplicate writers are prevented downstream, not by refusing to resume:
  `provider_writer_is_alive` plus an on-disk `flock` resume lock.
- A recorded `resume-failed` is only sticky when the failure is **terminal**
  (the saved conversation is gone, or the operator quit the agent). Ownership or
  policy refusals must be retried — after a reboot the previous owner is dead,
  and a sticky refusal means the pane never comes back.
- A resumed agent that exits cleanly after running a while was quit by the
  operator: the pane comes back as a plain shell, not another resume. Otherwise
  `/exit` relaunches the agent instantly.

## 5. Verifying a recovery claim

Never say "fixed" from tests alone. The acceptance surface is the dock-launched
app, pane by pane:

```bash
npm run verify:reboot-rehearsal   # per-pane verdict from copies of live checkpoints
npm run doctor                    # status pipeline health
node scripts/termfleetctl.mjs sessions list --json   # what is live right now
```
