fn main() {
    if let Err(error) = terminal_workspace_lib::daemon::run_daemon_forever() {
        eprintln!("terminal-workspace-daemon: {error}");
        std::process::exit(1);
    }
}
