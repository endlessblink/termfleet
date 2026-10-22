//! Urgent toggle for one terminal (Noam 2026-10-22: agents yield CPU unless it is urgent).
//! The work lives in `scripts/termfleet-priority.mjs` (shared with the phone bridge and the
//! agents); this only runs it with the user's Node.js and hands back its JSON. Moving a
//! terminal between priority groups never kills or pauses anything.

use std::path::PathBuf;
use std::process::{Command, Stdio};

fn priority_script() -> Option<PathBuf> {
    // The installed command (a link into the checkout), then the checkout this build came from.
    let installed = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".local/bin/termfleet-priority"));
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/termfleet-priority.mjs");
    installed.into_iter().chain(Some(dev)).find(|path| path.exists())
}

/// Pane ids are `terminal-<tab>-<pane>`: letters, digits and dashes only.
fn valid_pane_id(pane_id: &str) -> bool {
    !pane_id.is_empty()
        && !pane_id.starts_with('-')
        && pane_id.len() <= 200
        && pane_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn priority_args(action: &str, pane_id: &str) -> Result<Vec<String>, String> {
    if !valid_pane_id(pane_id) {
        return Err("That terminal id is not valid.".to_string());
    }
    let mut args = match action {
        "status" => vec!["status".to_string(), pane_id.to_string()],
        "on" | "off" => vec!["urgent".to_string(), action.to_string(), pane_id.to_string(), "--from-ui".to_string()],
        _ => return Err("Unknown priority action.".to_string()),
    };
    args.push("--json".to_string());
    Ok(args)
}

fn weight_args(weight: Option<u32>) -> Result<Vec<String>, String> {
    match weight {
        None => Ok(vec!["status".to_string(), "--json".to_string()]),
        Some(w) if (1..=100).contains(&w) => Ok(vec!["weight".to_string(), w.to_string(), "--json".to_string()]),
        Some(_) => Err("The share must be from 1 to 100.".to_string()),
    }
}

/// The share every agent terminal gets when the PC is busy: read (`None`) or set (1–100, applied live).
#[tauri::command]
pub async fn agent_cpu_share(weight: Option<u32>) -> Result<String, String> {
    run_priority(weight_args(weight)?).await
}

/// `action` is `status`, `on` or `off`; returns the command's JSON.
#[tauri::command]
pub async fn terminal_priority(action: String, pane_id: String) -> Result<String, String> {
    run_priority(priority_args(&action, &pane_id)?).await
}

async fn run_priority(args: Vec<String>) -> Result<String, String> {
    let script = priority_script().ok_or_else(|| "The priority helper is missing.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("node")
            .arg(&script)
            .args(&args)
            .stdin(Stdio::null())
            .output()
            .map_err(|_| "Changing priority needs Node.js on your PATH.".to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.starts_with('{') {
            Ok(stdout)
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_pane_ids_and_known_actions_reach_the_helper() {
        assert_eq!(
            priority_args("on", "terminal-abc-123").unwrap(),
            vec!["urgent", "on", "terminal-abc-123", "--from-ui", "--json"]
        );
        assert_eq!(priority_args("status", "terminal-a-b").unwrap(), vec!["status", "terminal-a-b", "--json"]);
        assert!(priority_args("on", "--self").is_err());
        assert!(priority_args("on", "a b").is_err());
        assert!(priority_args("on", "").is_err());
        assert!(priority_args("kill", "terminal-a-b").is_err());
        assert_eq!(weight_args(Some(50)).unwrap(), vec!["weight", "50", "--json"]);
        assert!(weight_args(Some(0)).is_err());
        assert!(weight_args(Some(101)).is_err());
    }
}
