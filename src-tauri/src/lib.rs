mod commands;
pub mod daemon;
#[cfg(all(target_os = "linux", feature = "native-vte"))]
mod native_gtk_pane;
mod native_terminal;
#[cfg(all(target_os = "linux", feature = "native-vte"))]
mod native_vte;
mod pty;
pub mod vt_grid;

use pty::PtyManager;
use tauri::Listener;
use vt_grid::GridManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(GridManager::new())
        .setup(|app| {
            commands::start_daemon_input_worker();
            app.listen_any(commands::DAEMON_INPUT_EVENT, |event| {
                commands::handle_daemon_input_event(event.payload());
            });
            app.listen_any(commands::TERMINAL_LATENCY_TRACE_EVENT, |event| {
                commands::handle_terminal_latency_trace_event(event.payload());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::daemon_status,
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
            commands::grid_attach,
            commands::grid_snapshot,
            commands::grid_detach,
            commands::grid_resize,
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
            native_terminal::native_terminal_capabilities,
            native_terminal::native_terminal_create,
            native_terminal::native_terminal_update,
            native_terminal::native_terminal_destroy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
