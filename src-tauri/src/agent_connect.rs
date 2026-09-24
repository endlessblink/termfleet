//! "Connect agents": registers the bundled Claude Code / Codex / OpenCode status
//! hooks for this user, so agent panes report a real Task line and a true
//! Running / Waiting / Idle badge in a downloaded build, not only in a source
//! checkout. The work lives in `termfleet-connect-agents.mjs` (shipped as a
//! bundle resource); this only locates it and runs it with the user's Node.js.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Manager;

const SCRIPT: &str = "agent-hooks/termfleet-connect-agents.mjs";

fn connect_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(path) = app
        .path()
        .resolve(SCRIPT, tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            return Some(path);
        }
    }
    // Development builds run straight from the checkout.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/termfleet-connect-agents.mjs");
    dev.exists().then_some(dev)
}

/// Runs the connector (`check` = report only) and returns its JSON summary.
#[tauri::command]
pub async fn agents_connect(app: tauri::AppHandle, check: bool) -> Result<String, String> {
    let script = connect_script(&app)
        .ok_or_else(|| "The agent connector is missing from this build.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("node");
        command.arg(&script).arg("--json");
        if check {
            command.arg("--check");
        }
        let output = command
            .stdin(Stdio::null())
            .output()
            .map_err(|_| "Connecting agents needs Node.js 20 or newer on your PATH.".to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.starts_with('{') {
            Ok(stdout)
        } else {
            Err(format!(
                "The agent connector failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
