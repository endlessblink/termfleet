# TermFleet v0.2.0 — early preview (Linux only)

TermFleet is a keyboard-first cockpit for running many terminals and AI coding
agents at once. Every terminal is a live card on a zoomable map, each card says
what its agent is working on and whether it is Running, Waiting for you, or Idle,
and terminals survive app restarts, crashes, and reboots.

This is an unsigned early preview for Linux x86-64. Expect rough edges; the
known issues below are real.

## Highlights since v0.1.1

- **Terminals and agent conversations come back.** App restart re-attaches live
  terminals with their processes still running. After a crash of the background
  service or a reboot, each Claude Code, Codex, or OpenCode pane resumes its own
  conversation; plain shells replay their text. A conversation is never resumed
  in two places at once.
- **True Running / Waiting / Idle badges.** Codex state is read from Codex's own
  session log plus the process table, so a finished turn reads Idle and an
  approval prompt reads Waiting even when status hooks are silent.
- **Every card says what it is for.** Task, Goal, and Now rows come only from
  evidence the pane itself produced (its task list, its session record, the
  operator's request). Missing evidence reads "not captured" instead of a guess.
- **A calmer map.** The map opens on your active terminal at a readable zoom,
  never moves your view while that terminal is on screen, and the card's task
  row has a fixed height so changing text never shoves the terminal below it.
- **Reconnect a chat from its card.** "Connect terminal" re-attaches the right
  agent conversation, including agents you started by hand.
- **Project grouping** follows the folder a terminal is in now, with stable
  per-project icons.
- **Reliability fixes:** a pane without a title no longer crashes startup, map
  rename works on slower machines, the sidebar lists terminals before the
  background service answers, and the PTY registry never blocks on slow work.

## Experimental (off or unadvertised)

- **Workstream Quest** (focus timer and quests) is off for new users. Turn it on
  from the command bar: *Show Workstream Quest*.
- **TermControl** (phone companion) ships in the repository but is not part of
  this preview's supported surface.
- **OpenCode** support works (status, resume, reflow) but copy and scroll inside
  an OpenCode pane are still being fixed.

## Known issues

- A plain shell running a recognised command can show "Awaiting command" instead
  of the command's description (TF-047).
- OpenCode panes: text copy and scroll are unreliable (TF-033, TF-034, TF-035).
- Some Codex tool calls can briefly show Running while Codex waits on you.
- Full BiDi / Hebrew nikud shaping in the terminal is not implemented yet.
- A reboot cannot resurrect processes that were running before it; agents
  resume their conversation, shells replay their text.

## Support matrix

| Target | Status |
|---|---|
| Linux x86-64 | Supported preview target |
| Debian/Ubuntu with WebKitGTK 4.1, JavaScriptCoreGTK 4.1, and libsoup 3 | Supported runtime boundary |
| Linux ARM or other architectures | Not built by this release |
| macOS and Windows | Not supported |

Both artifacts are unsigned. Verify downloads against `SHA256SUMS.txt`.

## Rollback

The installer keeps earlier releases under `~/.local/share/termfleet/releases/`.
If a build misbehaves, point the dock entry back at the previous release and
relaunch; never delete the background service's session data.
