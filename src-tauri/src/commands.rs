use crate::daemon::{
    daemon_ensure_running as current_daemon_ensure_running, daemon_socket_path,
    daemon_status as current_daemon_status, send_daemon_request, DaemonRequest, DaemonResponse,
    DaemonStatus,
};
use crate::daemon_ipc::{self, LocalStream};
use crate::platform_paths;
use crate::pty::{PtyManager, PtyOutputChunk, PtySessionEvent, PtySessionSummary};
use crate::vt_grid::{GridManager, DEFAULT_COLS, DEFAULT_ROWS};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
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
pub struct AgentProviderStatus {
    id: String,
    label: String,
    command: Option<String>,
    available: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstreamGitContext {
    cwd: String,
    git_root: Option<String>,
    git_branch: Option<String>,
    git_dirty: Option<bool>,
    worktree_path: Option<String>,
    isolation_status: Option<String>,
    isolation_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCleanupResult {
    status: String,
    note: String,
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn git_output(cwd: &PathBuf, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn sanitize_worktree_segment(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    while sanitized.contains("--") {
        sanitized = sanitized.replace("--", "-");
    }
    sanitized.trim_matches('-').to_string()
}

fn worktree_target_for(git_root: &PathBuf, run_id: &str) -> Result<PathBuf, String> {
    let repo_name = git_root
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_worktree_segment)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "repo".to_string());
    let run_segment = sanitize_worktree_segment(run_id);
    if run_segment.is_empty() {
        return Err("Run id is required for dedicated worktree provisioning".to_string());
    }
    let parent = git_root
        .parent()
        .ok_or_else(|| "Git root has no parent directory for worktree storage".to_string())?;
    Ok(parent
        .join(".termfleet-worktrees")
        .join(repo_name)
        .join(run_segment))
}

fn worktree_branch_for(run_id: &str) -> String {
    format!("termfleet/{}", sanitize_worktree_segment(run_id))
}

fn is_managed_termfleet_worktree_path(path: &PathBuf) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| part == ".termfleet-worktrees")
            .unwrap_or(false)
    })
}

fn context_for_cwd(cwd: PathBuf) -> WorkstreamGitContext {
    let cwd = cwd.canonicalize().unwrap_or(cwd);
    let cwd_string = cwd.display().to_string();
    let git_root = git_output(&cwd, &["rev-parse", "--show-toplevel"]);
    let git_branch = git_output(&cwd, &["branch", "--show-current"])
        .or_else(|| git_output(&cwd, &["rev-parse", "--short", "HEAD"]));
    let git_dirty = git_output(&cwd, &["status", "--porcelain"])
        .map(|status| !status.trim().is_empty())
        .or(Some(false))
        .filter(|_| git_root.is_some());
    let worktree_path = git_root
        .as_ref()
        .and_then(|_| git_output(&cwd, &["rev-parse", "--show-toplevel"]));

    WorkstreamGitContext {
        cwd: cwd_string,
        git_root,
        git_branch,
        git_dirty,
        worktree_path,
        isolation_status: None,
        isolation_note: None,
    }
}

#[tauri::command]
pub fn workstream_git_context(cwd: Option<String>) -> Result<WorkstreamGitContext, String> {
    let cwd = match cwd {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => std::env::current_dir().map_err(|error| error.to_string())?,
    };
    Ok(context_for_cwd(cwd))
}

