#!/usr/bin/env python3
"""Recover orphaned termfleet terminal sessions.

The daemon checkpoints each PTY's scrollback to
  ~/.local/share/terminal-workspace/sessions/<hex>.scrollback (+ .meta.json)
where <hex> decodes to the session id `terminal-<tabId>-<paneId>`. The app
re-attaches a session only if a persisted tab/pane in localStorage produces the
same id (Terminal.tsx: `terminal-${tabId}-${paneId}`); on attach the daemon
spawns a fresh shell and replays the saved scrollback above it
(pty.rs ensure_with_sink).

If the workspace localStorage gets reset (e.g. a verify run), those sessions are
orphaned: content on disk, but no tab references them. This script rebuilds one
tab per orphaned tabId (richest pane) and appends it to the persisted workspace
so the app restores them on next launch.

Usage:
  python3 scripts/recover-sessions.py            # show what would be recovered
  python3 scripts/recover-sessions.py --apply     # write tabs back to localStorage (APP MUST BE CLOSED)
  python3 scripts/recover-sessions.py --dump DIR  # also write ANSI-stripped text of each session to DIR
  python3 scripts/recover-sessions.py --min-bytes 2048   # scrollback size threshold (default 2048)
"""
import argparse
import binascii
import glob
import json
import os
import re
import sqlite3
import sys
import time

HOME = os.path.expanduser("~")
SESSIONS_DIR = os.path.join(HOME, ".local/share/terminal-workspace/sessions")
LS_DB = os.path.join(
    HOME,
    ".local/share/dev.terminal-workspace/localstorage/http_127.0.0.1_1420.localstorage",
)
STORAGE_KEY = "terminal-workspace.v1"
EMOJI = "\U0001F5A5"  # 🖥
COLOR = "#7aa2f7"
ANSI = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][AB0]|\x1b\][^\x07]*\x07|\r")


def parse_session_id(sid):
    # sid = "terminal-<tabId(36)>-<paneId(rest)>"
    if not sid.startswith("terminal-"):
        return None, None
    rest = sid[len("terminal-"):]
    tab_id = rest[:36]
    if len(rest) <= 37 or rest[36] != "-":
        return None, None
    return tab_id, rest[37:]


def scan_sessions():
    out = []
    for meta in glob.glob(os.path.join(SESSIONS_DIR, "*.meta.json")):
        hexname = os.path.basename(meta)[:-len(".meta.json")]
        try:
            sid = binascii.unhexlify(hexname).decode()
        except Exception:
            continue
        sb = os.path.join(SESSIONS_DIR, hexname + ".scrollback")
        size = os.path.getsize(sb) if os.path.exists(sb) else 0
        mtime = os.path.getmtime(sb) if os.path.exists(sb) else os.path.getmtime(meta)
        try:
            m = json.load(open(meta))
        except Exception:
            m = {}
        tab_id, pane_id = parse_session_id(sid)
        if not tab_id:
            continue
        out.append({
            "sid": sid, "hex": hexname, "scrollback": sb, "size": size,
            "mtime": mtime, "tab_id": tab_id, "pane_id": pane_id,
            "cwd": (m.get("cwd") or "").strip(), "command": m.get("command") or "",
        })
    return out


def read_persisted():
    con = sqlite3.connect(LS_DB)
    row = con.execute("SELECT value FROM ItemTable WHERE key=?", (STORAGE_KEY,)).fetchone()
    con.close()
    if not row:
        return {}
    val = row[0]
    if isinstance(val, bytes):
        try:
            val = val.decode("utf-16-le")
        except Exception:
            val = val.decode("utf-8", "replace")
    return json.loads(val)


def write_persisted(doc):
    blob = json.dumps(doc, ensure_ascii=False).encode("utf-16-le")
    con = sqlite3.connect(LS_DB)
    con.execute("UPDATE ItemTable SET value=? WHERE key=?", (sqlite3.Binary(blob), STORAGE_KEY))
    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.commit()
    con.close()


def build_tab(sess):
    tab_id, pane_id, cwd = sess["tab_id"], sess["pane_id"], sess["cwd"]
    title = os.path.basename(cwd.rstrip("/")) if cwd else "Terminal"
    split = {"id": pane_id, "type": "terminal"}
    if cwd:
        split["cwd"] = cwd
    tab = {
        "id": tab_id, "title": title or "Terminal", "emoji": EMOJI,
        "color": COLOR, "groupId": None,
        "terminals": [{
            "id": sess["sid"], "paneId": pane_id, "cols": 80, "rows": 24,
            "status": "stale", "reused": False,
            "lastStatusAt": int(time.time() * 1000),
            "lastError": "Session was restored from workspace metadata.",
        }],
        "splitLayout": split, "activePaneId": pane_id,
    }
    if cwd:
        tab["initialCwd"] = cwd
    return tab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write recovered tabs back to localStorage")
    ap.add_argument("--dump", metavar="DIR", help="write ANSI-stripped session text into DIR")
    ap.add_argument("--min-bytes", type=int, default=2048)
    args = ap.parse_args()

    sessions = scan_sessions()
    # richest pane per tabId, above threshold
    by_tab = {}
    for s in sessions:
        if s["size"] < args.min_bytes:
            continue
        cur = by_tab.get(s["tab_id"])
        if cur is None or s["size"] > cur["size"]:
            by_tab[s["tab_id"]] = s

    doc = read_persisted()
    existing = {t.get("id") for t in doc.get("tabs", [])}
    recover = [s for tid, s in by_tab.items() if tid not in existing]
    recover.sort(key=lambda s: s["size"], reverse=True)

    print(f"Sessions on disk: {len(sessions)}  |  unique tabs >= {args.min_bytes}B: {len(by_tab)}")
    print(f"Already in workspace: {len(existing)}  |  to recover: {len(recover)}\n")
    for s in recover:
        proj = s["cwd"].split("/my-projects/")[-1] if "/my-projects/" in s["cwd"] else (s["cwd"] or "(no cwd)")
        print(f"  + {s['size']:>7}B  {proj}   [{s['sid']}]")

    if args.dump:
        os.makedirs(args.dump, exist_ok=True)
        for s in by_tab.values():
            raw = open(s["scrollback"], "rb").read()
            text = ANSI.sub(b"", raw).decode("utf-8", "replace")
            label = (os.path.basename(s["cwd"].rstrip("/")) or "session") if s["cwd"] else "session"
            fn = os.path.join(args.dump, f"{label}-{s['tab_id'][:8]}-{s['size']}.txt")
            open(fn, "w").write(text)
        print(f"\nDumped {len(by_tab)} sessions to {args.dump}")

    if args.apply:
        if not recover:
            print("\nNothing to recover.")
            return
        doc.setdefault("tabs", [])
        doc["tabs"].extend(build_tab(s) for s in recover)
        write_persisted(doc)
        print(f"\nApplied: appended {len(recover)} tabs. Relaunch the app to restore them.")
    else:
        print("\n(dry run — pass --apply to write, with the app CLOSED)")


if __name__ == "__main__":
    main()
