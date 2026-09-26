#!/usr/bin/env python3
"""Stand-in for Claude Code's fullscreen TUI (TF-059), with no network or model.

Like Claude with `"tui": "fullscreen"`, it draws on the PRIMARY screen (no
?1049h), turns on any-event mouse tracking, and clears with ESC[2J — which pushes
the old frame into the terminal's history. It then scrolls its OWN view when it
receives wheel reports, and appends every wheel report it sees to argv[1].
"""
import os
import re
import select
import sys
import termios
import time
import tty

log_path = sys.argv[1]
out = sys.stdout


def draw(label):
    out.write("\x1b[H\x1b[2K" + label + "\r\n\x1b[2K(fake fullscreen app)")
    out.flush()


for i in range(60):
    out.write(f"TF_STALE_OLD_FRAME_{i:02d}\r\n")
out.write("\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h")
out.write("\x1b[2J")
draw("TF_FULLSCREEN_READY")

fd = sys.stdin.fileno()
saved = termios.tcgetattr(fd)
tty.setraw(fd)
scrolled = 0
buf = b""
deadline = time.time() + 120
try:
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if not ready:
            continue
        chunk = os.read(fd, 4096)
        if not chunk or b"q" in chunk:
            break
        buf += chunk
        consumed = 0
        for match in re.finditer(rb"\x1b\[<(\d+);(\d+);(\d+)[Mm]", buf):
            consumed = match.end()
            button = int(match.group(1))
            if button in (64, 65):
                scrolled += 1 if button == 64 else -1
                with open(log_path, "a") as log:
                    log.write(f"WHEEL {'UP' if button == 64 else 'DOWN'}\n")
                draw(f"TF_APP_SCROLLED_{scrolled}")
        # Keep only an unfinished report that may complete in the next read.
        buf = buf[consumed:][-64:]
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, saved)
    out.write("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l\r\n")
    out.flush()
