# Native Terminal Pane Architecture

Status: active target architecture for TC-014.
Scope: active terminal panes in the Tauri desktop runtime.

## Decision

Keep React and Tauri WebView for the cockpit UI, but move active terminal
rendering out of WebKitGTK/xterm.js. The measured backend path is already fast;
the remaining latency is xterm/WebKit render and compositor time. Further local
echo or shell-behavior simulation is rejected because it risks correctness in
password prompts, SSH, readline, bracketed paste, alternate-screen TUIs, and
control-key handling.

Active terminal sessions should use a native renderer when available:

1. **Linux VTE widget backend** as the first native integration.
   It is GTK-native, mature, and is the lowest-risk way to share a window with
   Tauri/WebKitGTK on Linux.
2. **wgpu / Alacritty-style renderer** as the latency ceiling path.
   This is the closest architecture to Warp, Ghostty, Kitty, and Alacritty, but
   it has higher implementation cost.
3. **xterm.js fallback** remains for browser preview, unsupported platforms, and
   native-backend failure recovery.

## Boundary

The React app owns orchestration:

- workspace mode, sidebars, command bar, project scoping, canvas/map state;
- session metadata, split layout, active pane selection, and focus routing;
- native-pane bounds, visibility, and lifecycle requests.

The native terminal backend owns active terminal rendering and input:

- shell PTY attachment or direct PTY ownership;
- low-latency key handling and glyph rendering;
- resize/focus/update of the native view;
- key-to-glyph latency measurement independent of WebKit paint.

The existing daemon remains the session authority while the native backend is
introduced. A VTE backend may eventually own its own PTY for active panes, but
it must still publish session metadata, status, cwd, and lifecycle events to the
same workspace model.

## Command Contract

Tauri exposes the native renderer as a control-plane API:

- `native_terminal_capabilities() -> NativeTerminalCapabilities`
- `native_terminal_create(session_id, tab_id, pane_id, window_label, bounds, cwd, command)`
- `native_terminal_update(handle, bounds, visible, focused)`
- `native_terminal_destroy(handle)`

The first implementation is intentionally capability-gated. If the backend is
not compiled or the platform cannot embed native terminal views, React falls
back to xterm.js and records the reason.

## Linux Dependency Gate

The VTE slice requires the GTK3/VTE runtime libraries. It does not require the
VTE development package because VTE symbols are loaded from `libvte-2.91.so.0`
at runtime:

```bash
npm run verify:native-terminal-deps
npm run verify:native-vte-build
```

Current capability reporting distinguishes:

- VTE runtime present (`libvte-2.91.so.0`);
- VTE runtime symbols resolvable through `dlopen`/`dlsym`;
- optional VTE development headers/pkg-config present (`vte-2.91.pc`);
- GTK3 development package present (`gtk+-3.0.pc`);
- `native-vte` feature compilation;
- GTK/VTE embedding probe compiled behind `native-vte`;
- GTK child-widget embedding readiness;
- direct PTY ownership/input routing readiness.

The serialized `readinessPhase` is the authoritative state machine for the
fallback decision:

- `runtimeMissing`
- `developmentHeadersMissing`
- `backendNotCompiled`
- `embeddingNotReady`
- `directPtyNotReady`
- `ready`

The Tauri 2 Linux window API exposes GTK integration points through
`Window::gtk_window()` and `Window::default_vbox()`. The first VTE backend
should insert the native `VteTerminal` widget into a GTK child container owned
by the main Tauri window, then drive position/visibility from React's measured
pane bounds. Keep this behind the `native-vte` feature until the whole active
pane path owns rendering and PTY input.

Current implementation state:

- default builds expose the command/control-plane and fall back to xterm.js;
- `native-vte` builds compile an optional GTK dependency already used by
  Tauri's Linux stack;
- the native GTK path obtains Tauri's WebKitGTK widget, reparents it into a
  GTK overlay, creates a fixed native layer above the WebView, creates a VTE
  terminal widget through runtime-loaded symbols, and tracks update/destroy
  lifecycle from React-measured pane bounds;
- React drives native bounds through `ResizeObserver`, window resize/scroll
  events, and a 250ms reconciliation tick. The reconciliation tick is outside
  the keystroke path and exists because WebKitGTK/Tauri window events are not
  reliable enough for native overlay positioning by themselves;
- native focus is transition-based: xterm focus calls are skipped while native
  rendering is attached, and GTK `grab_focus()` only runs when the native pane
  becomes focused rather than on every bounds update;
- native pane attachment uses a callback-ref-backed React state value for the
  terminal host element. Do not pass `ref.current` directly into
  `useNativeTerminalPane`; ref mutation does not schedule a render and can make
  release native attachment depend on unrelated state updates;
- native VTE dev launchers set `CARGO_BUILD_JOBS=1` and
  `CARGO_PROFILE_DEV_DEBUG=0` to reduce peak memory during the GTK/WebKit/VTE
  feature build. First-time native builds are slower, but this avoids local
  compile/link `Killed` failures during development;
