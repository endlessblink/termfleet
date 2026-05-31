use crate::pty::{PtyManager, PtyOutputChunk, PtySessionSummary};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SOCKET_DIR_NAME: &str = "terminal-workspace";
const SOCKET_FILE_NAME: &str = "daemon.sock";
const STATUS_COMMAND: &[u8] = b"status\n";
const PROTOCOL_VERSION: u16 = 1;
pub const DAEMON_ARG: &str = "--terminal-workspace-daemon";
pub const DAEMON_STDIO_ARG: &str = "--terminal-workspace-daemon-stdio";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DaemonRequest {
    Status,
    EnsureSession {
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
        // Spawn the PTY at the caller's measured size so a fresh shell prints its
        // first prompt at the real width (no spawn-at-80-then-resize duplicate).
        // `default` keeps older clients that omit these fields decodable.
        #[serde(default)]
        cols: Option<u16>,
        #[serde(default)]
        rows: Option<u16>,
    },
    WriteSession {
        id: String,
        data: String,
    },
    InputStream {
        id: String,
    },
    ResizeSession {
        id: String,
        cols: u16,
        rows: u16,
    },
    SnapshotSession {
        id: String,
    },
    ReadSession {
        id: String,
        offset: u64,
    },
    SubscribeSession {
        id: String,
        subscriber_id: String,
    },
    UnsubscribeSession {
        id: String,
        subscriber_id: String,
    },
    GetSessionCwd {
        id: String,
    },
    KillSession {
        id: String,
    },
    ListSessions,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DaemonResponse {
    Status(DaemonStatus),
    EnsureSession { id: String, reused: bool },
    WriteSession { ok: bool },
    ResizeSession { ok: bool },
    SnapshotSession { data: String },
    ReadSession(PtyOutputChunk),
    SessionData { data: String },
    UnsubscribeSession { ok: bool },
    GetSessionCwd { cwd: String },
    KillSession { ok: bool },
    ListSessions { sessions: Vec<PtySessionSummary> },
    Error { message: String },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    pub socket_path: String,
    pub reachable: bool,
    pub mode: DaemonMode,
    pub protocol_version: u16,
    pub pid: Option<u32>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DaemonMode {
    EmbeddedFallback,
    ExternalDaemon,
}

pub fn daemon_status() -> DaemonStatus {
    let socket_path = daemon_socket_path();
    match query_daemon_status(&socket_path) {
        Ok(status) => status,
        Err(error) => embedded_fallback_status(socket_path, error),
    }
}

pub fn daemon_ensure_running() -> DaemonStatus {
    let socket_path = daemon_socket_path();
    if let Ok(status) = query_daemon_status(&socket_path) {
        return status;
    }

    if let Err(error) = spawn_current_binary_as_daemon() {
        return embedded_fallback_status(socket_path, error);
    }

    for _ in 0..30 {
        if let Ok(status) = query_daemon_status(&socket_path) {
            return status;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    embedded_fallback_status(
        socket_path,
        "terminal daemon did not become reachable after launch".to_string(),
    )
}

pub fn trace_pty(label: &str, details: impl AsRef<str>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_some() {
        let line = serde_json::json!({
            "label": label,
            "rustEpochMs": now,
            "details": truncate_trace_detail(details.as_ref()),
        });
        let thread_id = format!("{:?}", std::thread::current().id())
            .chars()
            .filter(|char| char.is_ascii_alphanumeric())
            .collect::<String>();
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!(
                "/tmp/terminal-workspace-latency-trace-{}-{thread_id}.jsonl",
                std::process::id(),
            ))
            .and_then(|mut file| writeln!(file, "{line}"));
    }
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_PTY").is_none() {
        return;
    }
    let line = format!("[TW-PTY] {now} {label} {}\n", details.as_ref());
    eprint!("{line}");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/terminal-workspace-pty-trace.log")
        .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()));
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

pub fn send_daemon_request(request: DaemonRequest) -> Result<DaemonResponse, String> {
    let socket_path = daemon_socket_path();
    let mut stream = UnixStream::connect(&socket_path).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(700)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(700)))
        .map_err(|error| error.to_string())?;

    let request = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown(Shutdown::Write);

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    serde_json::from_str::<DaemonResponse>(&response).map_err(|error| error.to_string())
}

