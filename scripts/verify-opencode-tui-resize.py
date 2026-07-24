#!/usr/bin/env python3
"""Evidence that the OpenCode TUI repaints at the new size when its PTY resizes.

This is the measurement behind `isReflowSafeAgentTui` (src/lib/agentTui.ts): map
nodes freeze alt-screen terminals to stop a multiplexer fragmenting when shrunk,
but OpenCode redraws its whole frame on SIGWINCH, so freezing it just pins it at a
stale size inside a bigger node — the "TUI doesn't resize with the window" report.

Runs OpenCode in a bare PTY (no TermFleet involved), grows the winsize, then
shrinks it, and asserts the app painted out to the new last column and row each
time. No prompt is ever sent, so no model is called.

Usage: python3 scripts/verify-opencode-tui-resize.py [path-to-opencode]
Exit 0 = reflow-safe, 1 = it did not track the resize, 77 = OpenCode not installed.
"""
import fcntl
import os
import pty
import re
import select
import shutil
import signal
import struct
import sys
import termios
import time

# (cols, rows, seconds to observe) — start, grow, shrink.
PHASES = [(100, 30, 9.0), (150, 45, 6.0), (80, 24, 6.0)]
CURSOR_POS = re.compile(rb"\x1b\[(\d+);(\d+)H")


def find_opencode() -> str | None:
    if len(sys.argv) > 1:
        return sys.argv[1]
    local = os.path.expanduser("~/.opencode/bin/opencode")
    return local if os.path.exists(local) else shutil.which("opencode")


def set_winsize(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def capture(binary: str) -> list[bytes]:
    """Run OpenCode through the phases; return the bytes seen during each phase."""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.chdir("/tmp")
        os.execv(binary, [binary])
    set_winsize(fd, PHASES[0][0], PHASES[0][1])
    seen: list[bytes] = [b"" for _ in PHASES]
    phase = 0
    deadline = time.time() + PHASES[0][2]
    try:
        while phase < len(PHASES):
            readable, _, _ = select.select([fd], [], [], 0.2)
            if readable:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                seen[phase] += data
            if time.time() >= deadline:
                phase += 1
                if phase < len(PHASES):
                    cols, rows, seconds = PHASES[phase]
                    set_winsize(fd, cols, rows)
                    deadline = time.time() + seconds
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    return seen


def main() -> int:
    binary = find_opencode()
    if not binary or not os.path.exists(binary):
        print("SKIP: opencode is not installed")
        return 77

    seen = capture(binary)
    ok = True
    for index, (cols, rows, _) in enumerate(PHASES):
        raw = seen[index]
        positions = [(int(r), int(c)) for r, c in CURSOR_POS.findall(raw)]
        max_row = max((r for r, _ in positions), default=0)
        max_col = max((c for _, c in positions), default=0)
        # The TUI is full-screen, so a correct repaint addresses the final row and
        # comes within a couple of cells of the final column. Phase 0 is only the
        # baseline paint (the startup screen need not reach the last column); the
        # claim under test is that the phases AFTER a resize track the new size.
        painted = max_row >= rows and max_col >= cols - 2
        if index == 0:
            label = "base"
        else:
            label = "ok  " if painted else "FAIL"
            ok = ok and painted
        print(f"{label} {cols}x{rows}: bytes={len(raw)} painted_to={max_col}x{max_row}")
    print("OpenCode TUI reflow-safe" if ok else "OpenCode TUI did NOT track the resize")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
