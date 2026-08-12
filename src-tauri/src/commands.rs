use crate::daemon::{
    daemon_ensure_running as current_daemon_ensure_running, daemon_socket_path,
    daemon_status as current_daemon_status, send_daemon_request, DaemonRequest, DaemonResponse,
    DaemonStatus,
};
use crate::daemon_ipc::{self, LocalStream};
use crate::platform_paths;
use crate::pty::{
    update_agent_recovery_manifest, AgentRecoveryManifestUpdate, PtyManager, PtyOutputChunk,
    PtySessionEvent, PtySessionSummary,
};
use crate::vt_grid::{GridManager, DEFAULT_COLS, DEFAULT_ROWS};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::path::PathBuf;
use std::process::{Command, Stdio};
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
    let mut focused = state.0.lock().unwrap();
    if *focused == id {
        return;
    }
    append_paste_log(&format!(
        "focus.set terminal={}",
        id.as_deref().unwrap_or("-")
    ));
    *focused = id;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPressureSnapshot {
    cpu_count: usize,
    load_average_1m: Option<f64>,
    mem_total_bytes: Option<u64>,
    mem_available_bytes: Option<u64>,
    swap_total_bytes: Option<u64>,
    swap_free_bytes: Option<u64>,
    swap_used_bytes: Option<u64>,
    cpu_some_avg10: Option<f64>,
    memory_some_avg10: Option<f64>,
    io_some_avg10: Option<f64>,
    procs_running: Option<u64>,
    procs_blocked: Option<u64>,
}

fn parse_meminfo_bytes(contents: &str) -> HashMap<String, u64> {
    contents
        .lines()
        .filter_map(|line| {
            let (key, rest) = line.split_once(':')?;
            let value_kib = rest
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<u64>().ok())?;
            Some((key.to_string(), value_kib.saturating_mul(1024)))
        })
        .collect()
}

fn parse_pressure_avg10(contents: &str) -> Option<f64> {
    contents
        .lines()
        .find(|line| line.starts_with("some "))
        .and_then(|line| {
            line.split_whitespace()
                .find_map(|part| part.strip_prefix("avg10="))
        })
        .and_then(|value| value.parse::<f64>().ok())
}

fn read_pressure_avg10(path: &str) -> Option<f64> {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| parse_pressure_avg10(&contents))
}

fn read_load_average_1m() -> Option<f64> {
    fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|contents| contents.split_whitespace().next()?.parse::<f64>().ok())
}

fn read_proc_stat_counts() -> (Option<u64>, Option<u64>) {
    let Ok(contents) = fs::read_to_string("/proc/stat") else {
        return (None, None);
    };
    let mut running = None;
    let mut blocked = None;
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("procs_running ") {
            running = value.trim().parse::<u64>().ok();
        }
        if let Some(value) = line.strip_prefix("procs_blocked ") {
            blocked = value.trim().parse::<u64>().ok();
        }
    }
    (running, blocked)
}

#[tauri::command]
pub fn system_pressure_snapshot() -> SystemPressureSnapshot {
    let meminfo = fs::read_to_string("/proc/meminfo")
        .map(|contents| parse_meminfo_bytes(&contents))
        .unwrap_or_default();
    let swap_total_bytes = meminfo.get("SwapTotal").copied();
    let swap_free_bytes = meminfo.get("SwapFree").copied();
    let swap_used_bytes = match (swap_total_bytes, swap_free_bytes) {
        (Some(total), Some(free)) => Some(total.saturating_sub(free)),
        _ => None,
    };
    let (procs_running, procs_blocked) = read_proc_stat_counts();

    SystemPressureSnapshot {
        cpu_count: std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1),
        load_average_1m: read_load_average_1m(),
        mem_total_bytes: meminfo.get("MemTotal").copied(),
        mem_available_bytes: meminfo.get("MemAvailable").copied(),
        swap_total_bytes,
        swap_free_bytes,
        swap_used_bytes,
        cpu_some_avg10: read_pressure_avg10("/proc/pressure/cpu"),
        memory_some_avg10: read_pressure_avg10("/proc/pressure/memory"),
        io_some_avg10: read_pressure_avg10("/proc/pressure/io"),
        procs_running,
        procs_blocked,
    }
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

