import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "termfleet-performance-sampler.sh"


class PerformanceSamplerTests(unittest.TestCase):
    def test_once_writes_content_free_process_and_pressure_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["bash", str(SCRIPT), "--once", "--pid", str(os.getpid()),
                 "--output-dir", directory],
                check=True, capture_output=True, text=True,
            )
            self.assertEqual(result.stdout, "")
            rows = next(Path(directory).glob("desktop-samples-*.tsv")).read_text().splitlines()
            self.assertEqual(len(rows), 2)
            self.assertIn("host_cpu_some_avg10", rows[0])
            self.assertIn("ui_threads_top3", rows[0])
            self.assertEqual(len(rows[0].split("\t")), len(rows[1].split("\t")))
            self.assertIn(f"\t{os.getpid()}\t", f"\t{rows[1]}")

    def test_old_daily_samples_are_pruned(self):
        with tempfile.TemporaryDirectory() as directory:
            old = Path(directory) / "desktop-samples-2000-01-01.tsv"
            old.write_text("expired\n")
            os.utime(old, (time.time() - 3 * 86400, time.time() - 3 * 86400))
            subprocess.run(
                ["bash", str(SCRIPT), "--once", "--pid", str(os.getpid()),
                 "--retention-minutes", "2880", "--output-dir", directory],
                check=True, capture_output=True, text=True,
            )
            self.assertFalse(old.exists())


if __name__ == "__main__":
    unittest.main()
