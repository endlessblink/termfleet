#!/usr/bin/env python3
"""Pane-by-pane proof that the running dock app restored what it should.

Read-only. For every pane the workspace shows, it names the conversation that
pane is supposed to be, finds the live process actually running under that
pane's daemon session, and reports whether the exact provider + conversation id
is live. Writing a resume command, an attached PTY, or replayed scrollback is
never counted as recovery.

Usage: npm run verify:dock-restore
"""
import json
import os
import socket
import sys

DATA = os.path.join(
    os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")),
    "terminal-workspace",
)
SOCKET = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"),
    "terminal-workspace",
    "daemon.sock",
)


def encode_id(session_id):
    return session_id.encode("utf-8").hex()


def ask_daemon(request, timeout=3.0):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect(SOCKET)
    s.sendall(json.dumps(request).encode())
    s.shutdown(socket.SHUT_WR)
    buf = b""
    try:
        while True:
            chunk = s.recv(8192)
            if not chunk:
                break
            buf += chunk
            if b"\n" in buf:
                break
    except socket.timeout:
        pass
    s.close()
    lines = [l for l in buf.decode("utf-8", "replace").splitlines() if l.strip()]
    return json.loads(lines[0]) if lines else {}


def process_tree(root_pid):
    """Every command line at or under root_pid."""
    children = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat", "rb") as f:
                stat = f.read().decode("utf-8", "replace")
            ppid = int(stat[stat.rfind(")") + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        children.setdefault(ppid, []).append(int(entry))

    found = []
    stack = [root_pid]
    seen = set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read().decode("utf-8", "replace").replace("\0", " ").strip()
        except OSError:
            cmd = ""
        if cmd:
            found.append((pid, cmd))
        stack.extend(children.get(pid, []))
    return found


def panes():
    workspace = json.load(open(os.path.join(DATA, "workspace.json"), encoding="utf-8"))
    out = []
    seen = set()
    for tab in workspace.get("tabs", []):
        tab_id = tab.get("id")
        found = set()

        def collect(node):
            if isinstance(node, dict):
                candidate = node.get("paneId") or node.get("id")
                if isinstance(candidate, str) and (node.get("type") == "pane" or "paneId" in node):
                    found.add(candidate)
                for value in node.values():
                    collect(value)
            elif isinstance(node, list):
                for value in node:
                    collect(value)

        collect(tab)
        for pane_id in found:
            session_id = f"terminal-{tab_id}-{pane_id}"
            if session_id in seen:
                continue
            seen.add(session_id)
            meta_path = os.path.join(DATA, "sessions", f"{encode_id(session_id)}.meta.json")
            meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else None
            out.append((session_id, meta))
    return out


def main():
    live = ask_daemon({"type": "listSessions"})
    sessions = {s["id"]: s for s in live.get("sessions", []) if s.get("id")}
    rows = panes()
    restored = plain = missing = 0
    failures = []
    print(f"--- dock restore matrix: {len(rows)} panes ---")
    for session_id, meta in rows:
        folder = os.path.basename((meta or {}).get("cwd") or "") or "?"
        provider = (meta or {}).get("provider")
        conversation = (meta or {}).get("providerSessionId")
        session = sessions.get(session_id)
        pid = session.get("pid") if session else None
        if not provider or not conversation:
            print(f"  PLAIN   {folder:24} no conversation recorded for this pane")
            plain += 1
            continue
        if not pid:
            print(f"  MISSING {folder:24} {provider} {conversation[:18]} has no live terminal")
            missing += 1
            failures.append(session_id)
            continue
        tree = process_tree(pid)
        exact = [
            cmd for _pid, cmd in tree
            if provider in cmd and conversation in cmd and "resume" in cmd or
            (provider in cmd and conversation in cmd and "--session" in cmd)
        ]
        if exact:
            print(f"  LIVE    {folder:24} {provider} {conversation[:18]} running: {exact[0][:60]}")
            restored += 1
        else:
            top = tree[0][1][:48] if tree else "(no process)"
            print(f"  NOT     {folder:24} {provider} {conversation[:18]} pane is running: {top}")
            missing += 1
            failures.append(session_id)
    print(f"\n{restored} conversations live, {plain} plain terminals, {missing} not restored")
    if failures:
        print("FAIL: some panes did not come back with their conversation", file=sys.stderr)
        return 1
    print("PASS: every pane that should hold a conversation is holding it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