/// Which agent is actually running in a pane, read from the process table.
///
/// This is what makes a HAND-STARTED agent work with no setup: the operator just
/// types `opencode`, and the pane is recognised immediately — no plugin, no restart,
/// no special launch command. Returns None for a plain shell.
#[tauri::command]
pub fn pane_agent_provider(pane_id: String) -> Option<String> {
    crate::pane_process::pane_agent_provider(&pane_id)
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
pub struct AgentRecoveryManifestPayload {
    id: String,
    cwd: Option<String>,
    provider: Option<String>,
    launch_profile: Option<String>,
    provider_session_id: Option<String>,
    original_command: Option<String>,
    mission: Option<String>,
    dropoff_path: Option<String>,
    sanitized_resume_command: Option<String>,
    restore_status: Option<String>,
    restore_failure_reason: Option<String>,
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
pub fn daemon_update_agent_recovery_manifest(
    payload: AgentRecoveryManifestPayload,
) -> Result<(), String> {
    update_agent_recovery_manifest(
        &payload.id,
        AgentRecoveryManifestUpdate {
            cwd: payload.cwd,
            provider: payload.provider,
            launch_profile: payload.launch_profile,
            provider_session_id: payload.provider_session_id,
            original_command: payload.original_command,
            mission: payload.mission,
            dropoff_path: payload.dropoff_path,
            sanitized_resume_command: payload.sanitized_resume_command,
            restore_status: payload.restore_status,
            restore_failure_reason: payload.restore_failure_reason,
        },
    )
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
    attach_token: Option<String>,
) -> Result<(), String> {
    let cols = cols.filter(|value| *value > 0).unwrap_or(DEFAULT_COLS);
    let rows = rows.filter(|value| *value > 0).unwrap_or(DEFAULT_ROWS);
    crate::daemon::trace_pty("grid.attach", format!("id={id} cols={cols} rows={rows}"));
    grids.attach(&id, cols, rows, attach_token)
}

#[tauri::command]
pub fn grid_snapshot(grids: State<'_, GridManager>, id: String) -> Result<String, String> {
    grids.snapshot(&id)
}

#[tauri::command]
pub fn grid_revision(grids: State<'_, GridManager>, id: String) -> Result<u64, String> {
    grids.revision(&id)
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
pub fn grid_detach(grids: State<'_, GridManager>, id: String, attach_token: Option<String>) {
    grids.detach(&id, attach_token.as_deref());
}

#[tauri::command]
pub fn grid_search(
    grids: State<'_, GridManager>,
    id: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<crate::search::Match>, String> {
    grids.search(&id, &query, case_sensitive)
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTaskSummaryInput {
    workspace: Option<String>,
    opening_request: Option<String>,
    operator_request: Option<String>,
    main_task: Option<String>,
    conversation_summary: Option<String>,
    plan: Vec<String>,
    current_step: Option<String>,
    recent_activity: Option<String>,
}

fn clipped(value: Option<&str>, limit: usize) -> Option<String> {
    value.map(|text| text.chars().take(limit).collect())
}

/// Ask the operator's local model to name the whole conversation once. The frontend
/// fingerprints and caches the result, so the four-second status poll never turns into
/// repeated inference. Failure is intentionally quiet: the deterministic task ladder
/// remains the complete offline fallback.
#[tauri::command]
pub async fn agent_context_task_title(
    context: ContextTaskSummaryInput,
    rejected_title: Option<String>,
) -> Result<Option<String>, String> {
    use tokio::io::AsyncWriteExt;

    let endpoint = std::env::var("TERMFLEET_OLLAMA_URL")
        .ok()
        .filter(|url| url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:"))
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let endpoint = endpoint.trim_end_matches('/');
    let endpoint = if endpoint.ends_with("/api/generate") {
        endpoint.to_string()
    } else {
        format!("{endpoint}/api/generate")
    };
    let timeout_ms = std::env::var("TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(25_000)
        .clamp(1_000, 60_000);
    let timeout_seconds = format!("{:.3}", timeout_ms as f64 / 1000.0);
    let model =
        std::env::var("TERMFLEET_TASK_CONTEXT_MODEL").unwrap_or_else(|_| "qwen2.5:7b".to_string());
    let bounded_context = serde_json::json!({
        "workspace": clipped(context.workspace.as_deref(), 160),
        "originalRequest": clipped(context.opening_request.as_deref(), 5000),
        "latestRequest": clipped(context.operator_request.as_deref(), 1200),
        "declaredTask": clipped(context.main_task.as_deref(), 600),
        "conversationSummary": clipped(context.conversation_summary.as_deref(), 1200),
        "plan": context.plan.iter().take(16).map(|item| item.chars().take(500).collect::<String>()).collect::<Vec<_>>(),
        "currentStep": clipped(context.current_step.as_deref(), 600),
        "recentActivity": clipped(context.recent_activity.as_deref(), 600),
    });
    let correction = rejected_title
        .as_deref()
        .map(|title| format!(" Previous draft was rejected: {title}. It omitted or distorted the concrete subject. Identify the most specific named feature or object in conversationSummary first, then include that exact subject in the rewrite."))
        .unwrap_or_default();
    let prompt = format!(
        "Return only JSON: {{\"title\":string}}. Name the WHOLE conversation for a nontechnical person. Use 6 to 12 ordinary words separated by spaces; concatenated words are invalid. Follow this spacing shape only: {{\"title\":\"Keeping Example Product customer outcome clear and reliable\"}}. Replace every word after Keeping with words from the supplied context; Example, Product, customer, and outcome may not appear in the answer. The FIRST WORD MUST BE one of: Making, Improving, Protecting, Simplifying, Restoring, Redesigning, Connecting, Keeping, Helping. NEVER begin with Testing, Checking, Verifying, Adding, Implementing, Reviewing, Running, Investigating, Tracing, or Auditing. Include the recognizable workspace or product name AND the central user-facing subject from the original request, processed agent outcome, or plan. If the processed agent outcome names a concrete feature or object, preserve that subject verbatim. Never replace a named subject with a generic stand-in such as fix, task, work, issue, change, process, or outcome. Preserve every distinct user-facing outcome explicitly named in the original request; do not collapse a multi-part goal into a generic flow. Say the shared user or product outcome, not one plan step. Never name implementation, tests, coverage, tools, branches, sandboxes, files, checks, progress, or the latest reply. Never claim real transactions, production readiness, deployment, completion, or success. Ground every product, subject, and outcome noun in the supplied context; do not introduce a domain or feature that the context does not name.{correction} Context={bounded_context}"
    );
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "format": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "minLength": 20,
                    "maxLength": 120,
                    "pattern": r"^[^\s]+(?:\s+[^\s]+){5,11}$"
                }
            },
            "required": ["title"]
        },
        "options": {
            "temperature": 0,
            "num_ctx": 4096,
            "num_predict": 80
        }
    })
    .to_string();

    let mut child = tokio::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            timeout_seconds.as_str(),
            "--header",
            "content-type: application/json",
            "--data-binary",
            "@-",
            endpoint.as_str(),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("start local task model: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(body.as_bytes())
            .await
            .map_err(|error| format!("write local task model request: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("wait for local task model: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let outer: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let generated = match outer.get("response").and_then(|value| value.as_str()) {
        Some(value) => value.trim(),
        None => return Ok(None),
    };
    if std::env::var("TERMFLEET_CONTEXT_TITLE_TRACE").as_deref() == Ok("1") {
        eprintln!(
            "TERMFLEET_CONTEXT_TITLE_TRACE context={} generated={}",
            bounded_context, generated
        );
    }
    let json = match (generated.find('{'), generated.rfind('}')) {
        (Some(start), Some(end)) if end > start => &generated[start..=end],
        _ => generated,
    };
    let parsed: serde_json::Value = match serde_json::from_str(json) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    Ok(parsed
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

/// Resolve + validate an agent-status sidecar file inside the fixed status directory.
/// The frontend computes the file NAME (fnv-keyed; see `src/lib/agentStatusSidecar.ts`,
/// parity with `scripts/lib/agent-status-paths.mjs`); Rust owns the directory so a
/// hostile name can't escape it. `dirs::data_dir()` honors `XDG_DATA_HOME`, matching
/// the node hook's `statusDir()`.
fn agent_status_sidecar_file(file_name: &str) -> Result<std::path::PathBuf, String> {
    let valid = !file_name.is_empty()
        && file_name.len() <= 64
        && file_name.ends_with(".json")
        && !file_name.contains("..")
        && file_name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.');
    if !valid {
        return Err(format!("invalid agent-status file name: {file_name}"));
    }
    Ok(dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("terminal-workspace")
        .join("agent-status")
        .join(file_name))
}

/// Read an agent-status sidecar file for the cockpit title/TASKS panel. Lets the app
/// read the agent's real task list directly from disk in EVERY launch mode, instead of
/// depending on the launcher-lifetime HTTP status server (which desktop launches never
/// had — the root cause the panel kept going dark). Missing file → `Ok(None)`.
/// Is this provider conversation already open in a live agent OTHER than the
/// one in `pane_id`?
///
/// Answers the question the cockpit must ask before typing a resume command
/// into a terminal. A pane can be an empty shell while its original agent is
/// still running, because the PTY daemon deliberately survives a window
/// replacement — so "no agent in this pane" does not mean "nobody owns this
/// conversation". Resuming anyway makes the provider reject it with "already
/// has an active writer", and when two writers briefly overlap the transcript
/// gains a duplicated record, which permanently breaks forking that
/// conversation (observed 2026-08-12).
///
/// Ownership is determined the only way that cannot lie: whether a live process
/// holds the conversation's transcript open. Fails closed — an error answers
/// "owned", because a missed reconnect is fixable by hand and a corrupted
/// transcript is not.
#[tauri::command]
pub fn agent_conversation_has_other_owner(
    provider: String,
    session_id: String,
    pane_id: String,
) -> Result<bool, String> {
    if session_id.trim().is_empty() {
        return Ok(true);
    }
    let _ = (&provider, &pane_id);

    let Ok(entries) = fs::read_dir("/proc") else {
        return Ok(true);
    };
    let self_pid = std::process::id();
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .filter(|value| value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|pid| *pid > 1 && *pid != self_pid)
        else {
            continue;
        };
        let fd_dir = entry.path().join("fd");
        let Ok(fds) = fs::read_dir(&fd_dir) else {
            continue; // not ours to inspect
        };
        for fd in fds.flatten() {
            let Ok(target) = fs::read_link(fd.path()) else {
                continue;
            };
            let target = target.to_string_lossy();
            let is_transcript =
                target.contains("/.codex/sessions/") || target.contains("/.claude/projects/");
            if is_transcript && target.contains(session_id.trim()) {
                let _ = pid;
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn agent_status_read_sidecar(file_name: String) -> Result<Option<String>, String> {
    let path = agent_status_sidecar_file(&file_name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read {}: {error}", path.display())),
    }
}

/// Read the OS clipboard's text from the backend, NOT the webview.
///
/// `navigator.clipboard.readText()` is unreliable/blocked inside a WebKitGTK
/// webview (copy via writeText works, read does not), which is why Ctrl+Shift+V
/// text paste kept breaking. We read the real X11/Wayland clipboard here instead.
///
/// This is an `async` command on purpose: a *synchronous* clipboard read can
/// deadlock the GTK main thread on WebKitGTK (tauri-apps/plugins-workspace#2267).
/// Running `tokio::process` keeps it off the blocking path. Returns "" (not an
/// error) when the clipboard has no text — e.g. it holds an image — so the caller
/// can fall back to forwarding Ctrl-V (`\x16`) and let the agent read the image.
#[tauri::command]
pub async fn clipboard_read_text(corr_id: Option<String>) -> Result<String, String> {
    let cid = corr_id.unwrap_or_default();
    // Wayland first, then X11. Each returns text only; on an image-only clipboard
    // they exit non-zero / empty, so we surface "" and let the image path run.
    let attempts: [(&str, &[&str]); 3] = [
        ("wl-paste", &["--no-newline", "--type", "text/plain"]),
        ("xclip", &["-selection", "clipboard", "-o"]),
        ("xsel", &["--clipboard", "--output"]),
    ];
    for (bin, args) in attempts {
        // Only a SUCCESSFUL read is authoritative. A non-zero exit means either the
        // wrong display server (e.g. wl-paste on X11) or no text on the clipboard —
        // both indistinguishable here — so fall through to the next tool, and only
        // report "" (→ image/agent path) once every tool has been tried.
        let start = std::time::Instant::now();
        match tokio::process::Command::new(bin).args(args).output().await {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout).to_string();
                plog(
                    &cid,
                    &format!(
                        "backend.read OK tool={} len={} ms={} display={}",
                        bin,
                        text.len(),
                        start.elapsed().as_millis(),
                        display_backend()
                    ),
                );
                return Ok(text);
            }
            Ok(output) => plog(
                &cid,
                &format!(
                    "backend.read miss tool={} exit={:?} stderr={:?} ms={}",
                    bin,
                    output.status.code(),
                    String::from_utf8_lossy(&output.stderr).trim(),
                    start.elapsed().as_millis()
                ),
            ),
            Err(err) => plog(
                &cid,
                &format!(
                    "backend.read spawn-fail tool={} err={} ms={}",
                    bin,
                    err,
                    start.elapsed().as_millis()
                ),
            ),
        }
    }
    plog(
        &cid,
        &format!(
            "backend.read EMPTY (all tools exhausted) display={}",
            display_backend()
        ),
    );
    Ok(String::new())
}

/// Write text to the OS clipboard from the backend, NOT the webview.
///
/// `navigator.clipboard.writeText()` is unreliable in WebKitGTK (tauri#10835), so
/// copying inside the app would silently not land on the clipboard. We set the
/// real X11/Wayland selection here. The clipboard tools daemonize themselves to
/// keep serving the selection after we return, so a later `clipboard_read_text`
/// (or any app) can read it.
#[tauri::command]
pub async fn clipboard_write_text(text: String, corr_id: Option<String>) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let cid = corr_id.unwrap_or_default();
    let attempts: [(&str, &[&str]); 3] = [
        ("wl-copy", &[]),
        ("xclip", &["-selection", "clipboard"]),
        ("xsel", &["--clipboard", "--input"]),
    ];
    for (bin, args) in attempts {
        let start = std::time::Instant::now();
        let spawned = tokio::process::Command::new(bin)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(err) => {
                plog(
                    &cid,
                    &format!("backend.write spawn-fail tool={} err={}", bin, err),
                );
                continue; // tool not installed / wrong display server
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes()).await;
            let _ = stdin.shutdown().await; // close stdin so the tool takes ownership
        }
        // The foreground process forks a daemon to serve the selection and exits;
        // waiting on it returns promptly while the daemon keeps the clipboard set.
        let _ = child.wait().await;
        plog(
            &cid,
            &format!(
                "backend.write OK tool={} len={} ms={} display={}",
                bin,
                text.len(),
                start.elapsed().as_millis(),
                display_backend()
            ),
        );
        return Ok(());
    }
    plog(
        &cid,
        &format!(
            "backend.write FAILED (no clipboard tool) display={}",
            display_backend()
        ),
    );
    Err("no clipboard tool available".into())
}

/// Path of the rolling paste-diagnostics log (so the user/agent can `tail` it).
pub fn paste_log_path() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("terminal-workspace")
        .join("paste-debug.log")
}

/// Active display server, logged on every clipboard op so X11/Wayland mismatches
/// (e.g. wl-paste failing on X11) are obvious in the trace.
fn display_backend() -> &'static str {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        "wayland"
    } else if std::env::var_os("DISPLAY").is_some() {
        "x11"
    } else {
        "none"
    }
}

/// Append a correlated diagnostic line: `<ts> corr=<id> <msg>`. The correlation id
/// (generated per copy/paste in the frontend) threads the webview keystroke, this
/// backend read/write, and the PTY injection into one ordered trace.
fn plog(corr_id: &str, msg: &str) {
    append_paste_log(&format!(
        "corr={} {}",
        if corr_id.is_empty() { "-" } else { corr_id },
        msg
    ));
}

fn sanitize_paste_log_line(line: &str) -> String {
    const MAX_LINE_BYTES: usize = 900;
    let mut out = String::with_capacity(line.len().min(MAX_LINE_BYTES));
    for ch in line.chars() {
        let mapped = if ch == '\n' || ch == '\r' || ch == '\t' {
            ' '
        } else if ch.is_ascii_graphic() || ch == ' ' {
            ch
        } else {
            '?'
        };
        if out.len() + mapped.len_utf8() > MAX_LINE_BYTES {
            out.push_str("...");
            break;
        }
        out.push(mapped);
    }
    out
}

fn rotate_paste_log_if_needed(path: &std::path::Path) {
    const MAX_LOG_BYTES: u64 = 256 * 1024;
    if std::fs::metadata(path)
        .map(|metadata| metadata.len() <= MAX_LOG_BYTES)
        .unwrap_or(true)
    {
        return;
    }
    let rotated = path.with_extension("log.1");
    let _ = std::fs::rename(path, rotated);
}

/// Append one timestamped ASCII diagnostic line. Best-effort, never fails a paste.
pub(crate) fn append_paste_log(line: &str) {
    use std::io::Write;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = paste_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    rotate_paste_log_if_needed(&path);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{ms} {}", sanitize_paste_log_line(line));
    }
}

/// Frontend hook into the same paste-diagnostics log so a single ordered trace
/// captures both the React paste path and the backend clipboard read.
#[tauri::command]
pub fn paste_debug_log(line: String) {
    append_paste_log(&format!("ui.{line}"));
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
pub fn fs_open_external(path: String) -> Result<(), String> {
    let launchers: [(&str, &[&str]); 3] = [("kate", &[]), ("xdg-open", &[]), ("gio", &["open"])];

    for (command, args) in launchers {
        let mut child = Command::new(command);
        child
            .args(args)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if child.spawn().is_ok() {
            return Ok(());
        }
    }

    Err(
        "Could not find Kate or another desktop opener (tried kate, xdg-open, and gio)."
            .to_string(),
    )
}

#[tauri::command]
pub fn fs_write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

/// Persist the rendered cockpit identity from the installed WebView without relying on
/// a helper HTTP server being present. The frontend payload is already bounded to the
/// visible panes; keep the write inside TermFleet's own agent-status directory.
#[tauri::command]
pub fn cockpit_snapshot_write(contents: String) -> Result<(), String> {
    use std::io::Write;
    const MAX_TRACE_BYTES: u64 = 25 * 1024 * 1024;

    // Older dock windows can outlive a release restart and still call this command.
    // They must not reintroduce the retired synthetic identity contract into the
    // shared snapshot that the verifier and the current dock read.
    if contents.contains("Working toward:")
        || contents.contains("Ready to work in the ")
        || contents.contains("Supporting work in the ")
        || contents.contains("Ready to receive work in ")
    {
        return Ok(());
    }

    let root = crate::pty::data_root_dir()
        .ok_or_else(|| "Could not resolve data directory".to_string())?
        .join("agent-status");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let snapshot = root.join("cockpit-snapshot.json");
    let temporary = root.join("cockpit-snapshot.json.tmp");
    fs::write(&temporary, contents.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &snapshot).map_err(|error| error.to_string())?;

    let trace = root.join("cockpit-header-trace.jsonl");
    let incoming_bytes = contents.len() as u64 + 1;
    if fs::metadata(&trace)
        .map(|metadata| metadata.len().saturating_add(incoming_bytes) > MAX_TRACE_BYTES)
        .unwrap_or(false)
    {
        let previous = root.join("cockpit-header-trace.jsonl.1");
        let _ = fs::remove_file(&previous);
        fs::rename(&trace, &previous).map_err(|error| error.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(trace)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{contents}").map_err(|error| error.to_string())
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
        agent_status_sidecar_file, is_managed_termfleet_worktree_path, normalize_selected_folder,
        parse_meminfo_bytes, parse_pressure_avg10, sanitize_paste_log_line, shell_quote,
        workstream_prepare_dedicated_worktree, workstream_remove_dedicated_worktree,
        worktree_branch_for, worktree_target_for,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn system_pressure_meminfo_parser_converts_kib_to_bytes() {
        let parsed = parse_meminfo_bytes(
            "MemTotal:       81788928 kB\nMemAvailable:   30408704 kB\nSwapTotal:      33554428 kB\nSwapFree:       11534336 kB\n",
        );

        assert_eq!(parsed.get("MemTotal"), Some(&(81788928 * 1024)));
        assert_eq!(parsed.get("MemAvailable"), Some(&(30408704 * 1024)));
        assert_eq!(parsed.get("SwapTotal"), Some(&(33554428 * 1024)));
        assert_eq!(parsed.get("SwapFree"), Some(&(11534336 * 1024)));
    }

    #[test]
    fn system_pressure_psi_parser_reads_some_avg10() {
        let parsed = parse_pressure_avg10(
            "some avg10=4.25 avg60=2.00 avg300=1.00 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
        );

        assert_eq!(parsed, Some(4.25));
    }

    #[test]
    fn agent_status_sidecar_file_accepts_valid_names_inside_status_dir() {
        let path = agent_status_sidecar_file("pane-0888c672.json").expect("valid pane name");
        assert!(path.ends_with("terminal-workspace/agent-status/pane-0888c672.json"));
        let cwd_keyed = agent_status_sidecar_file("41ad229e.json").expect("valid cwd name");
        assert!(cwd_keyed.ends_with("terminal-workspace/agent-status/41ad229e.json"));
    }

    #[test]
    fn agent_status_sidecar_file_rejects_traversal_and_foreign_names() {
        for name in [
            "",
            "../secrets.json",
            "..%2fsecrets.json",
            "/etc/passwd",
            "pane/../../x.json",
            "pane-0888c672.txt",
            "PANE-0888C672.JSON",
            "pane 0888c672.json",
            "cockpit-header-trace.jsonl",
        ] {
            assert!(
                agent_status_sidecar_file(name).is_err(),
                "expected rejection for {name:?}"
            );
        }
    }

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
    fn paste_log_lines_are_ascii_single_line() {
        assert_eq!(
            sanitize_paste_log_line("read returned len=27 \u{2192} sending\nnext\tfield"),
            "read returned len=27 ? sending next field"
        );
    }

    #[test]
    fn paste_log_lines_are_bounded() {
        let sanitized = sanitize_paste_log_line(&"x".repeat(1200));
        assert!(sanitized.len() <= 903);
        assert!(sanitized.ends_with("..."));
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

// ---------------------------------------------------------------------------
// TC-060: vendor session records + a pane's running command.
//
// Claude Code and Codex each write a complete session record to disk on their
// own, with no hook involvement, so these cover hand-started and long-running
// panes — the exact class that used to render "Task not captured". Rust owns the
// directories so a hostile session id can't escape them; the frontend supplies
// only the id and does all parsing (see `src/lib/sessionTranscript.ts`).
// ---------------------------------------------------------------------------

/// Rollouts reach 11.7 MB; only the tail carries current state.
pub const TRANSCRIPT_TAIL_BYTES: usize = 262_144;
pub const TRANSCRIPT_CONTEXT_BYTES: usize = 262_144;

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 64
        && session_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn read_tail(path: &std::path::Path, max_bytes: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let len = file
        .metadata()
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .len();
    let take = std::cmp::min(max_bytes as u64, len);
    file.seek(SeekFrom::Start(len - take))
        .map_err(|e| format!("seek {}: {e}", path.display()))?;
    let mut buf = vec![0u8; take as usize];
    file.read_exact(&mut buf)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn is_relevant_transcript_record(line: &str) -> bool {
    let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    if record.get("isSidechain").and_then(|value| value.as_bool()) == Some(true) {
        return false;
    }
    if record.get("type").and_then(|value| value.as_str()) == Some("user") {
        let content = record
            .get("message")
            .and_then(|message| message.get("content"));
        return content.is_some_and(|content| {
            content.is_string()
                || content.as_array().is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block.get("type").and_then(|value| value.as_str()) == Some("text")
                    })
                })
        });
    }
    record
        .get("payload")
        .and_then(|payload| payload.get("type"))
        .and_then(|value| value.as_str())
        == Some("user_message")
}

fn read_relevant_transcript_records(
    path: &std::path::Path,
    max_bytes: usize,
) -> Result<String, String> {
    use std::collections::VecDeque;
    use std::io::BufRead;

    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut records: VecDeque<String> = VecDeque::new();
    let mut bytes = 0usize;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| format!("read {}: {e}", path.display()))?;
        let line_bytes = line.len() + 1;
        if line_bytes > max_bytes || !is_relevant_transcript_record(&line) {
            continue;
        }
        while bytes + line_bytes > max_bytes {
            if let Some(removed) = records.pop_front() {
                bytes -= removed.len() + 1;
            } else {
                break;
            }
        }
        bytes += line_bytes;
        records.push_back(line);
    }
    Ok(records.into_iter().collect::<Vec<_>>().join("\n"))
}

fn find_file_named(
    root: &std::path::Path,
    depth: usize,
    matches: &dyn Fn(&str) -> bool,
) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            dirs.push(entry.path());
        } else if matches(&name) {
            return Some(entry.path());
        }
    }
    if depth == 0 {
        return None;
    }
    for dir in dirs {
        if let Some(found) = find_file_named(&dir, depth - 1, matches) {
            return Some(found);
        }
    }
    None
}

