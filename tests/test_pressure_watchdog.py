"""Static safety checks for the host-pressure watchdog."""

import pathlib
import os
import subprocess
import tempfile
import time
import unittest
from datetime import date, timedelta


ROOT = pathlib.Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / "scripts" / "termfleet-pressure-watchdog.sh"
INSTALLER = ROOT / "scripts" / "install-pressure-watchdog.sh"
LOAD_SHED = ROOT / "scripts" / "termfleet-load-shed.sh"
SERVICE = ROOT / "systemd" / "termfleet-pressure-watchdog.service"
INCIDENT_HELPER = ROOT / "scripts" / "termfleet-incident-log.sh"
INCIDENT_SNAPSHOT = ROOT / "scripts" / "termfleet-capture-desktop-incident.sh"


class PressureWatchdogTests(unittest.TestCase):
    def test_watchdog_writes_atomic_progress_heartbeat_to_runtime_storage(self):
        script = WATCHDOG.read_text()
        helper = script.split("record_watchdog_heartbeat() {", 1)[1].split("\nis_production_desktop() {", 1)[0]
        shell = "record_watchdog_heartbeat() {" + helper

        with tempfile.TemporaryDirectory() as runtime_dir:
            subprocess.run(
                ["bash", "-c", shell + '\nrecord_watchdog_heartbeat loop-start\nrecord_watchdog_heartbeat desktop-sampled'],
                env={**os.environ, "RUNTIME_DIR": runtime_dir, "WATCHDOG_HEARTBEAT": f"{runtime_dir}/termfleet/pressure-watchdog.heartbeat"},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            heartbeat = pathlib.Path(runtime_dir) / "termfleet" / "pressure-watchdog.heartbeat"
            fields = heartbeat.read_text().strip().split("\t")
            self.assertEqual(fields[1], "desktop-sampled")
            self.assertRegex(fields[0], r"^\d{4}-\d\d-\d\dT")
            self.assertRegex(fields[2], r"^\d+$")
            self.assertEqual(list(heartbeat.parent.iterdir()), [heartbeat])

    def test_installer_deploys_the_current_continuous_sampler(self):
        with tempfile.TemporaryDirectory() as home:
            (pathlib.Path(home) / ".local" / "bin").mkdir(parents=True)
            env = {
                **os.environ,
                "HOME": home,
                "XDG_DATA_HOME": str(pathlib.Path(home) / ".local" / "share"),
                "XDG_CONFIG_HOME": str(pathlib.Path(home) / ".config"),
                "XDG_RUNTIME_DIR": str(pathlib.Path(home) / ".runtime"),
                "TERMFLEET_PRESSURE_WATCHDOG_FILES_ONLY": "1",
            }
            env.pop("DBUS_SESSION_BUS_ADDRESS", None)
            result = subprocess.run(
                ["bash", str(INSTALLER)],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            self.assertIn("files-only (service not restarted)", result.stdout)
            self.assertNotIn("systemctl", result.stdout)
            installed = pathlib.Path(home) / ".local" / "share" / "termfleet" / "libexec" / "termfleet-pressure-watchdog"
            self.assertEqual(installed.read_bytes(), WATCHDOG.read_bytes())
            self.assertEqual(
                (pathlib.Path(home) / ".config" / "systemd" / "user" / "termfleet-pressure-watchdog.service").read_bytes(),
                SERVICE.read_bytes(),
            )

    def test_desktop_sampler_records_host_pressure_when_desktop_is_absent(self):
        script = WATCHDOG.read_text()
        helpers = script.split("read_psi_avg10() {", 1)[1].split("\ncockpit_heartbeat_age_seconds() {", 1)[0]
        shell = "read_psi_avg10() {" + helpers

        with tempfile.TemporaryDirectory() as state_dir:
            result = subprocess.run(
                ["bash", "-c", shell + '\nrecord_desktop_sample "" "" ""'],
                env={**os.environ, "STATE_DIR": state_dir},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            sample_files = list(pathlib.Path(state_dir).glob("desktop-samples-*.tsv"))
            self.assertEqual(len(sample_files), 1, result.stderr)
            rows = sample_files[0].read_text().splitlines()
            self.assertEqual(rows[0].split("\t")[0:3], ["timestamp", "ui_pid", "ui_state"])
            sample = rows[-1].split("\t")
            self.assertEqual(sample[1:7], ["0", "absent", "0", "0", "absent", "0"])
            self.assertEqual(len(sample), len(rows[0].split("\t")))

    def test_desktop_sample_retention_removes_files_older_than_two_days(self):
        script = WATCHDOG.read_text()
        self.assertIn("prune_desktop_samples() {", script)
        pruning = script.split("prune_desktop_samples() {", 1)[1].split("\n}\n", 1)[0]
        old_function = "prune_desktop_samples() {" + pruning + "\n}"

        with tempfile.TemporaryDirectory() as state_dir:
            old_sample = pathlib.Path(state_dir) / "desktop-samples-2026-09-20.tsv"
            current_sample = pathlib.Path(state_dir) / "desktop-samples-2026-09-28.tsv"
            unrelated = pathlib.Path(state_dir) / "unrelated.log"
            for path in (old_sample, current_sample, unrelated):
                path.write_text("sample\n")
            old_time = time.time() - 3 * 86400
            os.utime(old_sample, (old_time, old_time))

            result = subprocess.run(
                ["bash", "-c", 'DESKTOP_SAMPLE_RETENTION_MINUTES="${TERMFLEET_DESKTOP_SAMPLE_RETENTION_MINUTES:-2880}"; ' + old_function + "\nprune_desktop_samples"],
                env={**os.environ, "STATE_DIR": state_dir},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            self.assertEqual(result.stdout, "")
            self.assertFalse(old_sample.exists())
            self.assertTrue(current_sample.exists())
            self.assertTrue(unrelated.exists())

    def test_desktop_sampler_records_bounded_ui_and_webkit_thread_summaries(self):
        script = WATCHDOG.read_text()
        helpers = script.split("read_psi_avg10() {", 1)[1].split("\ncockpit_heartbeat_age_seconds() {", 1)[0]
        shell = "read_psi_avg10() {" + helpers

        with tempfile.TemporaryDirectory() as state_dir:
            result = subprocess.run(
                ["bash", "-c", shell + '\nrecord_desktop_sample "$$" "" ""'],
                env={**os.environ, "STATE_DIR": state_dir},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            sample_file = next(pathlib.Path(state_dir).glob("desktop-samples-*.tsv"))
            headers, sample = [line.split("\t") for line in sample_file.read_text().splitlines()]
            self.assertIn("ui_threads_top3", headers)
            self.assertIn("webkit_threads_top3", headers)
            self.assertEqual(sample[headers.index("webkit_threads_top3")], "absent")
            ui_threads = sample[headers.index("ui_threads_top3")].split(",")
            self.assertGreaterEqual(len(ui_threads), 1, result.stderr)
            self.assertLessEqual(len(ui_threads), 3)
            for thread in ui_threads:
                self.assertRegex(thread, r"^\d+:[A-Za-z]+:[0-9.]+:[A-Za-z0-9_.-]+$")

    def test_desktop_sampler_rotates_incompatible_existing_schema(self):
        script = WATCHDOG.read_text()
        helpers = script.split("read_psi_avg10() {", 1)[1].split("\ncockpit_heartbeat_age_seconds() {", 1)[0]
        shell = "read_psi_avg10() {" + helpers

        with tempfile.TemporaryDirectory() as state_dir:
            sample_file = pathlib.Path(state_dir) / f"desktop-samples-{date.today().isoformat()}.tsv"
            sample_file.write_text("timestamp\tui_pid\told_schema\nold-row\n")
            subprocess.run(
                ["bash", "-c", shell + '\nrecord_desktop_sample "" "" ""'],
                env={**os.environ, "STATE_DIR": state_dir},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            headers, sample = [line.split("\t") for line in sample_file.read_text().splitlines()]
            self.assertEqual(len(sample), len(headers))
            self.assertIn("ui_threads_top3", headers)
            archives = list(pathlib.Path(state_dir).glob("desktop-samples-*.schema-*.tsv"))
            self.assertEqual(len(archives), 1)
            self.assertIn("old-row", archives[0].read_text())

    def test_desktop_incident_snapshot_is_read_only_and_precedes_recycle(self):
        script = WATCHDOG.read_text()
        self.assertIn("record_watchdog_heartbeat loop-start", script)
        self.assertIn("record_watchdog_heartbeat desktop-discovered", script)
        self.assertIn("record_watchdog_heartbeat desktop-sampled", script)
        pressure_sample = script.index('termfleet_incident_record "pressure_sample"')
        pressure_started = script.index('termfleet_incident_record "pressure_started"')
        capture = script.index('"$INCIDENT_CAPTURE_SCRIPT"')
        recovery = script.index('if (( recovery_planned == 1 )); then')
        recycle = script.index('kill -- "-$recovery_pgid"', recovery)
        self.assertLess(capture, pressure_sample)
        self.assertLess(capture, pressure_started)
        self.assertLess(capture, recycle)
        self.assertNotIn('kill ', INCIDENT_SNAPSHOT.read_text())

        with tempfile.TemporaryDirectory() as snapshot_root:
            result = subprocess.run(
                ["bash", str(INCIDENT_SNAPSHOT), str(os.getpid()), str(os.getpgrp()), "test"],
                env={**os.environ, "TERMFLEET_INCIDENT_SNAPSHOT_DIR": snapshot_root},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            snapshot = pathlib.Path(result.stdout.strip())
            self.assertTrue(snapshot.is_relative_to(pathlib.Path(snapshot_root)))
            for name in ("identity.txt", "status.txt", "wchan.txt", "stack.txt", "io-series.txt", "pressure.txt", "mounts.txt", "processes.txt", "fds.txt"):
                self.assertTrue((snapshot / name).is_file(), name)
            self.assertIn(str(os.getpid()), (snapshot / "identity.txt").read_text())

    def test_restart_notification_matches_recovery_eligibility(self):
        script = WATCHDOG.read_text()
        start = script.index('      recovery_text=')
        end = script.index('      if command -v notify-send', start)
        decision = script[start:end]
        for recover, allowed, pgid, expected in [
            ('0', '1', '123', False),
            ('1', '0', '123', False),
            ('1', '1', '', False),
            ('1', '1', '1', False),
            ('1', '1', '123', True),
        ]:
            for reason in ('desktop-blocked', 'webkit-blocked', 'webkit-missing', 'cockpit-heartbeat-stale', 'host-io-pressure', 'daemon-split-brain'):
                with self.subTest(recover=recover, allowed=allowed, pgid=pgid, reason=reason):
                    result = subprocess.run(
                        ['bash', '-c', decision + '\nprintf "%s\\n%s" "$recovery_planned" "$recovery_text"'],
                        env={'RECOVER': recover, 'recovery_allowed': allowed,
                             'desktop_pgid': pgid, 'webkit_pgid': pgid,
                             'reason': reason},
                        capture_output=True, text=True, check=True,
                    )
                    eligible = expected and reason in ('desktop-blocked', 'webkit-blocked', 'webkit-missing', 'cockpit-heartbeat-stale')
                    planned, message = result.stdout.split('\n', 1)
                    self.assertEqual(planned, '1' if eligible else '0')
                    self.assertEqual('will be recycled and relaunched' in message, eligible)
        self.assertIn('if (( recovery_planned == 1 )); then', script)

    def test_incident_log_is_structured_and_agent_readable(self):
        helper = INCIDENT_HELPER.read_text()
        self.assertIn('INCIDENT_JSONL="', helper)
        self.assertIn('INCIDENT_SUMMARY="', helper)
        self.assertIn('"schema":"termfleet.incident.v1"', helper)
        self.assertIn("termfleet_incident_record", helper)
        self.assertIn("incident-summary.md", helper)

    def test_watchdog_records_incident_lifecycle_and_pressure_context(self):
        script = WATCHDOG.read_text()
        self.assertIn("termfleet-incident-log.sh", script)
        self.assertIn('termfleet_incident_record "pressure_started"', script)
        self.assertIn('termfleet_incident_record "pressure_cleared"', script)
        self.assertIn('termfleet_incident_record "pressure_sample"', script)
        self.assertIn("swap_used_kb", script)
        self.assertIn("memory_available_kb", script)
        self.assertIn("swap_used_kb", script)
        self.assertIn("io_psi_avg10", script)
        self.assertIn("run_incident_audit", script)
        self.assertIn("audit=complete status=WARN exit=1", script)
        self.assertIn("run_load_shed", script)

    def test_launcher_records_start_and_exit_events(self):
        launcher = (ROOT / "scripts" / "termfleet-desktop-launcher.sh").read_text()
        self.assertIn("termfleet-incident-log.sh", launcher)
        self.assertIn('termfleet_incident_record "desktop_launch"', launcher)
        self.assertIn('termfleet_incident_record "desktop_exit"', launcher)

    def test_incident_helper_is_installed_with_the_watchdog(self):
        installer = INSTALLER.read_text()
        self.assertIn("termfleet-incident-log.sh", installer)
        self.assertIn("termfleet-capture-desktop-incident.sh", installer)
        self.assertIn("termfleet-load-shed.sh", installer)
        release_installer = (ROOT / "scripts" / "install-release.sh").read_text()
        self.assertIn("termfleet-pressure-watchdog.sh", release_installer)
        self.assertIn("termfleet-capture-desktop-incident.sh", release_installer)
        self.assertIn("termfleet-incident-log.sh", release_installer)
        self.assertIn("termfleet-load-shed.sh", release_installer)
        self.assertIn("try-restart termfleet-pressure-watchdog.service", release_installer)

    def test_load_shed_is_scoped_and_identity_safe(self):
        script = LOAD_SHED.read_text()
        self.assertIn("vite", script)
        self.assertIn("rustc", script)
        self.assertIn("lifeboat_sandbox_replay", script)
        self.assertIn("flowstate-installed-verification-profile", script)
        self.assertIn("--terminal-workspace-daemon", script)
        self.assertIn("proc_start", script)
        self.assertIn("renice", script)
        self.assertIn("ionice -c 3", script)
        self.assertIn("restore", script)
        self.assertNotIn("\nkill ", script)
        self.assertNotIn("SIGSTOP", script)

    def test_doctor_exposes_incident_handoff_for_future_agents(self):
        doctor = (ROOT / "scripts" / "termfleet-doctor.mjs").read_text()
        self.assertIn("incidents.jsonl", doctor)
        self.assertIn("incident-summary.md", doctor)
        self.assertIn("Incident history", doctor)

    def test_incident_logs_retain_only_recent_days(self):
        old_date = (date.today() - timedelta(days=5)).isoformat()
        today = date.today().isoformat()
        with tempfile.TemporaryDirectory() as state_root:
            state_dir = pathlib.Path(state_root) / "termfleet"
            state_dir.mkdir()
            (state_dir / "incidents.jsonl").write_text(
                f'{{"timestamp":"{old_date}T12:00:00+03:00","event":"old"}}\n'
                f'{{"timestamp":"{today}T12:00:00+03:00","event":"recent"}}\n'
            )
            (state_dir / "incident-summary.md").write_text(
                "# TermFleet incident history\n\n"
                f"- {old_date}T12:00:00+03:00 — old\n"
                f"- {today}T12:00:00+03:00 — recent\n"
            )
            subprocess.run(
                ["bash", "-c", f'source "{INCIDENT_HELPER}"; termfleet_incident_record test recent'],
                env={**os.environ, "XDG_STATE_HOME": state_root},
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            incidents = (state_dir / "incidents.jsonl").read_text()
            summary = (state_dir / "incident-summary.md").read_text()
            self.assertNotIn('"event":"old"', incidents)
            self.assertIn('"event":"recent"', incidents)
            self.assertIn('"event":"test"', incidents)
            self.assertNotIn(f"- {old_date}", summary)
            self.assertIn(f"- {today}", summary)

    def test_desktop_d_state_needs_strong_io_corroboration_before_recycle(self):
        script = WATCHDOG.read_text()
        self.assertIn("DESKTOP_BLOCKED_IO_THRESHOLD", script)
        self.assertIn("desktop_blocked_io_confirmed", script)
        self.assertIn("desktop_blocked_io_confirmed == 1", script)

    def test_stale_cockpit_heartbeat_recovers_a_live_but_gray_renderer(self):
        script = WATCHDOG.read_text()
        self.assertIn("TERMFLEET_COCKPIT_SNAPSHOT_PATH", script)
        self.assertIn("COCKPIT_HEARTBEAT_STALE_SECONDS", script)
        self.assertIn("COCKPIT_HEARTBEAT_STARTUP_GRACE_SECONDS", script)
        self.assertIn("cockpit_heartbeat_age_seconds", script)
        self.assertIn('reason="cockpit-heartbeat-stale"', script)

    def test_watchdog_ignores_normal_renderer_rss_without_recycling_or_alerting(self):
        script = WATCHDOG.read_text()
        self.assertIn("WebKitWebProcess", script)
        self.assertIn("desktop_info", script)
        self.assertIn("desktop-blocked", script)
        self.assertNotIn('reason="webkit-memory"', script)
        self.assertNotIn('reason="desktop-memory"', script)
        self.assertIn("memory-only readings are diagnostic, not pressure", script)
        self.assertIn('pgrep -u "$UID" -x termfleet', script)
        self.assertIn("/proc/pressure/memory", script)
        self.assertIn("/proc/pressure/io", script)
        self.assertIn("pressure-alert.prompt", script)
        self.assertIn("NOTIFY_BUS", script)
        self.assertIn('signature="$reason"', script)
        self.assertIn("TERMFLEET_PRESSURE_WATCHDOG_RECOVER", script)
        self.assertIn('RECOVER="${TERMFLEET_PRESSURE_WATCHDOG_RECOVER:-0}"', script)
        self.assertIn("ALERT_COOLDOWN_SECONDS", script)
        self.assertIn("HOST_ALERT_COOLDOWN_SECONDS", script)
        self.assertIn("BLOCKED_CONFIRMATIONS", script)
        self.assertIn("RECOVERY_COOLDOWN_SECONDS", script)
        self.assertIn("webkit_blocked_count", script)
        self.assertIn("desktop_blocked_count", script)
        self.assertIn("webkit_missing_count", script)
        self.assertIn("WEBKIT_MISSING_CONFIRMATIONS", script)
        self.assertIn('reason="webkit-missing"', script)
        self.assertIn("last_recovery_epoch", script)
        self.assertIn("NOTIFY_REPLACE_ID", script)
        self.assertIn("--replace-id=", script)
        self.assertIn("pgrep -u \"$UID\" -f -- '[t]ermfleet.*--terminal-workspace-daemon$'", script)
        self.assertIn("daemon_pids=", script)
        self.assertNotIn("if (( daemon_count > 1 || socket_count > 1 )); then", script)
        self.assertIn("if (( socket_count > 1 )); then", script)
        self.assertIn("false daemon_processes=2 alert", script)
        self.assertIn("last_host_alert_epoch", script)
        self.assertIn('kill -- "-$recovery_pgid"', script)
        self.assertIn("host pressure detected; TermFleet desktop will not be recycled", script)
        self.assertNotIn("renderer memory is high; TermFleet desktop will remain running", script)
        self.assertIn("renderer is blocked; desktop group will be recycled and relaunched", script)
        self.assertIn('"$reason" == webkit-missing', script)
        self.assertNotIn('( "$reason" == webkit-* || "$reason" == desktop-* )', script)
        self.assertIn('"$DESKTOP_LAUNCHER" --agent', script)
        self.assertIn("daemon=preserved", script)
        self.assertIn("DESKTOP_LAUNCHER", script)
        self.assertNotIn("pkill", script)

    def test_watchdog_scopes_webkit_block_detection_to_the_termfleet_process_group(self):
        script = WATCHDOG.read_text()
        desktop_lookup = script.index('desktop_info=""')
        renderer_lookup = script.index('webkit_info=""', desktop_lookup)
        self.assertLess(desktop_lookup, renderer_lookup)
        self.assertIn('awk -v pgid="$desktop_pgid"', script)
        self.assertIn("$3 == pgid && $6 ~ /WebKitWebProcess/", script)
        self.assertNotIn("awk '$6 ~ /WebKitWebProcess/", script)

    def test_watchdog_requires_repeated_host_pressure_before_alerting(self):
        script = WATCHDOG.read_text()
        self.assertIn("host_memory_pressure_count=0", script)
        self.assertIn("host_io_pressure_count=0", script)
        self.assertIn("HOST_PRESSURE_CONFIRMATIONS", script)
        self.assertIn("host_memory_pressure_count >= HOST_PRESSURE_CONFIRMATIONS", script)
        self.assertIn("host_io_pressure_count >= HOST_PRESSURE_CONFIRMATIONS", script)
        self.assertIn(":-12", script)
        self.assertNotIn("elif awk -v value=\"$memory_psi\"", script)
        self.assertNotIn("elif awk -v value=\"$io_psi\"", script)

    def test_host_pressure_is_telemetry_only_and_cannot_trigger_user_actions(self):
        script = WATCHDOG.read_text()
        self.assertIn('if [[ -n "$reason" && "$reason" != host-* ]]; then', script)
        self.assertIn('last_incident_reason" != host-*', script)
        self.assertIn("Host-wide PSI is useful telemetry", script)
        self.assertIn("misleading TermFleet notification", script)
        self.assertIn('watchdog-heartbeat.txt', INCIDENT_SNAPSHOT.read_text())

    def test_watchdog_ignores_private_verifier_desktops(self):
        script = WATCHDOG.read_text()
        self.assertIn("is_production_desktop", script)
        self.assertIn('XDG_RUNTIME_DIR=/run/user/$UID', script)
        self.assertIn("/termfleet-desktop-", script)
        self.assertIn('pgrep -u "$UID" -x termfleet', script)

    def test_watchdog_has_a_user_service_and_safe_installer(self):
        service = SERVICE.read_text()
        installer = INSTALLER.read_text()
        self.assertIn("Restart=always", service)
        self.assertIn("termfleet-pressure-watchdog", service)
        self.assertIn("Environment=TERMFLEET_PRESSURE_WATCHDOG_RECOVER=1", service)
        self.assertIn("install -m 0755", installer)
        self.assertIn("systemctl --user enable --now termfleet-pressure-watchdog.service", installer)
        self.assertIn("systemctl --user try-restart termfleet-pressure-watchdog.service", installer)
        self.assertNotIn("systemctl --user stop", installer)

    def test_reaper_timer_exports_the_user_session_bus(self):
        installer = (ROOT / "scripts" / "install-reaper-timer.sh").read_text()
        self.assertIn("Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=$RUNTIME_DIR/bus", installer)

    def test_reaper_install_disables_the_legacy_memory_guard_timer(self):
        installer = (ROOT / "scripts" / "install-reaper-timer.sh").read_text()
        self.assertIn("termfleet-memory-guard.timer", installer)
        self.assertIn("disable --now", installer)


if __name__ == "__main__":
    unittest.main()
