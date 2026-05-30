# Terminal Latency Perplexity Query

Use this query to research why a Tauri 2 + WebKitGTK terminal can still feel
laggy after moving PTY ownership to a Rust daemon and replacing request/response
input with a persistent Unix socket stream.

```text
I am building a Linux desktop terminal workspace with Tauri 2, React, xterm.js,
@xterm/addon-webgl, Rust portable-pty, and a custom user-local Rust PTY daemon.

Architecture:
- React renders xterm.js.
- A Rust Tauri app launches/detects a separate user-local daemon over a Unix
  domain socket.
- The daemon owns portable-pty MasterPty handles and child shell processes.
- Terminal output is pushed from daemon -> Tauri command Channel -> xterm.write.
- Terminal input no longer uses per-keystroke Tauri invoke request/response.
  xterm onData emits a Tauri event named terminal-workspace-daemon-input; Rust
  receives it, queues it to one worker, and writes to a persistent daemon Unix
  input stream per PTY session.
- Backend trace evidence can show daemon receive, PTY write, PTY output read,
  daemon subscribe emit, and xterm.write call close together, but the visible
  terminal still feels laggy during typing in dev mode.

Current instrumentation:
- frontend.xterm.keydown
- frontend.xterm.onData
- frontend.daemon.input.send.start/end
- tauri.daemon.input.event.receive
- tauri.daemon.input.worker.write.start/end
- daemon.input_stream.receive
- pty.write.start/end
- pty.output.read
- daemon.subscribe.emit
- frontend.daemon.channel.data
- frontend.xterm.write.call/callback/raf/render
- A new backend-only benchmark writes printable characters through the same
  persistent daemon input stream and waits for echoed output over daemon
  subscription, to isolate backend PTY latency from WebKit/xterm rendering.

Question:
What are the most likely remaining causes of perceived terminal typing lag in
this architecture, and what implementation changes should be tested first?

Please cover:
1. Tauri event emit/listen latency versus invoking a Rust command with Channel or
   using a dedicated IPC/socket path directly from frontend if possible.
2. WebKitGTK rendering, requestAnimationFrame, and xterm.js write/render timing
   bottlenecks on Linux.
3. xterm.js WebGL addon caveats in WebKitGTK and when DOM/canvas rendering can be
   faster or more stable.
4. Whether batching printable input by even 8-16ms can make typing feel laggy,
   and how to distinguish safe paste batching from immediate keystroke flushing.
5. Risks of routing input through Tauri events into a Rust worker before the
   daemon stream, compared with exposing a long-lived command/Channel or another
   low-latency transport.
6. How to benchmark keydown-to-visible-render latency reliably in Tauri/WebKitGTK
   rather than only checking eventual daemon scrollback.
7. Known Tauri 2, WebKitGTK, portable-pty, or xterm.js performance pitfalls for
   terminal emulators.

Assume I do not want optimistic local echo as the primary fix because it can be
wrong for password prompts, SSH, readline, bracketed paste, alternate-screen
TUIs, and control-key handling.
```