fn session_transcript_path_in(
    home: &std::path::Path,
    provider: &str,
    session_id: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    if !valid_session_id(session_id) {
        return Err(format!("invalid session id: {session_id}"));
    }
    match provider {
        "claude" => {
            let wanted = format!("{session_id}.jsonl");
            Ok(find_file_named(
                &home.join(".claude").join("projects"),
                2,
                &|name| name == wanted,
            ))
        }
        "codex" => {
            let suffix = format!("-{session_id}.jsonl");
            Ok(find_file_named(
                &home.join(".codex").join("sessions"),
                4,
                &|name| name.starts_with("rollout-") && name.ends_with(&suffix),
            ))
        }
        other => Err(format!("unknown provider: {other}")),
    }
}

pub fn session_transcript_path(
    provider: &str,
    session_id: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home directory".to_string())?;
    session_transcript_path_in(&home, provider, session_id)
}

/// Tail of a vendor session record for the cockpit task line. Missing file → `Ok(None)`.
#[tauri::command]
pub fn session_transcript_read(
    provider: String,
    session_id: String,
) -> Result<Option<String>, String> {
    match session_transcript_path(&provider, &session_id)? {
        Some(path) => Ok(Some(read_tail(&path, TRANSCRIPT_TAIL_BYTES)?)),
        None => Ok(None),
    }
}

