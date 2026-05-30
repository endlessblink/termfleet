# Recoverable Terminal Perplexity Queries

Purpose: research the unknowns before designing tmux-like recoverable terminals
for Magic Canvas / Terminal Cockpit. The current app uses Tauri, React,
`xterm.js`, and `portable-pty`; workspace layout is persisted, but live PTY
processes are owned by the Tauri runtime and are killed when an owned terminal
component unmounts.

## Primary Queries

1. `Tauri 2 Rust persistent background process keep PTY sessions alive after window close Linux best practice`

2. `portable-pty Rust keep pseudo terminal child alive across frontend reconnect xterm.js session architecture`

3. `Rust Tauri sidecar daemon PTY manager reconnect UI after app restart Linux architecture`

4. `tmux control mode attach GUI terminal emulator xterm.js Rust integration best practices`

5. `zellij pipe plugin API attach external GUI client session pane metadata current working directory`

6. `tmux vs zellij programmatic API session pane metadata control mode JSON external client comparison`

7. `terminal emulator app persistent sessions after crash architecture PTY supervisor daemon scrollback replay`

8. `Linux pseudo terminal process survives parent process exit setsid controlling terminal Rust pty daemon`

9. `systemd user service terminal session daemon Tauri app IPC Unix socket local-only security`

10. `xterm.js restore scrollback buffer from backend replay large terminal output performance limit`

## Unknowns To Resolve

### Process Ownership

1. `Can a portable-pty child process survive Tauri app process exit if spawned from Rust without external daemon Linux`

2. `Rust pty child process orphan controlling terminal parent death SIGHUP setsid nohup pseudo terminal behavior`

3. `Best architecture for desktop terminal app crash recovery persistent PTY broker daemon`

### Multiplexer Integration

4. `tmux control mode create panes send keys read output external terminal GUI client examples`

5. `tmux capture-pane live stream pane output external GUI client limitations`

6. `zellij external control API create tabs panes send input capture output current status`

7. `zellij resurrect session restore limitations commands cwd environment running processes`

8. `tmux resurrect continuum restore limitations running process state cwd vim shell commands`

### Reboot Recovery Limits

9. `Linux checkpoint restore terminal interactive process CRIU pseudo terminal limitations tmux`

10. `Can CRIU checkpoint restore interactive shell with PTY tmux zellij terminal multiplexer limitations`

11. `desktop terminal app reboot restore sessions cwd command history scrollback not running process best practice`

### Magic Canvas Product Shape

12. `GUI terminal workspace use tmux as backend expose sessions tabs panes files map architecture`

13. `terminal workspace app model sessions groups splits map nodes persistent ids PTY reconnect design`

14. `how Warp iTerm2 WezTerm Ghostty persist terminal sessions crash restart scrollback architecture`

15. `WezTerm mux server GUI detach reattach architecture terminal multiplexer local domain`

## Decision Queries

Use these after the first pass if the results are still ambiguous.

1. `Should a Tauri terminal workspace implement its own PTY daemon or use tmux backend pros cons`

2. `tmux control mode limitations for building custom GUI terminal client with xterm.js`

3. `zellij plugin pipe limitations compared to tmux control mode for external terminal UI`

4. `portable-pty vs wezterm mux server architecture reusable Rust terminal workspace`

5. `local Unix socket IPC auth security for desktop app controlling terminal daemon Linux`

## Expected Research Output

For each useful source, capture:

- What survives app window restart.
- What survives full app process crash.
- What survives OS reboot.
- Whether recovery preserves running processes or only restores session shape.
- API surface for create pane, send input, resize, read output, list sessions,
  list panes, get cwd, and kill session.
- Security implications of a local PTY daemon or tmux/zellij bridge.
- Fit for Magic Canvas: first-class terminal groups, split panes, map-linked
  sessions, and browser-preview fallback.

