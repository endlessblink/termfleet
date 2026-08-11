use crate::daemon_ipc::{self, LocalStream};
use crate::platform_paths;
use crate::platform_process;
use crate::platform_tty;
use crate::pty::{PtyManager, PtyOutputChunk, PtySessionEvent, PtySessionSummary};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const STATUS_COMMAND: &[u8] = b"status\n";
/// Ceiling on a single control request, so a malformed client that never sends
/// a newline cannot grow the daemon's memory without bound. Large enough for a
/// full-buffer paste; small enough to be an obvious error.
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const PROTOCOL_VERSION: u16 = 1;
pub const DAEMON_ARG: &str = "--terminal-workspace-daemon";
pub const DAEMON_STDIO_ARG: &str = "--terminal-workspace-daemon-stdio";
/// When set, the launcher / caller wants a clean backend: an already-running
/// daemon is replaced even if its build identity still matches.
const FRESH_DAEMON_ENV: &str = "TERMINAL_WORKSPACE_FRESH_DAEMON";

/// The daemon pins its build identity once, at startup, so a rebuilt binary at
/// the same path (dev) cannot make this still-running, stale-code daemon report
/// the *new* binary's mtime and falsely look current.
static DAEMON_BUILD_ID: OnceLock<String> = OnceLock::new();

/// Identifies the build a binary is running for diagnostics only: protocol
/// version + this binary's on-disk mtime. In `tauri dev` the daemon and app
/// share one binary path, so a Rust relink bumps the mtime; that must not be a
/// replacement trigger because the daemon owns live user processes.
fn current_build_id() -> String {
    let mtime = std::env::current_exe()
        .ok()
        .and_then(|exe| fs::metadata(exe).ok())
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    format!("{PROTOCOL_VERSION}:{mtime}")
}

