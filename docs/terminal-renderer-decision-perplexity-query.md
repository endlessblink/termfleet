# Perplexity query — native VTE vs xterm.js for a Tauri terminal on Linux

Paste the block below into Perplexity (use a Pro / reasoning model if available).

---

I'm building a **terminal-emulator desktop app on Linux using Tauri 2 (React +
TypeScript frontend, Rust backend, WebKitGTK webview via wry)**. A user-local
Rust PTY daemon owns the shells over a Unix socket and is fast (~1ms key-to-PTY
p95). The bottleneck is the **renderer**. I need to choose between two paths and
want a concrete, sourced recommendation.

## Path A — xterm.js inside the WebKitGTK webview
- Pros (verified in my app): fills its pane correctly, keyboard focus works,
  renders inside the React DOM so it works on a pan/zoom canvas, simple.
- Cons (verified): **typing feels laggy on Linux/WebKitGTK, and the lag gets
  WORSE the longer a session runs.** I use `@xterm/xterm` v5 with the WebGL
  addon (`@xterm/addon-webgl`) and `@xterm/addon-fit`.

## Path B — native GTK VTE widget (libvte-2.91) overlaid on the webview
- Pros: native rendering is fast and stable to type in.
- Cons (verified, painful): embedding a VTE `GtkWidget` over the WebKitGTK
  webview via `GtkOverlay` is fragile — wrong size (VTE renders at its ~80x24
  natural size despite `set_size_request`), a `get-child-position` handler that
  returned an absolute rect caused `gtk_widget_size_allocate(): width -9` and a
  pixman `region32_init_rect: Invalid rectangle` crash, and even when sized
  correctly the VTE widget wouldn't accept keyboard input (focus). It also
  cannot live on a zoom/pan HTML canvas because the GTK overlay can't transform
  or clip with CSS.

## Questions
1. **Is the "xterm.js gets laggier over time on WebKitGTK" a known, fixable
   problem?** Specifically: is it caused by accumulating listeners, the DOM
   renderer being used instead of WebGL/canvas, `FitAddon.fit()` thrash,
   scrollback growth, or a WebKitGTK compositing issue? What are the concrete,
   proven fixes (e.g. `@xterm/addon-webgl` setup pitfalls on WebKitGTK,
   `webkit_settings` / hardware acceleration / `WEBKIT_DISABLE_COMPOSITING_MODE`
   env vars, `term.options` tuning)? Cite real GitHub issues / sources.

2. **For the native VTE-over-WebKitGTK path, what is the correct, proven way to
   position a native GtkWidget at a sub-rectangle over the wry/Tauri webview**
   and have it (a) size to the rect, (b) resize with the window, (c) receive
   keyboard focus? Is `GtkOverlay` + `get-child-position` the right tool, or
   `GtkFixed`, or reparenting into a `GtkBox`/`GtkPaned`? How do real projects
   that mix WebKit2GTK and VTE in one window do it (e.g. links to working code)?

3. **Which path do experienced Tauri/GTK devs actually ship** for a
   latency-sensitive terminal on Linux in 2025–2026? Is there a third option I'm
   missing that's better than both — e.g. a GPU/wgpu terminal renderer
   (Alacritty/Ghostty-style) in a separate native window or surface, a
   `tao`/`winit` child surface, CEF, or abandoning the webview for the terminal
   surface entirely while keeping it for the cockpit UI?

4. Given the PTY backend is already fast and the ONLY problem is render/paint
   latency + embedding complexity, **what's the lowest-risk path to a terminal
   that types as fast as Alacritty/Ghostty while keeping a React/HTML cockpit
   UI around it?**

Please give a clear recommendation with tradeoffs, and cite concrete sources
(GitHub issues, project source, docs) for the WebKitGTK xterm.js latency
behavior and the GTK widget-over-webview embedding pattern.