/// Bounded request history from across the record. This recovers concrete goals that
/// verbose tool output pushed out of both the opening and tail windows.
#[tauri::command]
pub fn session_transcript_context_read(
    provider: String,
    session_id: String,
) -> Result<Option<String>, String> {
    match session_transcript_path(&provider, &session_id)? {
        Some(path) => Ok(Some(read_relevant_transcript_records(
            &path,
            TRANSCRIPT_CONTEXT_BYTES,
        )?)),
        None => Ok(None),
    }
}

/// The operator's opening request lives at the START of the record, so the tail can never
/// carry it — the tail holds the latest prompt ("/done", "go"). Without this the Task row
/// had to fall back to the agent's own session title, which is sometimes a slug
/// ("exercise-demo-gif-pipeline") that says nothing a week later.
pub const TRANSCRIPT_HEAD_BYTES: usize = 65_536;
pub const TRANSCRIPT_OPENING_SCAN_BYTES: usize = 4 * 1024 * 1024;

fn read_head(path: &std::path::Path, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut buf = vec![0u8; max_bytes];
    let read = file
        .read(&mut buf)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    buf.truncate(read);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn is_opening_record(record: &serde_json::Value, provider: &str) -> bool {
    match provider {
        "claude" => {
            record.get("type").and_then(serde_json::Value::as_str) == Some("user")
                && record
                    .get("isSidechain")
                    .and_then(serde_json::Value::as_bool)
                    != Some(true)
        }
        "codex" => {
            let payload = match record.get("payload") {
                Some(value) => value,
                None => return false,
            };
            payload.get("type").and_then(serde_json::Value::as_str) == Some("user_message")
                || (record.get("type").and_then(serde_json::Value::as_str) == Some("response_item")
                    && payload.get("type").and_then(serde_json::Value::as_str) == Some("message")
                    && payload.get("role").and_then(serde_json::Value::as_str) == Some("user"))
        }
        _ => false,
    }
}

fn read_opening_record(
    path: &std::path::Path,
    provider: &str,
    max_bytes: usize,
) -> Result<String, String> {
    use std::io::BufRead;

    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut reader = std::io::BufReader::new(file);
    let mut line = String::new();
    let mut scanned = 0usize;
    let mut records = Vec::new();
    while scanned < max_bytes {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        scanned = scanned.saturating_add(read);
        if let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) {
            if is_opening_record(&record, provider) {
                records.push(line.trim_end_matches(['\r', '\n']).to_string());
                if records.len() >= 8 {
                    break;
                }
            }
        }
    }
    if records.is_empty() {
        read_head(path, TRANSCRIPT_HEAD_BYTES)
    } else {
        Ok(records.join("\n"))
    }
}