pub fn daemon_stdio_bridge_argv(
    session_id: &str,
    cwd: Option<&str>,
    command: Option<&str>,
) -> Result<Vec<String>, String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut argv = vec![
        current_exe.to_string_lossy().to_string(),
        DAEMON_STDIO_ARG.to_string(),
        "--id".to_string(),
        session_id.to_string(),
    ];
    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        argv.push("--cwd".to_string());
        argv.push(cwd.to_string());
    }
    if let Some(command) = command.filter(|value| !value.trim().is_empty()) {
        argv.push("--command".to_string());
        argv.push(command.to_string());
    }
    Ok(argv)
}

pub fn run_daemon_stdio_bridge_from_args() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut id = None;
    let mut cwd = None;
    let mut command = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            DAEMON_STDIO_ARG => {}
            "--id" => id = args.next(),
            "--cwd" => cwd = args.next(),
            "--command" => command = args.next(),
            other => return Err(format!("unsupported daemon stdio bridge argument: {other}")),
        }
    }

    let id = id.ok_or_else(|| "daemon stdio bridge requires --id".to_string())?;
    run_daemon_stdio_bridge(id, cwd, command)
}

fn run_daemon_stdio_bridge(
    id: String,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let status = daemon_ensure_running();
    if !status.reachable {
        return Err(status.message);
    }

    match send_daemon_request(DaemonRequest::EnsureSession {
        id: Some(id.clone()),
        cwd,
        command,
        // The stdio bridge sizes the session from the controlling TTY via its
        // resize loop; spawn at the daemon default and let that reconcile.
        cols: None,
        rows: None,
    })? {
        DaemonResponse::EnsureSession { .. } => {}
        DaemonResponse::Error { message } => return Err(message),
        response => {
            return Err(format!(
                "Unexpected daemon bridge ensure response: {response:?}"
            ))
        }
    }

    let _raw_guard = SttyRawGuard::activate();
    let stop = Arc::new(AtomicBool::new(false));

    {
        let id = id.clone();
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            if let Err(error) = stream_daemon_session_to_stdout(&id, &stop) {
                eprintln!("terminal-workspace daemon stdio output bridge failed: {error}");
            }
            stop.store(true, Ordering::Relaxed);
        });
    }

    {
        let id = id.clone();
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            resize_daemon_session_from_tty(&id, &stop);
        });
    }

    copy_stdin_to_daemon_input_stream(&id)?;
    stop.store(true, Ordering::Relaxed);
    Ok(())
}

struct SttyRawGuard;

impl SttyRawGuard {
    fn activate() -> Option<Self> {
        let status = Command::new("stty").args(["raw", "-echo"]).status().ok()?;
        status.success().then_some(Self)
    }
}

impl Drop for SttyRawGuard {
    fn drop(&mut self) {
        let _ = Command::new("stty").arg("sane").status();
    }
}

fn stream_daemon_session_to_stdout(id: &str, stop: &AtomicBool) -> Result<(), String> {
    let mut stream =
        UnixStream::connect(daemon_socket_path()).map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&DaemonRequest::SubscribeSession {
        id: id.to_string(),
        subscriber_id: format!("native-vte-stdio-{}", std::process::id()),
    })
    .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .and_then(|()| stream.write_all(b"\n"))
        .map_err(|error| error.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut stdout = std::io::stdout();
    let mut line = String::new();
    while !stop.load(Ordering::Relaxed) {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(());
        }
        let response =
            serde_json::from_str::<DaemonResponse>(line.trim_end()).map_err(|error| {
                format!("daemon stdio bridge could not parse subscribe response: {error}")
            })?;
        match response {
            DaemonResponse::SnapshotSession { data } | DaemonResponse::SessionData { data } => {
                stdout
                    .write_all(data.as_bytes())
                    .and_then(|()| stdout.flush())
                    .map_err(|error| error.to_string())?;
            }
            DaemonResponse::Error { message } => return Err(message),
            _ => {}
        }
    }
    Ok(())
}

