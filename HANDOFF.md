# Handoff — 2026-05-30 16:54 Saturday

You are continuing work in termfleet (terminal cockpit; Tauri 2 + React + TS +
Rust, WebKitGTK) on branch main.
Location: /media/endlessblink/data/my-projects/ai-development/devops/termfleet

## Current task & next step
TC-017 — rebuild the terminal renderer as headless-VT (Rust) + custom HTML
canvas. next: implement **TC-017a (Stage 1)** — stand up a headless
`alacritty_terminal::Term` fed by the existing PTY daemon bytes on a blocking
thread (state behind RwLock), and add a Tauri `snapshot_grid` command that
serializes a 24x80 grid (chars + color/style) to JSON. Verify by running `htop`
and checking the JSON. Full staged spec (a–g, crate choice, binary wire format,
perf plan, escape hatches) is in MASTER_PLAN.md under "TC-017".

## Files touched / in flight
- src/hooks/useNativeTerminalPane.ts — `wantsNativeRenderer()` now returns false
  (native VTE disabled app-wide). Committed.
- src/components/MagicCanvas.tsx — `shouldUseNativeSplitForInteraction = false`
  so map nodes render live xterm. Committed.
- MASTER_PLAN.md — TC-014 marked SUPERSEDED; TC-017 + subtasks a–g added. Committed.
- docs/terminal-renderer-decision-perplexity-query.md, docs/headless-vt-canvas-plan-perplexity-query.md — research. Committed.
- Uncommitted (NOT mine, pre-existing): .gitignore, docs/assets/termfleet-cover.svg, AGENTS.md, docs/assets/* — leave alone unless asked.

## Key decisions & gotchas
- **Native VTE is abandoned** (dead end): VTE's ~80x24 min size → negative-width
  GTK alloc → pixman crash; unreliable focus; and a GTK widget CANNOT live on the
  zoom/pan canvas (GTK compositor ignores CSS transforms). Do NOT retry the GTK
  overlay. Code preserved at git tag `native-vte-snapshot` if ever needed.
- **xterm.js is the current renderer everywhere** — works (split + map both
  functional) but is LAGGY on WebKitGTK and degrades over time. It's the
  temporary fallback; keep it behind the disable-flag until the canvas renderer
  passes TUI + latency bars, then delete (TC-017g). App is usable as a daily driver now.
- Crate decision is locked: **alacritty_terminal (v0.22+) headless** — feed it PTY
  bytes, read its grid; it must NOT own the PTY (the daemon stays PTY authority).
  Rejected vt100 (weak TUI) and wezterm-term (heavy).
- HARD RULE: no optimistic local echo / no PTY echo suppression (breaks
  passwords/SSH/readline/TUIs).
- Renderer must be **Canvas2D, not WebGL** — WebKitGTK WebGL/DMA-BUF is unstable
  on Linux. Font atlas via offscreen canvas + drawImage. HiDPI: scale by
  devicePixelRatio.
- The PTY/daemon backend is fast (~1ms p95) and is NOT the problem — do not
  rearchitect it. Daemon: src-tauri/src/daemon.rs, commands in commands.rs.
- Build/run: `npm run tauri:dev:native-vte` (or ./run-native-vte-dev.sh). First
  Rust build can OOM-Kill; launchers set CARGO_BUILD_JOBS=1. The `!`-prefixed
  shell in this session kept line-wrapping/mangling commands — run launches
  plainly.

## Env / run state
Branch: main | Last commit: 0fec2ad "Pivot plan to TC-017: headless-VT + canvas renderer (supersede TC-014)"
Remote: https://github.com/endlessblink/termfleet.git (public), main tracking.
Running: nothing relevant.
Working app checkpoint = commit 3ebd666 (xterm everywhere). Native VTE = tag native-vte-snapshot.

Start by: read the TC-017 + TC-017a section in MASTER_PLAN.md, then scaffold the
headless alacritty_terminal grid + snapshot_grid Tauri command (Stage 1).