/// Head of a vendor session record — the opening request. Missing file → `Ok(None)`.
/// Same allowlisted directories and the same session-id validation as the tail reader.
#[tauri::command]
pub fn session_transcript_head_read(
    provider: String,
    session_id: String,
) -> Result<Option<String>, String> {
    match session_transcript_path(&provider, &session_id)? {
        Some(path) => Ok(Some(read_opening_record(
            &path,
            &provider,
            TRANSCRIPT_OPENING_SCAN_BYTES,
        )?)),
        None => Ok(None),
    }
}

/// A plain shell has no declared task, so the honest answer is what it is actually
/// running. The daemon already owns each pane's PTY and pid, so this needs no
/// cooperation from anything. `root` is injectable so the parse is testable.
pub fn foreground_command_from_proc(root: &std::path::Path, pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(root.join(pid.to_string()).join("stat")).ok()?;
    // The comm field is parenthesised and may contain spaces; fields resume after ") ".
    let rest = stat.rsplit_once(") ")?.1;
    // After ") " the fields are state, ppid, pgrp, session, tty_nr, tpgid.
    let tpgid: i32 = rest.split_whitespace().nth(5)?.parse().ok()?;
    if tpgid <= 0 || tpgid as u32 == pid {
        return None;
    }
    let raw = std::fs::read(root.join(tpgid.to_string()).join("cmdline")).ok()?;
    let text = String::from_utf8_lossy(&raw)
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(80).collect())
    }
}