#[tauri::command]
pub fn workstream_prepare_dedicated_worktree(
    cwd: Option<String>,
    run_id: String,
) -> Result<WorkstreamGitContext, String> {
    let cwd = match cwd {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => std::env::current_dir().map_err(|error| error.to_string())?,
    };
    let base = context_for_cwd(cwd.clone());
    let Some(git_root) = base.git_root.as_ref() else {
        return Ok(WorkstreamGitContext {
            isolation_status: Some("unavailable".to_string()),
            isolation_note: Some("Dedicated worktree requires a Git repository.".to_string()),
            ..base
        });
    };

    let git_root_path = PathBuf::from(git_root);
    let target = worktree_target_for(&git_root_path, &run_id)?;
    if target.exists() {
        let is_ready_worktree = target.join(".git").exists();
        let is_empty = fs::read_dir(&target)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !is_ready_worktree && !is_empty {
            return Ok(WorkstreamGitContext {
                isolation_status: Some("unavailable".to_string()),
                isolation_note: Some(format!(
                    "Dedicated worktree target already exists and is not empty: {}",
                    target.display()
                )),
                ..base
            });
        }
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if !target.join(".git").exists() {
        let branch = worktree_branch_for(&run_id);
        let output = Command::new("git")
            .arg("-C")
            .arg(&git_root_path)
            .args(["worktree", "add", "-b"])
            .arg(&branch)
            .arg(&target)
            .arg("HEAD")
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Ok(WorkstreamGitContext {
                isolation_status: Some("unavailable".to_string()),
                isolation_note: Some(if stderr.is_empty() {
                    "git worktree add failed".to_string()
                } else {
                    stderr
                }),
                ..base
            });
        }
    }

    let mut prepared = context_for_cwd(target.clone());
    prepared.isolation_status = Some("ready".to_string());
    prepared.isolation_note = Some(format!("Dedicated worktree ready at {}", target.display()));
    Ok(prepared)
}

#[tauri::command]
pub fn workstream_remove_dedicated_worktree(path: String) -> Result<WorktreeCleanupResult, String> {
    let target = PathBuf::from(path);
    let target = target.canonicalize().map_err(|error| error.to_string())?;
    if !is_managed_termfleet_worktree_path(&target) {
        return Ok(WorktreeCleanupResult {
            status: "blocked".to_string(),
            note: format!(
                "Refusing to remove unmanaged worktree path: {}",
                target.display()
            ),
        });
    }
    if !target.join(".git").exists() {
        return Ok(WorktreeCleanupResult {
            status: "blocked".to_string(),
            note: format!(
                "Refusing to remove path without worktree metadata: {}",
                target.display()
            ),
        });
    }
    let dirty = git_output(&target, &["status", "--porcelain"]).unwrap_or_default();
    if !dirty.trim().is_empty() {
        return Ok(WorktreeCleanupResult {
            status: "blocked".to_string(),
            note: "Refusing to remove dirty worktree; commit, stash, or clean it first."
                .to_string(),
        });
    }

    let command_cwd = git_output(
        &target,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map(PathBuf::from)
    .and_then(|path| {
        if path.file_name().and_then(|name| name.to_str()) == Some(".git") {
            path.parent().map(|parent| parent.to_path_buf())
        } else {
            Some(path)
        }
    })
    .ok_or_else(|| "Could not resolve owning Git repository for worktree cleanup".to_string())?;
    let output = Command::new("git")
        .arg("-C")
        .arg(command_cwd)
        .args(["worktree", "remove"])
        .arg(&target)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(WorktreeCleanupResult {
            status: "blocked".to_string(),
            note: if stderr.is_empty() {
                "git worktree remove failed".to_string()
            } else {
                stderr
            },
        });
    }

    Ok(WorktreeCleanupResult {
        status: "removed".to_string(),
        note: format!("Removed dedicated worktree {}", target.display()),
    })
}