- desktop native builds keep `terminal_workspace_lib` as an `rlib` only.
  The Tauri desktop binary links the library directly, so generating
  `staticlib` and `cdylib` outputs in dev is unnecessary compile/link pressure;
- the native VTE path resolves `vte_terminal_spawn_sync` and
  `vte_terminal_watch_child`, then spawns the app binary in
  `--terminal-workspace-daemon-stdio` mode inside the VTE PTY. That bridge puts
  the VTE PTY in raw/no-echo mode, forwards input bytes into the detached Rust
  daemon PTY, streams daemon output back to VTE, and propagates terminal size
  changes. VTE owns native rendering; the daemon owns durable PTY state;
- `native-vte` capability can report `available: true` when runtime symbols are
  present. Current headed smoke evidence shows VTE attached inside active pane
  bounds, typed input works, reconciliation updates continue, and a split pane
  can attach a second native VTE surface in both dev and Tauri release builds.
  Release verification must use the Tauri CLI build path, not raw `cargo build`,
  so frontend assets come from `frontendDist` instead of a localhost dev URL.
- trace-only GTK/VTE signal probes measure native `key-press-event` to VTE
  `commit`, `contents-changed`, GTK `draw`, and GDK frame-clock `after-paint`
  while
  `TERMINAL_WORKSPACE_TRACE_LATENCY=1`. The runtime smokes summarize these
  traces through `scripts/summarize-native-vte-latency-trace.mjs`; fresh
  evidence shows key-to-commit p95 at 1ms in dev and 0ms in release.
  `contents-changed` is recorded as a diagnostic only because VTE batches it
  and it is not a per-glyph paint timestamp;
- `npm run verify:native-vte-visual-latency` is the current release-only visual
  latency proxy. It drives isolated keystrokes at a controlled cadence and gates
  both key-to-GTK-draw and key-to-GDK-frame-after-paint p95 at 25ms. Fresh
  release evidence after the daemon bridge and frame-clock probe:
  `native_key_to_after_paint` p50 9ms, p95 15ms, p99 15ms;
  `native_key_to_draw` p50 9ms, p95 15ms, p99 15ms;
- `npm run verify:native-vte-pixel-latency` is the current independent
  key-to-glyph cross-check. It launches the release native VTE app without
  per-key latency trace probes, uses lifecycle-only native VTE logs for
  readiness, sends sustained typing through in-process XTest events, and
  observes first changed screen pixels via Xlib `get_image`. The verifier uses
  a real distribution (`samples=60`) and same-position typed glyph samples with
  unmeasured backspace resets. Fresh evidence after content-change paint
  requests: p50 13ms, p95 14ms, p99 17ms, max 17ms, report
  `/tmp/terminal-workspace-native-vte-pixel-latency-report.json`, screenshot
  `/tmp/terminal-workspace-native-vte-pixel-latency.png`;
- native VTE widgets install a content-change paint hook that calls
  `queue_draw()` and requests the GTK frame-clock paint phase when VTE reports
  changed contents. This removes the final screen-pixel tail while keeping the
  PTY/VTE semantics correct;
- `npm run verify:native-vte-lifecycle` is the release-headed lifecycle gate.
  It verifies map/split switching destroys and reattaches native panes,
  map-card activation returns to split and reattaches native VTE, close/reopen
  destroys and reattaches panes, and resize stress produces changing native pane
  bounds. Fresh evidence: attaches=5, destroys=3, updates=70, unique_widths=3;
- `npm run verify:native-vte-restart-reconnect` is the release-headed daemon
  survivability gate for native VTE. It exports a marker through the native pane,
  kills the app while keeping the daemon alive, relaunches, reattaches to the
  same stable session id, and verifies the marker is still available from the
  same shell. Fresh evidence passed for
  `terminal-e8f24b24-ddb2-481f-876c-fce89682c14d-8d621bc8-93b5-4a24-9ec8-c68f9d1ecb30`;
- native VTE runtime smokes set `VITE_WORKSPACE_RESET_STATE=1`, in addition to
  renderer/workspace overrides, so repeated verification does not inherit stale
  localStorage split geometry.
- canvas/map terminal nodes do not host active native GTK panes because GTK
  overlays cannot follow canvas zoom/clip transforms. In native-capable desktop
  builds, map terminal nodes are activation cards for the linked split pane
  rather than active xterm inputs. The interactive session stays native by
  switching to split mode before typing. Browser preview and unsupported
  platforms keep the web xterm fallback inside the canvas node.

TC-014 now has both in-process GTK frame-clock evidence and an independent
screen-pixel observation gate. Keep them separate: the frame-clock trace is
diagnostic, while `verify:native-vte-pixel-latency` is the external
key-to-glyph check and should run with per-key trace probes disabled.

Do not claim native-pane latency until all dependency gates pass and the
backend reports `available: true`.

## Acceptance Target

TC-014 is not complete until active desktop terminal sessions can run through a
native pane and measured release evidence shows:

- p95 key-to-glyph latency in the 15-25ms range;
- no optimistic local echo or PTY echo suppression;
- no duplicate input/output subscribers across remounts;
- typed-token correctness under fast typing;
- split, map, focus, resize, close, and restart/reconnect flows remain correct.
