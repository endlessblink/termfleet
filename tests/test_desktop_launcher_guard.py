"""The launcher's "already running" guard must ignore the daemon.

The cockpit and the daemon are the same binary, so they share a process name. A bare
`pgrep -x termfleet` therefore matches the daemon too. On 2026-07-31 a memory-pressure
kill took the cockpit window while the daemon survived, and the guard then refused to
launch the UI ever again — every click logged "reusing existing TermFleet window" and
exited 0 with nothing on screen.

These tests drive the real script with a fake `pgrep` and a fake `/proc`, so they check
the actual guard rather than a re-implementation of it.
"""

import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "termfleet-desktop-launcher.sh"


class DesktopLauncherGuardTests(unittest.TestCase):
    def run_launcher(self, pids: dict[int, str], states: dict[int, str] | None = None):
        """Run the launcher with `pgrep` stubbed to report `pids` (pid -> cmdline).

        Returns (returncode, launch log text). The launcher is pointed at a fake
        release binary that just records that it ran.
        """
        with tempfile.TemporaryDirectory() as tmp:
            home = pathlib.Path(tmp)

            # A release-shaped install, since the launcher refuses anything else.
            release_dir = home / "share" / "termfleet" / "releases" / "test-release"
            release_dir.mkdir(parents=True)
            marker = home / "launched"
            binary = release_dir / "termfleet"
            binary.write_text(f"#!/usr/bin/env bash\ntouch {marker}\n")
            binary.chmod(0o755)
            command = home / "bin" / "termfleet"
            command.parent.mkdir()
            command.symlink_to(binary)

            # Fake /proc/<pid>/cmdline entries, NUL-separated like the real thing.
            proc = home / "proc"
            for pid, cmdline in pids.items():
                entry = proc / str(pid)
                entry.mkdir(parents=True)
                (entry / "cmdline").write_bytes(cmdline.replace(" ", "\0").encode() + b"\0")
                state = (states or {}).get(pid, "S")
                (entry / "stat").write_text(f"{pid} (termfleet) {state} 1 1 1 0\n")

            # Stub pgrep, and redirect /proc lookups into our fake tree.
            stub_dir = home / "stub"
            stub_dir.mkdir()
            pgrep = stub_dir / "pgrep"
            listed = "\n".join(str(pid) for pid in pids)
            pgrep.write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' {listed!r}\nexit 0\n"
                             if pids else "#!/usr/bin/env bash\nexit 1\n")
            pgrep.chmod(0o755)

            script = LAUNCHER.read_text()
            script = script.replace('"/proc/$pid/cmdline"', f'"{proc}/$pid/cmdline"')
            script = script.replace('"/proc/$pid/stat"', f'"{proc}/$pid/stat"')
            patched = home / "launcher.sh"
            patched.write_text(script)
            patched.chmod(0o755)

            result = subprocess.run(
                ["bash", str(patched)],
                env={
                    **os.environ,
                    "PATH": f"{stub_dir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
                    "HOME": str(home),
                    "USER": "test",
                    "XDG_DATA_HOME": str(home / "share"),
                    "XDG_STATE_HOME": str(home / "state"),
                    "TERMFLEET_CMD": str(command),
                    "TERMFLEET_RESTORE": str(home / "missing-restore.py"),
                    "TERMFLEET_TMPDIR": str(home / "tmp"),
                },
                capture_output=True,
                text=True,
                check=False,
            )
            log_path = home / "state" / "termfleet" / "desktop-launch.log"
            log = log_path.read_text() if log_path.exists() else ""
            return result.returncode, log

    def test_daemon_alone_does_not_count_as_a_running_cockpit(self):
        # The exact state after the cockpit was killed: daemon up, no window.
        _rc, log = self.run_launcher({15795: "/opt/termfleet --terminal-workspace-daemon"})
        self.assertNotIn("reusing existing TermFleet window", log)
        self.assertIn("launching TermFleet desktop wrapper", log)

    def test_a_live_cockpit_still_suppresses_a_second_launch(self):
        _rc, log = self.run_launcher({4242: "/opt/termfleet"})
        self.assertIn("reusing existing TermFleet window", log)
        self.assertNotIn("launching TermFleet desktop wrapper", log)

    def test_cockpit_is_detected_alongside_a_daemon(self):
        _rc, log = self.run_launcher({
            15795: "/opt/termfleet --terminal-workspace-daemon",
            4242: "/opt/termfleet",
        })
        self.assertIn("reusing existing TermFleet window", log)

    def test_nothing_running_launches(self):
        _rc, log = self.run_launcher({})
        self.assertIn("launching TermFleet desktop wrapper", log)

    def test_zombie_cockpit_does_not_block_a_fresh_window(self):
        _rc, log = self.run_launcher({4242: ""}, states={4242: "Z"})
        self.assertNotIn("reusing existing TermFleet window", log)
        self.assertIn("launching TermFleet desktop wrapper", log)

    def test_desktop_launch_disables_unreliable_webkit_compositing(self):
        script = LAUNCHER.read_text()
        self.assertIn('export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"', script)
        self.assertIn(
            'export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"',
            script,
        )
        self.assertIn(
            'export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"',
            script,
        )
        self.assertIn('--setenv="WEBKIT_DISABLE_DMABUF_RENDERER=$WEBKIT_DISABLE_DMABUF_RENDERER"', script)

    def test_desktop_unit_kills_webkit_children_with_the_ui(self):
        script = LAUNCHER.read_text()
        self.assertIn("-p KillMode=control-group", script)
        self.assertNotIn("-p KillMode=process", script)

    def test_desktop_unit_bounds_renderer_memory_without_bounding_daemon(self):
        script = LAUNCHER.read_text()
        self.assertIn('export TERMFLEET_DESKTOP_MEMORY_HIGH="${TERMFLEET_DESKTOP_MEMORY_HIGH:-768M}"', script)
        self.assertIn('export TERMFLEET_DESKTOP_MEMORY_MAX="${TERMFLEET_DESKTOP_MEMORY_MAX:-1G}"', script)
        self.assertIn('-p MemoryHigh="$TERMFLEET_DESKTOP_MEMORY_HIGH"', script)
        self.assertIn('-p MemoryMax="$TERMFLEET_DESKTOP_MEMORY_MAX"', script)
        self.assertIn('printf \'%s\\n\' "$TERMFLEET_DESKTOP_MEMORY_HIGH" >"$desktop_cgroup/memory.high"', script)
        self.assertIn('printf \'%s\\n\' "$TERMFLEET_DESKTOP_MEMORY_MAX" >"$desktop_cgroup/memory.max"', script)

    def test_desktop_launch_serializes_racing_wrappers_before_releasing_the_lock(self):
        script = LAUNCHER.read_text()
        self.assertIn('LOCK_FILE="$LOG_DIR/desktop-launch.lock"', script)
        self.assertIn('exec 9>"$LOCK_FILE"', script)
        self.assertIn('flock -n 9', script)
        self.assertIn('cockpit_running', script)

    def test_dock_click_replaces_a_cockpit_from_an_older_release(self):
        script = LAUNCHER.read_text()
        self.assertIn('existing_exe="$(readlink -f "/proc/$existing_pid/exe"', script)
        self.assertIn('replacing stale TermFleet desktop', script)
        self.assertIn('kill -TERM "$existing_pid"', script)

    def test_systemd_user_bus_failure_falls_back_to_a_direct_desktop_child(self):
        script = LAUNCHER.read_text()
        self.assertIn('systemd user bus unavailable; falling back to direct desktop child', script)
        self.assertIn('if systemd-run \\', script)
        self.assertIn('nohup "$0" --child', script)
        self.assertIn('set_display_credentials', script)
        self.assertIn('for candidate in "/run/user/${UID}"/xauth_*', script)
        self.assertIn('export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID}}"', script)
        self.assertIn('export DBUS_SESSION_BUS_ADDRESS=', script)

    def test_systemd_child_receives_x11_credentials_before_launch(self):
        script = LAUNCHER.read_text()
        self.assertLess(script.index("set_display_credentials\n\nunit_name="), script.index("if systemd-run"))
        self.assertIn('--setenv="XAUTHORITY=${XAUTHORITY:-}"', script)

    def test_child_does_not_reacquire_the_parent_launch_lock(self):
        script = LAUNCHER.read_text()
        self.assertIn('if [[ "${1:-}" != "--child" ]]; then\n  exec 9>"$LOCK_FILE"', script)
        self.assertIn('if [[ "${1:-}" != "--child" ]]; then\n  existing_pid=', script)


if __name__ == "__main__":
    unittest.main()