/// The command a pane is running right now, or `None` when it sits at its prompt.
#[tauri::command]
pub fn pane_foreground_command(pid: u32) -> Result<Option<String>, String> {
    Ok(foreground_command_from_proc(
        std::path::Path::new("/proc"),
        pid,
    ))
}

#[cfg(test)]
mod tc060_tests {
    use super::*;

    #[test]
    fn rejects_hostile_session_ids() {
        let home = std::path::Path::new("/nonexistent-home");
        assert!(session_transcript_path_in(home, "claude", "../../etc/passwd").is_err());
        assert!(session_transcript_path_in(home, "claude", "").is_err());
        assert!(
            session_transcript_path_in(home, "nope", "abcdef12-1111-2222-3333-444444444444")
                .is_err()
        );
    }

    #[test]
    fn finds_a_session_record_by_id() {
        let home = std::env::temp_dir().join("tf-tc060-home");
        std::fs::remove_dir_all(&home).ok();
        let claude = home.join(".claude").join("projects").join("-some-project");
        std::fs::create_dir_all(&claude).unwrap();
        let id = "abcdef12-1111-2222-3333-444444444444";
        std::fs::write(claude.join(format!("{id}.jsonl")), "{}\n").unwrap();
        let found = session_transcript_path_in(&home, "claude", id).unwrap();
        assert!(found.is_some(), "claude record should be found");

        let codex = home.join(".codex").join("sessions").join("2026").join("07");
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(
            codex.join(format!("rollout-2026-07-22T10-00-00-{id}.jsonl")),
            "{}\n",
        )
        .unwrap();
        assert!(session_transcript_path_in(&home, "codex", id)
            .unwrap()
            .is_some());
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn reads_the_opening_lines_of_a_large_file() {
        // The operator's first request lives at the START; the tail can never carry it.
        let dir = std::env::temp_dir().join("tf-tc060-head");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("big.jsonl");
        let mut body = String::from("{\"first\":\"the opening ask\"}\n");
        body.push_str(&"y".repeat(TRANSCRIPT_HEAD_BYTES * 2));
        std::fs::write(&file, body).unwrap();
        let head = read_head(&file, TRANSCRIPT_HEAD_BYTES).unwrap();
        assert!(head.starts_with("{\"first\":\"the opening ask\"}"));
        assert!(head.len() <= TRANSCRIPT_HEAD_BYTES);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn finds_the_first_codex_user_message_after_oversized_startup_context() {
        let dir = std::env::temp_dir().join("tf-tc060-large-codex-opening");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rollout.jsonl");
        let oversized = serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "developer",
                "content": [{"type": "input_text", "text": "x".repeat(TRANSCRIPT_HEAD_BYTES * 2)}]
            }
        });
        let opening = r#"{"type":"event_msg","payload":{"type":"user_message","message":"Continue the Bina paid-reservation work with refunds"}}"#;
        std::fs::write(&file, format!("{oversized}\n{opening}\n")).unwrap();

