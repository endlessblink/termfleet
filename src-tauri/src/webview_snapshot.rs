//! App-owned WebKitGTK capture.
//!
//! The pixels come from the exact WRY WebView owned by this TermFleet process;
//! this path does not inspect or depend on another application's window.

#![cfg(target_os = "linux")]

use std::fs::File;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);

fn output_path(pane_id: &str) -> Result<PathBuf, String> {
    let root = crate::pty::data_root_dir()
        .ok_or_else(|| "Could not resolve TermFleet data directory".to_string())?
        .join("agent-status");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("create snapshot directory: {error}"))?;
    let safe = pane_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.is_empty() {
        return Err("pane id is empty".to_string());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("snapshot clock: {error}"))?
        .as_millis();
    Ok(root.join(format!("termfleet-pane-native-{safe}-{stamp}.png")))
}

/// Capture the current WebKit surface without requiring a mapped X11 window.
/// The command is async so the GTK/WebKit callback can run while the invoke
/// request is awaiting it; no GTK main-loop wait is performed inside a sync
/// status command.
#[tauri::command]
pub async fn capture_webview_snapshot(
    app: AppHandle,
    pane_id: String,
    full_document: bool,
) -> Result<String, String> {
    let output = output_path(&pane_id)?;
    let result_path = output.clone();
    let temporary = output.with_extension("png.tmp");
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "TermFleet main WebView is unavailable".to_string())?;
    let (sender, receiver) = oneshot::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            let region = if full_document {
                SnapshotRegion::FullDocument
            } else {
                SnapshotRegion::Visible
            };
            let temporary = temporary.clone();
            let output = output.clone();
            webview.inner().snapshot(
                region,
                SnapshotOptions::empty(),
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    let outcome = result
                        .map_err(|error| format!("WebKitGTK snapshot failed: {error}"))
                        .and_then(|surface| {
                            let mut file = File::create(&temporary)
                                .map_err(|error| format!("create snapshot file: {error}"))?;
                            surface
                                .write_to_png(&mut file)
                                .map_err(|error| format!("write snapshot PNG: {error}"))?;
                            std::fs::rename(&temporary, &output)
                                .map_err(|error| format!("publish snapshot PNG: {error}"))
                        });
                    let _ = sender.send(outcome);
                },
            );
        })
        .map_err(|error| format!("schedule WebKitGTK snapshot: {error}"))?;

    tokio::time::timeout(SNAPSHOT_TIMEOUT, receiver)
        .await
        .map_err(|_| "WebKitGTK snapshot timed out".to_string())?
        .map_err(|_| "WebKitGTK snapshot callback was cancelled".to_string())??;
    Ok(result_path.to_string_lossy().into_owned())
}
