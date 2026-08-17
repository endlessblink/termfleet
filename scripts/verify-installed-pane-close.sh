#!/usr/bin/env bash
set -euo pipefail

APP_BIN="${TERMFLEET_INSTALLED_BIN:-/home/endlessblink/.local/bin/termfleet}"
RUN_DIR="${TERMFLEET_PANE_CLOSE_RUN:-/tmp/termfleet-pane-close-$USER-$$}"
DATA_DIR="${TERMFLEET_PANE_CLOSE_DATA:-/tmp/termfleet-pane-close-data-$USER-$$}"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$RUN_DIR" "$DATA_DIR"
}
trap cleanup EXIT

if [[ ! -x "$APP_BIN" ]]; then
  echo "Missing installed TermFleet binary: $APP_BIN" >&2
  exit 1
fi

rm -rf "$RUN_DIR" "$DATA_DIR"
mkdir -p "$RUN_DIR" "$DATA_DIR"
XDG_RUNTIME_DIR="$RUN_DIR" XDG_DATA_HOME="$DATA_DIR" "$APP_BIN" --terminal-workspace-daemon \
  >/tmp/termfleet-pane-close-daemon.log 2>&1 &
DAEMON_PID=$!

python3 - "$SOCKET" "$DAEMON_PID" <<'PY'
import json
import socket
import os
import shutil
import sys
import time

socket_path, daemon_pid = sys.argv[1], int(sys.argv[2])


def request(payload):
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
                stream.settimeout(2)
                stream.connect(socket_path)
                # Daemon status uses the legacy health-check frame; all session
                # control requests use the JSON tagged protocol.
                wire = b"status\n" if payload.get("type") == "status" else (json.dumps(payload) + "\n").encode()
                stream.sendall(wire)
                stream.shutdown(socket.SHUT_WR)
                payload = stream.makefile("rb").read().decode()
                if payload.strip():
                    return json.loads(payload)
        except (FileNotFoundError, ConnectionRefusedError, TimeoutError, json.JSONDecodeError):
            time.sleep(0.05)
    raise RuntimeError("daemon socket was not reachable")


def live(pid):
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as process:
            return process.read().split()[2] != "Z"
    except FileNotFoundError:
        return False


def descends_from(pid, root):
    seen = set()
    while pid > 1 and pid not in seen:
        if pid == root:
            return True
        seen.add(pid)
        try:
            with open(f"/proc/{pid}/stat", encoding="utf-8") as process:
                fields = process.read().rsplit(") ", 1)[1].split()
            pid = int(fields[1])
        except (FileNotFoundError, ValueError, IndexError):
            return False
    return False


status = request({"type": "status"})
assert status["type"] == "status" and status["mode"] == "externalDaemon", status

pane_id = "installed-pane-close-test"
unrelated_id = "installed-pane-close-unrelated"
helper_dir = f"/tmp/termfleet-pane-close-helper-{os.getpid()}"
os.makedirs(helper_dir, exist_ok=True)
inner = os.path.join(helper_dir, "inner.sh")
outer = os.path.join(helper_dir, "outer.sh")
open(inner, "w", encoding="utf-8").write(
    "#!/bin/sh\n"
    "env -u TERMFLEET_PANE_ID sleep 60 &\n"
    "printf '%s\n' \"$!\"\n"
    "wait\n"
)
open(outer, "w", encoding="utf-8").write(
    "#!/bin/sh\n"
    f"setsid {inner} &\n"
    "wait\n"
)
os.chmod(inner, 0o700)
os.chmod(outer, 0o700)
detached_command = outer
request({
    "type": "ensureSession",
    "id": pane_id,
    "cwd": "/tmp",
    "command": detached_command,
    "cols": 80,
    "rows": 24,
})
pane_pid = None
for _ in range(100):
    sessions = request({"type": "listSessions"})["sessions"]
    matching = next((session for session in sessions if session["id"] == pane_id), None)
    if matching:
        pane_pid = matching["pid"]
        break
    time.sleep(0.02)
assert pane_pid, f"pane session never appeared: {sessions}"
request({
    "type": "ensureSession",
    "id": unrelated_id,
    "cwd": "/tmp",
    "command": "sleep 60",
    "cols": 80,
    "rows": 24,
})

child_pid = None
for _ in range(100):
    snapshot = request({"type": "snapshotSession", "id": pane_id})
    for line in snapshot.get("data", "").splitlines():
        if line.strip().isdigit() and int(line.strip()) > 1:
            child_pid = int(line.strip())
            break
    if child_pid:
        break
    time.sleep(0.02)
assert child_pid and live(child_pid), (child_pid, snapshot)
child_cgroup = open(f"/proc/{child_pid}/cgroup", encoding="utf-8").read()
assert "termfleet-pane-" in child_cgroup or descends_from(child_pid, pane_pid), (child_cgroup, pane_pid)

kill_response = request({"type": "killSession", "id": pane_id})
assert kill_response == {
    "type": "killSession",
    "ok": True,
}, kill_response
for _ in range(100):
    if not live(child_pid):
        break
    time.sleep(0.02)
assert not live(child_pid), f"detached child survived pane close: {child_pid}"
write_response = request({"type": "writeSession", "id": unrelated_id, "data": "still-alive\\n"})
assert write_response == {
    "type": "writeSession",
    "ok": True,
}, write_response
assert request({"type": "status"})["mode"] == "externalDaemon"
request({"type": "killSession", "id": unrelated_id})
shutil.rmtree(helper_dir, ignore_errors=True)
print(f"INSTALLED_PANE_CLOSE_OK child={child_pid} unrelated=alive daemon={daemon_pid}")
PY
