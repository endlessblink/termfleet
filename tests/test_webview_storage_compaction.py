"""Launch-time WebKit storage compaction (TF-015, 2026-09-29).

WebKit's localStorage write-ahead log grew to ~80 MB and the cockpit never left
its splash screen. The desktop launcher now checkpoints and truncates that log
before every window start when it is over budget. These tests run the real
launcher function against a real SQLite database in WAL mode.
"""
import os
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "termfleet-desktop-launcher.sh"


def launcher_function() -> str:
    text = LAUNCHER.read_text()
    match = re.search(r"^termfleet_compact_webview_storage\(\) \{\n.*?^\}\n", text, re.S | re.M)
    assert match, "termfleet_compact_webview_storage() not found in the launcher"
    return match.group(0)


def make_bloated_store(directory: pathlib.Path, megabytes: int) -> tuple[pathlib.Path, sqlite3.Connection]:
    db_path = directory / "tauri_localhost_0.localstorage"
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA wal_autocheckpoint=0")
    db.execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL)")
    blob = b"x" * 1_000_000
    for i in range(megabytes):
        db.execute("INSERT INTO ItemTable VALUES (?, ?)", ("termfleet.gamification.v6", blob + str(i).encode()))
        db.commit()
    db.execute("INSERT INTO ItemTable VALUES (?, ?)", ("terminal-workspace.v1", b'{"tabs":[1,2,3]}'))
    db.commit()
    return db_path, db


def run_compaction(directory: pathlib.Path, log: pathlib.Path, limit_kb: int) -> subprocess.CompletedProcess[str]:
    script = (
        'termfleet_incident_record() { printf "incident %s %s\\n" "$1" "$2" >>"$LOG_FILE"; }\n'
        + launcher_function()
        + "termfleet_compact_webview_storage\n"
    )
    env = dict(os.environ, LOG_FILE=str(log), TERMFLEET_WEBVIEW_STORAGE_DIR=str(directory),
               TERMFLEET_STORAGE_LOG_LIMIT_KB=str(limit_kb))
    return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=60)


class WebviewStorageCompactionTests(unittest.TestCase):
    def test_an_oversized_log_is_folded_back_and_data_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as crashed:
            live_dir = pathlib.Path(tmp)
            live_db, writer = make_bloated_store(live_dir, megabytes=24)
            # Snapshot the files while the writer still holds them, like a
            # cockpit that was killed mid-session: the oversized log stays behind.
            directory = pathlib.Path(crashed)
            for suffix in ("", "-wal", "-shm"):
                source = live_db.with_name(live_db.name + suffix)
                (directory / source.name).write_bytes(source.read_bytes())
            writer.close()
            db_path = directory / live_db.name
            wal = db_path.with_name(db_path.name + "-wal")
            self.assertGreater(wal.stat().st_size, 20_000_000)

            log = directory / "launch.log"
            result = run_compaction(directory, log, limit_kb=16_384)
            self.assertEqual(result.returncode, 0, result.stderr)

            self.assertTrue(not wal.exists() or wal.stat().st_size == 0, "log was not truncated")
            self.assertIn("storage_compacted", log.read_text())
            db = sqlite3.connect(db_path)
            rows = dict(db.execute("SELECT key, length(value) FROM ItemTable"))
            db.close()
            self.assertEqual(rows["terminal-workspace.v1"], len(b'{"tabs":[1,2,3]}'))
            self.assertGreater(rows["termfleet.gamification.v6"], 1_000_000)

    def test_a_small_log_is_left_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = pathlib.Path(tmp)
            db_path, writer = make_bloated_store(directory, megabytes=1)
            log = directory / "launch.log"
            result = run_compaction(directory, log, limit_kb=16_384)
            writer.close()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(log.exists() and "storage_compacted" in log.read_text())

    def test_every_window_start_runs_the_compaction(self):
        text = LAUNCHER.read_text()
        child = text[text.index('if [[ "${1:-}" == "--child" ]]; then\n  termfleet_incident_record "desktop_launch"'):]
        self.assertIn("termfleet_compact_webview_storage", child[: child.index("daemon_socket=")])


if __name__ == "__main__":
    unittest.main()
