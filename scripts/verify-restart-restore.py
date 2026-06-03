#!/usr/bin/env python3
"""End-to-end proof that terminal sessions are FULLY restorable, exercised
against the real daemon *process*, its unix socket, and on-disk checkpoints —
no GUI required. Covers BOTH recovery layers the app relies on:

  LAYER 1 (app restart, daemon survives -> live reattach):
    A fresh client (what a relaunched app's grid feed is) ensures the same
    session id and SUBSCRIBES; the daemon reports reused=true and streams a
    snapshot containing the live content. This is the exact transport path the
    GUI uses (vt_grid::feed_grid_from_daemon -> SubscribeSession), minus pixels.

  LAYER 2 (PC reboot, daemon dead -> disk replay):
    SIGKILL the daemon, restart it, ensure the same id; its grid snapshot
    replays the saved scrollback and reopens at the saved cwd.

Isolated via temp XDG_RUNTIME_DIR / XDG_DATA_HOME so it never touches the user's
real daemon or saved sessions.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI_ROOT = ROOT / "src-tauri"
CARGO_TARGET_DIR = Path(os.environ.get("CARGO_TARGET_DIR", "/tmp/tw-restart-restore-target"))
BIN = CARGO_TARGET_DIR / "debug" / "terminal-workspace"
DAEMON_ARG = "--terminal-workspace-daemon"


def send(sock_path, request, *, stream=False, timeout=2.0):
    """Send one JSON request; return a list of decoded response lines."""
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
            if not stream and b"\n" in buf:
                break
    except socket.timeout:
        pass
    s.close()
    return [json.loads(l) for l in buf.decode("utf-8", "replace").splitlines() if l.strip()]


def reachable(sock_path):
    try:
        resp = send(sock_path, {"type": "status"})
        if resp and resp[0].get("mode") == "externalDaemon":
            return resp[0]
    except (FileNotFoundError, ConnectionRefusedError, OSError):
        pass
    return None


def wait_up(sock_path, tries=60):
    for _ in range(tries):
        status = reachable(sock_path)
        if status:
            return status
        time.sleep(0.1)
    return None


def wait_down(sock_path, tries=60):
    for _ in range(tries):
        if reachable(sock_path) is None:
            return True
        time.sleep(0.1)
    return False


def snapshot_until(sock_path, sid, marker, tries=60):
    data = ""
    for _ in range(tries):
        resp = send(sock_path, {"type": "snapshotSession", "id": sid})
        data = resp[0].get("data", "") if resp else ""
        if marker in data:
            return data
        time.sleep(0.1)
    return data


def subscribe_collect(sock_path, sid, marker, timeout=2.0):
    """Subscribe like the GUI's grid feed; collect streamed snapshot/data."""
    # NOTE: struct-variant fields are NOT camelCased by the enum's rename_all —
    # the daemon expects the Rust field name `subscriber_id`.
    resp = send(sock_path, {"type": "subscribeSession", "id": sid,
                            "subscriber_id": "verify-reattach"}, stream=True, timeout=timeout)
    collected = "".join(
        r.get("data", "") for r in resp
        if r.get("type") in ("snapshotSession", "sessionData")
    )
    return collected, (marker in collected)


def start_daemon(env, log_path):
    log = open(log_path, "ab", buffering=0)
    return subprocess.Popen(
        [str(BIN), DAEMON_ARG], env=env, stdin=subprocess.DEVNULL,
        stdout=log, stderr=log,
    )


def setup_env():
    tmp = tempfile.mkdtemp(prefix="tw-restart-restore-")
    run_dir = os.path.join(tmp, "run")
    data_dir = os.path.join(tmp, "data")
    log_dir = os.path.join(tmp, "logs")
    os.makedirs(run_dir, mode=0o700, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)
    env = dict(os.environ, XDG_RUNTIME_DIR=run_dir, XDG_DATA_HOME=data_dir)
    sock = os.path.join(run_dir, "terminal-workspace", "daemon.sock")
    return tmp, env, sock, log_dir


def print_log_tail(log_path):
    try:
        data = Path(log_path).read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        print(f"(daemon log missing: {log_path})", file=sys.stderr)
        return
    print(f"--- daemon log tail: {log_path} ---", file=sys.stderr)
    for line in data[-40:]:
        print(line, file=sys.stderr)


