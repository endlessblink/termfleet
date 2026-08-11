"""Keep build and verifier process ownership visible under desktop load."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class BuildPressureGuardTests(unittest.TestCase):
    def read(self, name: str) -> str:
        return (ROOT / "scripts" / name).read_text()

    def test_release_build_is_serialized_and_deprioritized(self):
        script = self.read("install-release.sh")
        self.assertIn('BUILD_LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/termfleet-build.lock"', script)
        self.assertIn("flock -n 9", script)
        self.assertIn("CARGO_BUILD_JOBS=\"${CARGO_BUILD_JOBS:-1}\"", script)
        self.assertIn("ionice -c 3 nice -n", script)

    def test_standalone_verifier_owns_build_and_app_process_groups(self):
        script = self.read("verify-standalone-daemon-smoke.sh")
        self.assertIn('BUILD_PID=""', script)
        self.assertIn('kill -- "-$BUILD_PID"', script)
        self.assertIn('setsid ionice -c 3 nice -n', script)
        self.assertIn('kill -- "-$APP_PID"', script)
        self.assertIn('exec 9>"$BUILD_LOCK_FILE"', script)

    def test_performance_verifier_cleans_the_entire_private_app_group(self):
        script = self.read("verify-tauri-performance.sh")
        self.assertIn('setsid env DISPLAY=', script)
        self.assertIn('kill -- "-$APP_PID"', script)


if __name__ == "__main__":
    unittest.main()
