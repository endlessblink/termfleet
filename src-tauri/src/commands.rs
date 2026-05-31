use crate::daemon::{
    daemon_ensure_running as current_daemon_ensure_running, daemon_socket_path,
    daemon_status as current_daemon_status, send_daemon_request, DaemonRequest, DaemonResponse,
    DaemonStatus,
};
use crate::pty::{PtyManager, PtyOutputChunk};
use crate::vt_grid::{GridManager, DEFAULT_COLS, DEFAULT_ROWS};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::State;

/// Session id of the terminal that currently owns the keyboard (or `None`). Held
/// in an Arc so the Linux GTK key interceptor and the `set_focused_terminal`
/// command share one cell. See `gtk_keys` for why Tab must be handled in GTK.
#[derive(Clone, Default)]
pub struct FocusedTerminalState(pub Arc<Mutex<Option<String>>>);

/// Frontend tells the backend which terminal owns the keyboard, so the GTK
/// Tab-interceptor only claims Tab while a terminal is focused.
#[tauri::command]
pub fn set_focused_terminal(state: State<'_, FocusedTerminalState>, id: Option<String>) {
    *state.0.lock().unwrap() = id;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEnsureResult {
    id: String,
    reused: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyStreamEvent {
    data: String,
    snapshot: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonInputEvent {
    id: String,
    data: String,
    seq_ids: Option<Vec<u64>>,
}

pub const DAEMON_INPUT_EVENT: &str = "terminal-workspace-daemon-input";
pub const TERMINAL_LATENCY_TRACE_EVENT: &str = "terminal-workspace-latency-trace";
static DAEMON_INPUT_SENDER: OnceLock<Sender<DaemonInputEvent>> = OnceLock::new();

pub fn start_daemon_input_worker() {
    let _ = DAEMON_INPUT_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<DaemonInputEvent>();
        std::thread::spawn(move || {
            let mut streams = HashMap::<String, UnixStream>::new();
            for payload in receiver {
                trace_terminal_latency(
                    "tauri.daemon.input.worker.write.start",
                    &format!(
                        "id={} bytes={} seq_ids={:?}",
                        payload.id,
                        payload.data.len(),
                        payload.seq_ids
                    ),
                );
                if let Err(error) = write_daemon_input_stream(
                    &mut streams,
                    payload.id,
                    payload.data,
                    payload.seq_ids,
                ) {
                    eprintln!("terminal workspace daemon input write failed: {error}");
                    trace_terminal_latency("tauri.daemon.input.worker.write.failed", &error);
                } else {
                    trace_terminal_latency("tauri.daemon.input.worker.write.end", "{}");
                }
            }
        });
        sender
    });
}

fn write_daemon_input_stream(
    streams: &mut HashMap<String, UnixStream>,
    id: String,
    data: String,
    seq_ids: Option<Vec<u64>>,
) -> Result<(), String> {
    let bytes = data.into_bytes();
    for attempt in 0..2 {
        if !streams.contains_key(&id) {
            streams.insert(id.clone(), open_daemon_input_stream(&id)?);
        }

        let stream = streams
            .get_mut(&id)
            .ok_or_else(|| format!("input stream for {id} was not opened"))?;

        match stream.write_all(&bytes) {
            Ok(()) => return Ok(()),
            Err(error) if attempt == 0 => {
                streams.remove(&id);
                trace_terminal_latency(
                    "tauri.daemon.input.stream.reopen",
                    &format!("id={id} seq_ids={seq_ids:?} error={error}"),
                );
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err(format!("input stream write failed for {id}"))
}

fn open_daemon_input_stream(id: &str) -> Result<UnixStream, String> {
    let socket_path = daemon_socket_path();
    let mut stream = UnixStream::connect(&socket_path).map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_millis(700)))
        .map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&DaemonRequest::InputStream { id: id.to_string() })
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .and_then(|()| stream.write_all(b"\n"))
        .map_err(|error| error.to_string())?;
    trace_terminal_latency("tauri.daemon.input.stream.open", &format!("id={id}"));
    Ok(stream)
}

pub fn handle_daemon_input_event(payload: &str) {
    trace_terminal_latency("tauri.daemon.input.event.receive", payload);
    let payload = match serde_json::from_str::<DaemonInputEvent>(payload) {
        Ok(payload) => payload,
        Err(error) => {
            eprintln!("terminal workspace daemon input payload parse failed: {error}");
            return;
        }
    };

    if let Some(sender) = DAEMON_INPUT_SENDER.get() {
        trace_terminal_latency(
            "tauri.daemon.input.event.parsed",
            &format!(
                "id={} bytes={} seq_ids={:?}",
                payload.id,
                payload.data.len(),
                payload.seq_ids
            ),
        );
        if sender.send(payload).is_ok() {
            trace_terminal_latency("tauri.daemon.input.event.queued", "{}");
            return;
        }
    }

    eprintln!("terminal workspace daemon input worker is unavailable");
}

pub fn handle_terminal_latency_trace_event(payload: &str) {
    if !terminal_latency_trace_enabled() {
        return;
    }

    let mut value = match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("terminal workspace latency trace payload parse failed: {error}");
            return;
        }
    };

    if let Some(object) = value.as_object_mut() {
        object.insert("rustEpochMs".to_string(), serde_json::json!(epoch_ms()));
        if let Some(data) = object
            .get("data")
            .and_then(|value| value.as_str())
            .map(str::to_string)
        {
            object.insert("dataLength".to_string(), serde_json::json!(data.len()));
            object.insert(
                "dataPreview".to_string(),
                serde_json::json!(truncate_trace_detail(&data)),
            );
            object.remove("data");
        }
    }

    if let Ok(line) = serde_json::to_string(&value) {
        append_latency_trace_line(&line);
    }
}

