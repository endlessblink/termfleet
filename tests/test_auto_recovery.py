"""Startup recovery must not depend on a user clicking each recovered card."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SIDEBAR = ROOT / "src/components/WorkbenchSidebar.tsx"
WORKSPACE = ROOT / "src/stores/workspace.ts"


class AutomaticRecoveryTests(unittest.TestCase):
    def test_sidebar_starts_saved_agent_recovery_once(self):
        source = SIDEBAR.read_text()
        self.assertIn("autoRecoveryAttemptedRef", source)
        self.assertIn("void reconnectAgentPanes()", source)
        self.assertIn("autoRecoveryAttemptedRef.current = true", source)

    def test_recovered_sessions_reconcile_into_project_groups(self):
        source = WORKSPACE.read_text()
        self.assertIn("liveGitRoots", source)
        self.assertIn("reconcileProjectGroups(restoredTabs", source)
        self.assertIn("reconcileProjectGroups(tabs, state.groups", source)

    def test_manual_close_is_persisted_while_live_orphans_reconcile_into_saved_layout(self):
        source = WORKSPACE.read_text()
        self.assertIn("closedSessionIds", source)
        self.assertIn("closedSessionIds: state.closedSessionIds", source)
        self.assertIn("closedSessionIds.has(session.id)", source)
        self.assertIn("saved layout", source)
        self.assertIn("Reconcile every live session against the saved layout", source)
        self.assertNotIn("if (hadSavedLayout) continue", source)

    def test_normal_restart_does_not_label_every_saved_terminal_as_recovery(self):
        source = WORKSPACE.read_text()
        snapshot = source.split('function persistedTerminalSnapshot(terminal: TerminalState): TerminalState', 1)[1].split('function withRestartableTerminals', 1)[0]
        restart = source.split('function withRestartableTerminals', 1)[1].split('function isLegacyAnonymousRecoveredTab', 1)[0]
        self.assertIn('status: "starting",', snapshot)
        self.assertNotIn('Session will reconnect if the backend is still running; otherwise it will restart.', snapshot)
        self.assertIn('status: "starting",', restart)
        self.assertNotIn('Session was restored from workspace metadata.', restart)

    def test_explicit_restore_clears_the_close_tombstone(self):
        source = WORKSPACE.read_text()
        self.assertIn("closedSessionIds: remainingClosedSessionIds", source)
        self.assertIn("restoredTab.terminals.map((terminal) => terminal.id)", source)

    def test_disk_layout_restores_closed_session_tombstones(self):
        source = WORKSPACE.read_text()
        self.assertIn("disk.closedSessionIds", source)
        self.assertIn("closedSessionIds: [...closedSessionIds]", source)

    def test_disk_layout_writes_are_serialized_to_prevent_stale_rollback(self):
        source = WORKSPACE.read_text()
        self.assertIn("let diskMirrorQueue: Promise<void> = Promise.resolve()", source)
        self.assertIn("diskMirrorQueue = diskMirrorQueue", source)
        self.assertIn("await invoke(\"workspace_layout_save\"", source)

    def test_empty_saved_layout_is_not_treated_as_missing_state(self):
        source = WORKSPACE.read_text()
        self.assertIn("if (Array.isArray(disk.tabs))", source)
        self.assertIn("Array.isArray(persisted.tabs)", source)

    def test_desktop_close_waits_for_the_durable_snapshot(self):
        source = WORKSPACE.read_text()
        self.assertIn("onCloseRequested", source)
        self.assertIn("event.preventDefault()", source)
        self.assertIn("await flushWorkspacePersistence()", source)
        self.assertIn('await invoke("exit_application")', source)
        self.assertNotIn("await appWindow.destroy()", source)

    def test_operator_close_flushes_tombstone_before_killing_the_pty(self):
        source = WORKSPACE.read_text()
        close = source.split("closeTerminalSession: async", 1)[1].split("restoreLastClosed:", 1)[0]
        self.assertIn("closedSessionIds:", close)
        self.assertIn("manualStopRequested: true", close)
        self.assertIn("await flushWorkspacePersistence();", close)
        self.assertIn("await killPtys(", close)
        self.assertLess(
            close.index("await flushWorkspacePersistence();"),
            close.index("await killPtys("),
        )

    def test_split_pane_close_flushes_tombstone_before_killing_the_pty(self):
        source = WORKSPACE.read_text()
        close = source.split("export async function closeActivePane()", 1)[1].split("async function isDaemonReachable", 1)[0]
        self.assertIn("store.closePane(tab.id, tab.activePaneId);", close)
        self.assertIn("await flushWorkspacePersistence();", close)
        self.assertIn("await killPty(paneTerminal.id, invoke);", close)
        self.assertLess(
            close.index("await flushWorkspacePersistence();"),
            close.index("await killPty(paneTerminal.id, invoke);"),
        )

    def test_desktop_does_not_mirror_stale_cache_before_disk_hydration(self):
        source = WORKSPACE.read_text()
        self.assertIn("const needsDiskHydration =", source)
        self.assertIn("!FORCE_WORKSPACE_RESET_STATE;", source)
        self.assertIn("if (isTauriRuntime() && !needsDiskHydration && Array.isArray(persisted.tabs))", source)
        self.assertIn("persistWorkspaceSnapshot(buildPersistedSnapshot(useWorkspaceStore.getState()))", source)

    def test_recovered_sessions_can_attach_using_their_existing_daemon_id(self):
        split_pane = (ROOT / "src/components/SplitPane.tsx").read_text()
        restore = (ROOT / "scripts/restore-live-terminals.mjs").read_text()
        self.assertIn("attachToPtyId={paneTerminal?.id ?? null}", split_pane)
        self.assertIn("recovered-pane-${session.id}", restore)
        self.assertIn("if (!parts)", restore)

    def test_live_restore_honors_explicit_closed_workspace_identity(self):
        restore = (ROOT / "scripts/restore-live-terminals.mjs").read_text()
        self.assertIn("closedRestoreTargets", restore)
        self.assertIn("closedCwds", restore)
        self.assertIn("if (session.cwd && closedCwds.has(path.resolve(session.cwd))) continue;", restore)

    def test_anonymous_legacy_recovered_tabs_are_not_reintroduced(self):
        source = WORKSPACE.read_text()
        self.assertIn("isLegacyAnonymousRecoveredTab", source)
        self.assertIn("withoutLegacyRecoveredTabs", source)
        self.assertIn("if (!cwd) return null", source)

    def test_lost_flowstate_panes_have_one_time_bounded_repair(self):
        source = WORKSPACE.read_text()
        self.assertIn("agent_status_list_sidecars", source)
        self.assertIn("AGENT_RECOVERY_MAX_AGE_MS", source)
        self.assertIn("/productivity/flow-state", source)
        self.assertIn("AGENT_RECOVERY_MIGRATION_VERSION", source)


if __name__ == "__main__":
    unittest.main()
