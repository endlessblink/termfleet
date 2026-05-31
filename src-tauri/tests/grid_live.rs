//! TC-017a (Stage 1) live acceptance: drive a real PTY through the daemon and
//! confirm the headless grid reconstructs the screen (chars + colors).
//!
//! Isolated from any real daemon by overriding `XDG_RUNTIME_DIR` to a temp dir
//! before anything touches the socket path.

use std::time::{Duration, Instant};

use terminal_workspace_lib::daemon::{run_daemon_forever, send_daemon_request, DaemonRequest, DaemonResponse};
use terminal_workspace_lib::vt_grid::GridManager;

fn unique_runtime_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("tw-grid-test-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn wait_for<T>(timeout: Duration, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(value) = probe() {
            return Some(value);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    None
}

#[test]
fn live_pty_output_reconstructs_into_the_grid() {
    // Isolate the daemon socket so we never touch the user's real daemon.
    std::env::set_var("XDG_RUNTIME_DIR", unique_runtime_dir());

    std::thread::spawn(|| {
        let _ = run_daemon_forever();
    });

    // Wait for the daemon to accept a status request.
    let ready = wait_for(Duration::from_secs(5), || {
        matches!(
            send_daemon_request(DaemonRequest::Status),
            Ok(DaemonResponse::Status(_))
        )
        .then_some(())
    });
    assert!(ready.is_some(), "daemon did not become reachable");

    let id = "grid-live-test".to_string();
    match send_daemon_request(DaemonRequest::EnsureSession {
        id: Some(id.clone()),
        cwd: Some("/tmp".to_string()),
        command: Some("bash".to_string()),
        cols: Some(80),
        rows: Some(24),
    })
    .expect("ensure session request")
    {
        DaemonResponse::EnsureSession { .. } => {}
        other => panic!("unexpected ensure response: {other:?}"),
    }

    // Attach the headless grid; its reader thread subscribes to the daemon.
    let grids = GridManager::new();
    grids.attach(&id, 80, 24).expect("attach grid");

    // Let bash come up, then emit a deterministic red word. The escape in the
    // typed text is literal (\033 not interpreted) so only the printf *output*
    // is red — the echoed command line stays default-colored.
    std::thread::sleep(Duration::from_millis(400));
    send_daemon_request(DaemonRequest::WriteSession {
        id: id.clone(),
        data: "printf '\\033[31mREDWORD\\033[0m\\r\\n'\n".to_string(),
    })
    .expect("write session");

    // Poll the snapshot until the red REDWORD output shows up.
    let found = wait_for(Duration::from_secs(5), || {
        let json = grids.snapshot(&id).ok()?;
        let snapshot: serde_json::Value = serde_json::from_str(&json).ok()?;
        let rows = snapshot["cells"].as_array()?;
        for row in rows {
            let cells = row.as_array()?;
            // Look for the start of a red "REDWORD" run.
            for window in cells.windows(7) {
                let text: String = window
                    .iter()
                    .map(|c| c["c"].as_str().unwrap_or(""))
                    .collect();
                if text == "REDWORD" && window[0]["fg"].as_str() == Some("#cd0000") {
                    return Some(true);
                }
            }
        }
        None
    });

    assert!(
        found.is_some(),
        "grid never reconstructed the red REDWORD output from the live PTY"
    );

    // Sanity: a fresh snapshot is well-formed 24x80.
    let json = grids.snapshot(&id).expect("final snapshot");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("parse snapshot");
    assert_eq!(snapshot["cols"], 80);
    assert_eq!(snapshot["rows"], 24);

    let _ = send_daemon_request(DaemonRequest::KillSession { id });
}