fn copy_stdin_to_daemon_input_stream(id: &str) -> Result<(), String> {
    let mut stream =
        UnixStream::connect(daemon_socket_path()).map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&DaemonRequest::InputStream { id: id.to_string() })
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .and_then(|()| stream.write_all(b"\n"))
        .map_err(|error| error.to_string())?;
    std::io::copy(&mut std::io::stdin(), &mut stream)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn resize_daemon_session_from_tty(id: &str, stop: &AtomicBool) {
    let mut previous = None;
    while !stop.load(Ordering::Relaxed) {
        if let Some((cols, rows)) = tty_size() {
            let next = Some((cols, rows));
            if next != previous {
                let _ = send_daemon_request(DaemonRequest::ResizeSession {
                    id: id.to_string(),
                    cols,
                    rows,
                });
                previous = next;
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn tty_size() -> Option<(u16, u16)> {
    let output = Command::new("stty").arg("size").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut parts = text.split_whitespace();
    let rows = parts.next()?.parse::<u16>().ok()?;
    let cols = parts.next()?.parse::<u16>().ok()?;
    Some((cols, rows))
}

fn spawn_current_binary_as_daemon() -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Command::new(current_exe)
        .arg(DAEMON_ARG)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // The daemon owns PTYs independently of the UI lifecycle, so it must
        // outlive the app process. Put it in its own process group (detached from
        // the app's controlling terminal) so a group-directed SIGHUP/SIGINT — e.g.
        // closing the terminal that launched the app, or Ctrl-C'ing dev — does not
        // also tear down the daemon and every detached PTY (zellij/ssh/etc.) with
        // it. Without this the daemon shares the app's group and dies alongside it.
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn run_daemon_forever() -> Result<(), String> {
    let socket_path = daemon_socket_path();
    prepare_socket_dir(&socket_path)?;
    remove_stale_socket(&socket_path)?;
    let listener = UnixListener::bind(&socket_path).map_err(|error| error.to_string())?;
    // The daemon is the persistent PTY owner, so it checkpoints session
    // scrollback to disk. If it is restarted (reboot, OOM, dev relaunch) it
    // rebuilds each session's content from those checkpoints on reattach.
    let pty_manager = Arc::new(PtyManager::persistent());

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let socket_path = socket_path.clone();
                let pty_manager = pty_manager.clone();
                std::thread::spawn(move || {
                    let mut stream = stream;
                    if let Err(error) =
                        handle_daemon_client(&mut stream, &socket_path, &pty_manager)
                    {
                        eprintln!("terminal-workspace-daemon client error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("terminal-workspace-daemon accept error: {error}"),
        }
    }

    Ok(())
}

fn query_daemon_status(socket_path: &PathBuf) -> Result<DaemonStatus, String> {
    let mut stream = UnixStream::connect(socket_path).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(160)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(160)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(STATUS_COMMAND)
        .map_err(|error| error.to_string())?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    serde_json::from_str::<DaemonStatus>(&response).map_err(|error| error.to_string())
}

fn embedded_fallback_status(socket_path: PathBuf, error: String) -> DaemonStatus {
    DaemonStatus {
        socket_path: socket_path.to_string_lossy().to_string(),
        reachable: false,
        mode: DaemonMode::EmbeddedFallback,
        protocol_version: PROTOCOL_VERSION,
        pid: None,
        message: format!(
            "External terminal daemon is not available ({error}); using embedded Tauri PTY owner."
        ),
    }
}

pub fn daemon_socket_path() -> PathBuf {
    runtime_dir().join(SOCKET_DIR_NAME).join(SOCKET_FILE_NAME)
}

fn runtime_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::runtime_dir())
        .unwrap_or_else(std::env::temp_dir)
}

fn prepare_socket_dir(socket_path: &PathBuf) -> Result<(), String> {
    let socket_dir = socket_path
        .parent()
        .ok_or_else(|| "Daemon socket path has no parent directory".to_string())?;
    fs::create_dir_all(socket_dir).map_err(|error| error.to_string())?;
    fs::set_permissions(socket_dir, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())
}

fn remove_stale_socket(socket_path: &PathBuf) -> Result<(), String> {
    if !socket_path.exists() {
        return Ok(());
    }

    if query_daemon_status(socket_path).is_ok() {
        return Err(format!(
            "terminal-workspace-daemon is already running at {}",
            socket_path.to_string_lossy()
        ));
    }

    fs::remove_file(socket_path).map_err(|error| error.to_string())
}

fn handle_daemon_client(
    stream: &mut UnixStream,
    socket_path: &PathBuf,
    pty_manager: &PtyManager,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;

    let mut buffer = [0_u8; 8192];
    let count = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    if &buffer[..count] != STATUS_COMMAND {
        if let Some(header_end) = buffer[..count].iter().position(|byte| *byte == b'\n') {
            if let Ok(DaemonRequest::InputStream { id }) =
                serde_json::from_slice::<DaemonRequest>(&buffer[..header_end])
            {
                return handle_daemon_input_stream(
                    stream,
                    pty_manager,
                    &id,
                    &buffer[(header_end + 1)..count],
                );
            }
        }

        let request = match serde_json::from_slice::<DaemonRequest>(&buffer[..count]) {
            Ok(request) => request,
            Err(error) => {
                return write_daemon_response(
                    stream,
                    &DaemonResponse::Error {
                        message: format!("unsupported command: {error}"),
                    },
                );
            }
        };
        return handle_daemon_request(stream, socket_path, pty_manager, request);
    }

    write_daemon_response(
        stream,
        &DaemonResponse::Status(external_daemon_status(socket_path)),
    )
}

fn handle_daemon_request(
    stream: &mut UnixStream,
    socket_path: &PathBuf,
    pty_manager: &PtyManager,
    request: DaemonRequest,
) -> Result<(), String> {
    let response = match request {
        DaemonRequest::Status => DaemonResponse::Status(external_daemon_status(socket_path)),
        DaemonRequest::EnsureSession {
            id,
            cwd,
            command,
            cols,
            rows,
        } => {
            trace_pty(
                "daemon.ensure.receive",
                format!("id={id:?} cols={cols:?} rows={rows:?}"),
            );
            let (id, reused) = pty_manager.ensure_detached(id, cwd, command, cols, rows)?;
            trace_pty(
                "daemon.ensure.done",
                format!("id={id} reused={reused} cols={cols:?} rows={rows:?}"),
            );
            DaemonResponse::EnsureSession { id, reused }
        }
        DaemonRequest::WriteSession { id, data } => {
            trace_pty(
                "daemon.write.receive",
                format!("id={id} bytes={} data={data:?}", data.len()),
            );
            pty_manager.write(&id, &data)?;
            trace_pty("daemon.write.done", format!("id={id} bytes={}", data.len()));
            DaemonResponse::WriteSession { ok: true }
        }
        DaemonRequest::InputStream { id } => {
            return handle_daemon_input_stream(stream, pty_manager, &id, &[]);
        }
        DaemonRequest::ResizeSession { id, cols, rows } => {
            trace_pty(
                "daemon.resize.receive",
                format!("id={id} cols={cols} rows={rows}"),
            );
            pty_manager.resize(&id, cols, rows)?;
            DaemonResponse::ResizeSession { ok: true }
        }
        DaemonRequest::SnapshotSession { id } => DaemonResponse::SnapshotSession {
            data: pty_manager.snapshot(&id)?,
        },
        DaemonRequest::ReadSession { id, offset } => {
            DaemonResponse::ReadSession(pty_manager.read_since(&id, offset)?)
        }
        DaemonRequest::SubscribeSession { id, subscriber_id } => {
            return stream_daemon_session(stream, pty_manager, &id, subscriber_id);
        }
        DaemonRequest::UnsubscribeSession { id, subscriber_id } => {
            pty_manager.unsubscribe(&id, &subscriber_id)?;
            DaemonResponse::UnsubscribeSession { ok: true }
        }
        DaemonRequest::GetSessionCwd { id } => DaemonResponse::GetSessionCwd {
            cwd: pty_manager.get_cwd(&id)?,
        },
        DaemonRequest::KillSession { id } => {
            pty_manager.kill(&id)?;
            DaemonResponse::KillSession { ok: true }
        }
        DaemonRequest::ListSessions => DaemonResponse::ListSessions {
            sessions: pty_manager.list_sessions(),
        },
    };

    write_daemon_response(stream, &response)
}

fn handle_daemon_input_stream(
    stream: &mut UnixStream,
    pty_manager: &PtyManager,
    id: &str,
    initial_data: &[u8],
) -> Result<(), String> {
    stream
        .set_read_timeout(None)
        .map_err(|error| error.to_string())?;
    trace_pty("daemon.input_stream.open", format!("id={id}"));

    if !initial_data.is_empty() {
        let data = String::from_utf8_lossy(initial_data);
        trace_pty(
            "daemon.input_stream.receive",
            format!("id={id} bytes={}", data.len()),
        );
        pty_manager.write(id, &data)?;
    }

    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            trace_pty("daemon.input_stream.close", format!("id={id}"));
            return Ok(());
        }
        let data = String::from_utf8_lossy(&buffer[..count]);
        trace_pty(
            "daemon.input_stream.receive",
            format!("id={id} bytes={}", data.len()),
        );
        pty_manager.write(id, &data)?;
    }
}

fn stream_daemon_session(
    stream: &mut UnixStream,
    pty_manager: &PtyManager,
    id: &str,
    subscriber_id: String,
) -> Result<(), String> {
    let receiver = pty_manager.subscribe(id, subscriber_id)?;
    write_daemon_response(
        stream,
        &DaemonResponse::SnapshotSession {
            data: pty_manager.snapshot(id)?,
        },
    )?;

    for data in receiver {
        trace_pty(
            "daemon.subscribe.emit",
            format!("id={id} bytes={} data={data:?}", data.len()),
        );
        write_daemon_response(stream, &DaemonResponse::SessionData { data })?;
    }

    Ok(())
}

fn external_daemon_status(socket_path: &PathBuf) -> DaemonStatus {
    DaemonStatus {
        socket_path: socket_path.to_string_lossy().to_string(),
        reachable: true,
        mode: DaemonMode::ExternalDaemon,
        protocol_version: PROTOCOL_VERSION,
        pid: Some(std::process::id()),
        message: "External terminal daemon is reachable.".to_string(),
    }
}

fn write_daemon_response(stream: &mut UnixStream, response: &DaemonResponse) -> Result<(), String> {
    let response = serde_json::to_string(response).map_err(|error| error.to_string())?;
    stream
        .write_all(format!("{response}\n").as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        daemon_socket_path, daemon_status, daemon_stdio_bridge_argv, embedded_fallback_status,
        DaemonMode, DaemonRequest, DaemonResponse, DAEMON_STDIO_ARG, PROTOCOL_VERSION,
        SOCKET_FILE_NAME,
    };

    #[test]
    fn socket_path_uses_terminal_workspace_dir() {
        let socket_path = daemon_socket_path();
        assert_eq!(
            socket_path.file_name().and_then(|name| name.to_str()),
            Some(SOCKET_FILE_NAME)
        );
        assert!(
            socket_path
                .parent()
                .and_then(|parent| parent.file_name())
                .and_then(|name| name.to_str())
                == Some("terminal-workspace")
        );
    }

    #[test]
    fn status_reports_embedded_fallback_when_socket_is_absent() {
        let status = daemon_status();
        assert!(!status.socket_path.is_empty());
        if !status.reachable {
            assert_eq!(status.mode, DaemonMode::EmbeddedFallback);
        }
    }

    #[test]
    fn fallback_status_uses_protocol_version_and_pid_none() {
        let status = embedded_fallback_status(daemon_socket_path(), "missing".to_string());
        assert_eq!(status.mode, DaemonMode::EmbeddedFallback);
        assert_eq!(status.protocol_version, PROTOCOL_VERSION);
        assert_eq!(status.pid, None);
    }

    #[test]
    fn daemon_protocol_supports_session_ensure_and_list_requests() {
        let ensure = DaemonRequest::EnsureSession {
            id: Some("session-a".to_string()),
            cwd: Some("/tmp".to_string()),
            command: Some("bash".to_string()),
            cols: Some(80),
            rows: Some(24),
        };
        let serialized = serde_json::to_string(&ensure).expect("serialize ensure request");
        let parsed =
            serde_json::from_str::<DaemonRequest>(&serialized).expect("parse ensure request");
        assert_eq!(parsed, ensure);

        let response = DaemonResponse::EnsureSession {
            id: "session-a".to_string(),
            reused: false,
        };
        let serialized_response =
            serde_json::to_string(&response).expect("serialize ensure response");
        let parsed_response =
            serde_json::from_str::<DaemonResponse>(&serialized_response).expect("parse response");
        assert_eq!(parsed_response, response);
    }

    #[test]
    fn daemon_protocol_supports_session_control_requests() {
        let requests = [
            DaemonRequest::WriteSession {
                id: "session-a".to_string(),
                data: "hello\n".to_string(),
            },
            DaemonRequest::InputStream {
                id: "session-a".to_string(),
            },
            DaemonRequest::ResizeSession {
                id: "session-a".to_string(),
                cols: 120,
                rows: 40,
            },
            DaemonRequest::SnapshotSession {
                id: "session-a".to_string(),
            },
            DaemonRequest::ReadSession {
                id: "session-a".to_string(),
                offset: 0,
            },
            DaemonRequest::SubscribeSession {
                id: "session-a".to_string(),
                subscriber_id: "subscriber-a".to_string(),
            },
            DaemonRequest::UnsubscribeSession {
                id: "session-a".to_string(),
                subscriber_id: "subscriber-a".to_string(),
            },
            DaemonRequest::GetSessionCwd {
                id: "session-a".to_string(),
            },
            DaemonRequest::KillSession {
                id: "session-a".to_string(),
            },
        ];

        for request in requests {
            let serialized = serde_json::to_string(&request).expect("serialize control request");
            let parsed =
                serde_json::from_str::<DaemonRequest>(&serialized).expect("parse control request");
            assert_eq!(parsed, request);
        }

        let response = DaemonResponse::SnapshotSession {
            data: "hello\n".to_string(),
        };
        let serialized_response = serde_json::to_string(&response).expect("serialize response");
        let parsed_response =
            serde_json::from_str::<DaemonResponse>(&serialized_response).expect("parse response");
        assert_eq!(parsed_response, response);

        let read_response = DaemonResponse::ReadSession(crate::pty::PtyOutputChunk {
            data: "hello\n".to_string(),
            base_offset: 0,
            next_offset: 6,
        });
        let serialized_read_response =
            serde_json::to_string(&read_response).expect("serialize read response");
        let parsed_read_response =
            serde_json::from_str::<DaemonResponse>(&serialized_read_response)
                .expect("parse read response");
        assert_eq!(parsed_read_response, read_response);
    }

    #[test]
    fn daemon_stdio_bridge_argv_targets_stable_session_id() {
        let argv =
            daemon_stdio_bridge_argv("terminal-tab-pane", Some("/tmp"), Some("echo bridge-ready"))
                .expect("bridge argv");

        assert!(argv.iter().any(|arg| arg == DAEMON_STDIO_ARG));
        assert!(argv
            .windows(2)
            .any(|pair| pair == ["--id", "terminal-tab-pane"]));
        assert!(argv.windows(2).any(|pair| pair == ["--cwd", "/tmp"]));
        assert!(argv
            .windows(2)
            .any(|pair| pair == ["--command", "echo bridge-ready"]));
    }
}
