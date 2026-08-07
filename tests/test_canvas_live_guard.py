"""Static guards for the live Canvas2D E2E harness."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "verify-canvas-live.sh"


class CanvasLiveGuardTests(unittest.TestCase):
    def test_live_harness_allocates_an_os_free_port(self):
        script = SCRIPT.read_text()
        self.assertIn('sock.bind(("127.0.0.1", 0))', script)
        self.assertIn('PORT="$CANVAS_LIVE_PORT"', script)
        self.assertNotIn('RANDOM % 1000', script)

    def test_live_harness_allows_a_cold_tauri_build_to_finish(self):
        script = SCRIPT.read_text()
        self.assertIn('APP_BUDGET="${APP_BUDGET:-360}"', script)


if __name__ == "__main__":
    unittest.main()
