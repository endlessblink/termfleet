# Terminal Transport Failure Recovery

Date: 2026-05-29

## Problem

The terminal UI must never print repeated PTY infrastructure failures into the
user's shell buffer. A refused daemon socket can happen if the user-local daemon
dies or the socket goes stale, but the failure belongs to runtime state, not to
xterm output.

Bad behavior:

```text
[pty write failed] Connection refused (os error 111)
[pty write failed] Connection refused (os error 111)
```

## Invariant

- Shell output is reserved for the user's PTY stream.
- Transport diagnostics go to the developer console and terminal runtime
  metadata.
- The first read/write transport failure moves the terminal to `failed`.
- Further writes through that broken transport are ignored until restart or
  reattach.
- Explicit close still owns process destruction; transport failure handling only
  detaches the broken frontend transport.

## Verification

Run:

```bash
npm run verify:map-terminals
npm run build
cargo test
npx playwright test tests/terminal-user-flows.spec.ts --reporter=line
npm run verify:standalone-daemon
rg "\[pty write failed\]|\[pty read failed\]" src scripts tests
```

Expected:

- Source verification passes.
- The terminal user flow still accepts input in browser preview.
- The standalone daemon smoke still verifies daemon-owned output and restart
  reattach.
- The `rg` check finds no terminal-buffer failure strings in app, script, or
  test sources.
