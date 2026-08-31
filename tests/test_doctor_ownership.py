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

    def test_stale_canonical_daemon_is_reported_before_restart(self):
        self.assertIn('"Runtime release alignment"', DOCTOR)
        self.assertIn("do not restart or replace it while live sessions need preservation", DOCTOR)
        self.assertIn('report(\n      "warn",\n      "Runtime release alignment"', DOCTOR)

    def test_protocol_compatible_mixed_release_is_classified_as_safe_preservation(self):
        self.assertIn("termfleet-daemon-status.mjs", DOCTOR)
        self.assertIn("liveDaemonStatus?.protocolVersion === supportedDaemonProtocol", DOCTOR)
        self.assertIn("preserving live PTYs without replacement is safe", DOCTOR)

    def test_daemon_status_probe_uses_read_only_status_handshake(self):
        helper = (ROOT / "scripts" / "termfleet-daemon-status.mjs").read_text()
        self.assertIn('socket.end("status\\n")', helper)
        self.assertIn('"protocolVersion" in response', helper)

    def test_only_live_duplicate_provider_ids_are_warnings(self):
        self.assertIn("liveDuplicateIds", DOCTOR)
        self.assertIn("historical provider chat ID(s) have duplicate records", DOCTOR)
        self.assertIn("active provider chat ID(s) appear in multiple terminal records", DOCTOR)

    def test_codex_probe_accepts_current_event_stream_format(self):
        self.assertIn('' + '"event_msg"' + '', DOCTOR)
        self.assertIn('' + '"task_started"' + '', DOCTOR)


if __name__ == "__main__":
    unittest.main()
