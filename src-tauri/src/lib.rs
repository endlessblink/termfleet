mod commands;
pub mod daemon;
#[cfg(target_os = "linux")]
mod gtk_keys;
mod native_terminal;
mod pty;
pub mod vt_grid;

use commands::FocusedTerminalState;
use pty::PtyManager;
use tauri::Listener;
use vt_grid::GridManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let focused_terminal = FocusedTerminalState::default();

    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(GridManager::new())
        .manage(focused_terminal.clone())
        .setup(move |app| {
            commands::start_daemon_input_worker();
            app.listen_any(commands::DAEMON_INPUT_EVENT, |event| {
                commands::handle_daemon_input_event(event.payload());
            });
            app.listen_any(commands::TERMINAL_LATENCY_TRACE_EVENT, |event| {
                commands::handle_terminal_latency_trace_event(event.payload());
            });

            // Linux: WebKitGTK eats Tab/Shift+Tab for focus-traversal before JS
            // sees it, so route Tab to the focused terminal at the GTK layer.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(gtk_window) = window.gtk_window() {
                        gtk_keys::install_tab_interceptor(&gtk_window, focused_terminal.0.clone());
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::daemon_status,
            commands::agent_provider_statuses,
            commands::workstream_git_context,
            commands::workstream_prepare_dedicated_worktree,
            commands::workstream_remove_dedicated_worktree,
            commands::terminal_latency_trace_enabled,
            commands::daemon_ensure_running,
            commands::daemon_ensure_session,
            commands::daemon_write_session,
            commands::daemon_resize_session,
            commands::daemon_snapshot_session,
            commands::daemon_read_session,
            commands::daemon_subscribe_session,
            commands::daemon_unsubscribe_session,
            commands::daemon_get_session_cwd,
            commands::daemon_kill_session,
            commands::daemon_list_sessions,
            commands::daemon_list_session_events,
            commands::grid_attach,
            commands::grid_snapshot,
            commands::grid_detach,
            commands::grid_resize,
            commands::grid_scroll,
            commands::grid_scroll_to_bottom,
            commands::grid_subscribe_diffs,
            commands::pty_spawn,
            commands::pty_ensure,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_get_cwd,
            commands::pty_snapshot,
            commands::fs_home_dir,
            commands::fs_pick_project_folder,
            commands::fs_list_dir,
            commands::fs_create,
            commands::fs_rename,
            commands::fs_delete,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::workspace_layout_save,
            commands::workspace_layout_load,
            commands::workspace_persisted_sessions,
            native_terminal::native_terminal_capabilities,
            native_terminal::native_terminal_create,
            native_terminal::native_terminal_update,
            native_terminal::native_terminal_destroy,
            commands::set_focused_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