pub fn trace_terminal_latency(label: &str, details: &str) {
    if !terminal_latency_trace_enabled() {
        return;
    }

    let line = serde_json::json!({
        "label": label,
        "rustEpochMs": epoch_ms(),
        "details": truncate_trace_detail(details),
    });
    append_latency_trace_line(&line.to_string());
}

fn truncate_trace_detail(details: &str) -> String {
    const MAX_TRACE_DETAIL: usize = 160;
    if details.len() <= MAX_TRACE_DETAIL {
        return details.to_string();
    }
    let boundary = details
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= MAX_TRACE_DETAIL)
        .last()
        .unwrap_or(0);
    format!("{}...", &details[..boundary])
}

fn append_latency_trace_line(line: &str) {
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(latency_trace_path())
        .and_then(|mut file| writeln!(file, "{line}"));
}

fn latency_trace_path() -> String {
    let thread_id = format!("{:?}", std::thread::current().id())
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .collect::<String>();
    format!(
        "/tmp/terminal-workspace-latency-trace-{}-{thread_id}.jsonl",
        std::process::id(),
    )
}

fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[tauri::command]
pub fn terminal_latency_trace_enabled() -> bool {
    std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_some()
}

#[tauri::command]
pub fn daemon_status() -> DaemonStatus {
    current_daemon_status()
}

#[tauri::command]
pub fn daemon_ensure_running() -> DaemonStatus {
    current_daemon_ensure_running()
}

