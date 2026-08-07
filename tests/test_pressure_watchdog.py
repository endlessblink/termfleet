"""Static safety checks for the host-pressure watchdog."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / "scripts" / "termfleet-pressure-watchdog.sh"
INSTALLER = ROOT / "scripts" / "install-pressure-watchdog.sh"
SERVICE = ROOT / "systemd" / "termfleet-pressure-watchdog.service"


class PressureWatchdogTests(unittest.TestCase):
    def test_watchdog_recycles_only_the_desktop_group_and_preserves_the_daemon(self):
        script = WATCHDOG.read_text()
        self.assertIn("WebKitWebProcess", script)
        self.assertIn("/proc/pressure/memory", script)
        self.assertIn("/proc/pressure/io", script)
        self.assertIn("pressure-alert.prompt", script)
        self.assertIn("NOTIFY_BUS", script)
        self.assertIn('signature="$reason"', script)
        self.assertIn("TERMFLEET_PRESSURE_WATCHDOG_RECOVER", script)
        self.assertIn("ALERT_COOLDOWN_SECONDS", script)
        self.assertIn("HOST_ALERT_COOLDOWN_SECONDS", script)
        self.assertIn("NOTIFY_REPLACE_ID", script)
        self.assertIn("--replace-id=", script)
        self.assertIn("last_host_alert_epoch", script)
        self.assertIn('kill -- "-$webkit_pgid"', script)
        self.assertIn("host pressure detected; TermFleet desktop will not be recycled", script)
        self.assertIn("renderer pressure detected; desktop group will be recycled", script)
        self.assertIn("daemon=preserved", script)
        self.assertIn("DESKTOP_LAUNCHER", script)
        self.assertNotIn("pkill", script)

    def test_watchdog_has_a_user_service_and_safe_installer(self):
        service = SERVICE.read_text()
        installer = INSTALLER.read_text()
        self.assertIn("Restart=always", service)
        self.assertIn("termfleet-pressure-watchdog", service)
        self.assertIn("install -m 0755", installer)
        self.assertIn("systemctl --user enable --now termfleet-pressure-watchdog.service", installer)
        self.assertNotIn("systemctl --user stop", installer)


if __name__ == "__main__":
    unittest.main()
