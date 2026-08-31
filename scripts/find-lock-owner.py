#!/usr/bin/env python3
import os
import sys

target = os.path.realpath(sys.argv[1])
for entry in os.listdir("/proc"):
    if not entry.isdigit():
        continue
    fd_root = f"/proc/{entry}/fd"
    try:
        for fd in os.listdir(fd_root):
            try:
                if os.path.realpath(os.readlink(f"{fd_root}/{fd}")) == target:
                    cmdline = open(f"/proc/{entry}/cmdline", errors="replace").read().replace("\0", " ").strip()
                    print(f"{entry}\t{cmdline}")
            except (FileNotFoundError, PermissionError, OSError):
                pass
    except (FileNotFoundError, PermissionError, OSError):
        pass
