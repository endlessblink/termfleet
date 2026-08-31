#!/usr/bin/env python3
"""Reboot rehearsal for the panes you actually have open.

Answers one question: if the machine rebooted right now, which of my terminals
come back with their real conversation? It copies each live pane's on-disk
checkpoint into a throwaway data directory, starts a SECOND daemon there, and
lets the real Rust restore planner decide. The user's daemon, sockets, PTYs, and
saved sessions are never touched, and fake `codex`/`claude`/`opencode` shims sit
first on PATH so a rehearsal can never open a second writer on a live
conversation.

Usage: npm run verify:reboot-rehearsal
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARGO_TARGET_DIR = Path(os.environ.get("CARGO_TARGET_DIR", "/tmp/tw-restart-restore-target"))
BIN = CARGO_TARGET_DIR / "debug" / "terminal-workspace"
DAEMON_ARG = "--terminal-workspace-daemon"
REAL_DATA = Path(
    os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")
) / "terminal-workspace"


def encode_id(session_id):
    return session_id.encode("utf-8").hex()


def rehearsal_id(session_id):
    return f"rehearsal-{session_id}"


def send(sock_path, request, timeout=5.0):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect(sock_path)
    s.sendall(json.dumps(request).encode())
    s.shutdown(socket.SHUT_WR)
    buf = b""
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
            if b"\n" in buf:
                break
    except socket.timeout:
        pass
    s.close()
    return [json.loads(l) for l in buf.decode("utf-8", "replace").splitlines() if l.strip()]


def snapshot_until(sock_path, session_id, marker, tries=40):
    data = ""
    for _ in range(tries):
        resp = send(sock_path, {"type": "snapshotSession", "id": session_id})
        data = resp[0].get("data", "") if resp else ""
        if marker in data:
            return data
        time.sleep(0.1)
    return data


def wait_up(sock_path, tries=80):
    for _ in range(tries):
        try:
            resp = send(sock_path, {"type": "status"}, timeout=1.0)
            if resp and resp[0].get("mode") == "externalDaemon":
                return True
        except (FileNotFoundError, ConnectionRefusedError, OSError):
            pass
        time.sleep(0.1)
    return False


def write_provider_shims(bin_dir):
    """Stand-ins for the real agents. A rehearsal must never reach a real
    conversation: the planned resume command runs one of these instead."""
    os.makedirs(bin_dir, exist_ok=True)
    for name in ("codex", "claude", "opencode"):
        path = os.path.join(bin_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "#!/bin/sh\n"
                f"printf 'REHEARSAL_{name.upper()}_ARGS=%s\\n' \"$*\"\n"
                "sleep 30\n"
            )
        os.chmod(path, 0o755)


def live_panes():
    """Every pane the workspace currently shows, with its saved checkpoint."""
    workspace = json.loads((REAL_DATA / "workspace.json").read_text(encoding="utf-8"))
    panes = []
    seen = set()

    def collect(node, tab_id, out):
        if isinstance(node, dict):
            candidate = node.get("paneId") or node.get("id")
            if isinstance(candidate, str) and (node.get("type") == "pane" or "paneId" in node):
                out.add(candidate)
            for value in node.values():
                collect(value, tab_id, out)
        elif isinstance(node, list):
            for value in node:
                collect(value, tab_id, out)

    for tab in workspace.get("tabs", []):
        tab_id = tab.get("id")
        pane_ids = set()
        collect(tab, tab_id, pane_ids)
        for pane_id in pane_ids:
            session_id = f"terminal-{tab_id}-{pane_id}"
            if session_id in seen:
                continue
            seen.add(session_id)
            meta = REAL_DATA / "sessions" / f"{encode_id(session_id)}.meta.json"
            if not meta.exists():
                panes.append((session_id, tab.get("title") or "Terminal", None))
                continue
            panes.append((
                session_id,
                tab.get("title") or "Terminal",
                json.loads(meta.read_text(encoding="utf-8")),
            ))
    return panes


def main():
    if not BIN.exists():
        print(f"building private debug binary at {BIN}")
        build = subprocess.run(
            ["cargo", "build", "--bin", "terminal-workspace"],
            cwd=ROOT / "src-tauri",
            env=dict(os.environ, CARGO_TARGET_DIR=str(CARGO_TARGET_DIR), CARGO_BUILD_JOBS="1"),
        )
        if build.returncode != 0:
            print("FAIL: could not build the rehearsal binary", file=sys.stderr)
            return 1

    panes = live_panes()
    if not panes:
        print("No open panes to rehearse.")
        return 0

    tmp = tempfile.mkdtemp(prefix="tw-reboot-rehearsal-", dir="/tmp")
    run_dir = os.path.join(tmp, "run")
    data_dir = os.path.join(tmp, "data")
    bin_dir = os.path.join(tmp, "bin")
    os.makedirs(run_dir, mode=0o700, exist_ok=True)
    sessions = os.path.join(data_dir, "terminal-workspace", "sessions")
    os.makedirs(sessions, exist_ok=True)
    write_provider_shims(bin_dir)

    # Copy (never move) each pane's checkpoint into the throwaway tree under a
    # rehearsal-only id. The id must differ from the live one: the daemon refuses
    # to resume a conversation whose provider process is still running under that
    # pane, which is exactly right in real life and exactly wrong here — a reboot
    # is precisely the case where those processes are gone.
    for session_id, _title, meta in panes:
        if meta is None:
            continue
        stem = encode_id(session_id)
        rehearsal_stem = encode_id(rehearsal_id(session_id))
        for suffix in (".meta.json", ".scrollback", ".history", ".lifecycle.json"):
            source = REAL_DATA / "sessions" / f"{stem}{suffix}"
            if source.exists():
                shutil.copy2(source, os.path.join(sessions, f"{rehearsal_stem}{suffix}"))

    # The daemon runs a restore through a LOGIN shell, which re-sources profile
    # files and can put the real provider back at the front of PATH. A throwaway
    # HOME with no profile, plus a PATH that contains only the shims and the
    # system directories, is what keeps a rehearsal off real conversations.
    home_dir = os.path.join(tmp, "home")
    os.makedirs(home_dir, exist_ok=True)
    env = {
        "XDG_RUNTIME_DIR": run_dir,
        "XDG_DATA_HOME": data_dir,
        "HOME": home_dir,
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "SHELL": "/bin/bash",
        "TERM": os.environ.get("TERM", "xterm-256color"),
        "USER": os.environ.get("USER", "rehearsal"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    sock = os.path.join(run_dir, "terminal-workspace", "daemon.sock")
    log_path = os.path.join(tmp, "daemon.log")
    log = open(log_path, "ab", buffering=0)
    daemon = subprocess.Popen(
        [str(BIN), DAEMON_ARG], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log
    )
    failures = []
    try:
        if not wait_up(sock):
            print("FAIL: rehearsal daemon never came up", file=sys.stderr)
            return 1

        # Safety canary. Seed one fake agent checkpoint whose conversation id
        # belongs to nothing, and require the stub to be what runs. If the real
        # provider is reachable from inside the rehearsal, stop here — rehearsing
        # must never put a second writer on a live conversation.
        canary_id = "rehearsal-canary"
        canary_conversation = "rehearsal-canary-not-a-real-conversation"
        canary_stem = encode_id(canary_id)
        with open(os.path.join(sessions, f"{canary_stem}.meta.json"), "w", encoding="utf-8") as f:
            json.dump({
                "cwd": tmp,
                "command": "/bin/bash",
                "cols": 80,
                "rows": 24,
                "recoveryKind": "agent-terminal",
                "provider": "codex",
                "launchProfile": "terminal",
                "providerSessionId": canary_conversation,
            }, f)
        with open(os.path.join(sessions, f"{canary_stem}.lifecycle.json"), "w", encoding="utf-8") as f:
            json.dump("recoverable", f)
        # A checkpoint without saved scrollback is treated as a new session, not
        # a restore, so the canary must carry one to exercise the restore path.
        with open(os.path.join(sessions, f"{canary_stem}.scrollback"), "wb") as f:
            f.write((0).to_bytes(8, "little"))
            f.write(b"previous rehearsal transcript\n")
        send(sock, {"type": "ensureSession", "id": canary_id})
        canary = snapshot_until(sock, canary_id, "REHEARSAL_CODEX_ARGS=")
        if f"REHEARSAL_CODEX_ARGS=resume {canary_conversation}" not in canary:
            print(
                "FAIL: the rehearsal could still reach a real provider - refusing to "
                "rehearse live conversations",
                file=sys.stderr,
            )
            return 1
        print("stub provider confirmed; no real conversation can be opened  \u2713\n")

        print(f"--- reboot rehearsal for {len(panes)} open panes ---")
        resumed = shells = 0
        for session_id, title, meta in panes:
            folder = os.path.basename((meta or {}).get("cwd") or "") or "?"
            provider = (meta or {}).get("provider")
            if meta is None:
                print(f"  SHELL   {folder:24} {title[:20]:20} no saved terminal to restore")
                shells += 1
                continue
            conversation = (meta or {}).get("providerSessionId")
            probe_id = rehearsal_id(session_id)
            send(sock, {"type": "ensureSession", "id": probe_id})
            # The decisive receipt: the rehearsal's provider shim was launched
            # with this pane's exact conversation id. The planner writes its own
            # verdict back into the copied checkpoint.
            marker = f"REHEARSAL_{(provider or '').upper()}_ARGS="
            snapshot = snapshot_until(sock, probe_id, marker) if provider else ""
            replayed = json.loads(
                Path(os.path.join(sessions, f"{encode_id(probe_id)}.meta.json"))
                .read_text(encoding="utf-8")
            )
            status = replayed.get("restoreStatus")
            launched = bool(conversation) and conversation in snapshot
            if status == "resuming" and launched:
                print(f"  RESUME  {folder:24} {title[:20]:20} {provider} conversation resumes")
                resumed += 1
            elif provider and conversation:
                detail = f"restore said '{status}'" if not launched else "no resume was launched"
                print(f"  AT RISK {folder:24} {title[:20]:20} {provider} saved but {detail}")
                failures.append((session_id, status))
            else:
                print(f"  SHELL   {folder:24} {title[:20]:20} plain terminal, text replays only")
                shells += 1
        print(
            f"\n{resumed} conversations resume, {shells} return as plain terminals, "
            f"{len(failures)} would not come back"
        )
    finally:
        daemon.terminate()
        try:
            daemon.wait(timeout=5)
        except subprocess.TimeoutExpired:
            daemon.kill()
        if os.environ.get("TERMFLEET_REHEARSAL_KEEP"):
            print(f"(rehearsal tree kept at {tmp})")
        else:
            shutil.rmtree(tmp, ignore_errors=True)

    if failures:
        print("FAIL: some agent panes would not restore their conversation", file=sys.stderr)
        return 1
    print("PASS: every open pane has a known, correct outcome after a reboot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