#[tauri::command]
pub fn daemon_ensure_session(
    id: Option<String>,
    cwd: Option<String>,
    command: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyEnsureResult, String> {
    match send_daemon_request(DaemonRequest::EnsureSession {
        id,
        cwd,
        command,
        cols,
        rows,
    })? {
        DaemonResponse::EnsureSession { id, reused } => Ok(PtyEnsureResult { id, reused }),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_write_session(id: String, data: String) -> Result<(), String> {
    match send_daemon_request(DaemonRequest::WriteSession { id, data })? {
        DaemonResponse::WriteSession { ok: true } => Ok(()),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_resize_session(id: String, cols: u16, rows: u16) -> Result<(), String> {
    match send_daemon_request(DaemonRequest::ResizeSession { id, cols, rows })? {
        DaemonResponse::ResizeSession { ok: true } => Ok(()),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_snapshot_session(id: String) -> Result<String, String> {
    match send_daemon_request(DaemonRequest::SnapshotSession { id })? {
        DaemonResponse::SnapshotSession { data } => Ok(data),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_read_session(id: String, offset: u64) -> Result<PtyOutputChunk, String> {
    match send_daemon_request(DaemonRequest::ReadSession { id, offset })? {
        DaemonResponse::ReadSession(chunk) => Ok(chunk),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_subscribe_session(
    id: String,
    subscriber_id: String,
    on_data: Channel<PtyStreamEvent>,
) -> Result<(), String> {
    let socket_path = daemon_socket_path();
    let mut stream = UnixStream::connect(&socket_path).map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&DaemonRequest::SubscribeSession { id, subscriber_id })
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown(Shutdown::Write);

    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    eprintln!("terminal workspace daemon stream read failed: {error}");
                    break;
                }
            };
            let response = match serde_json::from_str::<DaemonResponse>(&line) {
                Ok(response) => response,
                Err(error) => {
                    eprintln!("terminal workspace daemon stream parse failed: {error}");
                    break;
                }
            };

            let event = match response {
                DaemonResponse::SnapshotSession { data } => PtyStreamEvent {
                    data,
                    snapshot: true,
                },
                DaemonResponse::SessionData { data } => PtyStreamEvent {
                    data,
                    snapshot: false,
                },
                DaemonResponse::Error { message } => {
                    eprintln!("terminal workspace daemon stream error: {message}");
                    break;
                }
                _ => continue,
            };

            if on_data.send(event).is_err() {
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn daemon_unsubscribe_session(id: String, subscriber_id: String) -> Result<(), String> {
    match send_daemon_request(DaemonRequest::UnsubscribeSession { id, subscriber_id })? {
        DaemonResponse::UnsubscribeSession { ok: true } => Ok(()),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_get_session_cwd(id: String) -> Result<String, String> {
    match send_daemon_request(DaemonRequest::GetSessionCwd { id })? {
        DaemonResponse::GetSessionCwd { cwd } => Ok(cwd),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_kill_session(id: String) -> Result<(), String> {
    match send_daemon_request(DaemonRequest::KillSession { id })? {
        DaemonResponse::KillSession { ok: true } => Ok(()),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn grid_attach(
    grids: State<'_, GridManager>,
    id: String,
    cols: Option<usize>,
    rows: Option<usize>,
) -> Result<(), String> {
    let cols = cols.filter(|value| *value > 0).unwrap_or(DEFAULT_COLS);
    let rows = rows.filter(|value| *value > 0).unwrap_or(DEFAULT_ROWS);
    crate::daemon::trace_pty("grid.attach", format!("id={id} cols={cols} rows={rows}"));
    grids.attach(&id, cols, rows)
}

#[tauri::command]
pub fn grid_snapshot(grids: State<'_, GridManager>, id: String) -> Result<String, String> {
    grids.snapshot(&id)
}

#[tauri::command]
pub fn grid_detach(grids: State<'_, GridManager>, id: String) {
    grids.detach(&id);
}

#[tauri::command]
pub fn grid_resize(
    grids: State<'_, GridManager>,
    id: String,
    cols: usize,
    rows: usize,
) -> Result<(), String> {
    crate::daemon::trace_pty("grid.resize", format!("id={id} cols={cols} rows={rows}"));
    grids.resize(&id, cols, rows)
}

#[tauri::command]
pub fn grid_scroll(grids: State<'_, GridManager>, id: String, delta: i32) -> Result<(), String> {
    grids.scroll(&id, delta)
}

#[tauri::command]
pub fn grid_subscribe_diffs(
    grids: State<'_, GridManager>,
    id: String,
    on_diff: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<(), String> {
    grids.subscribe_diffs(&id, on_diff)
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: Option<String>,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<String, String> {
    state.spawn(&app, id, cwd, command)
}

#[tauri::command]
pub fn pty_ensure(
    state: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: Option<String>,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<PtyEnsureResult, String> {
    let (id, reused) = state.ensure(&app, id, cwd, command)?;
    Ok(PtyEnsureResult { id, reused })
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    state.kill(&id)
}

#[tauri::command]
pub fn pty_get_cwd(state: State<'_, PtyManager>, id: String) -> Result<String, String> {
    state.get_cwd(&id)
}

#[tauri::command]
pub fn pty_snapshot(state: State<'_, PtyManager>, id: String) -> Result<String, String> {
    state.snapshot(&id)
}

#[tauri::command]
pub fn fs_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "Could not resolve home directory".to_string())
}

fn normalize_selected_folder(raw: &str) -> Option<String> {
    let selected = raw.trim();
    if selected.is_empty() {
        return None;
    }
    Some(
        selected
            .strip_prefix("file://")
            .unwrap_or(selected)
            .to_string(),
    )
}

fn run_folder_picker(command: &str, args: &[String]) -> Result<Option<String>, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        let selected = String::from_utf8_lossy(&output.stdout);
        return Ok(normalize_selected_folder(&selected));
    }

    if output.status.code() == Some(1) {
        return Ok(None);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("{command} exited with status {}", output.status)
    } else {
        stderr
    })
}

#[tauri::command]
pub fn fs_pick_project_folder(current_path: Option<String>) -> Result<Option<String>, String> {
    let start_path = current_path
        .filter(|path| !path.trim().is_empty())
        .or_else(|| dirs::home_dir().map(|path| path.to_string_lossy().to_string()))
        .unwrap_or_else(|| "/".to_string());

    let pickers: [(&str, Vec<String>); 3] = [
        (
            "kdialog",
            vec![
                "--title".to_string(),
                "Choose project folder".to_string(),
                "--getexistingdirectory".to_string(),
                start_path.clone(),
            ],
        ),
        (
            "zenity",
            vec![
                "--file-selection".to_string(),
                "--directory".to_string(),
                "--title=Choose project folder".to_string(),
                format!("--filename={start_path}"),
            ],
        ),
        (
            "yad",
            vec![
                "--file-selection".to_string(),
                "--directory".to_string(),
                "--title=Choose project folder".to_string(),
                format!("--filename={start_path}"),
            ],
        ),
    ];

    let mut failures = Vec::new();
    for (command, args) in pickers {
        match run_folder_picker(command, &args) {
            Ok(selection) => return Ok(selection),
            Err(error) => failures.push(format!("{command}: {error}")),
        }
    }

    Err(format!(
        "Could not open a folder picker. Tried kdialog, zenity, and yad. {}",
        failures.join("; ")
    ))
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = PathBuf::from(path);
    let read_dir = fs::read_dir(&dir).map_err(|error| error.to_string())?;
    let mut entries = Vec::new();

    for entry in read_dir {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(FileEntry {
            is_hidden: name.starts_with('.'),
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn fs_create(path: String, is_dir: bool) -> Result<(), String> {
    let path = PathBuf::from(path);
    if is_dir {
        fs::create_dir_all(&path).map_err(|error| error.to_string())
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn fs_rename(path: String, new_name: String) -> Result<String, String> {
    if new_name.contains('/') || new_name.trim().is_empty() {
        return Err("New name must be a single non-empty path segment".to_string());
    }

    let source = PathBuf::from(path);
    let target = source
        .parent()
        .ok_or_else(|| "Cannot rename path without a parent".to_string())?
        .join(new_name);
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.parent().is_none() {
        return Err("Refusing to delete a filesystem root".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(&path).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_selected_folder;

    #[test]
    fn selected_folder_output_is_trimmed() {
        assert_eq!(
            normalize_selected_folder("/home/endlessblink/project\n"),
            Some("/home/endlessblink/project".to_string())
        );
    }

    #[test]
    fn selected_folder_output_accepts_file_url_prefix() {
        assert_eq!(
            normalize_selected_folder("file:///home/endlessblink/project\n"),
            Some("/home/endlessblink/project".to_string())
        );
    }

    #[test]
    fn empty_selected_folder_means_cancelled() {
        assert_eq!(normalize_selected_folder("\n"), None);
    }
}
