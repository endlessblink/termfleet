"""The recovery coordinator must be conservative and race-safe by construction."""

import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
COORDINATOR = ROOT / "scripts" / "termfleet-recovery-coordinator.mjs"


class RecoveryCoordinatorTests(unittest.TestCase):
    def run_coordinator(self, root, *args, daemon_sessions=None, codex_lock_root=None):
        env = {"TERMFLEET_DATA_ROOT": str(root), "TERMFLEET_RECOVERY_PROJECTS_JSON": json.dumps([["demo", "/projects/demo"]]), "TERMFLEET_RECOVERY_SKIP_DAEMON_IDENTITY": "1"}
        if daemon_sessions is not None:
            env.pop("TERMFLEET_RECOVERY_SKIP_DAEMON_IDENTITY")
            env["TERMFLEET_RECOVERY_DAEMON_SESSIONS_JSON"] = json.dumps(daemon_sessions)
        if codex_lock_root is not None:
            env["TERMFLEET_CODEX_LOCK_ROOT"] = str(codex_lock_root)
        return subprocess.run(["node", str(COORDINATOR), *args], env={**os.environ, **env}, capture_output=True, text=True, check=False)

    def test_selects_latest_non_killed_provider_and_never_mutates_in_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-old.json").write_text(json.dumps({"paneId": "pane-old", "sessionId": "provider-old", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 10, "turnEventAt": 10}))
            (root / "agent-status" / "pane-new.json").write_text(json.dumps({"paneId": "pane-new", "sessionId": "provider-new", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text(json.dumps({"id": "pane-old", "kind": "recovery-held-review", "reason": "intentional-kill", "userRequested": True, "atMs": 11}) + "\n")
            workspace = {"tabs": [], "closedSessionIds": [], "closedProviderSessionIds": []}
            workspace_path = root / "workspace.json"
            workspace_path.write_text(json.dumps(workspace))

            result = self.run_coordinator(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)["plan"][0]
            self.assertEqual(plan["selected"]["providerSessionId"], "provider-new")
            self.assertEqual(json.loads(workspace_path.read_text()), workspace)

    def test_legacy_provider_tombstone_cache_does_not_block_recovery_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": ["provider"]}))

            result = self.run_coordinator(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["plan"][0]["selected"]["providerSessionId"], "provider")

    def test_explicit_provider_kill_event_blocks_provider_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text(json.dumps({"id": "old-pane", "providerSessionId": "provider", "kind": "recovery-held-review", "reason": "intentional-kill", "userRequested": True, "atMs": 21}) + "\n")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["decisions"][0]["decision"], "hold-provider-tombstone")

    def test_recovery_preserves_agent_type_instead_of_inferring_from_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))
            plan = json.loads(self.run_coordinator(root).stdout)["plan"][0]["selected"]
            self.assertEqual(plan["provider"], "claude")
            self.assertEqual(plan["decision"], "restore-exact")
            self.assertEqual(plan["exactResume"], "claude --resume provider")

    def test_explicit_kill_is_listed_for_manual_exact_restore_but_not_auto_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text(json.dumps({"id": "pane", "kind": "recovery-held-review", "reason": "intentional-kill", "userRequested": True, "atMs": 21}) + "\n")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["manualRestoreAvailable"][0]["decision"], "manual-restore-only")
            self.assertEqual(plan["manualRestoreAvailable"][0]["exactResume"], "codex resume provider")

    def test_unknown_provider_is_held_instead_of_defaulting_to_codex(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "other", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[{"id": "pane-one", "cwd": "/projects/demo"}, {"id": "pane-two", "cwd": "/projects/demo"}]).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["decisions"][0]["decision"], "hold-missing-provider-identity")
            self.assertIsNone(plan["decisions"][0]["exactResume"])

    def test_duplicate_provider_owner_is_held_for_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            for name, pane, timestamp in (("one", "pane-one", 20), ("two", "pane-two", 19)):
                (root / "agent-status" / f"pane-{name}.json").write_text(json.dumps({"paneId": pane, "sessionId": "provider", "provider": "codex", "cwd": "/projects/demo", "updatedAt": timestamp, "turnEventAt": timestamp}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[{"id": "pane-one", "cwd": "/projects/demo"}, {"id": "pane-two", "cwd": "/projects/demo"}]).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertTrue(all(row["decision"] == "hold-duplicate-provider-owner" for row in plan["decisions"]))

    def test_newer_ambiguous_pane_does_not_fall_back_to_an_older_chat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-new.json").write_text(json.dumps({"paneId": "pane-new", "sessionId": "new-provider", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 30, "turnEventAt": 30}))
            (root / "agent-status" / "pane-old.json").write_text(json.dumps({"paneId": "pane-old", "sessionId": "old-provider", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[{"id": "pane-new", "cwd": "/projects/other"}]).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["decisions"][0]["decision"], "hold-identity-mismatch")
            self.assertEqual(plan["ownerTransfers"][0]["providerSessionId"], "new-provider")
            self.assertEqual(plan["ownerTransfers"][0]["currentOwnerCwd"], "/projects/other")
            self.assertEqual(plan["ownerTransfers"][0]["targetCwd"], "/projects/demo")

    def test_provider_writer_lock_blocks_exact_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            lock_root = root / "locks"
            lock_root.mkdir()
            provider_id = "provider-session-1"
            (lock_root / f"{provider_id}.lock").write_text("")
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": provider_id, "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, codex_lock_root=lock_root).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["decisions"][0]["decision"], "hold-provider-writer-lock")

    def test_unheld_old_provider_writer_lock_is_reclaimed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            lock_root = root / "locks"
            lock_root.mkdir()
            provider_id = "provider-session-old-lock"
            lock = lock_root / f"{provider_id}.lock"
            lock.write_text("")
            old = time.time() - 120
            os.utime(lock, (old, old))
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": provider_id, "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, codex_lock_root=lock_root).stdout)["plan"][0]

            self.assertEqual(plan["selected"]["providerSessionId"], provider_id)
            self.assertFalse(plan["decisions"][0]["providerWriterLocked"])

    def test_apply_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))
            result = self.run_coordinator(root, "--apply")
            self.assertEqual(result.returncode, 2)
            self.assertIn("Refusing --apply", result.stderr)

    def test_concurrent_dry_runs_are_read_only_and_consistent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            workspace = {"tabs": [], "closedSessionIds": [], "closedProviderSessionIds": []}
            workspace_path = root / "workspace.json"
            workspace_path.write_text(json.dumps(workspace))
            with ThreadPoolExecutor(max_workers=8) as pool:
                runs = list(pool.map(lambda _: self.run_coordinator(root), range(16)))
            self.assertTrue(all(run.returncode == 0 for run in runs), [run.stderr for run in runs])
            plans = [json.loads(run.stdout)["plan"] for run in runs]
            self.assertTrue(all(plan == plans[0] for plan in plans[1:]))
            self.assertEqual(json.loads(workspace_path.read_text()), workspace)

    def test_daemon_identity_mismatch_is_not_relabelled_as_a_project(self):
        source = COORDINATOR.read_text()
        self.assertIn("identityMismatch", source)
        self.assertIn("candidate.identityMismatch", source)
        self.assertIn("TERM FLEET_RECOVERY_SKIP_DAEMON_IDENTITY".replace(" ", ""), source)

    def test_provider_command_mismatch_is_held_instead_of_resuming_wrong_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "claude-session", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[{"id": "pane", "cwd": "/projects/demo", "command": "codex resume claude-session"}]).stdout)["plan"][0]

            self.assertIsNone(plan["selected"])
            self.assertEqual(plan["decisions"][0]["decision"], "hold-identity-mismatch")
            self.assertEqual(plan["decisions"][0]["daemonProvider"], "codex")

    def test_persisted_duplicate_record_with_null_pid_does_not_block_live_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-live.json").write_text(json.dumps({"paneId": "pane-live", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "agent-status" / "pane-stale.json").write_text(json.dumps({"paneId": "pane-stale", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 19, "turnEventAt": 19}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[
                {"id": "pane-live", "cwd": "/projects/demo", "command": "claude --resume provider", "pid": 1234},
                {"id": "pane-stale", "cwd": "/projects/demo", "command": "claude --resume provider", "pid": None},
            ]).stdout)["plan"][0]

            self.assertEqual(plan["selected"]["paneId"], "pane-live")
            self.assertEqual(plan["selected"]["decision"], "restore-exact")

    def test_unique_live_provider_owner_can_be_found_by_conversation_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-stale.json").write_text(json.dumps({"paneId": "pane-stale", "sessionId": "claude-session", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[
                {"id": "recovered-owner", "cwd": "/projects/demo", "command": "claude --resume claude-session", "pid": 1234},
            ]).stdout)["plan"][0]

            self.assertEqual(plan["selected"]["providerSessionId"], "claude-session")
            self.assertEqual(plan["selected"]["providerOwner"]["sessionId"], "recovered-owner")

    def test_exact_live_owner_is_not_blocked_by_its_own_writer_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            lock_root = root / "locks"
            lock_root.mkdir()
            provider_id = "provider-session-1"
            (lock_root / f"{provider_id}.lock").write_text("")
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": provider_id, "provider": "codex", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text("")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root, daemon_sessions=[{"id": "pane", "cwd": "/projects/demo", "command": f"codex resume {provider_id}", "pid": 1234}], codex_lock_root=lock_root).stdout)["plan"][0]

            self.assertEqual(plan["selected"]["decision"], "restore-exact")

    def test_legacy_intentional_kill_marker_without_user_intent_does_not_tombstone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "agent-status").mkdir()
            (root / "sessions").mkdir()
            (root / "agent-status" / "pane-demo.json").write_text(json.dumps({"paneId": "pane", "sessionId": "provider", "provider": "claude", "cwd": "/projects/demo", "updatedAt": 20, "turnEventAt": 20}))
            (root / "sessions" / "terminal-lifecycle.jsonl").write_text(json.dumps({"id": "pane", "kind": "recovery-held-review", "reason": "intentional-kill", "atMs": 21}) + "\n")
            (root / "workspace.json").write_text(json.dumps({"closedSessionIds": [], "closedProviderSessionIds": []}))

            plan = json.loads(self.run_coordinator(root).stdout)["plan"][0]

            self.assertEqual(plan["selected"]["providerSessionId"], "provider")
            self.assertEqual(plan["selected"]["decision"], "restore-exact")

    def test_workspace_hydration_replays_transfer_marker_before_live_reconcile(self):
        source = (ROOT / "src" / "stores" / "workspace.ts").read_text()
        self.assertIn("baseTabs = applyRecoveryTransfers(baseTabs, recoveryTransfers)", source)
        self.assertIn("recoveryTransfers,\n    });", source)
        self.assertIn("providerSessionId: terminal.providerSessionId", source)
