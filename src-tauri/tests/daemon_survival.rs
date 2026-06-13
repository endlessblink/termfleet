use std::fs;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use terminal_workspace_lib::daemon::{
    daemon_ensure_running, daemon_socket_path, send_daemon_request, DaemonRequest, DaemonResponse,
    DAEMON_ARG,
};

fn unique_temp_dir(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_millis();
    std::env::temp_dir().join(format!("{name}-{}-{nonce}", std::process::id()))
}

fn start_private_daemon(run_dir: &std::path::Path, data_dir: &std::path::Path) -> Child {
    let app_bin = env!("CARGO_BIN_EXE_terminal-workspace");
    Command::new(app_bin)
        .arg(DAEMON_ARG)
        .env("XDG_RUNTIME_DIR", run_dir)
        .env("XDG_DATA_HOME", data_dir)
        .spawn()
        .expect("spawn private daemon")
}

fn wait_for_daemon() -> terminal_workspace_lib::daemon::DaemonStatus {
    for _ in 0..80 {
        let status = daemon_ensure_running();
        if status.reachable {
            return status;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("private daemon did not become reachable");
}

fn list_session_pid(id: &str) -> u32 {
    match send_daemon_request(DaemonRequest::ListSessions).expect("list sessions") {
        DaemonResponse::ListSessions { sessions } => sessions
            .into_iter()
            .find(|session| session.id == id)
            .and_then(|session| session.pid)
            .expect("session pid"),
        response => panic!("unexpected list response: {response:?}"),
    }
}

#[test]
fn ensure_running_preserves_live_daemon_processes_across_build_id_mismatch() {
    let temp = unique_temp_dir("tw-daemon-survival");
    let run_dir = temp.join("run");
    let data_dir = temp.join("data");
    fs::create_dir_all(&run_dir).expect("create run dir");
    fs::create_dir_all(&data_dir).expect("create data dir");

    std::env::set_var("XDG_RUNTIME_DIR", &run_dir);
    std::env::set_var("XDG_DATA_HOME", &data_dir);
    std::env::remove_var("TERMINAL_WORKSPACE_FRESH_DAEMON");

    let mut daemon = start_private_daemon(&run_dir, &data_dir);
    let session_id = "survival-build-mismatch";

    let result = std::panic::catch_unwind(|| {
        let initial_status = wait_for_daemon();
        let daemon_pid = initial_status.pid.expect("daemon pid");

        match send_daemon_request(DaemonRequest::EnsureSession {
            id: Some(session_id.to_string()),
            cwd: Some("/tmp".to_string()),
            command: Some("sh -lc 'echo SURVIVAL_READY; while true; do sleep 1; done'".to_string()),
            cols: Some(80),
            rows: Some(24),
        })
        .expect("ensure long-running session")
        {
            DaemonResponse::EnsureSession { .. } => {}
            response => panic!("unexpected ensure response: {response:?}"),
        }

        let child_pid = list_session_pid(session_id);

        // This call runs from the integration-test binary, whose current_build_id
        // differs from the app binary that launched the daemon. That mismatch used
        // to trigger daemon replacement and kill the daemon-owned child process.
        let ensured_status = daemon_ensure_running();
        assert_eq!(ensured_status.pid, Some(daemon_pid));
        assert_eq!(list_session_pid(session_id), child_pid);

        let socket_path = daemon_socket_path();
        assert!(socket_path.starts_with(&run_dir));
    });

    let _ = daemon.kill();
    let _ = daemon.wait();
    let _ = fs::remove_dir_all(&temp);

    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}
