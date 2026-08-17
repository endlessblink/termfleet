import json
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts" / "directive-codex-stop-guard.mjs"
HOOKS = ROOT / ".codex" / "hooks.json"


class DirectiveValidationGuardTests(unittest.TestCase):
    def test_stop_hook_routes_through_project_guard(self):
        hooks = json.loads(HOOKS.read_text())
        command = hooks["hooks"]["Stop"][0]["hooks"][0]["command"]
        self.assertIn("scripts/directive-codex-stop-guard.mjs", command)

    def test_incomplete_run_returns_block_instead_of_enoent(self):
        payload = {
            "projectRoot": str(ROOT),
            "sessionId": "01a00985-9ea9-7c23-bd20-a1be5526f6de",
        }
        result = subprocess.run(
            ["node", str(GUARD)],
            cwd=ROOT,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
        )
        response = json.loads(result.stdout)
        self.assertEqual(response["decision"], "block")
        self.assertIn("verification", response["reason"])
        self.assertNotIn("ENOENT", result.stdout)

    def test_unregistered_session_returns_block_instead_of_falling_through(self):
        payload = {
            "projectRoot": str(ROOT),
            "sessionId": "session-that-is-not-registered",
        }
        result = subprocess.run(
            ["node", str(GUARD)],
            cwd=ROOT,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
        )
        response = json.loads(result.stdout)
        self.assertEqual(response["decision"], "block")
        self.assertIn("unavailable", response["reason"])


if __name__ == "__main__":
    unittest.main()
