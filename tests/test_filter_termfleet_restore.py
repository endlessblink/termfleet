import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "filter-termfleet-restore.py"
SPEC = importlib.util.spec_from_file_location("filter_termfleet_restore", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class RestoreSuppressionTests(unittest.TestCase):
    def test_filters_every_closed_workspace_but_preserves_open_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "fleet.toml"
            workspace = root / "workspace.json"
            output = root / "filtered.toml"
            manifest.write_text(
                """[[session]]\nname = \"paper-bot\"\ncwd = \"/work/paper\"\nagent = \"codex\"\nhost = \"termfleet\"\npin = \"last\"\n\n[[session]]\nname = \"arthouse\"\ncwd = \"/work/arthouse\"\nagent = \"codex\"\nhost = \"termfleet\"\npin = \"last\"\n\n[[session]]\nname = \"open\"\ncwd = \"/work/open\"\nagent = \"codex\"\nhost = \"termfleet\"\npin = \"last\"\n""",
                encoding="utf-8",
            )
            workspace.write_text(
                json.dumps({
                    "tabs": [{"initialCwd": "/work/paper"}],
                    "closedRestoreTargets": [{"cwd": "/work/arthouse"}],
                }),
                encoding="utf-8",
            )

            suppressed = MODULE.filter_manifest(manifest, workspace, output)

            self.assertEqual(suppressed, ["paper-bot", "arthouse"])
            filtered = output.read_text(encoding="utf-8")
            self.assertNotIn("paper-bot", filtered)
            self.assertNotIn("arthouse", filtered)
            self.assertIn('name = "open"', filtered)

    def test_does_not_launch_a_manifest_workspace_already_present_in_saved_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "fleet.toml"
            workspace = root / "workspace.json"
            output = root / "filtered.toml"
            manifest.write_text(
                """[[session]]\nname = \"represented\"\ncwd = \"/work/represented\"\n\n[[session]]\nname = \"unrepresented\"\ncwd = \"/work/unrepresented\"\n""",
                encoding="utf-8",
            )
            workspace.write_text(
                json.dumps({"tabs": [{"initialCwd": "/work/represented/"}]}),
                encoding="utf-8",
            )

            suppressed = MODULE.filter_manifest(manifest, workspace, output)

            self.assertEqual(suppressed, ["represented"])
            filtered = output.read_text(encoding="utf-8")
            self.assertNotIn('name = "represented"', filtered)
            self.assertIn('name = "unrepresented"', filtered)

    def test_legacy_recovered_tab_is_not_reclassified_or_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "fleet.toml"
            workspace = root / "workspace.json"
            output = root / "filtered.toml"
            manifest.write_text(
                '[[session]]\nname = "legacy"\ncwd = "/work/legacy"\n',
                encoding="utf-8",
            )
            original = {
                "tabs": [{
                    "id": "recovered-tab-legacy",
                    "title": "legacy",
                    "initialCwd": "/work/legacy",
                    "terminals": [{"id": "raw-session-id"}],
                }],
            }
            workspace.write_text(json.dumps(original), encoding="utf-8")

            suppressed = MODULE.filter_manifest(manifest, workspace, output)

            self.assertEqual(suppressed, ["legacy"])
            self.assertEqual(json.loads(workspace.read_text(encoding="utf-8")), original)
            self.assertNotIn("closedRestoreTargets", json.loads(workspace.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
