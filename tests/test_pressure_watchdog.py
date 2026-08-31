"""Static safety checks for the host-pressure watchdog."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / "scripts" / "termfleet-pressure-watchdog.sh"
INSTALLER = ROOT / "scripts" / "install-pressure-watchdog.sh"
LOAD_SHED = ROOT / "scripts" / "termfleet-load-shed.sh"
SERVICE = ROOT / "systemd" / "termfleet-pressure-watchdog.service"
INCIDENT_HELPER = ROOT / "scripts" / "termfleet-incident-log.sh"


class PressureWatchdogTests(unittest.TestCase):
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
        self.assertIn("termfleet-load-shed.sh", installer)
        release_installer = (ROOT / "scripts" / "install-release.sh").read_text()
        self.assertIn("termfleet-pressure-watchdog.sh", release_installer)
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

    def test_desktop_d_state_needs_strong_io_corroboration_before_recycle(self):
        script = WATCHDOG.read_text()
        self.assertIn("DESKTOP_BLOCKED_IO_THRESHOLD", script)
        self.assertIn("desktop_blocked_io_confirmed", script)
        self.assertIn("desktop_blocked_io_confirmed == 1", script)

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
        self.assertIn('( "$reason" == webkit-blocked || "$reason" == desktop-blocked )', script)
        self.assertNotIn('( "$reason" == webkit-* || "$reason" == desktop-* )', script)
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
        self.assertIn("Environment=TERMFLEET_PRESSURE_WATCHDOG_RECOVER=0", service)
        self.assertIn("install -m 0755", installer)
        self.assertIn("systemctl --user enable --now termfleet-pressure-watchdog.service", installer)
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
