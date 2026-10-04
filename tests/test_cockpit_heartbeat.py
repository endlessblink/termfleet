"""TC-199: replay watchdog health decisions without touching live processes."""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/termfleet-pressure-watchdog.sh'


def decision(now, started, written, previous=0, cpu=0, owner=123, pid=123):
    source = SCRIPT.read_text()
    if 'cockpit_heartbeat_decision() {' in source:
        function = 'cockpit_heartbeat_decision() {' + source.split('cockpit_heartbeat_decision() {', 1)[1].split('\nrun_incident_audit() {', 1)[0]
        shell = function + '\ncockpit_heartbeat_decision "$pid" "$started" "$now" "$written" "$previous" "$cpu" "$owner"'
    else:
        # Execute the actual old branch, preserving its production defaults.
        condition = source.split('elif [[ "$desktop_age_seconds"', 1)[1].split('elif (( desktop_blocked_count', 1)[0]
        shell = 'reason=""; if [[ "$desktop_age_seconds"' + condition + 'fi\nif [[ "$reason" == cockpit-heartbeat-stale ]]; then echo stale; else echo fresh; fi'
    settings = '\n'.join(line for line in source.splitlines() if line.startswith('COCKPIT_HEARTBEAT_'))
    shell = settings + '\n' + shell
    clean_env = {k:v for k,v in os.environ.items() if not k.startswith('TERMFLEET_PRESSURE_WATCHDOG_')}
    result = subprocess.run(['bash', '-c', shell], env={
        **clean_env, 'pid': str(pid), 'started': str(started), 'now': str(now),
        'written': str(written), 'previous': str(previous), 'cpu': str(cpu), 'owner': str(owner),
        'desktop_age_seconds': str(now-started), 'cockpit_heartbeat_age': str(now-written),
        'desktop_pid': str(pid), 'desktop_pgid': '321', 'COCKPIT_SNAPSHOT_PATH': '/unused',
        'COCKPIT_HEARTBEAT_STALE_SECONDS': '90' if 'cockpit_heartbeat_decision() {' in source else '45',
        'COCKPIT_HEARTBEAT_STARTUP_GRACE_SECONDS': '180' if 'cockpit_heartbeat_decision() {' in source else '60',
        'COCKPIT_HEARTBEAT_CONFIRMATIONS': '3', 'COCKPIT_HEARTBEAT_BUSY_GRACE_SECONDS': '180',
    }, capture_output=True, text=True, check=True, timeout=5)
    return result.stdout.strip().split()[0]


class CockpitHeartbeatTests(unittest.TestCase):
    def test_old_snapshot_cannot_recycle_new_desktop(self):
        self.assertNotEqual(decision(1140, 1000, 999, previous=100), 'stale')

    def test_even_after_startup_grace_old_owner_is_not_current_evidence(self):
        self.assertNotEqual(decision(1400, 1000, 1390, previous=100, owner=122), 'stale')
        self.assertNotEqual(decision(1400, 1000, 900, previous=100), 'stale')

    def test_sixty_second_write_stall_never_recycles(self):
        for elapsed in range(0, 61, 5):
            self.assertNotEqual(decision(2000+elapsed, 1000, 2000, previous=20), 'stale')

    def test_first_stale_poll_needs_confirmation(self):
        self.assertNotEqual(decision(2100, 1000, 2000), 'stale')

    def test_second_stale_poll_needs_confirmation(self):
        self.assertNotEqual(decision(2105, 1000, 2000, previous=1), 'stale')

    def test_confirmed_stall_can_still_trigger_recovery(self):
        self.assertEqual(decision(2110, 1000, 2000, previous=2), 'stale')

    def test_busy_renderer_gets_longer_grace(self):
        self.assertNotEqual(decision(2179, 1000, 2000, previous=30, cpu=1), 'stale')
        self.assertEqual(decision(2180, 1000, 2000, previous=30, cpu=1), 'stale')

    def test_startup_gets_180_seconds_grace(self):
        self.assertNotEqual(decision(1179, 1000, 1001, previous=30), 'stale')

    def test_fresh_write_clears_stale_streak(self):
        self.assertEqual(decision(2000, 1000, 1999, previous=30), 'fresh')

    def test_future_mtime_is_not_failure_evidence(self):
        self.assertNotEqual(decision(2000, 1000, 2010, previous=30), 'stale')

    def test_no_desktop_cannot_recycle(self):
        self.assertNotEqual(decision(2000, 0, 0, previous=30, pid=0), 'stale')

    def test_notification_describes_missing_snapshot_without_claiming_blocked(self):
        source = SCRIPT.read_text()
        decision_source = source[source.index('      recovery_text='):source.index('      if command -v notify-send')]
        result = subprocess.run(['bash', '-c', decision_source + '\nprintf "%s" "$recovery_text"'],
            env={'RECOVER':'0', 'recovery_allowed':'1', 'desktop_pgid':'321', 'webkit_pgid':'321', 'reason':'cockpit-heartbeat-stale'},
            capture_output=True, text=True, check=True)
        self.assertIn('snapshot not updated', result.stdout)
        self.assertNotIn('renderer is blocked', result.stdout)

if __name__ == '__main__':
    unittest.main()
