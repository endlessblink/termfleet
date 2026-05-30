# Perplexity prompt — implementation plan for a headless-VT + canvas terminal renderer

Paste the block below into Perplexity (use a Pro / reasoning model). Goal: get a
concrete, staged implementation plan we can execute, grounded in real crates and
APIs.

---

Act as a senior Rust + Tauri + graphics engineer. Produce a **detailed, staged
implementation plan** (not just prose) for replacing a terminal renderer in an
existing app. I will execute this plan, so be concrete: name crates with
versions, list the exact IPC messages, the data structures, the render loop, and
the risks per stage.

## Existing architecture (do not redesign this part)
- Desktop app: **Tauri 2, React + TypeScript frontend, Rust backend, WebKitGTK
  webview (wry) on Linux first.**
- A **user-local Rust PTY daemon** already owns the shells over a Unix socket and
  is fast (~1ms key-to-PTY p95). It exposes ensure/write/resize/snapshot/read/
  subscribe/kill over a versioned protocol. Output is already streamed to the
  frontend via a Tauri `Channel`.
- Terminals appear in two surfaces: **split panes** (axis-aligned) and a
  **pan/zoom HTML canvas "map"** (React DOM, CSS transforms).
- We are REMOVING `xterm.js` (WebKitGTK WebGL/DMA-BUF lag + JS heap growth over
  time) and have already removed a native GTK/VTE overlay (it crashes with
  negative-width pixman allocations and cannot live on a CSS-transformed canvas).

## Target architecture to plan
Headless VT state in Rust + a custom HTML5 `<canvas>` glyph renderer in React:
1. Rust parses ANSI/VT into a grid state using a headless crate
   (e.g. `alacritty_terminal` or `vt100` — compare them and recommend one, with
   reasons: scrollback, resize/reflow, mouse, alternate screen, truecolor,
   wide/CJK chars, maintenance).
2. Rust computes **dirty-cell diffs** per frame and sends a compact binary
   payload to the frontend (define the wire format; consider a damage/dirty-row
   model and coalescing).
3. React draws glyphs on a plain `<canvas>` 2D (or WebGL) context using a
   **font atlas / glyph cache**. It must support `devicePixelRatio` (HiDPI),
   CSS scaling/panning on the map, the cursor, selection highlight, and theme
   colors.
4. Input: React captures `keydown`, translates to VT escape sequences
   (incl. arrows, function keys, ctrl/alt/meta, bracketed paste), sends to the
   daemon. Plan the keymap source-of-truth.

## What the plan must contain
1. **Crate choice** (alacritty_terminal vs vt100 vs wezterm-term): a clear
   recommendation with tradeoffs, and how it plugs into an existing PTY daemon
   (it must be headless — we feed it PTY bytes, it gives us a grid; we do NOT
   want it to own the PTY).
2. **Staged milestones**, each independently testable, ordered to de-risk early.
   For each: scope, files/modules touched, how to verify, rough effort. Suggested
   spine: (a) Rust grid state from PTY bytes + snapshot to JSON for a debug view;
   (b) full-frame canvas renderer (no diffing) proving glyphs/colors/cursor;
   (c) dirty-diff wire protocol; (d) input/keymap; (e) resize/reflow + fit;
   (f) selection/copy/paste; (g) scrollback + wheel; (h) HiDPI + theme;
   (i) map-mode CSS transform correctness; (j) delete xterm.js + fallback
   removal.
3. **Wire format** for diffs: concrete byte layout or typed-array schema, how
   cursor/scroll/resize/title/bell are encoded, and how to keep it small.
4. **Font atlas** approach in a WebKitGTK webview: how to pre-render glyphs,
   handle bold/italic/wide chars, ligatures (skip?), and box-drawing for TUIs
   like zellij/htop/vim. Canvas2D vs WebGL2 atlas — recommend one for WebKitGTK
   specifically (note: WebGL on WebKitGTK is unstable; account for that).
5. **Performance plan**: how to keep key-to-glyph p95 in the 15–25ms range,
   batching/rAF strategy, avoiding layout thrash, and how to measure it
   (key→draw→frame timing) since the whole point is beating xterm.js latency.
6. **Risks & escape hatches** per stage, and what to keep as a fallback while the
   new renderer is unproven (we plan to keep xterm.js behind a flag until the
   canvas renderer passes a TUI + latency bar, then delete it).
7. **TUI correctness**: how to validate against zellij, tmux, htop, vim, and
   full-screen alternate-screen apps with box drawing and 256/truecolor.

## Output format
A numbered, staged plan with: goal, concrete tasks, files/modules, verification
method, and risk per stage. Cite the crates/docs you recommend (alacritty_terminal,
vt100, wezterm, canvas font-atlas references, real projects doing headless-VT +
canvas such as Warp/Zed-style block terminals). Prefer specific API names over
generalities. Assume the reader is comfortable with Rust and React but wants to
avoid dead ends.
