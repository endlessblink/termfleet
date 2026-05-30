#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == terminal_workspace_lib::daemon::DAEMON_ARG) {
        if let Err(error) = terminal_workspace_lib::daemon::run_daemon_forever() {
            eprintln!("terminal-workspace daemon failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().any(|arg| arg == terminal_workspace_lib::daemon::DAEMON_STDIO_ARG) {
        if let Err(error) = terminal_workspace_lib::daemon::run_daemon_stdio_bridge_from_args() {
            eprintln!("terminal-workspace daemon stdio bridge failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    terminal_workspace_lib::run();
}
