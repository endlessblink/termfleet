# TermFleet v0.2.2 — early preview (Linux only)

TermFleet is a keyboard-first cockpit for running many terminals and AI coding
agents at once. Every terminal is a live card on a zoomable map, each card says
what its agent is working on and whether it is Running, Waiting for you, or Idle,
and terminals survive app restarts, crashes, and reboots.

This is an unsigned early preview for Linux x86-64. Expect rough edges; the
known issues below are real.

## New in v0.2.2

- **The app stays responsive in long sessions.** v0.2.1 could sit on its splash
  screen or go sluggish after hours of use because the app rewrote its own
  settings store about 0.5 MB every second. Writes are now rate-limited per key,
  unchanged values are skipped, and pending state is flushed when you close.
- **Copy and paste no longer get wiped when you switch terminals.** Clicking a
  terminal in the sidebar replays its saved history; every clipboard copy an
  agent had ever made in that history was being re-run, overwriting what you had
  just copied. History replay no longer has side effects (TF-067).
- **Zoomed-out map cards are readable.** Below 100% zoom the card preview used to
  drop every other character and row, so text looked scrambled. It now shows the
  newest lines, unmodified.
- **Private by default.** The latency diagnostics the app keeps locally record
  byte counts, never what you typed, and are size-capped and expire after two
  days.
- **Scrolling and selecting in Codex and other full-screen terminals** got a fix
  (TF-062): wheel input is paced and Codex is launched in a mode that handles the
  wheel itself. Automated tests pass, but wheel scrolling in both directions and
  drag-selection on a live Codex pane are **not yet confirmed**, so treat this as
  a fix attempt, not a finished one.
- **Workstream Quest** stays off for new profiles. An unfinished **helper
  terminals** feature ships switched off.

## Highlights since v0.1.1

- **Terminals and agent conversations come back.** App restart re-attaches live
  terminals with their processes still running. After a crash of the background
  service or a reboot, each Claude Code, Codex, or OpenCode pane resumes its own
  conversation; plain shells replay their text. A conversation is never resumed
  in two places at once.
- **True Running / Waiting / Idle badges** for Codex come from Codex's own session
  log plus the process table, so a finished turn reads Idle and an approval
  prompt reads Waiting even when status hooks are silent.
- **Connect agents.** The status bar offers **Connect agents** when Claude Code,
  Codex, or OpenCode is set up for your user. It copies the status hooks to
  `~/.local/share/termfleet/agent-hooks/`, registers them, and backs up every
  settings file it touches. Needs Node.js 20+.
- **Every card says what it is for.** Task, Goal, and Now rows come only from
  evidence the pane itself produced (its task list, its session record, your
  request). Missing evidence reads "not captured" instead of a guess.
- **Reconnect a chat from its card**, project grouping that follows the folder a
  terminal is in, and a map that opens on your active terminal without moving
  your view.

## How this release was checked

- Clean install of both the AppImage and the `.deb` on an empty profile (private
  display, throwaway home folder): window opens, background service starts, first
  terminal runs a real command, **Connect agents** registers the Claude Code hook
  and a hook event fills in the card.
- App restart: the app was killed, the background service kept the terminal and a
  process running inside it, and the relaunched app re-attached to the same
  terminal.
- Crash recovery: the background service was killed while the app was closed; on
  relaunch the terminal came back with its earlier text and accepted new input.
- Project persistence: a newly created project was on disk within seconds and was
  still there after an app kill and after a service kill.
- Soak: 30 minutes of typed probes against the running app on an empty profile;
  the slowest keystroke-to-terminal probe and the memory trend are recorded in
  the launch fact sheet.
- `npm run verify:release` (terminal reliability, restart restore, latency probe,
  standalone daemon restart and cold restore) and the Rust unit tests pass.

## Known issues

- After a restart or crash, the sidebar can show a **Recovery review** list with
  entries marked "dead · recoverable" for terminals that are already back. They
  are older copies, not missing work; clear them with the trash icon.
- Panes with no connected agent read "No task — just a command prompt" or
  "Task not captured". Connect agents (status bar) to fill the rows in.
- A plain shell running a recognised command can show "Awaiting command" instead
  of the command's description (TF-047).
- OpenCode panes: text copy and scroll are unreliable (TF-033, TF-034, TF-035).
- Some Codex tool calls can briefly show Running while Codex waits on you.
- At about 66% map zoom a card's project icon can overlap the first header word.
- The status bar can show "system pressure high" when the whole computer is busy,
  not only TermFleet.
- Full BiDi / Hebrew nikud shaping in the terminal is not implemented yet.
- A reboot cannot resurrect processes that were running before it; agents
  resume their conversation, shells replay their text.
- Connect agents was verified on an empty profile for Claude Code only; Codex and
  OpenCode registration was not re-tested from a clean profile for this release.

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
