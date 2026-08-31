#!/usr/bin/env python3
import fcntl
import os
import sys

path = sys.argv[1]
with open(path, "a+") as handle:
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("locked")
        raise SystemExit(1)
    print(f"unlocked pid={os.getpid()}")