def verify_live_reattach():
    """LAYER 1: daemon survives an app restart -> reattach delivers content."""
    print("--- LAYER 1: live reattach (app restart, daemon survives) ---")
    tmp, env, sock, log_dir = setup_env()
    log_path = os.path.join(log_dir, "daemon-live-reattach.log")
    sid, marker = "live-reattach-e2e", "LIVE_MARKER_7777"
    d = None
    try:
        d = start_daemon(env, log_path)
        if not wait_up(sock):
            print("FAIL: daemon never came up", file=sys.stderr)
            print_log_tail(log_path)
            return False
        send(sock, {"type": "ensureSession", "id": sid, "cwd": "/tmp", "command": "/bin/bash"})
        send(sock, {"type": "writeSession", "id": sid, "data": f"echo {marker}\n"})
        if marker not in snapshot_until(sock, sid, marker):
            print("FAIL: marker never reached live session", file=sys.stderr)
            return False
        print("marker present in live session  ✓")

        # Simulate the app relaunching against the SAME (surviving) daemon: a
        # fresh ensure must REUSE the live session, and a fresh subscriber (the
        # grid feed) must receive the live content.
        ens = send(sock, {"type": "ensureSession", "id": sid})
        reused = ens[0].get("reused") if ens else None
        if reused is not True:
            print(f"FAIL: relaunch did not reuse live session (reused={reused})", file=sys.stderr)
            return False
        streamed, ok = subscribe_collect(sock, sid, marker)
        print(f"relaunch reused={reused}; subscriber received content={ok}")
        if not ok:
            print(f"FAIL: reattach subscriber missing content: {streamed!r}", file=sys.stderr)
            return False
        print("live reattach delivered full content  ✓\n")
        return True
    finally:
        if d and d.poll() is None:
            d.kill()
        subprocess.run(["rm", "-rf", tmp], check=False)


def verify_cold_restore():
    """LAYER 2: daemon dies (PC reboot) -> content replayed from disk."""
    print("--- LAYER 2: cold restore (PC reboot, daemon dead) ---")
    tmp, env, sock, log_dir = setup_env()
    log1 = os.path.join(log_dir, "daemon-cold-restore-1.log")
    log2 = os.path.join(log_dir, "daemon-cold-restore-2.log")
    sid, marker = "cold-restore-e2e", "RESTORE_MARKER_4242"
    d1 = d2 = None
    try:
        d1 = start_daemon(env, log1)
        s1 = wait_up(sock)
        if not s1:
            print("FAIL: daemon #1 never came up", file=sys.stderr)
            print_log_tail(log1)
            return False
        print(f"daemon #1 up  pid={s1.get('pid')} build={s1.get('buildId')}")
        send(sock, {"type": "ensureSession", "id": sid, "cwd": "/tmp", "command": "/bin/bash"})
        send(sock, {"type": "writeSession", "id": sid, "data": f"echo {marker}\n"})
        if marker not in snapshot_until(sock, sid, marker):
            print("FAIL: marker never reached live session", file=sys.stderr)
            return False
        print("marker present before reboot  ✓")
        time.sleep(1.0)  # let the throttled 750ms disk checkpoint flush

        d1.kill(); d1.wait(timeout=5); wait_down(sock)
        print("daemon #1 SIGKILLed (reboot simulated)  ✓")

        d2 = start_daemon(env, log2)
        s2 = wait_up(sock)
        if not s2:
            print("FAIL: daemon #2 never came up", file=sys.stderr)
            print_log_tail(log2)
            return False
        print(f"daemon #2 up  pid={s2.get('pid')}")
        ens = send(sock, {"type": "ensureSession", "id": sid})  # no cwd -> restore
        reused = ens[0].get("reused") if ens else None
        post = snapshot_until(sock, sid, marker, tries=40)
        cwd = send(sock, {"type": "getSessionCwd", "id": sid})
        cwd_val = cwd[0].get("cwd") if cwd else None
        print(f"restored reused={reused} cwd={cwd_val!r}")
        if marker not in post:
            print(f"FAIL: marker missing after reboot: {post!r}", file=sys.stderr)
            return False
        if cwd_val != "/tmp":
            print(f"FAIL: restored at wrong cwd: {cwd_val!r}", file=sys.stderr)
            return False
        print("content REPLAYED and cwd restored after reboot  ✓\n")
        return True
    finally:
        for d in (d2, d1):
            if d and d.poll() is None:
                d.kill()
        subprocess.run(["rm", "-rf", tmp], check=False)


def main():
    if not BIN.is_file():
        print(f"building private debug binary at {BIN}")
        CARGO_TARGET_DIR.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["cargo", "build", "--bin", "terminal-workspace"],
            cwd=TAURI_ROOT,
            env=dict(os.environ, CARGO_BUILD_JOBS="1", CARGO_PROFILE_DEV_DEBUG="0",
                     CARGO_TARGET_DIR=str(CARGO_TARGET_DIR)),
        )
        if result.returncode != 0:
            print("FAIL: private debug binary build failed", file=sys.stderr)
            return result.returncode
    layer1 = verify_live_reattach()
    layer2 = verify_cold_restore()
    if layer1 and layer2:
        print("PASS: terminals fully restorable across app restart AND PC reboot")
        return 0
    print("FAIL: see above", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
