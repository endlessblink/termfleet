import hashlib
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify-installed-release.sh"
INSTALLER = ROOT / "scripts" / "install-release.sh"
DESKTOP_LAUNCHER = ROOT / "scripts" / "termfleet-desktop-launcher.sh"
RESTART_SMOKE = ROOT / "scripts" / "verify-installed-restart-smoke.sh"
PROCESS_TREE = ROOT / "scripts" / "restart-smoke-process-tree.sh"
DOCTOR = ROOT / "scripts" / "termfleet-doctor.mjs"


class InstalledReleaseTests(unittest.TestCase):
    def make_release(self, home: pathlib.Path):
        install_root = home / "share" / "termfleet"
        release_dir = install_root / "releases" / "release-1"
        release_dir.mkdir(parents=True)
        binary = release_dir / "termfleet"
        binary.write_bytes(b"stable-termfleet-release")
        binary.chmod(0o755)
        checksum = hashlib.sha256(binary.read_bytes()).hexdigest()
        (release_dir / "manifest.env").write_text(
            f"TERMFLEET_BINARY_SHA256={checksum}\n"
        )
        (install_root / "current").symlink_to("releases/release-1")
        command = home / "bin" / "termfleet"
        command.parent.mkdir()
        command.symlink_to(install_root / "current" / "termfleet")
        libexec = install_root / "libexec"
        libexec.mkdir()
        launcher = libexec / "termfleet-desktop-launcher"
        launcher.write_text("#!/usr/bin/env bash\nexit 0\n")
        launcher.chmod(0o755)
        (command.parent / "termfleet-desktop").symlink_to(launcher)
        applications = home / "share" / "applications"
        applications.mkdir()
        (applications / "termfleet.desktop").write_text(
            "[Desktop Entry]\n"
            f"Exec={command.parent / 'termfleet-desktop'} --dock\n"
            "Icon=termfleet\n"
            "StartupWMClass=Termfleet\n"
        )
        icon = home / "share" / "icons" / "hicolor" / "scalable" / "apps"
        icon.mkdir(parents=True)
        (icon / "termfleet.svg").write_text("<svg/>")
        return install_root, command, binary

    def run_verifier(self, install_root: pathlib.Path, command: pathlib.Path):
        return subprocess.run(
            ["bash", str(VERIFIER)],
            env={
                **os.environ,
                "TERMFLEET_INSTALL_ROOT": str(install_root),
                "TERMFLEET_COMMAND_PATH": str(command),
                "TERMFLEET_DESKTOP_LAUNCHER": str(command.parent / "termfleet-desktop"),
                "TERMFLEET_DESKTOP_ENTRY": str(
                    install_root.parent / "applications" / "termfleet.desktop"
                ),
                "TERMFLEET_DESKTOP_ICON": str(
                    install_root.parent / "icons" / "hicolor" / "scalable" / "apps" / "termfleet.svg"
                ),
                "TERMFLEET_PLASMA_ICON_DIR": str(install_root.parent / "plasma_icons"),
            },
            capture_output=True,
            text=True,
            check=False,
        )

    def test_accepts_checksummed_immutable_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            install_root, command, _ = self.make_release(pathlib.Path(tmp))
            result = self.run_verifier(install_root, command)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("TERMFLEET_INSTALLED_RELEASE_OK", result.stdout)

    def test_rejects_development_launcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = pathlib.Path(tmp)
            install_root = home / "share" / "termfleet"
            install_root.mkdir(parents=True)
            dev = home / "run-dev.sh"
            dev.write_text("#!/usr/bin/env bash\n")
            dev.chmod(0o755)
            command = home / "termfleet"
            command.symlink_to(dev)

            result = self.run_verifier(install_root, command)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("development source", result.stderr)

    def test_rejects_binary_changed_after_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            install_root, command, binary = self.make_release(pathlib.Path(tmp))
            binary.write_bytes(b"changed-after-promotion")
            binary.chmod(0o755)
            result = self.run_verifier(install_root, command)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum does not match", result.stderr)

    def test_dock_only_acceptance_is_recorded_for_every_agent(self):
        required = {
            "AGENTS.md": "Normal operator use and acceptance testing are dock-only.",
            "CLAUDE.md": "Normal operator use and acceptance testing are dock-only.",
            "README.md": "Install the current source build, then launch TermFleet from the desktop dock:",
            "HANDOFF.md": "Normal operator use and acceptance are dock-only.",
        }
        for relative_path, statement in required.items():
            with self.subTest(relative_path=relative_path):
                self.assertIn(statement, (ROOT / relative_path).read_text())

    def test_doctor_compares_the_dock_release_with_the_current_build(self):
        source = DOCTOR.read_text()
        self.assertIn("Installed dock release", source)
        self.assertIn("installedBinarySha", source)
        self.assertIn("builtBinarySha", source)
        self.assertNotIn("the dock launcher does not", source)

    def test_doctor_resolves_the_desktop_entry_executable_before_dock_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = pathlib.Path(tmp)
            release_dir = home / ".local" / "share" / "termfleet" / "releases" / "release-1"
            release_dir.mkdir(parents=True)
            binary = release_dir / "termfleet"
            binary.write_bytes(b"stable-termfleet-release")
            binary.chmod(0o755)
            (release_dir / "manifest.env").write_text("TERMFLEET_BINARY_SHA256=placeholder\n")
            current = release_dir.parent.parent / "current"
            current.symlink_to("releases/release-1")

            bin_dir = home / ".local" / "bin"
            bin_dir.mkdir(parents=True)
            command = bin_dir / "termfleet"
            command.symlink_to(current / "termfleet")
            launcher = bin_dir / "termfleet-desktop"
            launcher.write_text("#!/usr/bin/env bash\nexit 0\n")
            launcher.chmod(0o755)

            applications = home / ".local" / "share" / "applications"
            applications.mkdir(parents=True)
            (applications / "termfleet.desktop").write_text(
                f"[Desktop Entry]\nExec={launcher} --dock\n"
            )

            result = subprocess.run(
                ["node", str(DOCTOR)],
                env={**os.environ, "HOME": str(home)},
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotIn("dock launcher is missing", result.stdout + result.stderr)

    def test_release_installer_owns_the_branded_single_window_dock_launcher(self):
        installer = INSTALLER.read_text()
        launcher = DESKTOP_LAUNCHER.read_text()
        self.assertIn("termfleet-desktop-launcher.sh", installer)
        self.assertIn("termfleet-vessel-master.svg", installer)
        self.assertIn("Icon=termfleet", installer)
        self.assertIn("Exec=%s --dock", installer)
        self.assertIn("StartupWMClass=Termfleet", installer)
        self.assertIn("kbuildsycoca6 --noincremental", installer)
        self.assertIn("TERMFLEET_PLASMA_ICON_DIR", installer)
        self.assertIn("org.kde.PlasmaShell.refreshCurrentShell", installer)
        self.assertIn('pgrep -u "$UID" -x termfleet', launcher)
        self.assertIn('wmctrl -a TermFleet', launcher)
        self.assertIn('TERMFLEET_OLLAMA_URL:-http://127.0.0.1:11434', launcher)
        self.assertIn('TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS:-25000', launcher)
        self.assertNotIn('TERMFLEET_OLLAMA_URL:-http://127.0.0.1:9', launcher)

    def test_dock_restore_waits_for_the_daemon_after_starting_the_app(self):
        launcher = DESKTOP_LAUNCHER.read_text()
        app_start = launcher.index('"$TERMFLEET_CMD" &')
        daemon_wait = launcher.index('daemon_socket=')
        restore_start = launcher.index('"$TERMFLEET_RESTORE"', daemon_wait)
        self.assertLess(daemon_wait, app_start)
        self.assertLess(restore_start, app_start)
        self.assertIn('[[ -S "$daemon_socket" ]]', launcher)

    def test_dock_startup_has_a_hard_daemon_gate_before_the_window(self):
        launcher = DESKTOP_LAUNCHER.read_text()
        app_start = launcher.index('"$TERMFLEET_CMD" &')
        gate = launcher.index('refusing to launch cockpit: daemon socket did not appear')
        self.assertLess(gate, app_start)
        self.assertIn('nohup "$TERMFLEET_CMD" --terminal-workspace-daemon', launcher)

    def test_crash_restart_restores_provider_sessions_before_app_hydration(self):
        launcher = DESKTOP_LAUNCHER.read_text()
        app_start = launcher.index('"$TERMFLEET_CMD" &')
        restore_start = launcher.index('"$TERMFLEET_RESTORE"')
        self.assertLess(restore_start, app_start)
        pre_start = launcher[:app_start]
        self.assertIn('--terminal-workspace-daemon', pre_start)
        self.assertIn('--termfleet-startup', pre_start)
        self.assertIn('[[ ! -S "$daemon_socket" ]]', pre_start)

    def test_rejects_stale_plasma_pinned_launcher_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            install_root, command, _ = self.make_release(root)
            plasma_icons = install_root.parent / "plasma_icons"
            plasma_icons.mkdir()
            (plasma_icons / "termfleet (2).desktop").write_text(
                "[Desktop Entry]\n"
                "Type=Application\n"
                "Name=TermFleet\n"
                "Exec=/old/source/launch-termfleet-desktop.sh\n"
                "Icon=/old/source/termfleet-vessel-16.svg\n"
                "StartupWMClass=TermFleet\n"
            )

            result = self.run_verifier(install_root, command)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("pinned taskbar launcher", result.stderr)

    def test_rejects_desktop_entry_that_cannot_match_the_app_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            install_root, command, _ = self.make_release(root)
            desktop_entry = install_root.parent / "applications" / "termfleet.desktop"
            desktop_entry.write_text(
                desktop_entry.read_text().replace(
                    "StartupWMClass=Termfleet",
                    "StartupWMClass=TermFleet",
                )
            )

            result = self.run_verifier(install_root, command)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("window identity", result.stderr)

    def test_dock_launcher_reuses_an_existing_termfleet_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            install_root, command, _ = self.make_release(root)
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            (fake_bin / "pgrep").write_text("#!/usr/bin/env bash\nprintf '123\\n'\n")
            (fake_bin / "pgrep").chmod(0o755)
            focus_marker = root / "focused"
            (fake_bin / "wmctrl").write_text(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >\"$FOCUS_MARKER\"\n"
            )
            (fake_bin / "wmctrl").chmod(0o755)

            result = subprocess.run(
                ["bash", str(DESKTOP_LAUNCHER), "--dock"],
                env={
                    **os.environ,
                    "PATH": f"{fake_bin}:{os.environ['PATH']}",
                    "TERMFLEET_CMD": str(command),
                    "TERMFLEET_INSTALL_ROOT": str(install_root),
                    "TERMFLEET_TMPDIR": str(root / "tmp"),
                    "XDG_STATE_HOME": str(root / "state"),
                    "FOCUS_MARKER": str(focus_marker),
                },
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(focus_marker.read_text().strip(), "-a TermFleet")

    def test_failed_post_promotion_verification_restores_last_known_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            app = root / "app"
            scripts = app / "scripts"
            release_target = app / "src-tauri" / "target" / "release"
            scripts.mkdir(parents=True)
            release_target.mkdir(parents=True)
            installer = scripts / "install-release.sh"
            installer.write_text(INSTALLER.read_text())
            installer.chmod(0o755)
            desktop_launcher = scripts / "termfleet-desktop-launcher.sh"
            desktop_launcher.write_text("#!/usr/bin/env bash\nexit 0\n")
            desktop_launcher.chmod(0o755)
            brand_dir = app / "public" / "brand"
            brand_dir.mkdir(parents=True)
            (brand_dir / "termfleet-vessel-master.svg").write_text("<svg/>")
            (release_target / "terminal-workspace").write_bytes(b"new-release")
            (release_target / "terminal-workspace").chmod(0o755)
            verifier = scripts / "verify-installed-release.sh"
            verifier.write_text("#!/usr/bin/env bash\nexit 23\n")
            verifier.chmod(0o755)

            install_root = root / "installed"
            old_release = install_root / "releases" / "old"
            old_release.mkdir(parents=True)
            (old_release / "termfleet").write_bytes(b"old-release")
            (old_release / "termfleet").chmod(0o755)
            (install_root / "current").symlink_to("releases/old")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "termfleet").symlink_to(install_root / "current" / "termfleet")

            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            npm = fake_bin / "npm"
            npm.write_text("#!/usr/bin/env bash\nexit 0\n")
            npm.chmod(0o755)
            git = fake_bin / "git"
            git.write_text(
                "#!/usr/bin/env bash\n"
                "printf '%s\\n' 0123456789abcdef0123456789abcdef01234567\n"
            )
            git.chmod(0o755)

            result = subprocess.run(
                ["bash", str(installer)],
                env={
                    **os.environ,
                    "PATH": f"{fake_bin}:{os.environ['PATH']}",
                    "TERMFLEET_INSTALL_ROOT": str(install_root),
                    "TERMFLEET_BIN_DIR": str(bin_dir),
                    "TERMFLEET_APPLICATIONS_DIR": str(root / "applications"),
                    "TERMFLEET_ICON_DIR": str(root / "icons"),
                    "TERMFLEET_PLASMA_ICON_DIR": str(root / "plasma-icons"),
                },
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((install_root / "current").readlink(), pathlib.Path("releases/old"))
            self.assertEqual((bin_dir / "termfleet").resolve().read_bytes(), b"old-release")
            self.assertIn("restored the last-known-good release", result.stderr)

    def test_restart_smoke_uses_isolated_desktop_restore_path(self):
        source = RESTART_SMOKE.read_text()
        self.assertIn('TERMFLEET_RESTART_SMOKE_INNER', source)
        self.assertIn('xvfb-run -a', source)
        self.assertIn('TERMFLEET_RESTART_SMOKE_USE_CURRENT_DISPLAY', source)
        self.assertIn('export DISPLAY="${DISPLAY:-:0}"', source)
        self.assertNotIn("sort -n -u", source)
        self.assertIn('"$DESKTOP_LAUNCHER" --child', source)
        self.assertIn('AGENT_FLEET_CONFIG="$manifest"', source)
        self.assertIn('XDG_RUNTIME_DIR="$runtime_dir"', source)
        self.assertIn('XDG_DATA_HOME="$data_dir"', source)
        self.assertIn('XDG_STATE_HOME="$state_dir"', source)
        self.assertIn('AGENT_FLEET_STATE_DIR="$state_dir/agent-fleet"', source)
        self.assertIn('host = "terminal"', source)
        self.assertIn('SMOKE_RESUME_MARKER="$resume_marker"', source)
        self.assertIn("external_terminals=0", source)
        self.assertIn("setsid dbus-run-session", source)
        self.assertIn("xprop -id", source)
        self.assertIn('"termfleet", "Termfleet"', source)
        self.assertIn("trap 'cleanup_on_signal 130' INT", source)
        self.assertIn("trap 'cleanup_on_signal 143' TERM", source)

    def test_process_tree_cleanup_removes_group_and_detached_runtime_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = pathlib.Path(tmp) / "runtime"
            runtime.mkdir()
            script = f"""
source {PROCESS_TREE}
setsid env XDG_RUNTIME_DIR={runtime} bash -c 'sleep 60 & wait' &
group_pid=$!
setsid env XDG_RUNTIME_DIR={runtime} sleep 60 &
detached_pid=$!
termfleet_smoke_terminate_processes "$group_pid" {runtime}
wait "$group_pid" 2>/dev/null || true
wait "$detached_pid" 2>/dev/null || true
kill -0 "$group_pid" 2>/dev/null && exit 11
kill -0 "$detached_pid" 2>/dev/null && exit 12
exit 0
"""
            result = subprocess.run(
                ["bash", "-c", script],
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_interruption_trap_leaves_no_runtime_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            runtime = root / "runtime"
            runtime.mkdir()
            pid_file = root / "pids"
            harness = root / "harness.sh"
            harness.write_text(
                f"""#!/usr/bin/env bash
source {PROCESS_TREE}
runtime_dir="$1"
pid_file="$2"
setsid env XDG_RUNTIME_DIR="$runtime_dir" bash -c 'sleep 60 & wait' &
process_group_pid=$!
setsid env XDG_RUNTIME_DIR="$runtime_dir" sleep 60 &
detached_pid=$!
printf '%s %s\\n' "$process_group_pid" "$detached_pid" >"$pid_file"
cleanup_on_term() {{
  trap - TERM
  termfleet_smoke_terminate_processes "$process_group_pid" "$runtime_dir"
  wait "$process_group_pid" 2>/dev/null || true
  wait "$detached_pid" 2>/dev/null || true
  exit 143
}}
trap cleanup_on_term TERM
while true; do sleep 1; done
"""
            )
            harness.chmod(0o755)
            process = subprocess.Popen(
                [str(harness), str(runtime), str(pid_file)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            deadline = time.monotonic() + 5
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(pid_file.exists())
            child_pids = [int(pid) for pid in pid_file.read_text().split()]
            process.send_signal(signal.SIGTERM)
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 143, stderr)
            for pid in child_pids:
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)


if __name__ == "__main__":
    unittest.main()