#[tauri::command]
pub fn agent_provider_statuses() -> Vec<AgentProviderStatus> {
    let adapter_path = std::env::current_dir()
        .ok()
        .map(|dir| dir.join("scripts").join("agent-provider-adapter.sh"));
    [
        ("codex", "Codex", "codex"),
        ("claude", "Claude", "claude"),
        ("opencode", "OpenCode", "opencode"),
    ]
    .into_iter()
    .map(|(id, label, command)| {
        let check = format!("command -v {command}");
        let output = Command::new("sh").args(["-lc", check.as_str()]).output();
        match output {
            Ok(result) if result.status.success() => {
                let path = String::from_utf8_lossy(&result.stdout).trim().to_string();
                AgentProviderStatus {
                    id: id.to_string(),
                    label: label.to_string(),
                    command: adapter_path
                        .as_ref()
                        .map(|path| {
                            format!("sh {} {command}", shell_quote(&path.display().to_string()))
                        })
                        .or_else(|| Some(command.to_string())),
                    available: true,
                    message: if path.is_empty() {
                        format!("{command} is available")
                    } else {
                        path
                    },
                }
            }
            Ok(_) => AgentProviderStatus {
                id: id.to_string(),
                label: label.to_string(),
                command: Some(command.to_string()),
                available: false,
                message: format!("{command} not found on PATH"),
            },
            Err(error) => AgentProviderStatus {
                id: id.to_string(),
                label: label.to_string(),
                command: Some(command.to_string()),
                available: false,
                message: format!("could not check {command}: {error}"),
            },
        }
    })
    .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEnsureResult {
    id: String,
    reused: bool,
    // Current PTY winsize (None if not reported). The map projection reattaches
    // a reused session at this size to avoid shrinking a wide alt-screen TUI.
    cols: Option<u16>,
    rows: Option<u16>,
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
            let mut streams = HashMap::<String, LocalStream>::new();
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
    streams: &mut HashMap<String, LocalStream>,
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

fn open_daemon_input_stream(id: &str) -> Result<LocalStream, String> {
    let socket_path = daemon_socket_path();
    let mut stream = daemon_ipc::connect(&socket_path).map_err(|error| error.to_string())?;
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
        .open(platform_paths::latency_trace_path(
            std::process::id(),
            &current_thread_trace_id(),
        ))
        .and_then(|mut file| writeln!(file, "{line}"));
}

fn current_thread_trace_id() -> String {
    format!("{:?}", std::thread::current().id())
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .collect::<String>()
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
        DaemonResponse::EnsureSession {
            id,
            reused,
            cols,
            rows,
        } => Ok(PtyEnsureResult {
            id,
            reused,
            cols,
            rows,
        }),
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
    let mut stream = daemon_ipc::connect(&socket_path).map_err(|error| error.to_string())?;
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
pub fn daemon_list_sessions() -> Result<Vec<PtySessionSummary>, String> {
    match send_daemon_request(DaemonRequest::ListSessions)? {
        DaemonResponse::ListSessions { sessions } => Ok(sessions),
        DaemonResponse::Error { message } => Err(message),
        response => Err(format!("Unexpected daemon response: {response:?}")),
    }
}

#[tauri::command]
pub fn daemon_list_session_events() -> Result<Vec<PtySessionEvent>, String> {
    match send_daemon_request(DaemonRequest::ListSessionEvents)? {
        DaemonResponse::ListSessionEvents { events } => Ok(events),
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
pub fn grid_selection_text(
    grids: State<'_, GridManager>,
    id: String,
    start_row: i32,
    start_col: usize,
    end_row: i32,
    end_col: usize,
) -> Result<String, String> {
    grids.selection_text(&id, start_row, start_col, end_row, end_col)
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
    crate::daemon::trace_pty("grid.scroll", format!("id={id} delta={delta}"));
    grids.scroll(&id, delta)
}

#[tauri::command]
pub fn grid_scroll_to_bottom(grids: State<'_, GridManager>, id: String) -> Result<(), String> {
    crate::daemon::trace_pty("grid.scroll_to_bottom", format!("id={id}"));
    grids.scroll_to_bottom(&id)
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
    let (cols, rows) = match state.session_size(&id) {
        Some((c, r)) => (Some(c), Some(r)),
        None => (None, None),
    };
    Ok(PtyEnsureResult {
        id,
        reused,
        cols,
        rows,
    })
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

/// Path of the durable workspace-layout mirror. Lives next to the per-session
/// scrollback so the tab→session mapping survives a localStorage wipe (verifier
/// `RESET_STATE`, dev↔release origin change, browser data clear).
fn workspace_layout_file() -> Result<PathBuf, String> {
    let root = crate::pty::data_root_dir()
        .ok_or_else(|| "Could not resolve data directory".to_string())?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join("workspace.json"))
}

#[tauri::command]
pub fn workspace_layout_save(contents: String) -> Result<(), String> {
    let path = workspace_layout_file()?;
    // Atomic temp+rename so a crash mid-write can't truncate the mirror.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&tmp, &path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_layout_load() -> Result<Option<String>, String> {
    let path = workspace_layout_file()?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(ref error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn workspace_persisted_sessions() -> Vec<crate::pty::PersistedSessionSummary> {
    crate::pty::list_persisted_sessions()
}

#[cfg(test)]
mod tests {
    use super::{
        is_managed_termfleet_worktree_path, normalize_selected_folder, shell_quote,
        workstream_prepare_dedicated_worktree, workstream_remove_dedicated_worktree,
        worktree_branch_for, worktree_target_for,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("termfleet-{name}-{suffix}"))
    }

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn create_git_repo(root: &Path) {
        fs::create_dir_all(root).unwrap();
        git(root, &["init"]);
        git(
            root,
            &["config", "user.email", "termfleet-test@example.invalid"],
        );
        git(root, &["config", "user.name", "TermFleet Test"]);
        fs::write(root.join("README.md"), "termfleet test\n").unwrap();
        git(root, &["add", "README.md"]);
        git(root, &["commit", "-m", "initial"]);
    }

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

    #[test]
    fn shell_quote_handles_single_quotes() {
        assert_eq!(
            shell_quote("/tmp/termfleet's adapter.sh"),
            "'/tmp/termfleet'\\''s adapter.sh'"
        );
    }

    #[test]
    fn worktree_branch_sanitizes_run_id() {
        assert_eq!(
            worktree_branch_for("codex-LX 12_3/ABC"),
            "termfleet/codex-lx-12_3-abc"
        );
    }

    #[test]
    fn worktree_target_uses_sibling_termfleet_directory() {
        let target = worktree_target_for(&PathBuf::from("/tmp/my repo"), "codex/run 1").unwrap();
        assert_eq!(
            target,
            PathBuf::from("/tmp/.termfleet-worktrees/my-repo/codex-run-1")
        );
    }

    #[test]
    fn cleanup_guard_accepts_only_managed_worktree_paths() {
        assert!(is_managed_termfleet_worktree_path(&PathBuf::from(
            "/tmp/.termfleet-worktrees/repo/run"
        )));
        assert!(!is_managed_termfleet_worktree_path(&PathBuf::from(
            "/tmp/repo"
        )));
    }

    #[test]
    fn dedicated_worktree_can_be_provisioned_and_removed() {
        let root = unique_test_dir("worktree-cycle");
        let repo = root.join("repo");
        create_git_repo(&repo);

        let prepared = workstream_prepare_dedicated_worktree(
            Some(repo.display().to_string()),
            "codex-proof-run".to_string(),
        )
        .unwrap();
        assert_eq!(prepared.isolation_status.as_deref(), Some("ready"));
        let worktree_path = prepared.worktree_path.expect("worktree path");
        let worktree = PathBuf::from(&worktree_path);
        assert!(worktree.join(".git").exists());
        assert_eq!(
            fs::read_to_string(worktree.join("README.md")).unwrap(),
            "termfleet test\n"
        );

        let cleanup = workstream_remove_dedicated_worktree(worktree_path).unwrap();
        assert_eq!(cleanup.status, "removed");
        assert!(!worktree.exists());

        fs::remove_dir_all(root).unwrap();
    }
}