fn fresh_daemon_requested() -> bool {
    std::env::var_os(FRESH_DAEMON_ENV).is_some_and(|value| value != "0" && value != "")
}

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
    ListSessionEvents,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DaemonResponse {
    Status(DaemonStatus),
    EnsureSession {
        id: String,
        reused: bool,
        // Current PTY winsize. The map projection reattaches a reused session at
        // this size so an alt-screen TUI rendered wide isn't shrunk/corrupted.
        cols: Option<u16>,
        rows: Option<u16>,
    },
    WriteSession {
        ok: bool,
    },
    ResizeSession {
        ok: bool,
    },
    SnapshotSession {
        data: String,
    },
    ReadSession(PtyOutputChunk),
    SessionData {
        data: String,
    },
    UnsubscribeSession {
        ok: bool,
    },
    GetSessionCwd {
        cwd: String,
    },
    KillSession {
        ok: bool,
    },
    ListSessions {
        sessions: Vec<PtySessionSummary>,
    },
    ListSessionEvents {
        events: Vec<PtySessionEvent>,
    },
    Error {
        message: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    pub socket_path: String,
    pub reachable: bool,
    pub mode: DaemonMode,
    pub protocol_version: u16,
    pub pid: Option<u32>,
    /// Build identity of the *running* daemon (see `current_build_id`). The app
    /// compares it to its own build to decide reuse-vs-replace on startup.
    #[serde(default)]
    pub build_id: String,
    /// The cgroup the *running* daemon lives in (from its own `/proc/self/cgroup`).
    /// Lets the app and `npm run doctor` tell whether the daemon got its own
    /// systemd unit or is still parented under the app's unit — where the next
    /// app relaunch would kill it and every terminal with it. Empty when unknown.
    #[serde(default)]
    pub cgroup: Option<String>,
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
        // A reachable compatible daemon is reused as-is: its PTYs are still live,
        // so the app reattaches to the same foreground processes. Build identity
        // is intentionally *not* part of this decision. In dev, rebuilding the app
        // changes current_build_id(); replacing the daemon at that point kills the
        // user's shells/agents and only cold-restores scrollback plus cwd.
        if should_reuse_running_daemon(&status) {
            return status;
        }
        replace_running_daemon(&socket_path, status.pid);
    } else if socket_path.exists() {
        // A saturated daemon may accept a connection but miss the short status
        // deadline.  Never spawn a replacement while the socket is still owned:
        // doing so can unlink the live socket and create two PTY owners.
        match daemon_ipc::connect(&socket_path) {
            Ok(_) => {
                return embedded_fallback_status(
                    socket_path,
                    "terminal daemon socket is owned but status is temporarily unavailable; refusing to start a second daemon".to_string(),
                );
            }
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return embedded_fallback_status(
                    socket_path,
                    format!("terminal daemon socket could not be verified; refusing to start a second daemon: {error}"),
                );
            }
        }
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

fn should_reuse_running_daemon(status: &DaemonStatus) -> bool {
    should_reuse_running_daemon_with_fresh_request(status, fresh_daemon_requested())
}

fn should_reuse_running_daemon_with_fresh_request(
    status: &DaemonStatus,
    fresh_requested: bool,
) -> bool {
    !fresh_requested && status.protocol_version == PROTOCOL_VERSION
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
            .open(platform_paths::latency_trace_path(
                std::process::id(),
                &thread_id,
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
        .open(platform_paths::pty_trace_path())
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
    let mut stream = match daemon_ipc::connect(&socket_path) {
        Ok(stream) => stream,
        Err(initial_error) => {
            let status = daemon_ensure_running();
            if !status.reachable {
                return Err(status.message);
            }
            daemon_ipc::connect(&socket_path).map_err(|retry_error| {
                format!(
                    "terminal daemon became reachable but request connect still failed: {retry_error} (initial: {initial_error})"
                )
            })?
        }
    };
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

    let _raw_guard = platform_tty::RawModeGuard::activate();
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

fn stream_daemon_session_to_stdout(id: &str, stop: &AtomicBool) -> Result<(), String> {
    let mut stream =
        daemon_ipc::connect(&daemon_socket_path()).map_err(|error| error.to_string())?;
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
        daemon_ipc::connect(&daemon_socket_path()).map_err(|error| error.to_string())?;
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
        if let Some((cols, rows)) = platform_tty::terminal_size() {
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

/// Tear down an explicitly requested or protocol-incompatible daemon so a fresh
/// one can take its socket. `remove_stale_socket` refuses to bind while the old
/// daemon still answers, so we kill it and wait for the socket to go unreachable
/// before the caller spawns the replacement.
fn replace_running_daemon(socket_path: &PathBuf, pid: Option<u32>) {
    if let Some(pid) = pid {
        // SIGTERM first. This kills daemon-owned PTYs, so this path must remain
        // limited to explicit fresh-daemon requests or incompatible protocols.
        platform_process::terminate_process(pid);
        for _ in 0..40 {
            if query_daemon_status(socket_path).is_err() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // Still answering after ~2s — force it.
        platform_process::force_terminate_process(pid);
    }

    for _ in 0..40 {
        if query_daemon_status(socket_path).is_err() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn spawn_current_binary_as_daemon() -> Result<(), String> {
    platform_process::spawn_detached_current_binary(DAEMON_ARG)
}

/// Raise this process's open-file soft limit to its hard limit.
///
/// The daemon holds one fd per PTY master plus one per connected client, and the
/// cockpit opens a fresh control connection per poll. The inherited soft limit is
/// the shell default of 1024, and once it is reached `accept()` fails for *every*
/// caller: the app then reports "socket is owned but status is temporarily
/// unavailable" and falls back to an embedded PTY owner even though the daemon
/// and all its terminals are alive. Done here rather than in the launcher so it
/// holds however the daemon was started (systemd unit, dev run, direct spawn).
fn raise_open_file_limit() {
    #[cfg(unix)]
    {
        // SAFETY: both calls take a pointer to a fully-initialized `rlimit` we own.
        unsafe {
            let mut limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
                return;
            }
            if limit.rlim_cur >= limit.rlim_max {
                return;
            }
            let previous = limit.rlim_cur;
            limit.rlim_cur = limit.rlim_max;
            if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) == 0 {
                eprintln!(
                    "terminal-workspace-daemon: raised open-file limit {} -> {}",
                    previous, limit.rlim_max
                );
            }
        }
    }
}

pub fn run_daemon_forever() -> Result<(), String> {
    // Pin the build identity to the binary this daemon launched from, so a later
    // same-path rebuild can't make us report as current (see DAEMON_BUILD_ID).
    let _ = DAEMON_BUILD_ID.set(current_build_id());

    raise_open_file_limit();

    // Announce our cgroup parenting the moment we start. If we inherited the
    // app's unit instead of getting our own, this line is the one breadcrumb
    // that explains why terminals will die on the next app relaunch — the exact
    // failure that has no unit test.
    match platform_process::current_cgroup() {
        Some(cgroup) if platform_process::cgroup_is_own_daemon_unit(&cgroup) => {
            eprintln!("terminal-workspace-daemon: own systemd unit — terminals survive app relaunch ({cgroup})");
        }
        Some(cgroup) if platform_process::cgroup_is_app_unit(&cgroup) => {
            eprintln!("terminal-workspace-daemon: WARNING parented under the app's unit ({cgroup}) — the next app relaunch will kill every terminal");
        }
        Some(cgroup) => {
            eprintln!("terminal-workspace-daemon: cgroup {cgroup}");
        }
        None => {}
    }

    let socket_path = daemon_socket_path();
    prepare_socket_dir(&socket_path)?;
    remove_stale_socket(&socket_path)?;
    let listener = daemon_ipc::bind(&socket_path).map_err(|error| error.to_string())?;
    // The daemon is the persistent PTY owner, so it checkpoints session
    // scrollback to disk. If it is restarted (reboot, OOM, dev relaunch) it
    // rebuilds each session's content from those checkpoints on reattach.
    let pty_manager = Arc::new(PtyManager::persistent());

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                // Defense-in-depth: only this user may drive the PTYs, even if the
                // socket ever lands somewhere more permissive than the 0700 dir.
                if !daemon_ipc::peer_is_authorized(&stream) {
                    eprintln!(
                        "terminal-workspace-daemon: rejected connection from unauthorized peer uid"
                    );
                    continue;
                }
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
    let mut stream = daemon_ipc::connect(socket_path).map_err(|error| error.to_string())?;
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
        build_id: current_build_id(),
        // The embedded fallback runs inside the app process, so its cgroup would
        // be the app's — not a daemon parenting fact worth reporting.
        cgroup: None,
        message: format!(
            "External terminal daemon is not available ({error}); using embedded Tauri PTY owner."
        ),
    }
}

pub fn daemon_socket_path() -> PathBuf {
    platform_paths::daemon_socket_path()
}

fn prepare_socket_dir(socket_path: &PathBuf) -> Result<(), String> {
    let socket_dir = socket_path
        .parent()
        .ok_or_else(|| "Daemon socket path has no parent directory".to_string())?;
    fs::create_dir_all(socket_dir).map_err(|error| error.to_string())?;

    // Before we trust this directory to hold the control socket, reject anything
    // we don't exclusively own. This closes the `/tmp` squat / cross-user case
    // (e.g. when XDG_RUNTIME_DIR is unset and the path falls back to a shared
    // world-writable temp dir): a pre-existing dir owned by another uid, or a
    // symlink redirecting us elsewhere, must not be silently reused.
    let meta = fs::symlink_metadata(socket_dir).map_err(|error| error.to_string())?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "Daemon socket dir {} is a symlink; refusing to use it",
            socket_dir.to_string_lossy()
        ));
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: geteuid takes no arguments and always succeeds.
        let self_uid = unsafe { libc::geteuid() };
        if meta.uid() != self_uid {
            return Err(format!(
                "Daemon socket dir {} is owned by uid {}, not {}; refusing to use it",
                socket_dir.to_string_lossy(),
                meta.uid(),
                self_uid
            ));
        }
    }

    fs::set_permissions(socket_dir, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())
}

fn remove_stale_socket(socket_path: &PathBuf) -> Result<(), String> {
    if !socket_path.exists() {
        return Ok(());
    }

    // A live daemon can be too overloaded to answer the status protocol.  Do
    // not use a protocol timeout as evidence that the socket is stale: unlinking
    // a live Unix socket lets a second daemon bind the same pathname while the
    // first daemon still owns existing PTYs, creating split-brain reconnects.
    match daemon_ipc::connect(socket_path) {
        Ok(_) => {
            return Err(format!(
                "terminal-workspace-daemon socket is already owned at {}",
                socket_path.to_string_lossy()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "cannot verify terminal-workspace-daemon socket at {}: {error}; refusing to remove it",
                socket_path.to_string_lossy()
            ));
        }
    }

    fs::remove_file(socket_path).map_err(|error| error.to_string())
}

fn handle_daemon_client(
    stream: &mut LocalStream,
    socket_path: &PathBuf,
    pty_manager: &PtyManager,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;

    // Read until the request's terminating newline instead of trusting one
    // read() to deliver it whole. The old single 8192-byte read rejected every
    // request larger than the buffer — verified against a live daemon: an 8.1KB
    // `writeSession` failed with "EOF while parsing a string at line 1 column
    // 8192" — so pasting more than ~8KB through the control socket silently
    // failed. A short read could truncate a small request the same way.
    let (buffer, count) = match read_request_frame(stream)? {
        Some(frame) => frame,
        None => {
            return write_daemon_response(
                stream,
                &DaemonResponse::Error {
                    message: format!("request exceeds {MAX_REQUEST_BYTES} bytes"),
                },
            )
        }
    };
    if &buffer[..count] != STATUS_COMMAND {
        if let Some(header_end) = buffer[..count].iter().position(|byte| *byte == b'\n') {
            if let Ok(DaemonRequest::InputStream { id }) =
                serde_json::from_slice::<DaemonRequest>(&buffer[..header_end])
            {
                // Anything already buffered past the header is stream payload.
                let leftover = buffer[(header_end + 1)..].to_vec();
                return handle_daemon_input_stream(stream, pty_manager, &id, &leftover);
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

/// Read one newline-terminated request, however many reads that takes.
///
/// Returns the whole buffer plus the length of the framed request (bytes past
/// the newline belong to a following input stream). `None` means the client
/// exceeded `MAX_REQUEST_BYTES` without terminating its request.
///
/// A single fixed-size read was the bug this replaces: any request larger than
/// the buffer was handed to the JSON parser truncated and rejected, so a paste
/// over ~8KB through the control socket could never succeed.
fn read_request_frame(reader: &mut impl Read) -> Result<Option<(Vec<u8>, usize)>, String> {
    let mut buffer: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 8192];
    loop {
        if let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            return Ok(Some((buffer, index + 1)));
        }
        if buffer.len() > MAX_REQUEST_BYTES {
            return Ok(None);
        }
        let read = reader.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            let len = buffer.len();
            return Ok(Some((buffer, len)));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
}

fn handle_daemon_request(
    stream: &mut LocalStream,
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
            let (live_cols, live_rows) = match pty_manager.session_size(&id) {
                Some((c, r)) => (Some(c), Some(r)),
                None => (None, None),
            };
            trace_pty(
                "daemon.ensure.done",
                format!("id={id} reused={reused} cols={live_cols:?} rows={live_rows:?}"),
            );
            DaemonResponse::EnsureSession {
                id,
                reused,
                cols: live_cols,
                rows: live_rows,
            }
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
        DaemonRequest::ListSessionEvents => DaemonResponse::ListSessionEvents {
            events: pty_manager.session_events(),
        },
    };

    write_daemon_response(stream, &response)
}

fn handle_daemon_input_stream(
    stream: &mut LocalStream,
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
    stream: &mut LocalStream,
    pty_manager: &PtyManager,
    id: &str,
    subscriber_id: String,
) -> Result<(), String> {
    let subscriber_id_for_cleanup = subscriber_id.clone();
    let receiver = pty_manager.subscribe(id, subscriber_id)?;
    let result = (|| {
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
    })();
    let _ = pty_manager.unsubscribe(id, &subscriber_id_for_cleanup);
    result
}

fn external_daemon_status(socket_path: &PathBuf) -> DaemonStatus {
    DaemonStatus {
        socket_path: socket_path.to_string_lossy().to_string(),
        reachable: true,
        mode: DaemonMode::ExternalDaemon,
        protocol_version: PROTOCOL_VERSION,
        pid: Some(std::process::id()),
        // Report the build pinned at this daemon's startup, not a fresh read —
        // a same-path rebuild must not let stale code masquerade as current.
        build_id: DAEMON_BUILD_ID
            .get()
            .cloned()
            .unwrap_or_else(current_build_id),
        // Read here (inside the daemon process) so the reported cgroup is the
        // daemon's own, not the app's. This is what the doctor check inspects.
        cgroup: platform_process::current_cgroup(),
        message: "External terminal daemon is reachable.".to_string(),
    }
}

fn write_daemon_response(
    stream: &mut LocalStream,
    response: &DaemonResponse,
) -> Result<(), String> {
    let response = serde_json::to_string(response).map_err(|error| error.to_string())?;
    stream
        .write_all(format!("{response}\n").as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        current_build_id, daemon_socket_path, daemon_status, daemon_stdio_bridge_argv,
        embedded_fallback_status, prepare_socket_dir, remove_stale_socket,
        read_request_frame, should_reuse_running_daemon_with_fresh_request, DaemonMode,
        DaemonRequest, DaemonResponse, DaemonStatus, DAEMON_STDIO_ARG, PROTOCOL_VERSION,
    };

    /// Delivers its payload in small pieces, the way a socket actually does.
    struct ChunkedReader {
        data: Vec<u8>,
        position: usize,
        chunk: usize,
    }

    impl std::io::Read for ChunkedReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            let remaining = self.data.len() - self.position;
            let take = remaining.min(self.chunk).min(out.len());
            out[..take].copy_from_slice(&self.data[self.position..self.position + take]);
            self.position += take;
            Ok(take)
        }
    }

    /// A request bigger than one read buffer must still arrive intact.
    ///
    /// Regression: the handler used a single 8192-byte read, so every larger
    /// request reached the parser truncated. Verified live against the running
    /// daemon on 2026-08-11 — an 8.1KB `writeSession` failed with "EOF while
    /// parsing a string at line 1 column 8192", i.e. pasting more than ~8KB
    /// through the control socket could not work.
    #[test]
    fn a_request_larger_than_one_read_buffer_is_framed_whole() {
        let big = "p".repeat(200_000);
        let request = serde_json::to_vec(&DaemonRequest::WriteSession {
            id: "pane".to_string(),
            data: big.clone(),
        })
        .unwrap();
        assert!(request.len() > 8192, "test payload must exceed the old cap");

        let mut wire = request.clone();
        wire.push(b'\n');
        let mut reader = ChunkedReader {
            data: wire,
            position: 0,
            chunk: 1024,
        };

        let (buffer, count) = read_request_frame(&mut reader)
            .expect("framing must not error")
            .expect("payload is under the ceiling");
        assert_eq!(count, request.len() + 1);

        match serde_json::from_slice::<DaemonRequest>(&buffer[..count]).expect("parses") {
            DaemonRequest::WriteSession { id, data } => {
                assert_eq!(id, "pane");
                assert_eq!(data, big, "payload must survive framing intact");
            }
            other => panic!("wrong request decoded: {other:?}"),
        }
    }

    /// Bytes after the newline belong to the input stream that follows. Framing
    /// may stop as soon as it sees the newline, so those bytes are split between
    /// what was already buffered and what is still unread — but none may be
    /// dropped or duplicated, or the first keystrokes of a pane vanish.
    #[test]
    fn no_typed_bytes_are_lost_at_the_request_boundary() {
        let header = serde_json::to_vec(&DaemonRequest::InputStream {
            id: "pane".to_string(),
        })
        .unwrap();
        let typed = b"already typed";

        // Every chunk size lands the newline in a different place, including
        // exactly on a boundary.
        for chunk in [1_usize, 3, 7, 64, 8192] {
            let mut wire = header.clone();
            wire.push(b'\n');
            wire.extend_from_slice(typed);

            let mut reader = ChunkedReader {
                data: wire,
                position: 0,
                chunk,
            };
            let (buffer, count) = read_request_frame(&mut reader).unwrap().unwrap();
            assert_eq!(count, header.len() + 1, "chunk={chunk}");
            assert!(
                serde_json::from_slice::<DaemonRequest>(&buffer[..count]).is_ok(),
                "header must decode at chunk={chunk}"
            );

            let mut recovered = buffer[count..].to_vec();
            let mut rest = Vec::new();
            std::io::Read::read_to_end(&mut reader, &mut rest).unwrap();
            recovered.extend_from_slice(&rest);
            assert_eq!(
                recovered, typed,
                "typed bytes must be recoverable exactly once at chunk={chunk}"
            );
        }
    }

    #[test]
    fn a_client_that_never_terminates_its_request_is_rejected_not_buffered_forever() {
        let mut reader = ChunkedReader {
            data: vec![b'x'; super::MAX_REQUEST_BYTES + 4096],
            position: 0,
            chunk: 65536,
        };
        assert!(
            read_request_frame(&mut reader).unwrap().is_none(),
            "an unterminated oversized request must be refused"
        );
    }

    /// The daemon must not run on the inherited 1024-fd soft limit.
    ///
    /// It holds one descriptor per PTY plus one per connected client, and the
    /// cockpit opens a fresh control connection per poll. On 2026-08-11 it sat
    /// at exactly 1024 open descriptors, so `accept()` failed for every caller
    /// and even a status probe timed out — which the app reports as "socket is
    /// owned but status is temporarily unavailable", hiding the real cause.
    #[cfg(unix)]
    #[test]
    fn the_daemon_raises_its_open_file_limit_to_the_hard_ceiling() {
        fn current() -> (u64, u64) {
            // SAFETY: getrlimit writes into a fully-initialized struct we own.
            unsafe {
                let mut limit = libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                assert_eq!(libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit), 0);
                (limit.rlim_cur, limit.rlim_max)
            }
        }

        let (before_soft, hard) = current();
        if before_soft >= hard {
            // Already at the ceiling; lower it so the call has work to do.
            // SAFETY: same contract, and we restore below.
            unsafe {
                let mut limit = libc::rlimit {
                    rlim_cur: 1024.min(hard),
                    rlim_max: hard,
                };
                assert_eq!(libc::setrlimit(libc::RLIMIT_NOFILE, &mut limit), 0);
            }
        }

        super::raise_open_file_limit();

        let (after_soft, after_hard) = current();
        assert_eq!(
            after_soft, after_hard,
            "the soft limit must be raised to the hard ceiling"
        );
        assert!(
            after_soft > 1024,
            "1024 descriptors is not enough for one PTY per pane plus clients"
        );
    }

    #[test]
    fn prepare_socket_dir_creates_owner_only_dir() {
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("tf-sockdir-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let socket_path = base.join("daemon.sock");

        prepare_socket_dir(&socket_path).expect("prepare should succeed for an owned dir");
        let mode = std::fs::metadata(&base).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "socket dir must be owner-only");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prepare_socket_dir_rejects_symlinked_dir() {
        use std::os::unix::fs::symlink;
        let base = std::env::temp_dir().join(format!("tf-socklink-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let real = base.join("real");
        let link = base.join("link");
        std::fs::create_dir_all(&real).unwrap();
        symlink(&real, &link).unwrap();
        let socket_path = link.join("daemon.sock");

        let result = prepare_socket_dir(&socket_path);
        assert!(result.is_err(), "a symlinked socket dir must be refused");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn live_socket_is_never_unlinked_when_status_is_unavailable() {
        let base = std::env::temp_dir().join(format!("tf-live-socket-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let socket_path = base.join("daemon.sock");
        let _listener = crate::daemon_ipc::bind(&socket_path).unwrap();

        let result = remove_stale_socket(&socket_path);
        assert!(result.is_err(), "a live socket must block a second daemon");
        assert!(socket_path.exists(), "the live socket must remain in place");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn socket_path_uses_terminal_workspace_dir() {
        let socket_path = daemon_socket_path();
        assert_eq!(
            socket_path.file_name().and_then(|name| name.to_str()),
            Some("daemon.sock")
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
        assert_eq!(status.build_id, current_build_id());
    }

    #[test]
    fn build_id_is_stable_and_carries_protocol_version() {
        let id = current_build_id();
        assert_eq!(id, current_build_id());
        assert!(id.starts_with(&format!("{PROTOCOL_VERSION}:")));
    }

    #[test]
    fn reachable_same_protocol_daemon_is_reused_across_build_id_changes() {
        let status = DaemonStatus {
            socket_path: "/tmp/terminal-workspace/daemon.sock".to_string(),
            reachable: true,
            mode: DaemonMode::ExternalDaemon,
            protocol_version: PROTOCOL_VERSION,
            pid: Some(42),
            build_id: format!("{PROTOCOL_VERSION}:older-dev-build"),
            cgroup: None,
            message: "reachable".to_string(),
        };

        assert!(
            should_reuse_running_daemon_with_fresh_request(&status, false),
            "dev rebuilds change build_id, but compatible live daemons must keep owning PTYs"
        );
    }

    #[test]
    fn fresh_daemon_request_forces_replacement_even_when_protocol_matches() {
        let status = DaemonStatus {
            socket_path: "/tmp/terminal-workspace/daemon.sock".to_string(),
            reachable: true,
            mode: DaemonMode::ExternalDaemon,
            protocol_version: PROTOCOL_VERSION,
            pid: Some(42),
            build_id: current_build_id(),
            cgroup: None,
            message: "reachable".to_string(),
        };

        assert!(
            !should_reuse_running_daemon_with_fresh_request(&status, true),
            "explicit fresh-daemon remains the user-controlled way to replace the PTY owner"
        );
    }

    #[test]
    fn incompatible_protocol_daemon_is_not_reused() {
        let status = DaemonStatus {
            socket_path: "/tmp/terminal-workspace/daemon.sock".to_string(),
            reachable: true,
            mode: DaemonMode::ExternalDaemon,
            protocol_version: PROTOCOL_VERSION + 1,
            pid: Some(42),
            build_id: format!("{}:future-build", PROTOCOL_VERSION + 1),
            cgroup: None,
            message: "reachable".to_string(),
        };

        assert!(!should_reuse_running_daemon_with_fresh_request(
            &status, false
        ));
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
            cols: Some(120),
            rows: Some(40),
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
