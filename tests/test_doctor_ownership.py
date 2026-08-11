import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCTOR = (ROOT / "scripts" / "termfleet-doctor.mjs").read_text()


class DoctorOwnershipTests(unittest.TestCase):
    def test_canonical_daemon_count_uses_socket_listener_pids(self):
        self.assertIn('ps", ["-eo", "pid=,args="]', DOCTOR)
        self.assertIn("canonicalListenerPids", DOCTOR)
        self.assertIn("canonicalListenerPids.has(row.pid)", DOCTOR)

    def test_private_verifier_daemons_are_reported_separately(self):
        self.assertIn('"Private verifier daemons"', DOCTOR)
        self.assertIn("outside the canonical socket", DOCTOR)

    def test_only_live_duplicate_provider_ids_are_warnings(self):
        self.assertIn("liveDuplicateIds", DOCTOR)
        self.assertIn("historical provider chat ID(s) have duplicate records", DOCTOR)
        self.assertIn("active provider chat ID(s) appear in multiple terminal records", DOCTOR)

    def test_codex_probe_accepts_current_event_stream_format(self):
        self.assertIn('' + '"event_msg"' + '', DOCTOR)
        self.assertIn('' + '"task_started"' + '', DOCTOR)


if __name__ == "__main__":
    unittest.main()