        let head = read_opening_record(&file, "codex", TRANSCRIPT_OPENING_SCAN_BYTES).unwrap();

        assert_eq!(head, opening);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keeps_scanning_after_a_codex_user_role_instruction_wrapper() {
        let dir = std::env::temp_dir().join("tf-tc060-codex-wrapper");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rollout.jsonl");
        let wrapper = r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for the project"}]}}"##;
        let opening = r#"{"type":"event_msg","payload":{"type":"user_message","message":"Continue the Bina paid-reservation work with refunds"}}"#;
        std::fs::write(&file, format!("{wrapper}\n{opening}\n")).unwrap();

        let head = read_opening_record(&file, "codex", TRANSCRIPT_OPENING_SCAN_BYTES).unwrap();

        assert!(head.contains(wrapper));
        assert!(head.contains(opening));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn tails_only_the_last_bytes_of_a_large_file() {
        let dir = std::env::temp_dir().join("tf-tc060-tail");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("big.jsonl");
        std::fs::write(&file, "x".repeat(TRANSCRIPT_TAIL_BYTES + 5000)).unwrap();
        let tail = read_tail(&file, TRANSCRIPT_TAIL_BYTES).unwrap();
        assert_eq!(tail.len(), TRANSCRIPT_TAIL_BYTES);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovers_relevant_user_records_from_the_transcript_middle() {
        let dir = std::env::temp_dir().join("tf-tc060-context");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("big.jsonl");
        let concrete =
            r#"{"type":"user","message":{"content":"redesign the arcade game and its controls"}}"#;
        let body = [
            r#"{"type":"user","message":{"content":"lets continue from where we left off"}}"#,
            &"x".repeat(TRANSCRIPT_TAIL_BYTES),
            concrete,
            &"y".repeat(TRANSCRIPT_TAIL_BYTES),
            r#"{"type":"user","message":{"content":"lets start on the first task"}}"#,
        ]
        .join("\n");
        std::fs::write(&file, body).unwrap();

        let context = read_relevant_transcript_records(&file, TRANSCRIPT_CONTEXT_BYTES).unwrap();

        assert!(context.contains(concrete));
        assert!(context.len() <= TRANSCRIPT_CONTEXT_BYTES);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn write_fake_proc(root: &std::path::Path, pid: u32, tpgid: i32, cmdline: &str) {
        let dir = root.join(pid.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("stat"),
            format!("{pid} (bash) S 1 2 3 4 {tpgid} 0 0 0 0"),
        )
        .unwrap();
        std::fs::write(dir.join("cmdline"), cmdline.replace(' ', "\0")).unwrap();
    }

    #[test]
    fn reports_the_foreground_command() {
        let root = std::env::temp_dir().join("tf-tc060-proc");
        std::fs::remove_dir_all(&root).ok();
        write_fake_proc(&root, 100, 200, "bash");
        write_fake_proc(&root, 200, 200, "npm run build");
        assert_eq!(
            foreground_command_from_proc(&root, 100).as_deref(),
            Some("npm run build")
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reports_none_when_the_shell_itself_is_in_front() {
        let root = std::env::temp_dir().join("tf-tc060-proc2");
        std::fs::remove_dir_all(&root).ok();
        write_fake_proc(&root, 100, 100, "bash");
        assert_eq!(foreground_command_from_proc(&root, 100), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_process_is_not_an_error() {
        let root = std::env::temp_dir().join("tf-tc060-missing");
        assert_eq!(foreground_command_from_proc(&root, 999_999), None);
    }
}
