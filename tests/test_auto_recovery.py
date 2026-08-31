"""Startup recovery must not depend on a user clicking each recovered card."""

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SIDEBAR = ROOT / "src/components/WorkbenchSidebar.tsx"
WORKSPACE = ROOT / "src/stores/workspace.ts"


class AutomaticRecoveryTests(unittest.TestCase):
    def test_sidebar_starts_saved_agent_recovery_once(self):
        source = SIDEBAR.read_text()
        self.assertIn("async function reconnectAgentPanes()", source)
        self.assertIn("conversationOwnedElsewhere", source)
        self.assertIn("agent_conversation_has_other_owner", source)
        self.assertIn("setReconnectAgentsStatus(formatAgentReconnectResult(result))", source)

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

    def test_dead_persisted_sessions_do_not_reconstruct_historical_tabs(self):
        source = WORKSPACE.read_text()
        hydrate = source.split("export async function hydrateWorkspace()", 1)[1].split("/** Create a new tab", 1)[0]
        self.assertIn('invoke<RecoverySessionRecord[] | null>("workspace_persisted_sessions")', hydrate)
        self.assertIn("Dead persisted records are recovery metadata, not new visible tabs", hydrate)
        self.assertIn("closedSessionIds.has(session.id)", hydrate)
        self.assertIn("disk.closedProviderSessionIds", hydrate)
        self.assertIn("withoutClosedSessionTabs(baseTabs, closedSessionIds, closedProviderSessionIds)", hydrate)
        self.assertNotIn("if (!hadSavedLayout) {", hydrate)
        self.assertIn("historical records without a saved pane stay available", hydrate)
        self.assertIn("Do not reconstruct a dead historical session as a new tab", hydrate)
        persisted = hydrate.split("// 4. Dead persisted records", 1)[1].split("if (", 1)[0] if "// 4. Dead persisted records" in hydrate else ""
        self.assertNotIn("recovered.push(tab)", persisted)

    def test_hydration_does_not_audit_every_historical_session_on_each_retry(self):
        source = WORKSPACE.read_text()
        hydrate = source.split("export async function hydrateWorkspace()", 1)[1].split("/** Create a new tab", 1)[0]
        live_section = hydrate.split("const liveCwds", 1)[1].split("const liveGitRoots", 1)[0]
        self.assertNotIn("auditLifecycle(invoke, session.id, \"reconcile-live\"", live_section)
        historical = hydrate.split("// 4. Dead persisted records", 1)[1].split("if (", 1)[0]
        self.assertNotIn("recovery-held-review", historical)

    def test_initial_hydration_defers_the_historical_persisted_session_scan(self):
        source = WORKSPACE.read_text()
        hydrate = source.split("export async function hydrateWorkspace()", 1)[1].split("/** Create a new tab", 1)[0]
        initial_pass = hydrate.split("if (hydrationWasAlreadyComplete) {", 1)[0]
        self.assertNotIn('invoke<RecoverySessionRecord[] | null>("workspace_persisted_sessions")', initial_pass)
        self.assertIn("if (hydrationWasAlreadyComplete) {", hydrate)

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

    def test_explicit_close_blocks_provider_recovery_after_the_pty_id_changes(self):
        source = WORKSPACE.read_text()
        self.assertIn("closedProviderSessionIds", source)
        self.assertIn("terminal.providerSessionId", source)
        self.assertIn("closedProviderSessionIds.has(providerSessionId)", source)
        self.assertIn("closedProviderSessionIds: state.closedProviderSessionIds", source)

    def test_disk_layout_restores_closed_session_tombstones(self):
        source = WORKSPACE.read_text()
        self.assertIn("disk.closedSessionIds", source)
        self.assertIn("closedSessionIds: [...closedSessionIds]", source)
        self.assertIn("closedProviderSessionIds: [...closedProviderSessionIds]", source)
        self.assertIn("hydrationWasAlreadyComplete", source)

    def test_broad_provider_tombstones_are_not_authoritative(self):
        source = WORKSPACE.read_text()
        self.assertIn("closedProviderSessionIds = new Set(", source)
        self.assertIn("closedSessionIds.has(session.id)", source)
        self.assertIn("session.providerSessionId as string", source)
        self.assertIn("disk.closedProviderSessionIds", source)
        self.assertNotIn("closedProviderSessionIds.delete(providerSessionId)", source)
        self.assertIn("closedSessionIds.has(sidecar.paneId)", source)

    def test_disk_layout_writes_are_serialized_to_prevent_stale_rollback(self):
        source = WORKSPACE.read_text()
        self.assertIn("let diskMirrorQueue: Promise<void> = Promise.resolve()", source)
        self.assertIn("diskMirrorQueue = diskMirrorQueue", source)
        self.assertIn("await invoke(\"workspace_layout_save\"", source)

    def test_cache_failure_still_mirrors_the_authoritative_layout_to_disk(self):
        source = WORKSPACE.read_text()
        persistence = source.split("function persistWorkspaceSnapshot", 1)[1].split("function flushWorkspacePersistence", 1)[0]
        self.assertIn("localStorage.setItem", persistence)
        self.assertIn("mirrorWorkspaceLayoutToDisk(serialized)", persistence)
        self.assertIn("Could not update workspace cache", persistence)

    def test_startup_reconciles_again_after_the_daemon_restore_window(self):
        source = (ROOT / "src/App.tsx").read_text()
        self.assertIn("let reconciliationQueue = Promise.resolve()", source)
        self.assertIn("reconciliationQueue = reconciliationQueue", source)
        self.assertIn(".then(() => hydrateWorkspace())", source)
        self.assertIn("for (const delay of [500, 2000, 5000, 10000, 20000, 30000])", source)
        self.assertIn("window.setTimeout(reconcile, delay)", source)

    def test_startup_does_not_mirror_cache_before_disk_hydration(self):
        source = WORKSPACE.read_text()
        subscription = source.split("useWorkspaceStore.subscribe(() =>", 1)[1]
        self.assertIn("useWorkspaceStore.getState().hydrating", subscription)
        self.assertNotIn("!needsDiskHydration && Array.isArray(persisted.tabs)", subscription)

    def test_forced_hydration_flushes_even_when_the_snapshot_is_not_marked_dirty(self):
        source = WORKSPACE.read_text()
        flush = source.split("function flushWorkspacePersistence", 1)[1].split("function scheduleWorkspacePersistence", 1)[0]
        self.assertIn("options.force", flush)
        self.assertIn("persistDirty || options.force", flush)
        self.assertIn("flushWorkspacePersistence({ force: true })", source)

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
        self.assertLess(
            close.index("get().removeTab(id);"),
            close.index("await killPtys("),
        )

    def test_operator_stop_settles_workstream_before_killing_the_pty(self):
        source = WORKSPACE.read_text()
        stop = source.split("stopWorkstream: async", 1)[1].split("restartWorkstream:", 1)[0]
        self.assertIn('status: "stopped"', stop)
        self.assertIn('phase: "interrupted"', stop)
        self.assertLess(stop.index('status: "stopped"'), stop.index("await killPtys("))

    def test_agent_restart_keeps_panes_mounted_for_daemon_reattach(self):
        source = WORKSPACE.read_text()
        restart = source.split("restartWorkstream: async", 1)[1].split("reviewWorkstream:", 1)[0]
        self.assertIn("await killPtys(", restart)
        self.assertIn("withRestartableTerminals", restart)
        self.assertNotIn("terminals: [],", restart)
        self.assertIn('generation: (candidate.workstream.generation ?? 0) + 1', restart)

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
        self.assertIn("useWorkspaceStore.getState().hydrating", source)
        self.assertNotIn("if (isTauriRuntime() && !needsDiskHydration && Array.isArray(persisted.tabs))", source)

    def test_recovered_sessions_can_attach_using_their_existing_daemon_id(self):
        split_pane = (ROOT / "src/components/SplitPane.tsx").read_text()
        restore = (ROOT / "scripts/restore-live-terminals.mjs").read_text()
        self.assertIn("attachToPtyId={paneTerminal?.id ?? null}", split_pane)
        self.assertIn("recovered-pane-${session.id}", restore)
        self.assertIn("if (!parts)", restore)

    def test_closed_frontend_stream_unregisters_its_daemon_subscriber(self):
        source = (ROOT / "src-tauri/src/commands.rs").read_text()
        subscribe = source.split("pub fn daemon_subscribe_session", 1)[1].split(
            "pub fn daemon_unsubscribe_session", 1
        )[0]
        self.assertIn("let cleanup = ||", subscribe)
        self.assertIn("DaemonRequest::UnsubscribeSession", subscribe)
        self.assertIn("if on_data.send(event).is_err()", subscribe)
        self.assertIn("cleanup();", subscribe)

    def test_ended_daemon_sessions_are_reaped_without_a_new_attach(self):
        daemon = (ROOT / "src-tauri/src/daemon.rs").read_text()
        pty = (ROOT / "src-tauri/src/pty.rs").read_text()
        self.assertIn('name("pty-session-reaper".to_string())', daemon)
        self.assertIn("reap_ended_sessions()", daemon)
        self.assertIn("ptys.retain(|_, entry| !entry.ended.load(Ordering::Acquire))", pty)

    def test_expected_client_disconnects_do_not_fill_daemon_logs(self):
        daemon = (ROOT / "src-tauri/src/daemon.rs").read_text()
        self.assertIn("is_expected_client_disconnect", daemon)
        self.assertIn('"Broken pipe"', daemon)
        self.assertIn('if !is_expected_client_disconnect(&error)', daemon)

    def test_live_restore_honors_explicit_closed_workspace_identity(self):
        restore = (ROOT / "scripts/restore-live-terminals.mjs").read_text()
        self.assertIn("closedSessionIds", restore)
        self.assertIn("closedProviderSessionIds", restore)
        self.assertIn("closedProviders.has(session.providerSessionId)", restore)
        self.assertIn("if (closed.has(session.id)) continue;", restore)
        self.assertNotIn("closedCwds", restore)

    def test_cold_orphans_use_exact_session_tombstones_not_shared_cwds(self):
        source = WORKSPACE.read_text()
        hydrate = source.split("export async function hydrateWorkspace()", 1)[1].split("/** Create a new tab", 1)[0]
        self.assertIn("closedSessionIds.has(session.id)", hydrate)
        self.assertNotIn("isClosedRestoreCwd(session.cwd", hydrate)

    def test_explicit_close_reconciles_old_daemon_checkpoints_without_restart(self):
        source = WORKSPACE.read_text()
        close = source.split("async function killPty", 1)[1].split("function shellQuote", 1)[0]
        self.assertIn('invoke<Array<{ id?: string }>>(\"daemon_list_sessions\")', close)
        self.assertIn("Daemon retained explicitly closed session", close)
        hydrate = source.split("export async function hydrateWorkspace()", 1)[1].split("/** Create a new tab", 1)[0]
        self.assertIn(
            'invoke("daemon_kill_session", { id: session.id, userRequested: true })',
            hydrate,
        )

    def test_recovery_uses_daemon_lifecycle_disposition_instead_of_deleting_backups(self):
        workspace = WORKSPACE.read_text()
        pty = (ROOT / "src-tauri" / "src" / "pty.rs").read_text()
        self.assertIn('session.lifecycle !== "recoverable"', workspace)
        self.assertNotIn('invoke("pty_forget_persisted_session", { id })', workspace)
        self.assertIn("SessionLifecycle::IntentionalKill", pty)
        self.assertIn("write_session_disposition", pty)
        self.assertIn("backup_only", pty)

    def test_tauri_never_falls_back_to_a_second_embedded_owner(self):
        source = (ROOT / "src" / "hooks" / "usePty.ts").read_text()
        workspace = WORKSPACE.read_text()
        self.assertIn("refusing to start an embedded second PTY owner", source)
        self.assertIn("refusing a second PTY owner", workspace)

    def test_daemon_transport_reconnect_does_not_exhaust_after_a_fixed_attempt_count(self):
        source = (ROOT / "src" / "hooks" / "usePty.ts").read_text()
        reconnect = source.split("const DAEMON_RECONNECT_DELAYS_MS", 1)[1].split("type ActiveInputListener", 1)[0]
        self.assertNotIn("< DAEMON_RECONNECT_DELAYS_MS.length", source)
        self.assertIn("Math.min", reconnect)
        self.assertIn("Terminal daemon unavailable; reconnecting", source)


    def test_anonymous_legacy_recovered_tabs_are_not_reintroduced(self):
        source = WORKSPACE.read_text()
        self.assertIn("isLegacyAnonymousRecoveredTab", source)
        self.assertIn("withoutLegacyRecoveredTabs", source)
        self.assertIn("if (!cwd) return null", source)

    def test_agent_panes_have_continuous_exact_identity_repair(self):
        source = WORKSPACE.read_text()
        self.assertIn("agent_status_list_sidecars", source)
        self.assertIn("AGENT_RECOVERY_MIGRATION_VERSION", source)
        self.assertIn('provenance === "legacy-unverified"', source)
        self.assertIn("session.providerSessionId", source)
        self.assertIn("if (hadSavedLayout)", source)
        self.assertNotIn("AGENT_RECOVERY_MAX_AGE_MS", source)
        self.assertNotIn('"/productivity/flow-state"', source)


if __name__ == "__main__":
    unittest.main()
