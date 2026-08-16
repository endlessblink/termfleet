"""Agent status hooks must be directly executable by provider hook runners."""

import pathlib
import stat
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class AgentHookPermissionTests(unittest.TestCase):
    def test_provider_status_hooks_are_executable(self):
        hooks = (
            ROOT / "scripts" / "termfleet-claude-status-hook.mjs",
            ROOT / "scripts" / "termfleet-codex-status-hook.mjs",
        )
        for hook in hooks:
            with self.subTest(hook=hook.name):
                self.assertTrue(hook.exists(), hook)
                self.assertTrue(
                    hook.stat().st_mode & stat.S_IXUSR,
                    f"{hook} must be executable for direct UserPromptSubmit invocation",
                )


if __name__ == "__main__":
    unittest.main()
