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
| Structured incidents (launch, exit, watchdog recovery, pressure; pruned to the latest two calendar days on first daily write) | `~/.local/state/termfleet/incidents.jsonl` |
| Five-second desktop CPU, pressure, and top-three UI/WebKit thread summaries (thread ID, state, CPU share, wait channel; automatic 48-hour retention) | `~/.local/state/termfleet/desktop-samples-YYYY-MM-DD.tsv` |
| Standalone five-second process/pressure sampler when the installed watchdog is stale; timing/state only, pruned after 48 hours | `/tmp/termfleet-performance/desktop-samples-YYYY-MM-DD.tsv`; verify with `npm run verify:performance-sampler` |
| Watchdog progress stage, atomically refreshed in runtime memory; copied into each pre-recycle snapshot | `$XDG_RUNTIME_DIR/termfleet/pressure-watchdog.heartbeat` and `watchdog-heartbeat.txt` |
| Canvas drag, resize, and layout summaries (at most one record per second, with bounded affected-node IDs and source counts) | `/tmp/terminal-workspace-geometry.jsonl` (`kind=canvas-node-movement`) |
| Human incident summary (same two-day pruning policy) | `~/.local/state/termfleet/incident-summary.md` |
| Launcher decisions + daemon startup | `~/.local/state/termfleet/desktop-launch.log` |
| The cockpit's own stdout/stderr | `~/.local/state/termfleet/app-output.log` (+ `.1`) |
| Per-pane agent status sidecars | `~/.local/share/terminal-workspace/agent-status/` |
| Live cockpit health poll | `agent-status/termfleet-pane-health.json` |
| Content-free renderer stalls, terminal interaction timings, map camera changes, and coalesced terminal movement sources | `/tmp/terminal-workspace-geometry.jsonl` (expires after two days of inactivity; rotates above 8 MiB, keeps the latest 1 MiB) |
| Opt-in Rust terminal input timing events (pane ID, byte count, sequence IDs only) | `/tmp/terminal-workspace-latency-trace-<pid>-<thread>.jsonl` (each file rotates at 1 MiB; files older than two days are pruned on first write) |

A clean exit is recorded as `desktop_exit ... status=0 daemon=preserved`. A
watchdog-forced restart is `desktop_recovery` — an exit with no recovery event
means nothing killed it.

The pressure watchdog appends one compact row every five seconds, including
while the desktop is absent or being replaced. It records process states and
cumulative CPU ticks for the desktop/WebKit processes when present, plus host
and desktop-cgroup CPU/I/O pressure and bounded summaries of each process's top
three CPU threads (thread ID, state, CPU share, wait channel). An absent desktop
is explicit in the row, so a quiet log can be distinguished from a missing app. These samples contain
  no terminal content and are pruned after 48 hours. Incident JSONL and its
  Markdown summary are pruned to the latest two calendar days on the first
  incident write each day.

The renderer log records only stall durations, batched input-to-render timing
percentiles, geometry, committed camera changes, and movement-source counts. New
browser and Rust input traces retain byte counts and key categories, never typed
text or terminal output. The geometry log expires after two days of inactivity and
rotates above 8 MiB; each opt-in Rust trace file rotates at 1 MiB, and old trace
files are pruned after two days.

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
