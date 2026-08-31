use crate::{default_shell, platform_paths};
use portable_pty::{native_pty_system, Child, CommandBuilder, ExitStatus, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
#[cfg(unix)]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime};

// Per-session scrollback we retain in RAM and replay on restore. 200KB was far
// too small for agent CLIs (Claude/Codex): their output is escape-sequence-heavy
// (~3KB per rendered line), so 200KB rendered to only ~60-70 scrollable lines and
// you could never scroll back near the start of a conversation. 4MB retains
// ~1.3k+ lines of that kind of output (and far more for plain shells) — enough to
// reach the start of a typical session, at a bounded RAM/disk cost per session.
const MAX_SCROLLBACK_BYTES: usize = 4_000_000;

// The lifecycle log is append-only and used to be unbounded: on a long-lived
// install it reached 349MB, and `session_events()` (polled every 500ms by the
// exit watcher) read and JSON-parsed the entire file each tick. Two independent
// bounds keep that cheap forever: the writer rotates at 32MB keeping exactly one
// previous generation, and the reader only parses the tail window below. Callers
// ask "what is the latest event per session", so older records are never needed.
const MAX_LIFECYCLE_LOG_BYTES: u64 = 32 * 1024 * 1024;
const LIFECYCLE_READ_WINDOW_BYTES: u64 = 4 * 1024 * 1024;

// Persisted per-session files (scrollback/meta/history/lifecycle) that nothing
// has written to in this long are removed at startup, so the sessions directory
// cannot grow without limit. A live or restorable terminal rewrites its files
// continuously, so it is never a prune candidate.
const PERSISTED_SESSION_RETENTION_DAYS: u64 = 30;

/// Injected once after a session's replayed scrollback on cold restore (daemon
/// death / reboot) to normalize VT state before the fresh shell writes. A dead
/// full-screen app (vim/zellij/tmux) left the parser in alt-screen, so exit it
/// (`?1049l`) to reveal the pre-app shell content instead of a frozen alt frame;
/// disable bracketed paste (`?2004l`); reset SGR (`0m`) so no color bleeds; then
/// drop to a fresh line for the new prompt.
const RESTORE_NORMALIZE_SEQUENCE: &str = "\x1b[?1049l\x1b[?2004l\x1b[0m\r\n";

/// How often a session's scrollback is checkpointed to disk while it is being
/// written to. The daemon owns PTYs across app restarts, but a *daemon* death
/// (reboot, OOM, dev relaunch which clears the daemon) used to lose all content
/// because scrollback lived only in RAM. We checkpoint to disk on this cadence
/// so a relaunched daemon can restore each session's content. Throttled so a
/// fast PTY dump doesn't rewrite the (≤200KB) file on every read.
const PERSIST_FLUSH_INTERVAL: Duration = Duration::from_millis(750);
// Let an append-only checkpoint grow modestly beyond the in-memory window,
// then compact it in one atomic rewrite. Without this slack, every small write
// to a full scrollback advances base_offset and rewrites the entire 4 MB file.
const PERSIST_COMPACT_SLACK_BYTES: usize = 1_000_000;
const MAX_SESSION_EVENTS: usize = 200;
/// Stack size for each PTY's reader thread. The daemon owns one of these per
/// live session, so at ~100 parallel terminals the default 2MB-per-thread stack
/// would reserve ~200MB of address space for threads that only hold a 4KB read
/// buffer plus a few Arc clones. A small fixed stack keeps the footprint flat as
/// the number of terminals grows.
const READER_THREAD_STACK_BYTES: usize = 256 * 1024;
/// How long `shutdown` waits for an already-SIGKILLed child to be reaped before
/// giving up and leaving it unreaped. Bounded on purpose: the `child` mutex is
/// also read by `list_sessions`, so an unbounded wait here is a daemon-wide
/// freeze rather than one stuck session.
const CHILD_REAP_TIMEOUT: Duration = Duration::from_secs(5);

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    // Behind its own mutex so `write` can release the registry lock before it
    // blocks on the PTY master. A PTY write blocks whenever the foreground
    // process stops draining its input (stopped job, wedged TUI, full kernel
    // buffer); with the writer inline that block was held *under the registry
    // lock* and froze every other session's requests too.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    output: Arc<Mutex<PtyOutputBuffer>>,
    subscribers: Arc<Mutex<Vec<PtySubscriber>>>,
    initial_cwd: Option<String>,
    command: String,
    // Last-known PTY winsize, set at spawn and kept current by resize(). The map
    // projection reads this back (session_size) to reattach a reused session at
    // its real width instead of shrinking it — see TerminalCanvas mapProjection.
    cols: u16,
    rows: u16,
    // Reader-thread lifecycle. The thread loops on master.read(); on kill() we set
    // `stop`, kill the child, and drop the master to force read() to EOF, then join
    // via `reader`. Without this the thread was detached and leaked: it kept Arcs to
    // output/subscribers alive and (on a duplicate-shell race) a leaked reader could
    // still broadcast bytes — output corruption that read as a duplicate zellij.
    reader_stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
    last_exit: Arc<Mutex<Option<PtyExitStatus>>>,
    ended: Arc<AtomicBool>,
    pane_cgroup: Option<PathBuf>,
    _resume_lock: Option<File>,
}

impl PtyEntry {
    /// Stop the reader thread and reap the child. Idempotent.
    fn shutdown(
        &mut self,
        reason: &str,
        events: &Arc<Mutex<Vec<PtySessionEvent>>>,
        lifecycle_dir: Option<&Path>,
        id: &str,
    ) {
        self.reader_stop.store(true, Ordering::Relaxed);
        if self.ended.load(Ordering::Acquire) {
            if let Some(handle) = self.reader.take() {
                let _ = handle.join();
            }
            return;
        }
        let pid = self.child.lock().unwrap().process_id();
        push_session_event(
            events,
            PtySessionEvent::new(id, "kill-requested")
                .with_pid(pid)
                .with_reason(reason),
            lifecycle_dir,
        );
        kill_pane_processes(id, pid, self.pane_cgroup.as_ref());
        let _ = self.child.lock().unwrap().kill();
        // Dropping all writers/clones of the master closes the PTY master fd, so
        // the reader's blocking read() returns EOF and the loop exits.
        if let Some(handle) = self.reader.take() {
            let _ = handle.join();
        }
        let mut child = self.child.lock().unwrap();
        // Poll instead of blocking in `wait()`. We already SIGKILLed the child,
        // so it normally reaps within milliseconds — but a child stuck in
        // uninterruptible IO never exits, and a blocking `wait()` here held the
        // `child` mutex forever. `list_sessions` reads that same mutex, so one
        // unreapable shell used to wedge every request in the daemon. Give up
        // after the deadline and record it: a lingering zombie is cheap, a
        // frozen daemon is not.
        let deadline = Instant::now() + CHILD_REAP_TIMEOUT;
        let exit_status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break PtyExitStatus::from(status),
                Err(error) => break PtyExitStatus::error(error.to_string()),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break PtyExitStatus::error(format!(
                            "child did not exit within {:?} of SIGKILL; left unreaped",
                            CHILD_REAP_TIMEOUT
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        };
        drop(child);
        *self.last_exit.lock().unwrap() = Some(exit_status.clone());
        self.ended.store(true, Ordering::Release);
        self.subscribers.lock().unwrap().clear();
        remove_pane_cgroup(self.pane_cgroup.take());
        push_session_event(
            events,
            PtySessionEvent::new(id, "killed")
                .with_pid(pid)
                .with_reason(reason)
                .with_exit_status(exit_status),
            lifecycle_dir,
        );
    }
}

#[cfg(target_os = "linux")]
fn kill_pane_processes(
    pane_id: &str,
    process_group_leader: Option<u32>,
    pane_cgroup: Option<&PathBuf>,
) {
    // A cgroup is the hard boundary: descendants keep it even after they call
    // setsid(), daemonize, or are reparented, and cgroup.kill is recursive.
    kill_pane_cgroup(pane_cgroup);

    // Capture the live descendant tree before killing the leader. This catches
    // children that called setsid() but have not yet been reparented, even when
    // the daemon is running outside a delegated systemd cgroup.
    let descendants = process_tree(process_group_leader);

    // portable-pty creates a fresh session for every PTY. Killing its process
    // group handles normal descendants, including shells, agents, and test
    // runners that stay in the PTY session.
    if let Some(pid) = process_group_leader.filter(|pid| *pid > 1) {
        unsafe {
            let _ = libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
        }
    }
    for pid in descendants {
        unsafe {
            let _ = libc::kill(pid, libc::SIGKILL);
        }
    }

    // A child can deliberately create a new session (for example via setsid,
    // nohup, or a test server). Every PTY child inherits this stable identity,
    // so sweep matching /proc environments as a second, pane-scoped boundary.
    let needle = format!("TERMFLEET_PANE_ID={pane_id}");
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(pid) = file_name
            .to_str()
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<libc::pid_t>().ok())
            .filter(|pid| *pid > 1)
        else {
            continue;
        };
        if pid == std::process::id() as libc::pid_t {
            continue;
        }
        let Ok(environ) = std::fs::read(entry.path().join("environ")) else {
            continue;
        };
        if environ
            .split(|byte| *byte == 0)
            .any(|variable| variable == needle.as_bytes())
        {
            unsafe {
                let _ = libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn process_tree(root: Option<u32>) -> Vec<libc::pid_t> {
    let Some(root) = root.filter(|pid| *pid > 1) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut parents = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name
            .to_str()
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<libc::pid_t>().ok())
            .filter(|pid| *pid > 1)
        else {
            continue;
        };
        let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some((_, rest)) = stat.rsplit_once(") ") else {
            continue;
        };
        let Some(parent) = rest
            .split_whitespace()
            .nth(1)
            .and_then(|value| value.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        parents.push((pid, parent));
    }

    let mut descendants = Vec::new();
    let mut frontier = vec![root as libc::pid_t];
    while let Some(parent) = frontier.pop() {
        for (pid, ppid) in &parents {
            if *ppid == parent && *pid != root as libc::pid_t && !descendants.contains(pid) {
                descendants.push(*pid);
                frontier.push(*pid);
            }
        }
    }
    descendants
}

#[cfg(not(target_os = "linux"))]
fn kill_pane_processes(
    _pane_id: &str,
    _process_group_leader: Option<u32>,
    _pane_cgroup: Option<&PathBuf>,
) {
}

#[cfg(not(target_os = "linux"))]
fn process_tree(_root: Option<u32>) -> Vec<i32> {
    Vec::new()
}

#[cfg(target_os = "linux")]
static NEXT_PANE_CGROUP: AtomicU64 = AtomicU64::new(1);

#[cfg(target_os = "linux")]
fn pane_cgroup_parent() -> Option<PathBuf> {
    let contents = fs::read_to_string("/proc/self/cgroup").ok()?;
    let path = contents
        .lines()
        .find_map(|line| line.strip_prefix("0::"))?
        .trim();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from("/sys/fs/cgroup").join(path.trim_start_matches('/')))
}

#[cfg(target_os = "linux")]
fn pane_cgroup_hash(id: &str) -> u32 {
    id.bytes().fold(2166136261u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(16777619)
    })
}

#[cfg(target_os = "linux")]
fn create_pane_cgroup(id: &str, pid: Option<u32>) -> Option<PathBuf> {
    let pid = pid.filter(|pid| *pid > 1)?;
    let parent = pane_cgroup_parent()?;
    let sequence = NEXT_PANE_CGROUP.fetch_add(1, Ordering::Relaxed);
    let path = parent.join(format!(
        "termfleet-pane-{:08x}-{sequence}",
        pane_cgroup_hash(id)
    ));
    fs::create_dir(&path).ok()?;
    if fs::write(path.join("cgroup.procs"), pid.to_string()).is_err() {
        let _ = fs::remove_dir(&path);
        return None;
    }
    Some(path)
}

#[cfg(not(target_os = "linux"))]
fn create_pane_cgroup(_id: &str, _pid: Option<u32>) -> Option<PathBuf> {
    None
}

#[cfg(target_os = "linux")]
fn kill_pane_cgroup(path: Option<&PathBuf>) {
    if let Some(path) = path {
        let _ = fs::write(path.join("cgroup.kill"), b"1");
    }
}

#[cfg(not(target_os = "linux"))]
fn kill_pane_cgroup(_path: Option<&PathBuf>) {}

fn remove_pane_cgroup(path: Option<PathBuf>) {
    if let Some(path) = path {
        let _ = fs::remove_dir(path);
    }
}

pub struct PtyManager {
    ptys: Mutex<HashMap<String, PtyEntry>>,
    // Serialize session creation so concurrent renderer attaches cannot launch
    // two copies of the same provider conversation before the first PTY is
    // inserted. Codex rejects that second writer as an active-writer error.
    ensure_lock: Mutex<()>,
    session_events: Arc<Mutex<Vec<PtySessionEvent>>>,
    /// When set, sessions checkpoint their scrollback + metadata under this
    /// directory so they survive a daemon restart. `None` disables persistence
    /// (used by the embedded Tauri fallback, which dies with the app anyway, and
    /// by unit tests, which must not touch the user's data dir).
    persist_dir: Option<PathBuf>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionSummary {
    pub id: String,
    pub pid: Option<u32>,
    pub initial_cwd: Option<String>,
    pub command: String,
    pub scrollback_bytes: usize,
    pub subscriber_count: usize,
    pub last_exit: Option<PtyExitStatus>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputChunk {
    pub data: String,
    pub base_offset: u64,
    pub next_offset: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitStatus {
    pub code: u32,
    pub success: bool,
    pub description: String,
}

impl PtyExitStatus {
    fn error(message: String) -> Self {
        Self {
            code: 1,
            success: false,
            description: format!("could not read exit status: {message}"),
        }
    }
}

impl From<ExitStatus> for PtyExitStatus {
    fn from(status: ExitStatus) -> Self {
        Self {
            code: status.exit_code(),
            success: status.success(),
            description: status.to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionEvent {
    pub id: String,
    pub at_ms: u128,
    pub kind: String,
    pub pid: Option<u32>,
    pub reason: Option<String>,
    pub exit_status: Option<PtyExitStatus>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalMatrixRecord {
    pub id: String,
    pub last_at_ms: u128,
    pub last_event: String,
    pub last_reason: Option<String>,
    pub pid: Option<u32>,
    pub exit_status: Option<PtyExitStatus>,
    pub event_count: u64,
}

impl PtySessionEvent {
    fn new(id: &str, kind: &str) -> Self {
        Self {
            id: id.to_string(),
            at_ms: now_ms(),
            kind: kind.to_string(),
            pid: None,
            reason: None,
            exit_status: None,
        }
    }

    fn with_pid(mut self, pid: Option<u32>) -> Self {
        self.pid = pid;
        self
    }

    fn with_reason(mut self, reason: &str) -> Self {
        self.reason = Some(reason.to_string());
        self
    }

    fn with_exit_status(mut self, exit_status: PtyExitStatus) -> Self {
        self.exit_status = Some(exit_status);
        self
    }
}

struct PtySubscriber {
    id: String,
    sender: Sender<String>,
}

#[derive(Default)]
struct PtyOutputBuffer {
    base_offset: u64,
    data: String,
    /// Disk checkpoint target. `None` for non-persistent managers.
    persist: Option<PersistHandle>,
}

/// Throttled disk-checkpoint state for one session's scrollback.
struct PersistHandle {
    path: PathBuf,
    last_flush: Option<Instant>,
    dirty: bool,
    persisted_base_offset: Option<u64>,
    persisted_data_len: usize,
}

impl PersistHandle {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_flush: None,
            dirty: false,
            persisted_base_offset: None,
            persisted_data_len: 0,
        }
    }

    fn write_checkpoint(&mut self, base_offset: u64, data: &str) -> std::io::Result<()> {
        let current_end = base_offset.saturating_add(data.len() as u64);
        if let Some(persisted_base) = self.persisted_base_offset {
            let persisted_end = persisted_base.saturating_add(self.persisted_data_len as u64);
            if persisted_end >= base_offset && persisted_end <= current_end {
                let suffix_start = (persisted_end - base_offset) as usize;
                let suffix = &data.as_bytes()[suffix_start..];
                let projected_len = self.persisted_data_len.saturating_add(suffix.len());
                if suffix.is_empty() {
                    return Ok(());
                }
                if projected_len <= MAX_SCROLLBACK_BYTES + PERSIST_COMPACT_SLACK_BYTES {
                    let append_result = (|| {
                        let mut file = fs::OpenOptions::new().append(true).open(&self.path)?;
                        file.write_all(suffix)?;
                        file.sync_data()
                    })();
                    if append_result.is_ok() {
                        self.persisted_data_len = projected_len;
                        return Ok(());
                    }
                    // A partial/failed append is repaired by the atomic full
                    // checkpoint below; never retry a suffix against unknown disk state.
                }
            }
        }

        let mut bytes = Vec::with_capacity(8 + data.len());
        bytes.extend_from_slice(&base_offset.to_le_bytes());
        bytes.extend_from_slice(data.as_bytes());
        atomic_write(&self.path, &bytes)?;
        self.persisted_base_offset = Some(base_offset);
        self.persisted_data_len = data.len();
        Ok(())
    }

    /// Persist `data` (with its `base_offset` header) if dirty and the throttle
    /// window has elapsed. Best-effort: an I/O error just leaves it dirty to
    /// retry on the next append.
    fn maybe_flush(&mut self, base_offset: u64, data: &str) {
        if !self.dirty {
            return;
        }
        let due = self
            .last_flush
            .map_or(true, |at| at.elapsed() >= PERSIST_FLUSH_INTERVAL);
        if !due {
            return;
        }
        if self.write_checkpoint(base_offset, data).is_ok() {
            self.last_flush = Some(Instant::now());
            self.dirty = false;
        }
    }

    fn flush_now(&mut self, base_offset: u64, data: &str) {
        if !self.dirty {
            return;
        }
        if self.write_checkpoint(base_offset, data).is_ok() {
            self.last_flush = Some(Instant::now());
            self.dirty = false;
        }
    }
}

impl PtyOutputBuffer {
    fn append(&mut self, data: &str) {
        self.data.push_str(data);
        if self.data.len() > MAX_SCROLLBACK_BYTES {
            let trim_to = self.data.len() - MAX_SCROLLBACK_BYTES;
            let boundary = replay_boundary_at_or_after(&self.data, trim_to);
            self.data.drain(..boundary);
            self.base_offset += boundary as u64;
        }

        let base = self.base_offset;
        if let Some(handle) = self.persist.as_mut() {
            handle.dirty = true;
            handle.maybe_flush(base, &self.data);
        }
    }

    fn flush_persist(&mut self) {
        if let Some(handle) = self.persist.as_mut() {
            handle.flush_now(self.base_offset, &self.data);
        }
    }

    fn snapshot(&mut self) -> String {
        self.flush_persist();
        self.data.clone()
    }

    fn read_since(&mut self, offset: u64) -> PtyOutputChunk {
        self.flush_persist();
        let start = offset.max(self.base_offset);
        let relative = (start - self.base_offset) as usize;
        let boundary = boundary_at_or_after(&self.data, relative);
        let data = self.data.get(boundary..).unwrap_or("").to_string();

        PtyOutputChunk {
            data,
            base_offset: self.base_offset,
            next_offset: self.base_offset + self.data.len() as u64,
        }
    }
}

trait PtyEventSink: Send + Sync + 'static {
    fn emit_pty_data(&self, id: &str, data: &str) -> Result<(), String>;
}

#[derive(Clone)]
struct TauriPtyEventSink<R: Runtime> {
    app: AppHandle<R>,
}

struct DetachedPtyEventSink;

impl<R: Runtime> PtyEventSink for TauriPtyEventSink<R> {
    fn emit_pty_data(&self, id: &str, data: &str) -> Result<(), String> {
        self.app
            .emit(&format!("pty-data-{}", id), data)
            .map_err(|error| error.to_string())
    }
}

impl PtyEventSink for DetachedPtyEventSink {
    fn emit_pty_data(&self, _id: &str, _data: &str) -> Result<(), String> {
        Ok(())
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
            ensure_lock: Mutex::new(()),
            session_events: Arc::new(Mutex::new(Vec::new())),
            persist_dir: None,
        }
    }

    /// A manager that checkpoints sessions to the default per-user data dir so
    /// they survive a daemon restart. Used by the daemon (the persistent PTY
    /// owner). Falls back to no persistence if the data dir can't be created.
    pub fn persistent() -> Self {
        let persist_dir =
            default_persist_dir().and_then(|dir| fs::create_dir_all(&dir).ok().map(|_| dir));
        if let Some(dir) = persist_dir.as_deref() {
            prune_persisted_state(dir);
        }
        Self {
            ptys: Mutex::new(HashMap::new()),
            ensure_lock: Mutex::new(()),
            session_events: Arc::new(Mutex::new(Vec::new())),
            persist_dir,
        }
    }

    #[cfg(test)]
    fn with_persistence_dir(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        Self {
            ptys: Mutex::new(HashMap::new()),
            ensure_lock: Mutex::new(()),
            session_events: Arc::new(Mutex::new(Vec::new())),
            persist_dir: Some(dir),
        }
    }

    pub fn ensure<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<(String, bool), String> {
        self.ensure_with_sink(
            TauriPtyEventSink { app: app.clone() },
            id,
            cwd,
            command,
            None,
            None,
        )
    }

    fn ensure_with_sink<S: PtyEventSink>(
        &self,
        event_sink: S,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<(String, bool), String> {
        let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let _ensure_guard = self.ensure_lock.lock().unwrap();
        let ended_entry = {
            let mut ptys = self.ptys.lock().unwrap();
            match ptys.get(&id) {
                Some(entry) if entry.ended.load(Ordering::Acquire) => ptys.remove(&id),
                Some(_) => {
                    if let Some(dir) = &self.persist_dir {
                        persist_sidecar_recovery(dir, &id);
                        write_agent_restore_status(
                            dir,
                            &id,
                            AgentRestoreStatus::LiveAttached,
                            None,
                        );
                    }
                    return Ok((id, true));
                }
                None => None,
            }
        };
        if let Some(mut entry) = ended_entry {
            entry.shutdown(
                "replace naturally ended session",
                &self.session_events,
                self.persist_dir.as_deref(),
                &id,
            );
        }
        // A persisted checkpoint for this id means the original shell died with a
        // previous daemon (dev relaunch, OOM) or the machine rebooted. Restore the
        // session so it comes back *fully*: the saved scrollback is replayed into
        // the grid (see the buffer build below) and the fresh shell reopens at the
        // saved working directory. The replay is made safe for dead full-screen
        // apps by appending RESTORE_NORMALIZE_SEQUENCE.
        let mut persisted = self
            .persist_dir
            .as_ref()
            .and_then(|dir| load_persisted(dir, &id));
        // TC-054: a hand-started agent (not launched via the agent button) leaves no
        // AgentTerminal manifest, so it would cold-restore as a bare shell. Its live
        // per-pane sidecar knows the conversation id — enrich from it so the existing
        // resume path (`plan_agent_restore`) fires. Seeded/agent-button sessions
        // already carry the manifest and are left untouched.
        let sidecar_recovery_allowed = self
            .persist_dir
            .as_ref()
            .map(|dir| is_sidecar_recovery_allowed(read_session_disposition(dir, &id)))
            .unwrap_or(true);
        let needs_sidecar_recovery = sidecar_recovery_allowed
            && persisted.as_ref().map_or(true, |entry| {
                entry.recovery_kind != Some(SessionRecoveryKind::AgentTerminal)
                    && entry
                        .sanitized_resume_command
                        .as_deref()
                        .map(str::trim)
                        .unwrap_or("")
                        .is_empty()
            });
        if needs_sidecar_recovery {
            if let Some((provider, session_id, sidecar_cwd)) = read_pane_sidecar_recovery(&id) {
                let entry = persisted.get_or_insert_with(PersistedSession::default);
                entry.recovery_kind = Some(SessionRecoveryKind::AgentTerminal);
                entry.provider = Some(provider);
                entry.provider_session_id = Some(session_id);
                if entry.launch_profile.is_none() {
                    entry.launch_profile = Some("terminal".to_string());
                }
                if entry.cwd.is_none() {
                    entry.cwd = sidecar_cwd;
                }
            }
        }
        let recovery_plan = persisted
            .as_ref()
            .map(|entry| plan_agent_restore(entry, false));
        let recovery_command = recovery_plan.as_ref().and_then(|plan| plan.command.clone());
        let cwd = cwd.or_else(|| persisted.as_ref().and_then(|entry| entry.cwd.clone()));
        let suppress_agent_relaunch = recovery_plan.as_ref().is_some_and(|plan| {
            matches!(
                plan.status,
                AgentRestoreStatus::ResumeFailed | AgentRestoreStatus::NeedsAuth
            )
        });
        let mut command = if suppress_agent_relaunch {
            None
        } else {
            recovery_command
                .or(command)
                .or_else(|| persisted.as_ref().and_then(|entry| entry.command.clone()))
        };
        let mut resume_lock = None;
        let mut resume_blocked = false;
        if recovery_plan
            .as_ref()
            .is_some_and(|plan| plan.status == AgentRestoreStatus::Resuming)
        {
            if let Some(session_id) = persisted
                .as_ref()
                .and_then(|entry| entry.provider_session_id.as_deref())
            {
                let provider = persisted
                    .as_ref()
                    .and_then(|entry| entry.provider.as_deref())
                    .unwrap_or("unknown");
                let orphaned_writer = provider_writer_is_alive(&id, provider);
                let lock_result = if orphaned_writer {
                    None
                } else {
                    let lock_dir = self
                        .persist_dir
                        .clone()
                        .or_else(default_persist_dir)
                        .ok_or_else(|| "resume lock directory unavailable".to_string())?;
                    try_acquire_resume_lock(&lock_dir, provider, session_id)?
                };
                match lock_result {
                    Some(lock) => resume_lock = Some(lock),
                    None => {
                        let reason = if orphaned_writer {
                            "agent conversation is already owned by an orphaned live provider process"
                        } else {
                            "agent conversation is already owned by another live writer"
                        };
                        if let Some(dir) = self.persist_dir.as_deref() {
                            write_agent_restore_status(
                                dir,
                                &id,
                                AgentRestoreStatus::ResumeFailed,
                                Some(reason),
                            );
                        }
                        resume_blocked = true;
                        command = None;
                    }
                }
            }
        }

        let pty_system = native_pty_system();
        // Open the PTY at the caller's measured size when known so a freshly
        // spawned shell prints its first prompt at the real terminal width. The
        // old hardcoded 80x24 meant the shell printed at 80, then the frontend
        // immediately resized it — SIGWINCH made the shell reprint, leaving a
        // stale wrong-width prompt stacked above the live one (the duplicate-prompt
        // corruption). Sizing at spawn removes that initial resize round-trip.
        // Resolve the spawn size once so the stored size matches the PTY winsize.
        // The map projection reattaches a reused session at this size (read back
        // via session_size) to avoid a corrupting shrink of an alt-screen TUI.
        // Prefer the caller's measured size; on a cold restore (no size supplied)
        // fall back to the persisted winsize so the reopened shell matches the
        // dead session's width instead of snapping to 24x80 and reflowing the
        // replayed scrollback. Default only when neither is known.
        let open_rows = rows
            .filter(|value| *value > 0)
            .or_else(|| persisted.as_ref().and_then(|entry| entry.rows))
            .filter(|value| *value > 0)
            .unwrap_or(24);
        let open_cols = cols
            .filter(|value| *value > 0)
            .or_else(|| persisted.as_ref().and_then(|entry| entry.cols))
            .filter(|value| *value > 0)
            .unwrap_or(80);
        let pair = pty_system
            .openpty(PtySize {
                rows: open_rows,
                cols: open_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let initial_cwd = cwd.clone();
        let shell = default_shell::shell_command(command);
        let command_label = shell.clone();
        let mut cmd = if default_shell::is_inline_shell_command(&shell) {
            let login_shell = default_shell::login_shell_command();
            let mut builder = CommandBuilder::new(login_shell);
            builder.arg("-lc");
            builder.arg(&shell);
            builder
        } else {
            CommandBuilder::new(&shell)
        };
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env_remove("NO_COLOR");
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "C.UTF-8".into()),
        );
        cmd.env(
            "LC_CTYPE",
            std::env::var("LC_CTYPE").unwrap_or_else(|_| "C.UTF-8".into()),
        );
        // Per-terminal status key (TC-035): expose this terminal's stable session id to
        // its child processes. The Claude status hook reads TERMFLEET_PANE_ID and keys its
        // sidecar by it, so two terminals open in the SAME directory keep independent
        // status (title + task list) instead of sharing one cwd-keyed file. The frontend
        // sends this same id as the status-request key. Covers both the in-process
        // (`ensure`) and daemon-owned (`ensure_detached`) spawns — both route here.
        cmd.env("TERMFLEET_PANE_ID", &id);

        // Set working directory
        if let Some(dir) = &cwd {
            cmd.cwd(dir);
        } else {
            // Default to home directory
            if let Some(home) = dirs::home_dir() {
                cmd.cwd(home);
            }
        }

        // Spawn the child process on the slave side
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let child_pid = child.process_id();
        let pane_cgroup = create_pane_cgroup(&id, child_pid);
        let child = Arc::new(Mutex::new(child));
        push_session_event(
            &self.session_events,
            PtySessionEvent::new(&id, "spawned")
                .with_pid(child_pid)
                .with_reason(if persisted.is_some() {
                    "restored"
                } else {
                    "fresh"
                }),
            self.persist_dir.as_deref(),
        );
        // Drop the slave - the child process has it now
        drop(pair.slave);

        // Get reader and writer from master
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|e| e.to_string())?,
        ));

        // Spawn reader thread that emits events to frontend
        let event_id = id.clone();
        let event_sink = Arc::new(event_sink);
        let mut initial_buffer = PtyOutputBuffer::default();
        if let Some(dir) = &self.persist_dir {
            let mut persist = PersistHandle::new(scrollback_path(dir, &id));
            if persisted.is_some() {
                // Cold restore: seed the buffer with the dead session's saved
                // scrollback so the daemon's snapshot replays the prior content
                // into the grid. Append the normalize sequence so a session that
                // died in a full-screen app comes back to its shell, not a frozen
                // alt-screen frame.
                if let Some((base_offset, data)) = load_persisted_scrollback(dir, &id) {
                    let (base_offset, mut data) = discard_partial_replay_prefix(base_offset, data);
                    data.push_str(RESTORE_NORMALIZE_SEQUENCE);
                    initial_buffer.base_offset = base_offset;
                    initial_buffer.data = data;
                    // Re-checkpoint the replayed content right away so a second
                    // daemon death before the throttled flush can't lose it. Only
                    // on restore — pre-flushing a fresh session's empty buffer
                    // would set last_flush and throttle its first real content.
                    persist.dirty = true;
                    persist.maybe_flush(initial_buffer.base_offset, &initial_buffer.data);
                }
            }
            initial_buffer.persist = Some(persist);
            write_session_meta(
                dir,
                &id,
                cwd.as_deref(),
                &command_label,
                open_cols,
                open_rows,
            );
            // Fresh PTYs become recoverable only after they are actually
            // created. Preserve explicit-close and backup-only tombstones.
            mark_session_recoverable_if_unknown(dir, &id);
            if let Some(plan) = recovery_plan.as_ref() {
                write_agent_restore_status(
                    dir,
                    &id,
                    if resume_blocked {
                        AgentRestoreStatus::ResumeFailed
                    } else {
                        plan.status.clone()
                    },
                    if resume_blocked {
                        Some("agent conversation is already owned by another live writer")
                    } else {
                        plan.reason.as_deref()
                    },
                );
            }
        }
        let resume_output_start = initial_buffer.data.len();
        let output = Arc::new(Mutex::new(initial_buffer));
        let output_reader = output.clone();
        let subscribers: Arc<Mutex<Vec<PtySubscriber>>> = Arc::new(Mutex::new(Vec::new()));
        let subscribers_reader = subscribers.clone();
        let reader_stop = Arc::new(AtomicBool::new(false));
        let reader_stop_thread = reader_stop.clone();
        let last_exit: Arc<Mutex<Option<PtyExitStatus>>> = Arc::new(Mutex::new(None));
        let last_exit_reader = last_exit.clone();
        let ended = Arc::new(AtomicBool::new(false));
        let ended_reader = ended.clone();
        let child_reader = child.clone();
        let reader_events = self.session_events.clone();
        let reader_event_id = id.clone();
        let reader_pid = child_pid;
        let reader_persist_dir = self.persist_dir.clone();
        let reader_pane_cgroup = pane_cgroup.clone();
        let reader_was_resuming = resume_lock.is_some();
        // An agent the operator actually used runs for more than a moment. A
        // clean exit inside this window is the resume command itself finishing,
        // not someone typing `/exit`, and must stay retryable.
        let reader_resume_started_at = std::time::Instant::now();

        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .stack_size(READER_THREAD_STACK_BYTES)
            .spawn(move || {
                let mut buf = [0u8; 4096];
                let end_event = loop {
                    if reader_stop_thread.load(Ordering::Relaxed) {
                        break Some(
                            PtySessionEvent::new(&reader_event_id, "reader-stopped")
                                .with_pid(reader_pid)
                                .with_reason("shutdown requested"),
                        );
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            break Some(
                                PtySessionEvent::new(&reader_event_id, "eof")
                                    .with_pid(reader_pid)
                                    .with_reason("pty master returned EOF"),
                            );
                        }
                        Ok(n) => {
                            // A stop requested mid-read: discard the bytes and exit so a
                            // killed/duplicate shell can never broadcast after shutdown.
                            if reader_stop_thread.load(Ordering::Relaxed) {
                                break Some(
                                    PtySessionEvent::new(&reader_event_id, "reader-stopped")
                                        .with_pid(reader_pid)
                                        .with_reason("shutdown requested after read"),
                                );
                            }
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            append_pty_output(&output_reader, &data);
                            broadcast_pty_output(&subscribers_reader, &data);
                            if event_sink.emit_pty_data(&event_id, &data).is_err() {
                                break Some(
                                    PtySessionEvent::new(&reader_event_id, "event-sink-closed")
                                        .with_pid(reader_pid)
                                        .with_reason("frontend event sink closed"),
                                );
                            }
                        }
                        Err(error) => {
                            break Some(
                                PtySessionEvent::new(&reader_event_id, "read-error")
                                    .with_pid(reader_pid)
                                    .with_reason(&error.to_string()),
                            );
                        }
                    }
                };
                if let Some(mut event) = end_event {
                    if !reader_stop_thread.load(Ordering::Relaxed) {
                        let mut child = child_reader.lock().unwrap();
                        let exit_status = match child.try_wait() {
                            Ok(Some(status)) => PtyExitStatus::from(status),
                            Ok(None) => {
                                if event.kind != "eof" {
                                    let _ = child.kill();
                                }
                                child
                                    .wait()
                                    .map(PtyExitStatus::from)
                                    .unwrap_or_else(|error| PtyExitStatus::error(error.to_string()))
                            }
                            Err(error) => PtyExitStatus::error(error.to_string()),
                        };
                        drop(child);
                        *last_exit_reader.lock().unwrap() = Some(exit_status.clone());
                        let exit_succeeded = exit_status.success;
                        if let Some(dir) = reader_persist_dir.as_deref() {
                            // Natural EOF/read failure is recoverable. The
                            // disposition check prevents a close-vs-EOF race
                            // from resurrecting an explicitly killed pane.
                            mark_session_recoverable_if_not_intentionally_killed(
                                dir,
                                &reader_event_id,
                            );
                        }
                        subscribers_reader.lock().unwrap().clear();
                        ended_reader.store(true, Ordering::Release);
                        remove_pane_cgroup(reader_pane_cgroup);
                        event = event.with_exit_status(exit_status);
                        if reader_was_resuming {
                            let resume_failure = {
                                let output = output_reader.lock().unwrap();
                                classify_agent_resume_failure(
                                    output.data.get(resume_output_start..).unwrap_or_default(),
                                )
                            };
                            // A resumed agent that ends while this daemon is
                            // alive was ended by the operator (`/exit`, Ctrl-D).
                            // Record that so the pane comes back as a plain
                            // shell: without it the next create re-plans the
                            // same resume and the agent relaunches itself the
                            // instant the user quits it.
            // A resumed agent that ends *cleanly* while this daemon is alive
                            // was ended by the operator (`/exit`, Ctrl-D). A non-zero
                            // exit is a failed resume and stays retryable.
                            let recorded_reason: Option<String> = resume_failure
                                .map(str::to_string)
                                .or_else(|| {
                                    // Any end after real uptime is the operator
                                    // leaving the agent — providers exit with
                                    // assorted codes on `/exit`, so the code is
                                    // not a usable signal. A resume that simply
                                    // fails dies inside the uptime window, and
                                    // daemon teardown is handled by the owner
                                    // stamp, not by this check.
                                    let _ = exit_succeeded;
                                    (reader_resume_started_at.elapsed()
                                        >= agent_operator_exit_min_uptime())
                                        .then(agent_operator_exit_reason)
                                });
                            if let (Some(dir), Some(reason)) =
                                (reader_persist_dir.as_deref(), recorded_reason)
                            {
                                write_agent_restore_status(
                                    dir,
                                    &reader_event_id,
                                    AgentRestoreStatus::ResumeFailed,
                                    Some(&reason),
                                );
                            }
                        }
                    }
                    trace_pty(
                        "pty.session.event",
                        format!(
                            "id={} kind={} pid={:?} reason={:?}",
                            event.id, event.kind, event.pid, event.reason
                        ),
                    );
                    push_session_event(&reader_events, event, reader_persist_dir.as_deref());
                }
            })
            .expect("spawn pty reader thread");

        // Store the PTY entry. A concurrent renderer may have created the same
        // stable session while this shell was launching; keep the first owner and
        // fully shut down this loser (kill child + stop/join its reader) so no
        // orphaned thread keeps emitting.
        let mut ptys = self.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            let mut loser = PtyEntry {
                master: pair.master,
                writer,
                child,
                output,
                subscribers,
                initial_cwd,
                command: command_label,
                cols: open_cols,
                rows: open_rows,
                reader_stop,
                reader: Some(reader_handle),
                last_exit,
                ended,
                pane_cgroup,
                _resume_lock: resume_lock,
            };
            // Release the registry first: shutdown kills the child, joins the
            // reader thread and reaps the process, none of which is bounded in
            // time. Doing it under the registry lock let one stuck loser freeze
            // every other session's requests.
            drop(ptys);
            loser.shutdown(
                "duplicate stable session lost creation race",
                &self.session_events,
                self.persist_dir.as_deref(),
                &id,
            );
            return Ok((id, true));
        }
        ptys.insert(
            id.clone(),
            PtyEntry {
                master: pair.master,
                writer,
                child,
                output,
                subscribers,
                initial_cwd,
                command: command_label,
                cols: open_cols,
                rows: open_rows,
                reader_stop,
                reader: Some(reader_handle),
                last_exit,
                ended,
                pane_cgroup,
                _resume_lock: resume_lock,
            },
        );

        Ok((id, false))
    }

    pub fn spawn<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<String, String> {
        let (id, _) = self.ensure(app, id, cwd, command)?;
        Ok(id)
    }

    pub fn ensure_detached(
        &self,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<(String, bool), String> {
        self.ensure_with_sink(DetachedPtyEventSink, id, cwd, command, cols, rows)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.ptys.lock().unwrap().len()
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        trace_pty(
            "pty.write.start",
            format!("id={id} bytes={} data={data:?}", data.len()),
        );
        // Resolve the session's writer under the registry lock, then release the
        // registry before the (potentially blocking) PTY write. Typing into a
        // wedged pane must never stall the other panes.
        let writer = if let Some((provider, session_id)) = resume_request_from_input(data) {
            let mut ptys = self.ptys.lock().unwrap();
            let entry = ptys
                .get_mut(id)
                .ok_or_else(|| format!("PTY {} not found", id))?;
            if entry._resume_lock.is_some() {
                return Err("agent conversation is already owned by this pane".to_string());
            }
            let lock_dir = self
                .persist_dir
                .clone()
                .or_else(default_persist_dir)
                .ok_or_else(|| "resume lock directory unavailable".to_string())?;
            let lock =
                try_acquire_resume_lock(&lock_dir, provider, session_id)?.ok_or_else(|| {
                    "agent conversation is already owned by another live writer".to_string()
                })?;
            entry._resume_lock = Some(lock);
            entry.writer.clone()
        } else {
            let ptys = self.ptys.lock().unwrap();
            ptys.get(id)
                .map(|entry| entry.writer.clone())
                .ok_or_else(|| format!("PTY {} not found", id))?
        };
        let mut writer = writer.lock().unwrap();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        trace_pty("pty.write.end", format!("id={id} bytes={}", data.len()));
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get_mut(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        entry.cols = cols;
        entry.rows = rows;
        let meta = (entry.initial_cwd.clone(), entry.command.clone());
        // Keep the persisted winsize current so a cold restore reopens at the
        // user's latest size, not the spawn size. The disk write happens after
        // the registry lock is released: on a thrashing disk this fsync-ish path
        // can stall for seconds, and holding the registry through it stalls every
        // other session too.
        drop(ptys);
        if let Some(dir) = &self.persist_dir {
            write_session_meta(dir, id, meta.0.as_deref(), &meta.1, cols, rows);
        }
        Ok(())
    }

    /// Current PTY winsize for a session, if it is live. The map projection
    /// reattaches a reused session at this size so an alt-screen TUI that already
    /// rendered wide is not shrunk (and corrupted) to a tiny map-node size.
    pub fn session_size(&self, id: &str) -> Option<(u16, u16)> {
        let ptys = self.ptys.lock().unwrap();
        ptys.get(id).map(|entry| (entry.cols, entry.rows))
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        self.kill_with_disposition(id, true)
    }

    pub fn kill_with_disposition(&self, id: &str, user_requested: bool) -> Result<(), String> {
        let mut entry = {
            let mut ptys = self.ptys.lock().unwrap();
            ptys.remove(id)
                .ok_or_else(|| format!("PTY {} not found", id))?
        };
        // Only an explicit operator close is terminal. System/test cleanup must
        // preserve recovery eligibility instead of manufacturing a user-close.
        if let Some(dir) = &self.persist_dir {
            write_session_disposition(
                dir,
                id,
                if user_requested {
                    SessionLifecycle::IntentionalKill
                } else {
                    SessionLifecycle::Recoverable
                },
            );
        }
        // Stop + join the reader thread (and kill the child) outside the manager
        // lock, so a reader blocked in read() can't deadlock other PTY operations
        // while we wait for it to drain to EOF.
        entry.shutdown(
            "explicit session close",
            &self.session_events,
            self.persist_dir.as_deref(),
            id,
        );
        Ok(())
    }

    /// Restore without the operator-close review. Production always goes through
    /// `restore_persisted_session_with_review`; this shorthand is for tests.
    #[cfg(test)]
    pub fn restore_persisted_session(&self, id: &str) -> Result<(), String> {
        self.restore_persisted_session_with_review(id, false)
    }

    pub fn restore_persisted_session_with_review(
        &self,
        id: &str,
        reviewed: bool,
    ) -> Result<(), String> {
        let dir = self
            .persist_dir
            .as_ref()
            .ok_or_else(|| "session persistence is unavailable".to_string())?;
        if !scrollback_path(dir, id).exists() {
            return Err(format!("No backup exists for PTY {id}"));
        }
        if matches!(
            read_session_disposition(dir, id),
            SessionLifecycle::IntentionalKill
        ) && !reviewed
        {
            return Err(format!(
                "PTY {id} was closed by the operator and cannot be restored"
            ));
        }
        write_session_disposition(dir, id, SessionLifecycle::Recoverable);
        Ok(())
    }

    pub fn get_cwd(&self, id: &str) -> Result<String, String> {
        // Registry released before touching `child` (held by shutdown while it
        // reaps) and before the /proc read, which blocks if the shell is stuck
        // in uninterruptible IO.
        let child = {
            let ptys = self.ptys.lock().unwrap();
            ptys.get(id)
                .map(|entry| entry.child.clone())
                .ok_or_else(|| format!("PTY {} not found", id))?
        };
        let pid = child
            .lock()
            .unwrap()
            .process_id()
            .ok_or_else(|| "Cannot get process ID".to_string())?;
        let link = format!("/proc/{}/cwd", pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    }

    /// Resolve a session's output buffer and release the registry before using
    /// it. `snapshot`/`read_since` both call `flush_persist`, which writes the
    /// whole scrollback (up to MAX_SCROLLBACK_BYTES) to disk synchronously — so
    /// holding the registry across them turns one slow disk into a frozen
    /// daemon, and the cockpit calls them constantly.
    fn output_handle(&self, id: &str) -> Result<Arc<Mutex<PtyOutputBuffer>>, String> {
        let ptys = self.ptys.lock().unwrap();
        ptys.get(id)
            .map(|entry| entry.output.clone())
            .ok_or_else(|| format!("PTY {} not found", id))
    }

    pub fn snapshot(&self, id: &str) -> Result<String, String> {
        let output = self.output_handle(id)?;
        let snapshot = output.lock().unwrap().snapshot();
        Ok(snapshot)
    }

    pub fn read_since(&self, id: &str, offset: u64) -> Result<PtyOutputChunk, String> {
        let output = self.output_handle(id)?;
        let chunk = output.lock().unwrap().read_since(offset);
        Ok(chunk)
    }

    /// Same hoist as `output_handle`: the reader thread holds `subscribers`
    /// while broadcasting a burst of output, so taking it under the registry
    /// couples every session to the busiest one.
    fn subscribers_handle(&self, id: &str) -> Result<Arc<Mutex<Vec<PtySubscriber>>>, String> {
        let ptys = self.ptys.lock().unwrap();
        ptys.get(id)
            .map(|entry| entry.subscribers.clone())
            .ok_or_else(|| format!("PTY {} not found", id))
    }

    pub fn subscribe(&self, id: &str, subscriber_id: String) -> Result<Receiver<String>, String> {
        let handle = self.subscribers_handle(id)?;
        let (sender, receiver) = mpsc::channel();
        let mut subscribers = handle.lock().unwrap();
        subscribers.retain(|subscriber| subscriber.id != subscriber_id);
        subscribers.push(PtySubscriber {
            id: subscriber_id,
            sender,
        });
        Ok(receiver)
    }

    pub fn unsubscribe(&self, id: &str, subscriber_id: &str) -> Result<(), String> {
        let handle = self.subscribers_handle(id)?;
        handle
            .lock()
            .unwrap()
            .retain(|subscriber| subscriber.id != subscriber_id);
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<PtySessionSummary> {
        // Take only cheap clones (Arc handles + small fields) under the registry
        // lock, then release it before touching any per-session mutex. Holding
        // the registry while locking `child`/`output`/`subscribers` made one slow
        // session freeze the whole daemon: a shutdown holding `child` across a
        // blocking wait, or a reader holding `output` across a slow scrollback
        // checkpoint, would park this call *with the registry lock held*, and
        // every other request (write, resize, kill, ensure, list) piled up behind
        // it forever. See docs/termfleet-reliability-plan.md.
        let handles: Vec<_> = {
            let ptys = self.ptys.lock().unwrap();
            ptys.iter()
                .map(|(id, entry)| {
                    (
                        id.clone(),
                        entry.child.clone(),
                        entry.output.clone(),
                        entry.subscribers.clone(),
                        entry.last_exit.clone(),
                        entry.initial_cwd.clone(),
                        entry.command.clone(),
                    )
                })
                .collect()
        };

        // Every per-session read here is a `try_lock`. A session summary must
        // never block: `output` is held across scrollback flushes to disk and
        // `child` across a reap, so a blocking read made "list my terminals"
        // hang whenever any ONE pane was mid-flush — which is how a single slow
        // session still took the cockpit down after the registry was freed.
        // A momentarily-busy session reports its cheap fields and omits the
        // contended ones rather than stalling the whole listing.
        handles
            .into_iter()
            .map(
                |(id, child, output, subscribers, last_exit, initial_cwd, command)| {
                    PtySessionSummary {
                        id,
                        pid: child.try_lock().ok().and_then(|c| c.process_id()),
                        initial_cwd,
                        command,
                        scrollback_bytes: output
                            .try_lock()
                            .map(|buffer| buffer.data.len())
                            .unwrap_or(0),
                        subscriber_count: subscribers
                            .try_lock()
                            .map(|list| list.len())
                            .unwrap_or(0),
                        last_exit: last_exit.try_lock().ok().and_then(|status| status.clone()),
                    }
                },
            )
            .collect()
    }

    /// Drop in-memory PTY entries whose reader and child have already ended.
    /// Their scrollback and recovery metadata are persisted separately, so keeping
    /// these entries forever only makes inventory and reconciliation scan stale state.
    pub fn reap_ended_sessions(&self) -> usize {
        let mut ptys = self.ptys.lock().unwrap();
        let before = ptys.len();
        ptys.retain(|_, entry| !entry.ended.load(Ordering::Acquire));
        before.saturating_sub(ptys.len())
    }

    pub fn session_events(&self) -> Vec<PtySessionEvent> {
        if let Some(dir) = self.persist_dir.as_deref() {
            if let Some(events) = read_lifecycle_events(dir) {
                return events;
            }
        }
        self.session_events.lock().unwrap().clone()
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn lifecycle_log_path(dir: &Path) -> PathBuf {
    dir.join("terminal-lifecycle.jsonl")
}

fn lifecycle_matrix_path(dir: &Path) -> PathBuf {
    dir.join("terminal-matrix.json")
}

fn update_terminal_matrix(dir: &Path, event: &PtySessionEvent) {
    let mut matrix = fs::read(lifecycle_matrix_path(dir))
        .ok()
        .and_then(|raw| serde_json::from_slice::<Vec<TerminalMatrixRecord>>(&raw).ok())
        .unwrap_or_default();
    if let Some(record) = matrix.iter_mut().find(|record| record.id == event.id) {
        record.last_at_ms = event.at_ms;
        record.last_event = event.kind.clone();
        record.last_reason = event.reason.clone();
        record.pid = event.pid.or(record.pid);
        record.exit_status = event
            .exit_status
            .clone()
            .or_else(|| record.exit_status.clone());
        record.event_count = record.event_count.saturating_add(1);
    } else {
        matrix.push(TerminalMatrixRecord {
            id: event.id.clone(),
            last_at_ms: event.at_ms,
            last_event: event.kind.clone(),
            last_reason: event.reason.clone(),
            pid: event.pid,
            exit_status: event.exit_status.clone(),
            event_count: 1,
        });
    }
    matrix.sort_by(|left, right| left.id.cmp(&right.id));
    if let Ok(json) = serde_json::to_vec(&matrix) {
        let _ = atomic_write(&lifecycle_matrix_path(dir), &json);
    }
}

/// Keep the append-only lifecycle log bounded. At the cap the current log becomes
/// the single retained previous generation and any older generation is dropped,
/// so total on-disk cost is at most two caps.
fn rotate_lifecycle_log_if_needed(dir: &Path) {
    let path = lifecycle_log_path(dir);
    let Ok(meta) = fs::metadata(&path) else {
        return;
    };
    if meta.len() < MAX_LIFECYCLE_LOG_BYTES {
        return;
    }
    let previous = path.with_extension("jsonl.1");
    let _ = fs::remove_file(&previous);
    let _ = fs::rename(&path, &previous);
}

fn append_lifecycle_event(dir: &Path, event: &PtySessionEvent) {
    let _ = fs::create_dir_all(dir);
    rotate_lifecycle_log_if_needed(dir);
    if let Ok(json) = serde_json::to_vec(event) {
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(lifecycle_log_path(dir))
        {
            let _ = file.write_all(&json);
            let _ = file.write_all(b"\n");
            let _ = file.sync_data();
        }
        update_terminal_matrix(dir, event);
    }
}

fn read_lifecycle_events(dir: &Path) -> Option<Vec<PtySessionEvent>> {
    let mut file = File::open(lifecycle_log_path(dir)).ok()?;
    let len = file.metadata().ok()?.len();
    let raw = if len > LIFECYCLE_READ_WINDOW_BYTES {
        file.seek(SeekFrom::Start(len - LIFECYCLE_READ_WINDOW_BYTES))
            .ok()?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).ok()?;
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        // The window opens mid-record; drop that partial first line.
        match text.find('\n') {
            Some(newline) => {
                text.drain(..=newline);
                text
            }
            None => String::new(),
        }
    } else {
        let mut text = String::new();
        file.read_to_string(&mut text).ok()?;
        text
    };
    Some(
        raw.lines()
            .filter_map(|line| serde_json::from_str::<PtySessionEvent>(line).ok())
            .collect(),
    )
}

/// Startup retention pass for the persisted state directory. Rotates an oversized
/// lifecycle log and removes per-session files nothing has written to within the
/// retention window. Returns how many files were removed.
pub fn prune_persisted_state(dir: &Path) -> usize {
    rotate_lifecycle_log_if_needed(dir);
    let Some(cutoff) = SystemTime::now().checked_sub(Duration::from_secs(
        PERSISTED_SESSION_RETENTION_DAYS * 86_400,
    )) else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        // Only per-session artifacts are prunable; the lifecycle log, its rotated
        // generation, and the terminal matrix are directory-level state.
        let is_session_file = name.ends_with(".scrollback")
            || name.ends_with(".meta.json")
            || name.ends_with(".history")
            || name.ends_with(".lifecycle.json");
        if !is_session_file {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else {
            continue;
        };
        if modified >= cutoff {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub fn append_lifecycle_audit(id: &str, kind: &str, reason: Option<&str>) {
    let Some(dir) = default_persist_dir() else {
        return;
    };
    let mut event = PtySessionEvent::new(id, kind);
    event.reason = reason.map(ToString::to_string);
    append_lifecycle_event(&dir, &event);
}

pub fn terminal_matrix() -> Vec<TerminalMatrixRecord> {
    default_persist_dir()
        .and_then(|dir| fs::read(lifecycle_matrix_path(&dir)).ok())
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

fn push_session_event(
    events: &Arc<Mutex<Vec<PtySessionEvent>>>,
    event: PtySessionEvent,
    lifecycle_dir: Option<&Path>,
) {
    trace_pty(
        "pty.session.event",
        format!(
            "id={} kind={} pid={:?} reason={:?} exit={:?}",
            event.id, event.kind, event.pid, event.reason, event.exit_status
        ),
    );
    if let Some(dir) = lifecycle_dir {
        append_lifecycle_event(dir, &event);
    }
    let mut events = events.lock().unwrap();
    events.push(event);
    let overflow = events.len().saturating_sub(MAX_SESSION_EVENTS);
    if overflow > 0 {
        events.drain(..overflow);
    }
}

fn append_pty_output(output: &Arc<Mutex<PtyOutputBuffer>>, data: &str) {
    trace_pty(
        "pty.output.read",
        format!("bytes={} data={data:?}", data.len()),
    );
    output.lock().unwrap().append(data);
}

fn broadcast_pty_output(subscribers: &Arc<Mutex<Vec<PtySubscriber>>>, data: &str) {
    let mut subscribers = subscribers.lock().unwrap();
    subscribers.retain(|subscriber| subscriber.sender.send(data.to_string()).is_ok());
}

fn trace_pty(label: &str, details: impl AsRef<str>) {
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

// ---------------------------------------------------------------------------
// Disk persistence (restore terminal content across a daemon restart)
// ---------------------------------------------------------------------------

/// Metadata for a session that has an on-disk checkpoint. Its presence signals a
/// restore (the original process is dead); `cwd` lets the fresh shell reopen
/// where the old one was. The saved scrollback content is loaded separately by
/// `load_persisted_scrollback` and replayed (see `ensure_with_sink`).
#[derive(Default)]
struct PersistedSession {
    cwd: Option<String>,
    command: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    recovery_kind: Option<SessionRecoveryKind>,
    provider: Option<String>,
    launch_profile: Option<String>,
    provider_session_id: Option<String>,
    mission: Option<String>,
    dropoff_path: Option<String>,
    sanitized_resume_command: Option<String>,
    restore_status: Option<AgentRestoreStatus>,
    restore_failure_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    command: Option<String>,
    // Last known PTY winsize, persisted so a cold restore (daemon death/reboot)
    // reopens the shell at its real width instead of snapping to the default
    // 24x80 — which reflowed restored scrollback and the first prompt. Optional
    // for backward compatibility with checkpoints written before this field.
    #[serde(default)]
    cols: Option<u16>,
    #[serde(default)]
    rows: Option<u16>,
    #[serde(default)]
    recovery_kind: Option<SessionRecoveryKind>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    launch_profile: Option<String>,
    #[serde(default)]
    provider_session_id: Option<String>,
    #[serde(default)]
    original_command: Option<String>,
    #[serde(default)]
    mission: Option<String>,
    #[serde(default)]
    dropoff_path: Option<String>,
    #[serde(default)]
    sanitized_resume_command: Option<String>,
    #[serde(default)]
    launched_as_regular_terminal: Option<bool>,
    #[serde(default)]
    last_healthy_ms: Option<u128>,
    #[serde(default)]
    restore_status: Option<AgentRestoreStatus>,
    #[serde(default)]
    restore_failure_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SessionLifecycle {
    #[default]
    Unknown,
    Recoverable,
    IntentionalKill,
    BackupOnly,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum SessionRecoveryKind {
    Shell,
    AgentTerminal,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum AgentRestoreStatus {
    LiveAttached,
    Resuming,
    ResumeFailed,
    Reconstructed,
    NeedsAuth,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentRestorePlan {
    status: AgentRestoreStatus,
    command: Option<String>,
    reason: Option<String>,
}

/// FNV-1a 32-bit, lowercase 8-hex. Parity with `scripts/lib/agent-status-paths.mjs`
/// `fnv()` so the daemon can locate a pane's sidecar file by its session id.
fn fnv1a_hex(input: &str) -> String {
    let mut hash: u32 = 2166136261;
    for byte in input.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:08x}")
}

/// Infer the agent provider from a provider session id when the sidecar omits it:
/// codex uses time-prefixed ULID-style ids (`019f…`); claude uses random uuidv4.
fn infer_agent_provider(session_id: &str) -> &'static str {
    if session_id.starts_with("ses_") {
        "opencode"
    } else if session_id.starts_with("019") {
        "codex"
    } else {
        "claude"
    }
}

/// Extract `(provider, session_id)` from a pane sidecar's JSON for cold-restore
/// resume (TC-054). Provider is the sidecar `provider` field when present, else
/// inferred from the id shape. Returns None when there is no non-empty sessionId.
fn agent_recovery_from_sidecar(sidecar_text: &str) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_str(sidecar_text).ok()?;
    let session_id = value.get("sessionId")?.as_str()?.trim().to_string();
    if session_id.is_empty() {
        return None;
    }
    let provider = value
        .get("provider")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| infer_agent_provider(&session_id).to_string());
    Some((provider, session_id))
}

/// Read a session's live per-pane sidecar (written continuously by the codex/claude
/// status hooks, for hand-started agents too) and extract `(provider, session_id,
/// cwd)` for cold-restore resume. Returns None when there is no sidecar/session id.
fn read_pane_sidecar_recovery(id: &str) -> Option<(String, String, Option<String>)> {
    let path = data_root_dir()?
        .join("agent-status")
        .join(format!("pane-{}.json", fnv1a_hex(id)));
    let text = std::fs::read_to_string(path).ok()?;
    let (provider, session_id) = agent_recovery_from_sidecar(&text)?;
    let cwd = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("cwd")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        });
    Some((provider, session_id, cwd))
}

fn plan_agent_restore(persisted: &PersistedSession, live_pty_exists: bool) -> AgentRestorePlan {
    if live_pty_exists {
        return AgentRestorePlan {
            status: AgentRestoreStatus::LiveAttached,
            command: None,
            reason: None,
        };
    }

    if persisted.recovery_kind != Some(SessionRecoveryKind::AgentTerminal) {
        return AgentRestorePlan {
            status: AgentRestoreStatus::Reconstructed,
            command: persisted.command.clone(),
            reason: Some("regular shell checkpoint".to_string()),
        };
    }

    if persisted.restore_status == Some(AgentRestoreStatus::NeedsAuth)
        || persisted
            .restore_failure_reason
            .as_deref()
            .is_some_and(|reason| reason.to_ascii_lowercase().contains("auth"))
    {
        return AgentRestorePlan {
            status: AgentRestoreStatus::NeedsAuth,
            command: None,
            reason: persisted.restore_failure_reason.clone(),
        };
    }

    // A persisted `resume-failed` only sticks when the failure is terminal (the
    // provider transcript is gone). Ownership/policy refusals are transient: after
    // a reboot the previous owner is dead, so the pane must be allowed to resume.
    // Duplicate writers are still prevented downstream by `provider_writer_is_alive`
    // plus the on-disk resume lock, not by this sticky flag.
    if persisted.restore_status == Some(AgentRestoreStatus::ResumeFailed)
        && persisted
            .restore_failure_reason
            .as_deref()
            .is_some_and(agent_resume_failure_is_terminal)
    {
        return AgentRestorePlan {
            status: AgentRestoreStatus::ResumeFailed,
            command: None,
            reason: persisted.restore_failure_reason.clone(),
        };
    }

    if let Some(command) = persisted
        .sanitized_resume_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
    {
        return AgentRestorePlan {
            status: AgentRestoreStatus::Resuming,
            command: Some(command.to_string()),
            reason: None,
        };
    }

    if persisted.provider.as_deref() == Some("codex")
        && matches!(
            persisted.launch_profile.as_deref(),
            None | Some("terminal") | Some("headless")
        )
    {
        if let Some(session_id) = persisted
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|session_id| !session_id.is_empty())
        {
            return AgentRestorePlan {
                status: AgentRestoreStatus::Resuming,
                command: Some(format!("codex resume {}", shell_quote_arg(session_id))),
                reason: None,
            };
        }
    }

    if persisted.provider.as_deref() == Some("claude")
        && matches!(
            persisted.launch_profile.as_deref(),
            None | Some("terminal") | Some("headless")
        )
    {
        if let Some(session_id) = persisted
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|session_id| !session_id.is_empty())
        {
            return AgentRestorePlan {
                status: AgentRestoreStatus::Resuming,
                command: Some(format!("claude --resume {}", shell_quote_arg(session_id))),
                reason: None,
            };
        }
    }

    // OpenCode resumes a conversation by id with `--session`; its ids are the
    // `ses_...` strings its own status plugin stamps into the pane sidecar.
    if persisted.provider.as_deref() == Some("opencode")
        && matches!(
            persisted.launch_profile.as_deref(),
            None | Some("terminal") | Some("headless")
        )
    {
        if let Some(session_id) = persisted
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|session_id| !session_id.is_empty())
        {
            return AgentRestorePlan {
                status: AgentRestoreStatus::Resuming,
                command: Some(format!(
                    "opencode --session {}",
                    shell_quote_arg(session_id)
                )),
                reason: None,
            };
        }
    }

    let has_reconstruction_context = persisted
        .mission
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || persisted
            .dropoff_path
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());

    AgentRestorePlan {
        status: AgentRestoreStatus::Reconstructed,
        command: persisted.command.clone(),
        reason: Some(
            if has_reconstruction_context {
                "missing durable provider session id; reconstruct from mission/dropoff and scrollback"
            } else {
                "missing durable provider session id"
            }
            .to_string(),
        ),
    }
}

/// Terminal resume failures never retry: the saved conversation is gone, so a
/// fresh `codex resume` would only print an error. Every other recorded reason
/// (ownership, another live writer, auth-less policy refusals) is transient and
/// must be re-planned on the next cold restore.
fn agent_resume_failure_is_terminal(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("no longer exists")
        || reason.contains("no saved session found")
        || reason.contains("not found")
        || (reason.contains(AGENT_EXITED_IN_SESSION) && agent_operator_exit_is_current(&reason))
}

/// Recorded when a resumed agent's process ends while its daemon is still
/// running: the operator quit it. Auto-resume must not undo that.
const AGENT_EXITED_IN_SESSION: &str = "agent was exited in this session";

/// How long a resumed agent must stay alive before a clean exit counts as the
/// operator quitting it rather than the resume command finishing on its own.
const AGENT_OPERATOR_EXIT_MIN_UPTIME_DEFAULT: std::time::Duration =
    std::time::Duration::from_secs(10);

/// Overridable so an end-to-end test can prove the real spawn -> quit -> restore
/// chain without sleeping for the production threshold.
fn agent_operator_exit_min_uptime() -> std::time::Duration {
    std::env::var("TERMFLEET_AGENT_QUIT_MIN_UPTIME_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(std::time::Duration::from_millis)
        .unwrap_or(AGENT_OPERATOR_EXIT_MIN_UPTIME_DEFAULT)
}

/// Stamps the quit marker with the daemon that observed it. A quit only silences
/// auto-resume for the daemon that was running at the time: if the daemon itself
/// is later stopped, its own teardown kills every agent cleanly, and without this
/// stamp that teardown would look exactly like the operator quitting all of them.
fn agent_operator_exit_reason() -> String {
    format!("{AGENT_EXITED_IN_SESSION} (owner={})", daemon_run_id())
}

/// Identity of THIS daemon run. Deliberately not the pid: pids are reused after a
/// reboot, and a recycled pid would let a stale quit marker silence a legitimate
/// recovery — the exact class of bug this stamp exists to prevent.
fn daemon_run_id() -> &'static str {
    static RUN_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    RUN_ID.get_or_init(|| {
        let pid = std::process::id();
        // /proc/self/stat field 22 is the process start time in clock ticks
        // since boot: unique per run alongside the pid, and stable while it runs.
        let start_ticks = fs::read_to_string("/proc/self/stat")
            .ok()
            .and_then(|stat| {
                let tail = stat.rsplit_once(would_be_comm_end())?.1.to_string();
                tail.split_whitespace().nth(19).map(str::to_string)
            })
            .unwrap_or_else(|| "0".to_string());
        format!("{pid}-{start_ticks}")
    })
}

fn would_be_comm_end() -> &'static str {
    ") "
}

/// True when the quit was recorded by the daemon that is running right now.
/// A marker from a dead daemon means the agents died with it, not by choice.
fn agent_operator_exit_is_current(reason: &str) -> bool {
    reason
        .rsplit_once("(owner=")
        .and_then(|(_, rest)| rest.strip_suffix(')'))
        .is_some_and(|owner| owner.trim() == daemon_run_id())
}

fn classify_agent_resume_failure(output: &str) -> Option<&'static str> {
    if output.contains("No saved session found with ID") {
        Some("saved agent session no longer exists")
    } else if output.contains("already has an active writer") {
        Some("agent session is already active in another writer")
    } else {
        None
    }
}

fn shell_quote_arg(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':' | '/' | '@'))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn resume_request_from_input(data: &str) -> Option<(&str, &str)> {
    let parts = data.split_whitespace().collect::<Vec<_>>();
    match parts.as_slice() {
        ["exec", "codex", "resume", session_id]
        | ["exec", "claude", "--resume", session_id]
        | ["exec", "opencode", "--session", session_id]
            if !session_id.is_empty() =>
        {
            Some((parts[1], session_id))
        }
        _ => None,
    }
}

/// Root of termfleet's per-user durable state (`~/.local/share/terminal-workspace`).
/// Holds the per-session scrollback (`sessions/`) and the workspace layout
/// (`workspace.json`) so the tab→session mapping survives a localStorage wipe.
pub fn data_root_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::data_local_dir)
        .map(|dir| dir.join("terminal-workspace"))
}

fn default_persist_dir() -> Option<PathBuf> {
    data_root_dir().map(|dir| dir.join("sessions"))
}

/// Remove the durable checkpoint for an explicitly closed session. The current
/// desktop may need this when an older canonical daemon handled the live kill
/// but did not remove its checkpoint.
pub fn forget_persisted_session(id: &str) {
    if let Some(dir) = default_persist_dir() {
        remove_persisted(&dir, id);
    }
}

fn try_acquire_resume_lock(
    dir: &Path,
    provider: &str,
    session_id: &str,
) -> Result<Option<File>, String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!(
        "resume-{}.lock",
        encode_id(&format!("{provider}:{session_id}"))
    ));
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result == 0 {
            return Ok(Some(file));
        }
        if std::io::Error::last_os_error().kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err(std::io::Error::last_os_error().to_string());
    }

    #[cfg(not(unix))]
    {
        Ok(Some(file))
    }
}

/// A daemon can die while a PTY child remains alive. In that case the old
/// daemon's in-memory resume lease is gone, but the provider process still owns
/// the conversation. Refuse to launch a second provider when its pane-scoped
/// process is still present; Codex otherwise rejects the duplicate with
/// `thread/resume ... already has an active writer`.
fn provider_writer_is_alive(pane_id: &str, provider: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        let provider = provider.to_ascii_lowercase();
        let Ok(entries) = fs::read_dir("/proc") else {
            return false;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(_pid) = name
                .to_str()
                .filter(|value| {
                    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
                })
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|pid| *pid > 1 && *pid != std::process::id())
            else {
                continue;
            };
            let path = entry.path();
            let Ok(environ) = fs::read(path.join("environ")) else {
                continue;
            };
            let pane_marker = format!("TERMFLEET_PANE_ID={pane_id}");
            if !environ
                .split(|byte| *byte == 0)
                .any(|variable| variable == pane_marker.as_bytes())
            {
                continue;
            }
            let Ok(command_line) = fs::read(path.join("cmdline")) else {
                continue;
            };
            let command_line = String::from_utf8_lossy(&command_line).to_ascii_lowercase();
            if command_line
                .split('\0')
                .any(|argument| argument.contains(&provider))
            {
                return true;
            }
        }
        false
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (pane_id, provider);
        false
    }
}

/// Summary of a session whose content is checkpointed on disk (whether or not it
/// is currently live). Used to reconcile orphaned content back into the
/// workspace after a layout reset.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionSummary {
    pub id: String,
    pub cwd: Option<String>,
    pub scrollback_bytes: usize,
    pub lifecycle: SessionLifecycle,
    pub backup_only: bool,
    pub command: Option<String>,
    pub provider: Option<String>,
    pub provider_session_id: Option<String>,
}

/// Enumerate sessions with on-disk scrollback in the default persistence dir.
/// `scrollback_bytes` excludes the 8-byte base-offset header.
pub fn list_persisted_sessions() -> Vec<PersistedSessionSummary> {
    let Some(dir) = default_persist_dir() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("scrollback") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        let Ok(id_bytes) = (0..stem.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(stem.get(i..i + 2).unwrap_or(""), 16))
            .collect::<Result<Vec<u8>, _>>()
        else {
            continue;
        };
        let Ok(id) = String::from_utf8(id_bytes) else {
            continue;
        };
        let bytes = fs::metadata(&path)
            .map(|meta| (meta.len() as usize).saturating_sub(8))
            .unwrap_or(0);
        let meta = fs::read(meta_path(&dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<SessionMeta>(&raw).ok());
        let cwd = meta.as_ref().and_then(|meta| meta.cwd.clone());
        let command = meta.as_ref().and_then(|meta| meta.command.clone());
        let provider = meta.as_ref().and_then(|meta| meta.provider.clone());
        let provider_session_id = meta
            .as_ref()
            .and_then(|meta| meta.provider_session_id.clone())
            .or_else(|| extract_provider_session_id(command.as_deref()));
        let lifecycle = read_session_disposition(&dir, &id);
        sessions.push(PersistedSessionSummary {
            id,
            cwd,
            scrollback_bytes: bytes,
            backup_only: matches!(
                lifecycle,
                SessionLifecycle::IntentionalKill | SessionLifecycle::BackupOnly
            ),
            lifecycle,
            command,
            provider,
            provider_session_id,
        });
    }
    sessions
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentRecoveryManifestUpdate {
    pub cwd: Option<String>,
    pub provider: Option<String>,
    pub launch_profile: Option<String>,
    pub provider_session_id: Option<String>,
    pub original_command: Option<String>,
    pub mission: Option<String>,
    pub dropoff_path: Option<String>,
    pub sanitized_resume_command: Option<String>,
    pub restore_status: Option<String>,
    pub restore_failure_reason: Option<String>,
}

pub fn update_agent_recovery_manifest(
    id: &str,
    update: AgentRecoveryManifestUpdate,
) -> Result<(), String> {
    let dir =
        default_persist_dir().ok_or_else(|| "session persistence dir unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    update_agent_recovery_manifest_in_dir(&dir, id, update)
}

fn update_agent_recovery_manifest_in_dir(
    dir: &Path,
    id: &str,
    update: AgentRecoveryManifestUpdate,
) -> Result<(), String> {
    let previous = fs::read(meta_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
        .unwrap_or_default();
    let explicit_restore_status = update
        .restore_status
        .as_deref()
        .and_then(parse_agent_restore_status);
    let clear_failure_reason = matches!(
        explicit_restore_status,
        Some(AgentRestoreStatus::LiveAttached | AgentRestoreStatus::Resuming)
    );
    let restore_status = explicit_restore_status.or(previous.restore_status);
    let restore_failure_reason = if clear_failure_reason {
        update.restore_failure_reason
    } else {
        update
            .restore_failure_reason
            .or(previous.restore_failure_reason)
    };
    let meta = SessionMeta {
        cwd: update.cwd.or(previous.cwd),
        command: previous.command,
        cols: previous.cols,
        rows: previous.rows,
        recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
        provider: update.provider.or(previous.provider),
        launch_profile: update.launch_profile.or(previous.launch_profile),
        provider_session_id: update.provider_session_id.or(previous.provider_session_id),
        original_command: update.original_command.or(previous.original_command),
        mission: update.mission.or(previous.mission),
        dropoff_path: update.dropoff_path.or(previous.dropoff_path),
        sanitized_resume_command: update
            .sanitized_resume_command
            .or(previous.sanitized_resume_command),
        launched_as_regular_terminal: Some(true),
        last_healthy_ms: Some(now_ms()),
        restore_status,
        restore_failure_reason,
    };
    let json = serde_json::to_vec(&meta).map_err(|error| error.to_string())?;
    atomic_write(&meta_path(dir, id), &json).map_err(|error| error.to_string())
}

fn parse_agent_restore_status(value: &str) -> Option<AgentRestoreStatus> {
    match value {
        "live-attached" => Some(AgentRestoreStatus::LiveAttached),
        "resuming" => Some(AgentRestoreStatus::Resuming),
        "resume-failed" => Some(AgentRestoreStatus::ResumeFailed),
        "reconstructed" => Some(AgentRestoreStatus::Reconstructed),
        "needs-auth" => Some(AgentRestoreStatus::NeedsAuth),
        _ => None,
    }
}

fn write_agent_restore_status(
    dir: &Path,
    id: &str,
    status: AgentRestoreStatus,
    reason: Option<&str>,
) {
    let Some(mut meta) = fs::read(meta_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
    else {
        return;
    };
    if meta.recovery_kind != Some(SessionRecoveryKind::AgentTerminal) {
        return;
    }
    meta.restore_status = Some(status);
    if let Some(reason) = reason {
        meta.restore_failure_reason = Some(reason.to_string());
    }
    if let Ok(json) = serde_json::to_vec(&meta) {
        let _ = atomic_write(&meta_path(dir, id), &json);
    }
}

/// Filesystem-safe, reversible mapping from a session id to a filename stem.
/// Session ids come from the frontend (uuids, pane paths) and can contain
/// characters that aren't valid in a filename, so hex-encode the raw bytes.
fn encode_id(id: &str) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(id.len() * 2);
    for byte in id.as_bytes() {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn scrollback_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.scrollback", encode_id(id)))
}

fn meta_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.meta.json", encode_id(id)))
}

/// Where a dead session's pre-restore scrollback is parked (not replayed live).
fn history_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.history", encode_id(id)))
}

fn lifecycle_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.lifecycle.json", encode_id(id)))
}

fn read_session_disposition(dir: &Path, id: &str) -> SessionLifecycle {
    fs::read(lifecycle_path(dir, id))
        .ok()
        .and_then(|raw| serde_json::from_slice::<SessionLifecycle>(&raw).ok())
        .unwrap_or_default()
}

fn mark_session_recoverable_if_unknown(dir: &Path, id: &str) {
    if matches!(read_session_disposition(dir, id), SessionLifecycle::Unknown) {
        write_session_disposition(dir, id, SessionLifecycle::Recoverable);
    }
}

fn mark_session_recoverable_if_not_intentionally_killed(dir: &Path, id: &str) {
    if matches!(
        read_session_disposition(dir, id),
        SessionLifecycle::Unknown | SessionLifecycle::Recoverable
    ) {
        write_session_disposition(dir, id, SessionLifecycle::Recoverable);
    }
}

fn is_sidecar_recovery_allowed(lifecycle: SessionLifecycle) -> bool {
    matches!(lifecycle, SessionLifecycle::Recoverable)
}

fn write_session_disposition(dir: &Path, id: &str, lifecycle: SessionLifecycle) {
    let _ = fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_vec(&lifecycle) {
        let _ = atomic_write(&lifecycle_path(dir, id), &json);
        let lifecycle_name = match lifecycle {
            SessionLifecycle::Unknown => "unknown",
            SessionLifecycle::Recoverable => "recoverable",
            SessionLifecycle::IntentionalKill => "intentional-kill",
            SessionLifecycle::BackupOnly => "backup-only",
        };
        append_lifecycle_event(
            dir,
            &PtySessionEvent::new(id, "lifecycle-disposition").with_reason(lifecycle_name),
        );
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        let _ = file.sync_all();
    }
    fs::rename(&tmp, path)
}

fn write_session_meta(
    dir: &Path,
    id: &str,
    cwd: Option<&str>,
    command: &str,
    cols: u16,
    rows: u16,
) {
    let previous = fs::read(meta_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
        .unwrap_or_default();
    let meta = SessionMeta {
        cwd: cwd.map(|value| value.to_string()),
        command: Some(command.to_string()),
        cols: Some(cols),
        rows: Some(rows),
        recovery_kind: previous.recovery_kind,
        provider: previous.provider,
        launch_profile: previous.launch_profile,
        provider_session_id: previous.provider_session_id,
        original_command: previous.original_command,
        mission: previous.mission,
        dropoff_path: previous.dropoff_path,
        sanitized_resume_command: previous.sanitized_resume_command,
        launched_as_regular_terminal: previous.launched_as_regular_terminal,
        last_healthy_ms: previous.last_healthy_ms,
        restore_status: previous.restore_status,
        restore_failure_reason: previous.restore_failure_reason,
    };
    if let Ok(json) = serde_json::to_vec(&meta) {
        let _ = atomic_write(&meta_path(dir, id), &json);
    }
}

/// Promote the live per-pane provider identity into the durable checkpoint.
///
/// Hand-started agents begin life as a shell from the PTY daemon's point of
/// view. While that PTY remains attached, the status sidecar is the only
/// authoritative provider/session mapping. Persist it before any daemon
/// restart can turn the shell checkpoint into a plain-shell restore.
fn persist_sidecar_recovery(dir: &Path, id: &str) {
    let Some((provider, session_id, sidecar_cwd)) = read_pane_sidecar_recovery(id) else {
        return;
    };
    let path = meta_path(dir, id);
    let mut meta = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
        .unwrap_or_default();
    // A pane's recovery binding is durable identity, not mutable status. Nested
    // Codex/Claude workers inherit TERMFLEET_PANE_ID and therefore write to the
    // same status sidecar as their parent; accepting a later session id here
    // silently replaces the conversation the pane must restore. Bind once and
    // change it only through an explicit top-level recovery-manifest update.
    if meta.recovery_kind == Some(SessionRecoveryKind::AgentTerminal)
        && meta
            .provider_session_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return;
    }
    meta.recovery_kind = Some(SessionRecoveryKind::AgentTerminal);
    meta.provider = Some(provider);
    meta.provider_session_id = Some(session_id);
    if meta.launch_profile.is_none() {
        meta.launch_profile = Some("terminal".to_string());
    }
    if meta.cwd.is_none() {
        meta.cwd = sidecar_cwd;
    }
    if let Ok(json) = serde_json::to_vec(&meta) {
        let _ = atomic_write(&path, &json);
    }
}

/// Detect a session checkpoint for this id. Returns `None` for a fresh session
/// (no saved scrollback). Reads the cwd metadata used to reopen the shell; the
/// scrollback *content* is loaded separately by `load_persisted_scrollback`.
fn load_persisted(dir: &Path, id: &str) -> Option<PersistedSession> {
    if !scrollback_path(dir, id).exists() {
        return None;
    }
    let lifecycle = read_session_disposition(dir, id);
    if !matches!(lifecycle, SessionLifecycle::Recoverable) {
        return None;
    }
    let meta = fs::read(meta_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
        .unwrap_or_default();
    let provider_session_id = meta
        .provider_session_id
        .clone()
        .or_else(|| extract_provider_session_id(meta.command.as_deref()))
        .or_else(|| extract_provider_session_id(meta.sanitized_resume_command.as_deref()))
        .or_else(|| extract_provider_session_id(meta.original_command.as_deref()));
    Some(PersistedSession {
        cwd: meta.cwd,
        command: meta.command,
        cols: meta.cols,
        rows: meta.rows,
        recovery_kind: meta.recovery_kind,
        provider: meta.provider,
        launch_profile: meta.launch_profile,
        provider_session_id,
        mission: meta.mission,
        dropoff_path: meta.dropoff_path,
        sanitized_resume_command: meta.sanitized_resume_command,
        restore_status: meta.restore_status,
        restore_failure_reason: meta.restore_failure_reason,
    })
}

fn extract_provider_session_id(command: Option<&str>) -> Option<String> {
    let tokens: Vec<&str> = command?.split_whitespace().collect();
    tokens.windows(2).find_map(|pair| {
        let marker = pair[0].trim_matches(|ch: char| ch == '\'' || ch == '"' || ch == ';');
        let candidate = pair[1].trim_matches(|ch: char| {
            ch == '\'' || ch == '"' || ch == ';' || ch == ')' || ch == '('
        });
        if marker != "resume" && marker != "--resume" {
            return None;
        }
        if candidate.len() == 36
            && candidate.chars().enumerate().all(|(index, ch)| {
                if [8, 13, 18, 23].contains(&index) {
                    ch == '-'
                } else {
                    ch.is_ascii_hexdigit()
                }
            })
        {
            Some(candidate.to_string())
        } else {
            None
        }
    })
}

/// Load a dead session's checkpointed scrollback for replay on cold restore:
/// the 8-byte little-endian `base_offset` header followed by the raw (lossy
/// UTF-8) byte log exactly as `PersistHandle` wrote it. `None` if absent or
/// shorter than the header.
fn load_persisted_scrollback(dir: &Path, id: &str) -> Option<(u64, String)> {
    let raw = fs::read(scrollback_path(dir, id)).ok()?;
    if raw.len() < 8 {
        return None;
    }
    let mut header = [0u8; 8];
    header.copy_from_slice(&raw[..8]);
    let mut base_offset = u64::from_le_bytes(header);
    let mut data = String::from_utf8_lossy(&raw[8..]).into_owned();
    if data.len() > MAX_SCROLLBACK_BYTES {
        let trim_to = data.len() - MAX_SCROLLBACK_BYTES;
        let boundary = replay_boundary_at_or_after(&data, trim_to);
        data.drain(..boundary);
        base_offset = base_offset.saturating_add(boundary as u64);
    }
    Some((base_offset, data))
}

fn remove_persisted(dir: &Path, id: &str) {
    let _ = fs::remove_file(scrollback_path(dir, id));
    let _ = fs::remove_file(meta_path(dir, id));
    let _ = fs::remove_file(history_path(dir, id));
    let _ = fs::remove_file(lifecycle_path(dir, id));
}

fn boundary_at_or_after(data: &str, index: usize) -> usize {
    if index >= data.len() {
        return data.len();
    }

    data.char_indices()
        .find_map(|(boundary, _)| (boundary >= index).then_some(boundary))
        .unwrap_or(data.len())
}

fn replay_boundary_at_or_after(data: &str, index: usize) -> usize {
    let boundary = boundary_at_or_after(data, index);
    if boundary == 0 || boundary >= data.len() {
        return boundary;
    }

    let rest = &data[boundary..];
    rest.find('\n')
        .map(|line_end| boundary + line_end + 1)
        .unwrap_or(data.len())
}

fn discard_partial_replay_prefix(base_offset: u64, data: String) -> (u64, String) {
    if base_offset == 0 || data.is_empty() {
        return (base_offset, data);
    }

    match data.find('\n') {
        Some(line_end) => {
            let boundary = line_end + 1;
            (
                base_offset + boundary as u64,
                data.get(boundary..).unwrap_or("").to_string(),
            )
        }
        None => (base_offset + data.len() as u64, String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        agent_recovery_from_sidecar, classify_agent_resume_failure, discard_partial_replay_prefix,
        extract_provider_session_id, fnv1a_hex, plan_agent_restore, provider_writer_is_alive,
        replay_boundary_at_or_after, AgentRecoveryManifestUpdate, AgentRestoreStatus,
        PersistedSession, PtyManager, SessionMeta, SessionRecoveryKind,
    };

    fn wait_for_snapshot_containing(manager: &PtyManager, id: &str, needle: &str) -> String {
        let mut snapshot = String::new();
        for _ in 0..40 {
            snapshot = manager.snapshot(id).expect("read snapshot");
            if snapshot.contains(needle) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        snapshot
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn orphaned_provider_process_is_detected_by_pane_and_provider() {
        let pane_id = format!("orphan-writer-test-{}", std::process::id());
        let mut child = std::process::Command::new("bash")
            .args(["-c", "exec -a codex sleep 5"])
            .env("TERMFLEET_PANE_ID", &pane_id)
            .spawn()
            .expect("spawn fake orphaned provider");
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(provider_writer_is_alive(&pane_id, "codex"));
        assert!(!provider_writer_is_alive(&pane_id, "claude"));
        let _ = child.kill();
        let _ = child.wait();
        assert!(!provider_writer_is_alive(&pane_id, "codex"));
    }

    #[test]
    fn replay_trim_uses_line_boundary_instead_of_escape_tail() {
        let data =
            "stable line before\n\x1b[14;8Hcorrupt first retained line\nrendered line after\n";
        let index_inside_escape = data.find("14;8H").expect("escape tail marker");
        let boundary = replay_boundary_at_or_after(data, index_inside_escape);

        assert_eq!(&data[boundary..], "rendered line after\n");
    }

    #[test]
    fn restored_trimmed_scrollback_drops_partial_first_line() {
        let (base_offset, data) =
            discard_partial_replay_prefix(900, "14;8Hng\r\nvisible line\r\n".to_string());

        assert_eq!(base_offset, 909);
        assert_eq!(data, "visible line\r\n");
    }

    #[test]
    fn manager_handles_one_hundred_consecutive_pty_sessions() {
        let dir = std::env::temp_dir().join(format!(
            "tw-one-hundred-pty-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = PtyManager::with_persistence_dir(dir.clone());
        let ids: Vec<String> = (0..100).map(|index| format!("load-{index}")).collect();

        for id in &ids {
            let (actual_id, reused) = manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    Some(100),
                    Some(30),
                )
                .expect("100-session PTY load must remain attachable");
            assert_eq!(&actual_id, id);
            assert!(!reused);
        }
        assert_eq!(manager.active_count(), 100);

        for id in &ids {
            manager
                .kill(id)
                .expect("load session must be cleanly stoppable");
        }
        assert_eq!(manager.active_count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_command_fallback_extracts_provider_session_id() {
        assert_eq!(
            extract_provider_session_id(Some(
                "export TERMFLEET=1; exec codex resume 019fe29c-6f6b-7d23-98f6-05c99d8970ce",
            )),
            Some("019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string())
        );
        assert_eq!(
            extract_provider_session_id(Some("claude --resume not-a-session")),
            None
        );
    }

    fn codex_agent_checkpoint(provider_session_id: Option<&str>) -> PersistedSession {
        PersistedSession {
            cwd: Some("/work/termfleet".to_string()),
            command: Some("codex".to_string()),
            cols: Some(132),
            rows: Some(37),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            launch_profile: Some("terminal".to_string()),
            provider_session_id: provider_session_id.map(ToString::to_string),
            mission: Some("Restore the interrupted agent lane".to_string()),
            dropoff_path: Some("HANDOFF.md".to_string()),
            sanitized_resume_command: None,
            restore_status: None,
            restore_failure_reason: None,
        }
    }

    fn claude_agent_checkpoint(provider_session_id: Option<&str>) -> PersistedSession {
        PersistedSession {
            cwd: Some("/work/termfleet".to_string()),
            command: Some("claude".to_string()),
            cols: Some(132),
            rows: Some(37),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("claude".to_string()),
            launch_profile: Some("terminal".to_string()),
            provider_session_id: provider_session_id.map(ToString::to_string),
            mission: Some("Restore the interrupted agent lane".to_string()),
            dropoff_path: Some("HANDOFF.md".to_string()),
            sanitized_resume_command: None,
            restore_status: None,
            restore_failure_reason: None,
        }
    }

    #[test]
    fn agent_restore_planner_prefers_live_attach_when_pty_survived() {
        let plan = plan_agent_restore(&codex_agent_checkpoint(Some("019f-agent-session")), true);

        assert_eq!(plan.status, AgentRestoreStatus::LiveAttached);
        assert_eq!(plan.command, None);
        assert_eq!(plan.reason, None);
    }

    #[test]
    fn agent_restore_planner_resumes_codex_when_no_live_pty_remains() {
        // No live PTY means the owning daemon died (reboot, OOM). The exact
        // conversation must be resumed; duplicate writers are blocked downstream
        // by `provider_writer_is_alive` plus the on-disk resume lock.
        let plan = plan_agent_restore(&codex_agent_checkpoint(Some("019f-agent-session")), false);

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(plan.command.as_deref(), Some("codex resume 019f-agent-session"));
    }

    #[test]
    fn agent_restore_planner_retries_a_transient_agent_resume() {
        let mut checkpoint = codex_agent_checkpoint(Some("019f-transient-session"));
        checkpoint.restore_status = Some(AgentRestoreStatus::ResumeFailed);
        checkpoint.restore_failure_reason = Some("resume command exited".to_string());

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("codex resume 019f-transient-session")
        );
    }

    #[test]
    fn agent_restore_planner_retries_an_ownership_refusal_after_a_reboot() {
        // The refusal recorded while the previous daemon still owned the
        // conversation must not outlive that daemon.
        let mut checkpoint = codex_agent_checkpoint(Some("019f-owned-session"));
        checkpoint.restore_status = Some(AgentRestoreStatus::ResumeFailed);
        checkpoint.restore_failure_reason = Some(
            "No stable live owner for the exact saved conversation; automatic resume is disabled"
                .to_string(),
        );

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("codex resume 019f-owned-session")
        );
    }

    #[test]
    fn agent_restore_planner_never_relaunches_an_agent_the_operator_quit() {
        // `/exit` in a resumed pane must drop the operator at a shell. Without
        // this the pane re-plans the same resume and the agent reappears the
        // instant it is quit.
        let mut checkpoint = codex_agent_checkpoint(Some("019f-quit-session"));
        checkpoint.restore_status = Some(AgentRestoreStatus::ResumeFailed);
        checkpoint.restore_failure_reason = Some(super::agent_operator_exit_reason());

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::ResumeFailed);
        assert_eq!(plan.command, None);
    }

    #[test]
    fn quitting_a_resumed_agent_restores_a_shell_but_a_dead_daemon_still_resumes() {
        // End-to-end over the real spawn -> exit -> restore chain, not the
        // planner alone: the planner passed while `/exit` still relaunched the
        // agent in the live app, because the marker was never written.
        use std::path::PathBuf;

        std::env::set_var("TERMFLEET_AGENT_QUIT_MIN_UPTIME_MS", "150");
        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-quit-e2e-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-quit-e2e".to_string();

        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("/bin/bash".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some("019f-quit-e2e".to_string()),
            // Stands in for the agent: alive past the threshold, then leaves
            // with a non-zero code the way a real provider can.
            sanitized_resume_command: Some("sleep 0.6; exit 3".to_string()),
            ..SessionMeta::default()
        };
        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback checkpoint");
        super::atomic_write(
            &super::meta_path(&dir, &id),
            &serde_json::to_vec(&meta).expect("encode meta"),
        )
        .expect("seed metadata");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("spawn the resumed agent");
        std::thread::sleep(std::time::Duration::from_millis(1400));

        let after_quit = super::load_persisted(&dir, &id).expect("read checkpoint");
        let reason = after_quit
            .restore_failure_reason
            .clone()
            .expect("a quit must be recorded");
        assert!(
            reason.contains(super::AGENT_EXITED_IN_SESSION),
            "expected an operator-quit marker, got {reason:?}"
        );
        assert_eq!(after_quit.restore_status, Some(AgentRestoreStatus::ResumeFailed));

        // Same daemon: no resume is planned, so the restore falls through to a
        // plain shell. Prove that against the real restore, not just the plan.
        let plan_after_quit = plan_agent_restore(&after_quit, false);
        assert_eq!(plan_after_quit.status, AgentRestoreStatus::ResumeFailed);
        assert_eq!(plan_after_quit.command, None);

        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("restore the quit pane");
        std::thread::sleep(std::time::Duration::from_millis(300));
        let restored = super::load_persisted(&dir, &id).expect("read restored checkpoint");
        assert_ne!(
            restored.command.as_deref(),
            Some("sleep 0.6; exit 3"),
            "quitting an agent must leave a shell, not relaunch the agent"
        );

        // A different daemon run (reboot, crash, app restart): resume again.
        let mut from_dead_daemon =
            super::load_persisted(&dir, &id).expect("re-read checkpoint");
        from_dead_daemon.restore_failure_reason =
            Some(reason.replace(super::daemon_run_id(), "9999-dead-run"));
        let plan = plan_agent_restore(&from_dead_daemon, false);
        assert_eq!(
            plan.status,
            AgentRestoreStatus::Resuming,
            "an agent that died with its daemon must still resume"
        );
        assert_eq!(plan.command.as_deref(), Some("sleep 0.6; exit 3"));

        std::env::remove_var("TERMFLEET_AGENT_QUIT_MIN_UPTIME_MS");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn daemon_run_id_is_not_just_a_reusable_pid() {
        // A pid alone is reused after a reboot, which would let a stale quit
        // marker silence a legitimate recovery.
        let run_id = super::daemon_run_id();
        assert!(run_id.starts_with(&format!("{}-", std::process::id())));
        assert_ne!(run_id, std::process::id().to_string());
        assert_eq!(run_id, super::daemon_run_id(), "run id must be stable");
    }

    #[test]
    fn agent_restore_planner_resumes_agents_that_died_with_a_previous_daemon() {
        // Stopping the daemon kills every agent cleanly, which looks identical to
        // the operator quitting them. The quit marker is stamped with the daemon
        // that saw it, so a marker from a dead daemon must not silence recovery.
        let mut checkpoint = codex_agent_checkpoint(Some("019f-daemon-death"));
        checkpoint.restore_status = Some(AgentRestoreStatus::ResumeFailed);
        checkpoint.restore_failure_reason = Some(format!(
            "{} (owner={}-dead-run)",
            super::AGENT_EXITED_IN_SESSION,
            std::process::id()
        ));

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("codex resume 019f-daemon-death")
        );
    }

    #[test]
    fn agent_restore_planner_never_retries_a_missing_saved_conversation() {
        let mut checkpoint = codex_agent_checkpoint(Some("019f-gone-session"));
        checkpoint.restore_status = Some(AgentRestoreStatus::ResumeFailed);
        checkpoint.restore_failure_reason =
            Some("saved agent session no longer exists".to_string());

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::ResumeFailed);
        assert_eq!(plan.command, None);
        assert!(plan.reason.is_some());
    }

    #[test]
    fn missing_codex_session_output_marks_the_resume_as_failed() {
        assert_eq!(
            classify_agent_resume_failure(
                "ERROR: No saved session found with ID 019f-missing-session."
            ),
            Some("saved agent session no longer exists")
        );
        assert_eq!(
            classify_agent_resume_failure("agent completed normally"),
            None
        );
    }

    #[test]
    fn agent_restore_planner_resumes_claude_when_no_live_pty_remains() {
        let plan = plan_agent_restore(&claude_agent_checkpoint(Some("97f9-claude-session")), false);

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("claude --resume 97f9-claude-session")
        );
    }

    fn opencode_agent_checkpoint(provider_session_id: Option<&str>) -> PersistedSession {
        PersistedSession {
            cwd: Some("/work/termfleet".to_string()),
            command: Some("opencode".to_string()),
            cols: Some(132),
            rows: Some(37),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("opencode".to_string()),
            launch_profile: Some("terminal".to_string()),
            provider_session_id: provider_session_id.map(ToString::to_string),
            mission: None,
            dropoff_path: None,
            sanitized_resume_command: None,
            restore_status: None,
            restore_failure_reason: None,
        }
    }

    #[test]
    fn agent_restore_planner_resumes_opencode_when_no_live_pty_remains() {
        let plan = plan_agent_restore(
            &opencode_agent_checkpoint(Some("ses_4b6273738ffer1UqWIk6zevIQA")),
            false,
        );

        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("opencode --session ses_4b6273738ffer1UqWIk6zevIQA")
        );
    }

    #[test]
    fn agent_restore_planner_reconstructs_opencode_without_a_session_id() {
        let plan = plan_agent_restore(&opencode_agent_checkpoint(None), false);

        assert_eq!(plan.status, AgentRestoreStatus::Reconstructed);
    }

    #[test]
    fn sidecar_provider_is_inferred_from_an_opencode_session_id() {
        let text = r#"{"sessionId":"ses_4b6273738ffer1UqWIk6zevIQA","cwd":"/x"}"#;
        assert_eq!(
            agent_recovery_from_sidecar(text),
            Some((
                "opencode".to_string(),
                "ses_4b6273738ffer1UqWIk6zevIQA".to_string()
            ))
        );
    }

    #[test]
    fn fnv1a_hex_matches_the_node_sidecar_name_scheme() {
        // Real pane id -> its on-disk sidecar file pane-0162f700.json.
        let pane =
            "terminal-6e9b9476-f2a2-4ec4-949e-660c749727f0-8abd0e41-2a96-4436-9978-1d2ab3c37603";
        assert_eq!(fnv1a_hex(pane), "0162f700");
    }

    #[test]
    fn sidecar_recovery_uses_explicit_provider() {
        let text = r#"{"sessionId":"97f94c32-4b90-448d-99ac-31876103ab25","provider":"claude","cwd":"/x"}"#;
        assert_eq!(
            agent_recovery_from_sidecar(text),
            Some((
                "claude".to_string(),
                "97f94c32-4b90-448d-99ac-31876103ab25".to_string()
            ))
        );
    }

    #[test]
    fn sidecar_recovery_infers_codex_from_ulid_id_when_provider_absent() {
        let text = r#"{"sessionId":"019f5554-b21a-7de1-be53-35aac426be5a","cwd":"/x"}"#;
        let (provider, id) = agent_recovery_from_sidecar(text).expect("recovery");
        assert_eq!(provider, "codex");
        assert_eq!(id, "019f5554-b21a-7de1-be53-35aac426be5a");
    }

    #[test]
    fn sidecar_recovery_infers_claude_from_uuid_id_when_provider_absent() {
        let text = r#"{"sessionId":"2134def7-6e6d-47be-a000-000000000000"}"#;
        assert_eq!(agent_recovery_from_sidecar(text).unwrap().0, "claude");
    }

    #[test]
    fn sidecar_recovery_is_none_without_a_session_id() {
        assert_eq!(
            agent_recovery_from_sidecar(r#"{"cwd":"/x","userTask":"hi"}"#),
            None
        );
        assert_eq!(agent_recovery_from_sidecar(r#"{"sessionId":""}"#), None);
    }

    #[test]
    fn sidecar_derived_recovery_resumes_a_hand_started_agent_on_cold_restore() {
        // A pane that was a bare shell (no manifest) but whose live sidecar knows
        // the conversation must cold-restore into a resume, not a plain shell.
        let text = r#"{"sessionId":"019f56e6-a57e-7021-b159-8aaa714ebbae","cwd":"/work"}"#;
        let (provider, id) = agent_recovery_from_sidecar(text).expect("recovery");
        let mut persisted = PersistedSession::default();
        persisted.recovery_kind = Some(SessionRecoveryKind::AgentTerminal);
        persisted.launch_profile = Some("terminal".to_string());
        persisted.provider = Some(provider);
        persisted.provider_session_id = Some(id);
        let plan = plan_agent_restore(&persisted, false);
        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("codex resume 019f56e6-a57e-7021-b159-8aaa714ebbae")
        );
    }

    #[test]
    fn read_pane_sidecar_recovery_reads_the_live_sidecar_from_its_hashed_path() {
        let id = format!(
            "terminal-tc054-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        );
        let dir = super::data_root_dir()
            .expect("data dir")
            .join("agent-status");
        std::fs::create_dir_all(&dir).expect("create agent-status dir");
        let file = dir.join(format!("pane-{}.json", fnv1a_hex(&id)));
        std::fs::write(
            &file,
            r#"{"sessionId":"019f56e6-a57e-7021-b159-8aaa714ebbae","provider":"codex","cwd":"/work/x"}"#,
        )
        .expect("write sidecar");
        let got = super::read_pane_sidecar_recovery(&id);
        let _ = std::fs::remove_file(&file);
        assert_eq!(
            got,
            Some((
                "codex".to_string(),
                "019f56e6-a57e-7021-b159-8aaa714ebbae".to_string(),
                Some("/work/x".to_string())
            ))
        );
    }

    #[test]
    fn live_sidecar_recovery_promotes_a_shell_checkpoint_to_agent_resume_metadata() {
        let id = format!(
            "terminal-tc054-persist-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        );
        let sidecar_dir = super::data_root_dir()
            .expect("data dir")
            .join("agent-status");
        std::fs::create_dir_all(&sidecar_dir).expect("create agent-status dir");
        let sidecar = sidecar_dir.join(format!("pane-{}.json", fnv1a_hex(&id)));
        std::fs::write(
            &sidecar,
            r#"{"sessionId":"019f56e6-a57e-7021-b159-8aaa714ebbae","provider":"codex","cwd":"/work/x"}"#,
        )
        .expect("write sidecar");

        let checkpoint_dir = std::env::temp_dir().join(format!(
            "tw-sidecar-persist-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&checkpoint_dir);
        std::fs::create_dir_all(&checkpoint_dir).expect("create checkpoint dir");
        std::fs::write(
            super::meta_path(&checkpoint_dir, &id),
            serde_json::to_vec(&super::SessionMeta {
                command: Some("/bin/bash".to_string()),
                ..Default::default()
            })
            .expect("encode shell checkpoint"),
        )
        .expect("write shell checkpoint");

        super::persist_sidecar_recovery(&checkpoint_dir, &id);
        let meta = std::fs::read(super::meta_path(&checkpoint_dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<super::SessionMeta>(&raw).ok())
            .expect("read promoted checkpoint");
        assert_eq!(meta.command.as_deref(), Some("/bin/bash"));
        assert_eq!(
            meta.recovery_kind,
            Some(super::SessionRecoveryKind::AgentTerminal)
        );
        assert_eq!(meta.provider.as_deref(), Some("codex"));
        assert_eq!(
            meta.provider_session_id.as_deref(),
            Some("019f56e6-a57e-7021-b159-8aaa714ebbae")
        );
        assert_eq!(meta.launch_profile.as_deref(), Some("terminal"));
        assert_eq!(meta.cwd.as_deref(), Some("/work/x"));

        let _ = std::fs::remove_file(sidecar);
        let _ = std::fs::remove_dir_all(checkpoint_dir);
    }

    #[test]
    fn nested_agent_sidecar_cannot_replace_a_bound_pane_conversation() {
        let id = format!(
            "terminal-tc054-bound-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        );
        let sidecar_dir = super::data_root_dir()
            .expect("data dir")
            .join("agent-status");
        std::fs::create_dir_all(&sidecar_dir).expect("create agent-status dir");
        let sidecar = sidecar_dir.join(format!("pane-{}.json", fnv1a_hex(&id)));
        std::fs::write(
            &sidecar,
            r#"{"sessionId":"019f-nested-session","provider":"codex","cwd":"/nested/worker"}"#,
        )
        .expect("write nested sidecar");

        let checkpoint_dir = std::env::temp_dir().join(format!(
            "tw-sidecar-bound-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&checkpoint_dir);
        std::fs::create_dir_all(&checkpoint_dir).expect("create checkpoint dir");
        std::fs::write(
            super::meta_path(&checkpoint_dir, &id),
            serde_json::to_vec(&super::SessionMeta {
                command: Some("/bin/bash".to_string()),
                recovery_kind: Some(super::SessionRecoveryKind::AgentTerminal),
                provider: Some("codex".to_string()),
                provider_session_id: Some("019f-original-session".to_string()),
                ..Default::default()
            })
            .expect("encode bound checkpoint"),
        )
        .expect("write bound checkpoint");

        super::persist_sidecar_recovery(&checkpoint_dir, &id);
        let meta = std::fs::read(super::meta_path(&checkpoint_dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<super::SessionMeta>(&raw).ok())
            .expect("read bound checkpoint");
        assert_eq!(
            meta.provider_session_id.as_deref(),
            Some("019f-original-session")
        );

        let _ = std::fs::remove_file(sidecar);
        let _ = std::fs::remove_dir_all(checkpoint_dir);
    }

    #[test]
    fn agent_restore_planner_never_starts_a_new_agent_when_session_id_is_missing() {
        let plan = plan_agent_restore(&codex_agent_checkpoint(None), false);

        assert_eq!(plan.status, AgentRestoreStatus::Reconstructed);
    }

    #[test]
    fn agent_restore_planner_never_starts_an_agent_for_auth_failures() {
        let mut checkpoint = codex_agent_checkpoint(Some("019f-agent-session"));
        checkpoint.restore_failure_reason = Some("auth required by provider".to_string());

        let plan = plan_agent_restore(&checkpoint, false);

        assert_eq!(plan.status, AgentRestoreStatus::NeedsAuth);
        assert_eq!(plan.command, None);
        assert!(plan.reason.is_some());
    }

    #[test]
    fn agent_recovery_manifest_update_preserves_session_checkpoint_fields() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-manifest-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create manifest dir");
        let id = "agent-manifest-update-test";
        let previous = SessionMeta {
            cwd: Some("/work/termfleet".to_string()),
            command: Some("codex".to_string()),
            cols: Some(132),
            rows: Some(37),
            ..SessionMeta::default()
        };
        let previous_bytes = serde_json::to_vec(&previous).expect("encode previous meta");
        super::atomic_write(&super::meta_path(&dir, id), &previous_bytes)
            .expect("seed previous meta");

        super::update_agent_recovery_manifest_in_dir(
            &dir,
            id,
            AgentRecoveryManifestUpdate {
                provider: Some("codex".to_string()),
                launch_profile: Some("terminal".to_string()),
                provider_session_id: Some("019f-agent-session".to_string()),
                original_command: Some("codex".to_string()),
                mission: Some("Restore the interrupted agent lane".to_string()),
                dropoff_path: Some("HANDOFF.md".to_string()),
                restore_status: Some("resuming".to_string()),
                ..AgentRecoveryManifestUpdate::default()
            },
        )
        .expect("update agent manifest");

        let updated = std::fs::read(super::meta_path(&dir, id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read updated meta");
        assert_eq!(updated.cwd.as_deref(), Some("/work/termfleet"));
        assert_eq!(updated.command.as_deref(), Some("codex"));
        assert_eq!(updated.cols, Some(132));
        assert_eq!(updated.rows, Some(37));
        assert_eq!(
            updated.recovery_kind,
            Some(SessionRecoveryKind::AgentTerminal)
        );
        assert_eq!(updated.provider.as_deref(), Some("codex"));
        assert_eq!(
            updated.provider_session_id.as_deref(),
            Some("019f-agent-session")
        );
        assert_eq!(updated.restore_status, Some(AgentRestoreStatus::Resuming));
        assert_eq!(updated.launched_as_regular_terminal, Some(true));
        assert!(updated.last_healthy_ms.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn exact_live_receipt_clears_an_old_resume_failure() {
        let dir = std::env::temp_dir().join(format!(
            "tw-agent-live-receipt-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create receipt dir");
        let id = "agent-live-receipt-test";
        let previous = SessionMeta {
            restore_status: Some(AgentRestoreStatus::ResumeFailed),
            restore_failure_reason: Some("old failure".to_string()),
            ..SessionMeta::default()
        };
        super::atomic_write(
            &super::meta_path(&dir, id),
            &serde_json::to_vec(&previous).expect("encode failed receipt"),
        )
        .expect("seed failed receipt");

        super::update_agent_recovery_manifest_in_dir(
            &dir,
            id,
            AgentRecoveryManifestUpdate {
                restore_status: Some("live-attached".to_string()),
                ..AgentRecoveryManifestUpdate::default()
            },
        )
        .expect("write live receipt");

        let updated = std::fs::read(super::meta_path(&dir, id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read live receipt");
        assert_eq!(
            updated.restore_status,
            Some(AgentRestoreStatus::LiveAttached)
        );
        assert_eq!(updated.restore_failure_reason, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn live_agent_reattach_records_live_attached_restore_status() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-live-status-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "agent-live-status-test".to_string();
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    Some(120),
                    Some(40),
                )
                .expect("spawn live agent PTY");
            super::update_agent_recovery_manifest_in_dir(
                &dir,
                &id,
                AgentRecoveryManifestUpdate {
                    provider: Some("codex".to_string()),
                    launch_profile: Some("terminal".to_string()),
                    provider_session_id: Some("019f-agent-session".to_string()),
                    original_command: Some("codex".to_string()),
                    mission: Some("Restore the interrupted agent lane".to_string()),
                    ..AgentRecoveryManifestUpdate::default()
                },
            )
            .expect("mark live session as agent");

            let (_reattached, reused) = manager
                .ensure_detached(Some(id.clone()), None, None, None, None)
                .expect("reattach live agent PTY");
            assert!(reused);

            let updated = std::fs::read(super::meta_path(&dir, &id))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
                .expect("read live-attached meta");
            assert_eq!(
                updated.restore_status,
                Some(AgentRestoreStatus::LiveAttached)
            );

            manager.kill(&id).expect("kill live agent PTY");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cold_agent_restore_records_reconstructed_status_without_session_id() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-reconstruct-status-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-reconstruct-status-test".to_string();

        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);
        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("sh".to_string()),
            cols: Some(120),
            rows: Some(40),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            launch_profile: Some("terminal".to_string()),
            mission: Some("Restore the interrupted agent lane".to_string()),
            dropoff_path: Some("HANDOFF.md".to_string()),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("cold restore without provider session id");

        let updated = std::fs::read(super::meta_path(&dir, &id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read reconstructed meta");
        assert_eq!(
            updated.restore_status,
            Some(AgentRestoreStatus::Reconstructed)
        );
        assert_eq!(
            updated.restore_failure_reason.as_deref(),
            Some("missing durable provider session id; reconstruct from mission/dropoff and scrollback")
        );

        manager.kill(&id).expect("kill reconstructed agent PTY");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kill_removes_pty_from_manager() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "kill-removes-pty-test".to_string();

        let spawned = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn test PTY");

        assert_eq!(spawned, id);
        manager
            .write(&id, "before kill\n")
            .expect("write before kill");
        manager.kill(&id).expect("kill test PTY");

        let write_after_kill = manager.write(&id, "after kill\n");
        assert!(
            matches!(write_after_kill, Err(ref error) if error.contains("not found")),
            "expected killed PTY to be removed, got {write_after_kill:?}"
        );
    }

    #[test]
    fn kill_stops_and_joins_the_reader_thread() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "reader-exit-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                // `cat` with no input produces no output, so the reader thread is
                // parked in a blocking read() — the exact case that used to leak
                // when the entry was killed. (Matches the other tests' shell.)
                Some("cat".to_string()),
            )
            .expect("spawn test PTY");

        // Hold a weak ref to the reader's shared output buffer. The reader thread
        // keeps one strong clone; if kill() failed to stop+join it, the buffer
        // would survive entry removal.
        let output_weak = {
            let ptys = manager.ptys.lock().unwrap();
            std::sync::Arc::downgrade(&ptys.get(&id).expect("entry present").output)
        };
        assert!(output_weak.upgrade().is_some(), "buffer live before kill");

        manager.kill(&id).expect("kill test PTY");

        assert_eq!(manager.active_count(), 0);
        assert!(
            output_weak.upgrade().is_none(),
            "reader thread leaked: output buffer still strong-referenced after kill"
        );
    }

    /// A pane whose foreground process stopped draining its input must not be
    /// able to freeze the whole daemon.
    ///
    /// Regression for the 2026-08-11 wedge: `write` held the global registry
    /// lock across the blocking PTY write, so once one pane's input buffer
    /// filled, every other request (`listSessions`, writes to other panes,
    /// kill, ensure) blocked behind it forever — 1000+ parked threads, and the
    /// app fell back to an embedded PTY owner while all terminals were alive.
    #[cfg(unix)]
    #[test]
    fn a_pane_that_never_drains_input_does_not_block_other_sessions() {
        use std::sync::{mpsc, Arc};
        use std::thread;
        use std::time::{Duration, Instant};

        let app = tauri::test::mock_app();
        let manager = Arc::new(PtyManager::new());
        let stuck = "wedge-writer-stuck".to_string();
        let other = "wedge-writer-other".to_string();

        for id in [&stuck, &other] {
            manager
                .spawn(
                    app.handle(),
                    Some(id.clone()),
                    None,
                    Some("sleep 30".to_string()),
                )
                .expect("spawn PTY");
        }

        // Stand in for the real-world stall (a pane whose foreground process
        // stopped draining input, so `write_all` parks in the kernel) by holding
        // that one session's writer. Deterministic, and it exercises the exact
        // ordering that matters: a caller blocked on ONE session's writer must
        // not still be holding the registry that every other session needs.
        let stuck_writer = {
            let ptys = manager.ptys.lock().unwrap();
            ptys.get(&stuck).expect("stuck session").writer.clone()
        };
        let held = stuck_writer.lock().unwrap();

        let blocked = manager.clone();
        let blocked_id = stuck.clone();
        thread::spawn(move || {
            let _ = blocked.write(&blocked_id, "input nobody drains\n");
        });
        thread::sleep(Duration::from_millis(200));

        let (tx, rx) = mpsc::channel();
        let probe = manager.clone();
        let probe_other = other.clone();
        thread::spawn(move || {
            let started = Instant::now();
            let listed = probe.list_sessions().len();
            let wrote = probe.write(&probe_other, "echo hi\n").is_ok();
            let _ = tx.send((listed, wrote, started.elapsed()));
        });

        let (listed, wrote, elapsed) = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("listSessions/write froze behind a pane that never drains its input");
        assert_eq!(listed, 2, "both sessions should still be listed");
        assert!(wrote, "writing to a healthy pane must still succeed");
        assert!(
            elapsed < Duration::from_secs(2),
            "registry was stalled by the wedged pane for {elapsed:?}"
        );

        drop(held);
        let _ = manager.kill(&stuck);
        let _ = manager.kill(&other);
    }

    /// Reading one pane's scrollback must not freeze the others.
    ///
    /// `snapshot`/`read_since` call `flush_persist`, which writes the whole
    /// scrollback to disk synchronously. Those ran with the registry lock held,
    /// so on a stalled disk — exactly the state this workstation was in during
    /// the 2026-08-11 tmpfs storm — a single scrollback flush froze every pane.
    /// The cockpit polls these constantly, which is what made it total.
    #[cfg(unix)]
    #[test]
    fn reading_one_panes_scrollback_does_not_block_other_sessions() {
        use std::sync::{mpsc, Arc};
        use std::thread;
        use std::time::{Duration, Instant};

        let app = tauri::test::mock_app();
        let manager = Arc::new(PtyManager::new());
        let slow = "slow-scrollback-session".to_string();
        let other = "healthy-scrollback-session".to_string();

        for id in [&slow, &other] {
            manager
                .spawn(
                    app.handle(),
                    Some(id.clone()),
                    None,
                    Some("sleep 30".to_string()),
                )
                .expect("spawn PTY");
        }

        // Stand in for a scrollback flush stalled on a thrashing disk.
        let slow_output = {
            let ptys = manager.ptys.lock().unwrap();
            ptys.get(&slow).expect("slow session").output.clone()
        };
        let held = slow_output.lock().unwrap();

        let blocked = manager.clone();
        let blocked_id = slow.clone();
        thread::spawn(move || {
            let _ = blocked.snapshot(&blocked_id);
        });
        thread::sleep(Duration::from_millis(200));

        let (tx, rx) = mpsc::channel();
        let probe = manager.clone();
        let probe_other = other.clone();
        thread::spawn(move || {
            let started = Instant::now();
            let listed = probe.list_sessions().len();
            let snapped = probe.snapshot(&probe_other).is_ok();
            let _ = tx.send((listed, snapped, started.elapsed()));
        });

        let (listed, snapped, elapsed) = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("registry froze behind one session's scrollback flush");
        assert_eq!(listed, 2);
        assert!(
            snapped,
            "a healthy pane's scrollback must still be readable"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "registry was stalled for {elapsed:?}"
        );

        drop(held);
        let _ = manager.kill(&slow);
        let _ = manager.kill(&other);
    }

    /// The remaining per-session entry points must be hoisted too.
    ///
    /// `get_cwd` reads `/proc/<pid>/cwd` (blocks on a shell stuck in
    /// uninterruptible IO) and `subscribe` takes the list the reader holds while
    /// broadcasting a burst. Both used to do that with the registry held, so a
    /// single busy pane stalled every other pane's requests.
    #[cfg(unix)]
    #[test]
    fn cwd_and_subscribe_on_a_busy_pane_do_not_block_other_sessions() {
        use std::sync::{mpsc, Arc};
        use std::thread;
        use std::time::{Duration, Instant};

        let app = tauri::test::mock_app();
        let manager = Arc::new(PtyManager::new());
        let busy = "busy-entrypoint-session".to_string();
        let other = "healthy-entrypoint-session".to_string();

        for id in [&busy, &other] {
            manager
                .spawn(
                    app.handle(),
                    Some(id.clone()),
                    None,
                    Some("sleep 30".to_string()),
                )
                .expect("spawn PTY");
        }

        // Hold both of the mutexes those two entry points reach for.
        let (child, subscribers) = {
            let ptys = manager.ptys.lock().unwrap();
            let entry = ptys.get(&busy).expect("busy session");
            (entry.child.clone(), entry.subscribers.clone())
        };
        let held_child = child.lock().unwrap();
        let held_subs = subscribers.lock().unwrap();

        for (m, id) in [
            (manager.clone(), busy.clone()),
            (manager.clone(), busy.clone()),
        ] {
            thread::spawn(move || {
                let _ = m.get_cwd(&id);
            });
        }
        let sub_manager = manager.clone();
        let sub_id = busy.clone();
        thread::spawn(move || {
            let _ = sub_manager.subscribe(&sub_id, "probe".to_string());
        });
        thread::sleep(Duration::from_millis(200));

        let (tx, rx) = mpsc::channel();
        let probe = manager.clone();
        let probe_other = other.clone();
        thread::spawn(move || {
            let started = Instant::now();
            let cwd_ok = probe.get_cwd(&probe_other).is_ok();
            let sub_ok = probe.subscribe(&probe_other, "healthy".to_string()).is_ok();
            let listed = probe.list_sessions().len();
            let _ = tx.send((cwd_ok, sub_ok, listed, started.elapsed()));
        });

        let (cwd_ok, sub_ok, listed, elapsed) = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("healthy pane froze behind a busy one");
        assert!(cwd_ok, "a healthy pane's cwd must still be readable");
        assert!(sub_ok, "a healthy pane must still accept a subscriber");
        assert_eq!(listed, 2);
        assert!(
            elapsed < Duration::from_secs(2),
            "registry was stalled for {elapsed:?}"
        );

        drop(held_subs);
        drop(held_child);
        let _ = manager.kill(&busy);
        let _ = manager.kill(&other);
    }

    #[cfg(unix)]
    #[test]
    fn kill_terminates_processes_started_inside_the_pty_session() {
        use std::thread;
        use std::time::{Duration, Instant};

        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "kill-process-tree-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("sh -c 'setsid sleep 30 & printf \"%s\\n\" \"$!\"; wait'".to_string()),
            )
            .expect("spawn process-tree test PTY");
        let unrelated_id = "kill-process-tree-unrelated-test".to_string();
        manager
            .spawn(
                app.handle(),
                Some(unrelated_id.clone()),
                None,
                Some("sleep 30".to_string()),
            )
            .expect("spawn unrelated PTY");

        let child_pid = {
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let output = manager.snapshot(&id).expect("snapshot process-tree PTY");
                if let Some(pid) = output
                    .lines()
                    .filter_map(|line| line.trim().parse::<libc::pid_t>().ok())
                    .find(|pid| *pid > 1)
                {
                    break pid;
                }
                assert!(
                    Instant::now() < deadline,
                    "child process pid was not printed"
                );
                thread::sleep(Duration::from_millis(20));
            }
        };

        manager.kill(&id).expect("kill process-tree test PTY");

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let process_gone = unsafe { libc::kill(child_pid, 0) == -1 };
            if process_gone {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "child process {child_pid} survived PTY close"
            );
            thread::sleep(Duration::from_millis(20));
        }
        assert!(manager.write(&unrelated_id, "still alive\n").is_ok());
        manager
            .kill(&unrelated_id)
            .expect("kill unrelated test PTY");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn kill_terminates_detached_descendant_that_drops_pane_marker() {
        use std::fs;
        use std::thread;
        use std::time::{Duration, Instant};

        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "kill-detached-unmarked-test".to_string();
        let pid_file = std::env::temp_dir().join(format!(
            "termfleet-detached-child-{}-{}.pid",
            std::process::id(),
            super::now_ms()
        ));
        let pid_file_arg = super::shell_quote_arg(&pid_file.to_string_lossy());
        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some(format!(
                    "setsid sh -c 'env -u TERMFLEET_PANE_ID sleep 30 & child=$!; printf \"%s\\n\" \"$child\" > {pid_file_arg}; wait'"
                )),
            )
            .expect("spawn detached unmarked process PTY");
        let pane_pid = manager
            .ptys
            .lock()
            .unwrap()
            .get(&id)
            .and_then(|entry| entry.child.lock().unwrap().process_id())
            .expect("detached PTY pid");
        let pane_cgroup = std::fs::read_to_string(format!("/proc/{pane_pid}/cgroup"))
            .expect("read detached PTY cgroup");

        let child_pid = {
            // A shared CI runner can take several seconds to get the detached
            // child scheduled and its pid flushed; the assertion is about the
            // pid appearing at all, not about how quickly.
            let deadline = Instant::now() + Duration::from_secs(20);
            loop {
                if let Ok(pid_file_contents) = fs::read_to_string(&pid_file) {
                    if let Some(pid) = pid_file_contents
                        .lines()
                        .filter_map(|line| line.trim().parse::<libc::pid_t>().ok())
                        .find(|pid| *pid > 1)
                    {
                        break pid;
                    }
                }
                if let Some(pid) = manager
                    .snapshot(&id)
                    .expect("snapshot detached PTY")
                    .lines()
                    .filter_map(|line| line.trim().parse::<libc::pid_t>().ok())
                    .find(|pid| *pid > 1)
                {
                    break pid;
                }
                assert!(
                    Instant::now() < deadline,
                    "detached child pid was not printed"
                );
                thread::sleep(Duration::from_millis(20));
            }
        };
        assert!(
            pane_cgroup.contains("/termfleet-pane-")
                || super::process_tree(Some(pane_pid)).contains(&child_pid),
            "detached child was neither cgroup-owned nor in the pane tree: {pane_cgroup:?}"
        );

        manager.kill(&id).expect("kill detached unmarked PTY");

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if unsafe { libc::kill(child_pid, 0) == -1 } {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "detached descendant {child_pid} survived PTY close"
            );
            thread::sleep(Duration::from_millis(20));
        }
        let _ = fs::remove_file(&pid_file);
    }

    #[test]
    fn duplicate_spawn_shuts_down_the_loser_reader() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "dup-stable-test".to_string();

        let (first, reused_first) = manager
            .ensure(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("first ensure");
        assert!(!reused_first);

        // A second ensure for the same id reuses the existing PTY without starting
        // another child or leaking a reader. Manager keeps one.
        let (second, reused_second) = manager
            .ensure(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("second ensure");
        assert!(reused_second);
        assert_eq!(first, second);
        assert_eq!(manager.active_count(), 1);

        manager.kill(&id).expect("kill test PTY");
        assert_eq!(manager.active_count(), 0);
    }

    #[test]
    fn spawn_reuses_existing_stable_id() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-reuse-test".to_string();

        let first = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn first stable PTY");
        let second = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("reuse stable PTY");

        assert_eq!(first, id);
        assert_eq!(second, id);
        assert_eq!(manager.active_count(), 1);

        manager.kill(&id).expect("kill stable PTY");
    }

    #[test]
    fn snapshot_replays_backend_scrollback() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-snapshot-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn snapshot PTY");
        manager
            .write(&id, "snapshot replay\n")
            .expect("write snapshot line");

        let mut snapshot = String::new();
        for _ in 0..20 {
            snapshot = manager.snapshot(&id).expect("read snapshot");
            if snapshot.contains("snapshot replay") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        assert!(
            snapshot.contains("snapshot replay"),
            "expected backend scrollback to include PTY output, got {snapshot:?}"
        );

        manager.kill(&id).expect("kill snapshot PTY");
    }

    #[test]
    fn read_since_returns_incremental_output_cursor() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-read-since-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn read cursor PTY");
        manager
            .write(&id, "cursor one\n")
            .expect("write first line");

        let mut first = manager.read_since(&id, 0).expect("read first chunk");
        for _ in 0..20 {
            if first.data.contains("cursor one") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
            first = manager.read_since(&id, 0).expect("read first chunk");
        }

        assert!(
            first.data.contains("cursor one"),
            "expected first output chunk, got {first:?}"
        );

        let empty = manager
            .read_since(&id, first.next_offset)
            .expect("read at current cursor");
        assert_eq!(empty.data, "");
        assert_eq!(empty.next_offset, first.next_offset);

        manager
            .write(&id, "cursor two\n")
            .expect("write second line");
        let mut second = manager
            .read_since(&id, first.next_offset)
            .expect("read second chunk");
        for _ in 0..20 {
            if second.data.contains("cursor two") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
            second = manager
                .read_since(&id, first.next_offset)
                .expect("read second chunk");
        }

        assert!(
            second.data.contains("cursor two"),
            "expected incremental output chunk, got {second:?}"
        );

        manager.kill(&id).expect("kill read cursor PTY");
    }

    #[test]
    fn restored_session_replays_saved_scrollback_at_saved_cwd() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-persist-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "persist-restore-test".to_string();

        // First daemon: a session at /tmp writes content that gets checkpointed.
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    None,
                    None,
                )
                .expect("spawn persistent PTY");
            manager
                .write(&id, "persisted-content-line\n")
                .expect("write content");

            // Wait until the content reaches the on-disk scrollback checkpoint.
            let scrollback = super::scrollback_path(&dir, &id);
            let mut ok = false;
            for _ in 0..40 {
                if let Ok(raw) = std::fs::read(&scrollback) {
                    if raw.len() > 8
                        && String::from_utf8_lossy(&raw[8..]).contains("persisted-content-line")
                    {
                        ok = true;
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            assert!(
                ok,
                "scrollback was not checkpointed to disk at {scrollback:?}"
            );
            // Drop the manager WITHOUT killing the session — simulates the daemon
            // process dying while the on-disk checkpoint remains.
        }

        // Second daemon: the session is no longer live (simulates a reboot), so
        // ensure restores it FULLY — a fresh shell at the saved cwd whose grid
        // replays the prior scrollback content.
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            let (rid, reused) = manager
                .ensure_detached(Some(id.clone()), None, Some("cat".to_string()), None, None)
                .expect("restore persistent PTY");
            assert_eq!(rid, id);
            assert!(!reused, "a disk-restored session spawns a fresh shell");

            // Identity restored: the fresh shell reopens at the saved cwd.
            let cwd = manager.get_cwd(&id).expect("cwd of restored session");
            assert!(
                cwd.ends_with("tmp"),
                "restored shell did not reopen at saved cwd, got {cwd:?}"
            );

            // Fully restored: the live grid replays the prior content.
            let snapshot = manager.snapshot(&id).expect("snapshot restored session");
            assert!(
                snapshot.contains("persisted-content-line"),
                "restored session must replay saved scrollback, got {snapshot:?}"
            );

            // The replayed content is re-checkpointed so it survives another death.
            let (_, reparked) = super::load_persisted_scrollback(&dir, &id)
                .expect("restored scrollback re-checkpointed to disk");
            assert!(
                reparked.contains("persisted-content-line"),
                "replayed content must be re-persisted, got {reparked:?}"
            );

            // Explicit close removes every on-disk trace so it can't resurrect.
            manager.kill(&id).expect("kill restored session");
            assert!(
                super::load_persisted(&dir, &id).is_none(),
                "kill must drop the disk checkpoint"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restored_session_reopens_at_persisted_winsize() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-persist-size-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "persist-size-test".to_string();

        // First daemon: a session opened at a non-default 120x40 writes content
        // that gets checkpointed, then the daemon "dies" (manager dropped).
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    Some(120),
                    Some(40),
                )
                .expect("spawn persistent PTY");
            manager
                .write(&id, "sized-content\n")
                .expect("write content");

            let scrollback = super::scrollback_path(&dir, &id);
            let mut ok = false;
            for _ in 0..40 {
                if let Ok(raw) = std::fs::read(&scrollback) {
                    if raw.len() > 8 && String::from_utf8_lossy(&raw[8..]).contains("sized-content")
                    {
                        ok = true;
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            assert!(ok, "scrollback was not checkpointed at {scrollback:?}");
        }

        // Second daemon: restore WITHOUT supplying a size (the cold-restore case).
        // It must reopen at the persisted 120x40, not snap to the default 24x80.
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(Some(id.clone()), None, Some("cat".to_string()), None, None)
                .expect("restore persistent PTY");
            let size = manager.session_size(&id).expect("restored session size");
            assert_eq!(
                size,
                (120, 40),
                "restored session must reopen at the persisted winsize, got {size:?}"
            );
            manager.kill(&id).expect("kill restored session");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restored_agent_terminal_checkpoint_runs_saved_resume_command() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-restore-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let cwd = dir.join("agent-workspace");
        std::fs::create_dir_all(&cwd).expect("create agent cwd");
        let cwd_string = cwd.to_string_lossy().to_string();
        let id = "agent-terminal-restore-test".to_string();
        let resume_command =
            "printf 'AGENT_RECOVERED:%s:%s\\n' \"$PWD\" \"$TERMFLEET_PANE_ID\"; sleep 5"
                .to_string();

        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed agent scrollback checkpoint");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);

        let meta = SessionMeta {
            cwd: Some(cwd_string.clone()),
            command: Some("bash".to_string()),
            cols: Some(132),
            rows: Some(37),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            original_command: Some("codex".to_string()),
            sanitized_resume_command: Some(resume_command.clone()),
            launched_as_regular_terminal: Some(true),
            last_healthy_ms: Some(123),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes)
            .expect("seed agent metadata checkpoint");

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        let (rid, reused) = manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("restore agent terminal checkpoint");
        assert_eq!(rid, id);
        assert!(!reused, "disk-restored agent terminal spawns a fresh PTY");
        assert_eq!(manager.session_size(&id), Some((132, 37)));

        let snapshot = wait_for_snapshot_containing(&manager, &id, "AGENT_RECOVERED:");
        assert!(
            snapshot.contains("previous agent transcript"),
            "agent restore must keep prior terminal transcript, got {snapshot:?}"
        );
        assert!(
            snapshot.contains(&format!("AGENT_RECOVERED:{cwd_string}:{id}")),
            "agent restore must run the saved resume command in the saved cwd with the pane id, got {snapshot:?}"
        );

        manager
            .resize(&id, 144, 41)
            .expect("resize restored agent terminal");
        let rewritten = std::fs::read(super::meta_path(&dir, &id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read rewritten agent metadata");
        assert_eq!(
            rewritten.recovery_kind,
            Some(SessionRecoveryKind::AgentTerminal),
            "ordinary metadata rewrites must preserve the agent recovery marker"
        );
        assert_eq!(
            rewritten.sanitized_resume_command.as_deref(),
            Some(resume_command.as_str()),
            "ordinary metadata rewrites must preserve the sanitized resume command"
        );
        assert_eq!(rewritten.cols, Some(144));
        assert_eq!(rewritten.rows, Some(41));

        manager.kill(&id).expect("kill restored agent terminal");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_agent_resume_is_persisted_and_not_planned_again() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-resume-failure-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-resume-failure-test".to_string();

        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);
        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("codex".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some("019f-missing-session".to_string()),
            sanitized_resume_command: Some(
                "printf 'ERROR: No saved session found with ID 019f-missing-session.\\n'"
                    .to_string(),
            ),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("attempt saved resume");

        let updated = (0..80)
            .find_map(|_| {
                let meta = std::fs::read(super::meta_path(&dir, &id))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())?;
                if meta.restore_status == Some(AgentRestoreStatus::ResumeFailed) {
                    Some(meta)
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                    None
                }
            })
            .expect("failed resume status was not persisted");
        assert_eq!(
            updated.restore_failure_reason.as_deref(),
            Some("saved agent session no longer exists")
        );

        let persisted = super::load_persisted(&dir, &id).expect("reload failed checkpoint");
        let plan = super::plan_agent_restore(&persisted, false);
        assert_eq!(plan.status, AgentRestoreStatus::ResumeFailed);
        assert_eq!(plan.command, None, "failed resume must not be retried");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replayed_old_resume_error_does_not_poison_a_new_attempt() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-old-resume-error-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-old-resume-error-test".to_string();

        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"ERROR: No saved session found with ID old-session.\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed stale error scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);
        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("codex".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some("019f-valid-session".to_string()),
            sanitized_resume_command: Some("printf 'resume completed\\n'".to_string()),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("run clean resume attempt");
        std::thread::sleep(std::time::Duration::from_millis(150));

        let updated = std::fs::read(super::meta_path(&dir, &id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read updated metadata");
        assert_eq!(
            updated.restore_status,
            Some(AgentRestoreStatus::Resuming),
            "an error from replayed scrollback must not poison the new attempt"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn active_writer_resume_error_is_retried_after_the_owner_is_gone() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-active-writer-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-active-writer-test".to_string();
        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("codex".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some("019f-active-session".to_string()),
            sanitized_resume_command: Some(
                "printf 'thread/resume failed during TUI bootstrap: thread/resume failed: thread 019f-active already has an active writer (code -32600)\\n'".to_string(),
            ),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");
        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("attempt active-writer resume");

        let updated = (0..80)
            .find_map(|_| {
                let meta = std::fs::read(super::meta_path(&dir, &id))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())?;
                if meta.restore_status == Some(AgentRestoreStatus::ResumeFailed) {
                    Some(meta)
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                    None
                }
            })
            .expect("active-writer failure was not persisted");
        assert_eq!(
            updated.restore_failure_reason.as_deref(),
            Some("agent session is already active in another writer")
        );

        let persisted = super::load_persisted(&dir, &id).expect("reload failed checkpoint");
        let plan = super::plan_agent_restore(&persisted, false);
        assert_eq!(plan.status, AgentRestoreStatus::Resuming);
        assert_eq!(
            plan.command.as_deref(),
            Some("printf 'thread/resume failed during TUI bootstrap: thread/resume failed: thread 019f-active already has an active writer (code -32600)\\n'"),
            "a prior ownership collision must not permanently disable this pane"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_lock_blocks_a_second_process_before_it_launches_codex() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-resume-lock-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = "agent-resume-lock-test".to_string();
        let session_id = "019f-locked-session";
        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("codex".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some(session_id.to_string()),
            sanitized_resume_command: Some("printf should-not-launch\\n".to_string()),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode seeded meta");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");
        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous agent transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);
        let held_lock = super::try_acquire_resume_lock(&dir, "codex", session_id)
            .expect("acquire first writer lock")
            .expect("first writer lock must be available");

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("fallback shell after lock contention");
        assert_eq!(
            manager.write(&id, "exec codex resume 019f-locked-session\n"),
            Err("agent conversation is already owned by another live writer".to_string()),
            "the daemon write boundary must reject a duplicate resume atomically"
        );
        let updated = std::fs::read(super::meta_path(&dir, &id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read lock-contention metadata");
        assert_eq!(
            updated.restore_failure_reason.as_deref(),
            Some("agent conversation is already owned by another live writer")
        );
        assert_eq!(
            updated.restore_status,
            Some(AgentRestoreStatus::ResumeFailed)
        );
        assert_eq!(
            manager.list_sessions()[0].command,
            crate::default_shell::shell_command(None),
            "lock contention must launch only a regular shell"
        );

        drop(held_lock);
        manager.kill(&id).expect("kill fallback shell");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn orphaned_provider_writer_forces_a_shell_instead_of_duplicate_resume() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-agent-orphan-writer-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence dir");
        let id = format!("agent-orphan-writer-{}", std::process::id());
        let mut orphan = std::process::Command::new("bash")
            .args(["-c", "exec -a codex sleep 10"])
            .env("TERMFLEET_PANE_ID", &id)
            .spawn()
            .expect("spawn orphaned provider");
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(provider_writer_is_alive(&id, "codex"));

        let meta = SessionMeta {
            cwd: Some("/tmp".to_string()),
            command: Some("codex".to_string()),
            recovery_kind: Some(SessionRecoveryKind::AgentTerminal),
            provider: Some("codex".to_string()),
            provider_session_id: Some("019f-orphaned-session".to_string()),
            ..SessionMeta::default()
        };
        let meta_bytes = serde_json::to_vec(&meta).expect("encode metadata");
        super::atomic_write(&super::meta_path(&dir, &id), &meta_bytes).expect("seed metadata");
        let mut scrollback = Vec::new();
        scrollback.extend_from_slice(&0_u64.to_le_bytes());
        scrollback.extend_from_slice(b"previous transcript\n");
        super::atomic_write(&super::scrollback_path(&dir, &id), &scrollback)
            .expect("seed scrollback");
        super::write_session_disposition(&dir, &id, super::SessionLifecycle::Recoverable);

        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(Some(id.clone()), None, None, None, None)
            .expect("fall back to a shell");
        assert_eq!(
            manager.list_sessions()[0].command,
            crate::default_shell::shell_command(None),
            "an orphaned provider must never receive a duplicate resume"
        );
        let updated = std::fs::read(super::meta_path(&dir, &id))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
            .expect("read orphan metadata");
        assert!(matches!(
            updated.restore_failure_reason.as_deref(),
            Some(
                "agent conversation is already owned by an orphaned live provider process"
                    | "agent conversation is already owned by another live writer"
            )
        ));

        manager.kill(&id).expect("kill fallback shell");
        let _ = orphan.kill();
        let _ = orphan.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detached_sessions_are_owned_and_listed_without_tauri() {
        let manager = PtyManager::new();
        let id = "detached-session-test".to_string();

        let (first, reused_first) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("spawn detached PTY");
        let (second, reused_second) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("reuse detached PTY");
        let sessions = manager.list_sessions();

        assert_eq!(first, id);
        assert_eq!(second, id);
        assert!(!reused_first);
        assert!(reused_second);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, id);
        assert_eq!(sessions[0].initial_cwd.as_deref(), Some("/tmp"));

        manager.kill(&id).expect("kill detached PTY");
    }

    #[test]
    fn natural_exit_is_reaped_reported_and_disconnects_subscribers() {
        let manager = PtyManager::new();
        let id = "detached-natural-exit-test".to_string();

        manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("printf natural-exit-marker".to_string()),
                None,
                None,
            )
            .expect("spawn short-lived PTY");
        let receiver = manager
            .subscribe(&id, "natural-exit-subscriber".to_string())
            .expect("subscribe before exit");

        let mut last_exit = None;
        for _ in 0..80 {
            last_exit = manager
                .list_sessions()
                .into_iter()
                .find(|session| session.id == id)
                .and_then(|session| session.last_exit);
            if last_exit.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        let exit = last_exit.expect("natural exit should be reported");
        assert!(exit.success, "short-lived command should exit successfully");
        assert_eq!(exit.code, 0);
        while receiver.try_recv().is_ok() {}
        assert!(
            matches!(
                receiver.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Disconnected)
            ),
            "natural exit should release subscribers"
        );

        let (restarted, reused) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("restart the stable session id");
        assert_eq!(restarted, id);
        assert!(!reused, "an ended child must never be reported as reused");
        assert_eq!(manager.list_sessions()[0].last_exit, None);
        manager.kill(&id).expect("kill restarted PTY");
    }

    #[test]
    fn detached_spawn_records_requested_winsize() {
        let manager = PtyManager::new();
        let id = "detached-spawn-size-test".to_string();

        let (spawned, reused) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                Some(132),
                Some(42),
            )
            .expect("spawn detached PTY at requested size");

        assert_eq!(spawned, id);
        assert!(!reused);
        assert_eq!(manager.session_size(&id), Some((132, 42)));

        manager.kill(&id).expect("kill sized detached PTY");
    }

    #[test]
    fn spawned_sessions_clear_no_color_but_keep_color_capability() {
        let manager = PtyManager::new();
        let id = "detached-color-env-test".to_string();
        let previous_no_color = std::env::var_os("NO_COLOR");

        std::env::set_var("NO_COLOR", "1");
        let result = manager.ensure_detached(
            Some(id.clone()),
            Some("/tmp".to_string()),
            Some("sh".to_string()),
            Some(96),
            Some(24),
        );
        match previous_no_color {
            Some(value) => std::env::set_var("NO_COLOR", value),
            None => std::env::remove_var("NO_COLOR"),
        }
        result.expect("spawn detached PTY with parent NO_COLOR set");

        manager
            .write(
                &id,
                "printf 'NO_COLOR=%s TERM=%s COLORTERM=%s\\n' \"${NO_COLOR-unset}\" \"$TERM\" \"$COLORTERM\"\n",
            )
            .expect("write color env probe");
        let snapshot = wait_for_snapshot_containing(&manager, &id, "NO_COLOR=unset");

        assert!(
            snapshot.contains("NO_COLOR=unset"),
            "spawned shell should not inherit NO_COLOR, got {snapshot:?}"
        );
        assert!(
            snapshot.contains("TERM=xterm-256color"),
            "spawned shell should advertise 256-color TERM, got {snapshot:?}"
        );
        assert!(
            snapshot.contains("COLORTERM=truecolor"),
            "spawned shell should advertise truecolor, got {snapshot:?}"
        );

        manager.kill(&id).expect("kill color env PTY");
    }

    #[test]
    fn resize_storm_tracks_final_winsize_and_reuse_does_not_shrink() {
        let manager = PtyManager::new();
        let id = "detached-resize-storm-size-test".to_string();

        let (spawned, reused) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                Some(96),
                Some(28),
            )
            .expect("spawn detached PTY before resize storm");
        assert_eq!(spawned, id);
        assert!(!reused);

        for (cols, rows) in [(118, 34), (64, 18), (150, 45), (82, 22), (157, 52)] {
            manager
                .resize(&id, cols, rows)
                .expect("resize detached PTY during storm");
            assert_eq!(
                manager.session_size(&id),
                Some((cols, rows)),
                "stored winsize must track each successful PTY resize"
            );
        }

        let (reattached, reattached_reused) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                Some(80),
                Some(24),
            )
            .expect("reattach detached PTY after resize storm");

        assert_eq!(reattached, id);
        assert!(reattached_reused);
        assert_eq!(
            manager.session_size(&id),
            Some((157, 52)),
            "reattach must report the live PTY size instead of shrinking a reused session"
        );

        manager.kill(&id).expect("kill resized detached PTY");
    }

    #[test]
    fn intentional_kill_is_a_backup_and_not_an_automatic_restore_candidate() {
        let dir = std::env::temp_dir().join(format!(
            "tw-lifecycle-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "intentional-kill-lifecycle-test".to_string();

        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    None,
                    None,
                )
                .expect("spawn persistent PTY");
            manager
                .write(&id, "intentional-kill-marker\n")
                .expect("write marker");
            let snapshot = wait_for_snapshot_containing(&manager, &id, "intentional-kill-marker");
            assert!(snapshot.contains("intentional-kill-marker"));
            manager.kill(&id).expect("record intentional kill");
        }

        let summary = std::fs::read(super::lifecycle_path(&dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<super::SessionLifecycle>(&raw).ok())
            .expect("read lifecycle disposition");
        assert_eq!(summary, super::SessionLifecycle::IntentionalKill);

        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            let (_, reused) = manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    None,
                    None,
                )
                .expect("start a replacement shell");
            assert!(
                !reused,
                "an intentional kill must not cold-restore automatically"
            );
            manager.kill(&id).expect("kill replacement shell");
        }

        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            let error = manager
                .restore_persisted_session(&id)
                .expect_err("operator-closed backups must never be restorable");
            assert!(error.contains("closed by the operator"));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn intentional_kill_blocks_stale_sidecar_agent_recovery_after_restart() {
        assert!(!super::is_sidecar_recovery_allowed(
            super::SessionLifecycle::Unknown
        ));
        assert!(!super::is_sidecar_recovery_allowed(
            super::SessionLifecycle::IntentionalKill
        ));
        assert!(!super::is_sidecar_recovery_allowed(
            super::SessionLifecycle::BackupOnly
        ));
        assert!(super::is_sidecar_recovery_allowed(
            super::SessionLifecycle::Recoverable
        ));
    }

    #[test]
    fn oversized_lifecycle_log_rotates_and_reads_only_its_tail() {
        let dir = std::env::temp_dir().join(format!(
            "tw-lifecycle-bound-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test dir");
        let path = super::lifecycle_log_path(&dir);

        // A log past the cap must roll over on the next append instead of growing
        // forever, and the newest record must still be readable afterwards.
        let filler = "x".repeat(1024);
        let mut oversized = String::new();
        while oversized.len() as u64 <= super::MAX_LIFECYCLE_LOG_BYTES {
            oversized.push_str(&filler);
            oversized.push('\n');
        }
        std::fs::write(&path, &oversized).expect("seed oversized log");

        let event = super::PtySessionEvent::new("lifecycle-bound-test", "eof");
        super::append_lifecycle_event(&dir, &event);

        let rotated = path.with_extension("jsonl.1");
        assert!(rotated.exists(), "the oversized log must be rotated aside");
        let live_len = std::fs::metadata(&path).expect("live log").len();
        assert!(
            live_len < super::MAX_LIFECYCLE_LOG_BYTES,
            "the live log must restart below the cap, was {live_len}"
        );

        let events = super::read_lifecycle_events(&dir).expect("read events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "lifecycle-bound-test");

        // A log larger than the read window is parsed from its tail only: the
        // oldest record falls outside the window, the newest is always kept.
        let mut wide = String::new();
        let stale = serde_json::to_string(&super::PtySessionEvent::new("stale-record", "eof"))
            .expect("serialize stale");
        wide.push_str(&stale);
        wide.push('\n');
        while (wide.len() as u64) < super::LIFECYCLE_READ_WINDOW_BYTES + 4096 {
            wide.push_str(&filler);
            wide.push('\n');
        }
        wide.push_str(
            &serde_json::to_string(&super::PtySessionEvent::new("fresh-record", "eof"))
                .expect("serialize fresh"),
        );
        wide.push('\n');
        std::fs::write(&path, &wide).expect("seed wide log");

        let tail = super::read_lifecycle_events(&dir).expect("read tail events");
        assert!(
            tail.iter().any(|event| event.id == "fresh-record"),
            "the newest record must always be inside the read window"
        );
        assert!(
            !tail.iter().any(|event| event.id == "stale-record"),
            "records older than the window must not be parsed"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_pass_drops_only_stale_session_files() {
        let dir = std::env::temp_dir().join(format!(
            "tw-retention-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test dir");

        let fresh = dir.join("fresh.meta.json");
        let stale = dir.join("stale.meta.json");
        let stale_scrollback = dir.join("stale.scrollback");
        let matrix = super::lifecycle_matrix_path(&dir);
        let log = super::lifecycle_log_path(&dir);
        for path in [&fresh, &stale, &stale_scrollback, &matrix, &log] {
            std::fs::write(path, b"{}").expect("seed file");
        }

        let old = std::time::SystemTime::now()
            - std::time::Duration::from_secs(
                (super::PERSISTED_SESSION_RETENTION_DAYS + 1) * 86_400,
            );
        for path in [&stale, &stale_scrollback] {
            let handle = std::fs::File::open(path).expect("open stale file");
            handle
                .set_modified(old)
                .expect("age the file past the retention window");
        }

        let removed = super::prune_persisted_state(&dir);
        assert_eq!(removed, 2, "both stale session files must be removed");
        assert!(fresh.exists(), "a recently written session must survive");
        assert!(!stale.exists());
        assert!(!stale_scrollback.exists());
        assert!(
            matrix.exists() && log.exists(),
            "directory-level state is never a prune candidate"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn system_cleanup_keeps_a_session_recoverable() {
        let dir = std::env::temp_dir().join(format!(
            "tw-system-cleanup-lifecycle-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "system-cleanup-lifecycle-test".to_string();
        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("spawn persistent PTY");
        manager
            .kill_with_disposition(&id, false)
            .expect("system cleanup must stop the PTY");

        let lifecycle = std::fs::read(super::lifecycle_path(&dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<super::SessionLifecycle>(&raw).ok())
            .expect("read lifecycle disposition");
        assert_eq!(lifecycle, super::SessionLifecycle::Recoverable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lifecycle_ledger_survives_manager_restart() {
        let dir = std::env::temp_dir().join(format!(
            "tw-lifecycle-ledger-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "lifecycle-ledger-test".to_string();
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    None,
                    None,
                )
                .expect("spawn persistent PTY");
            manager
                .kill_with_disposition(&id, false)
                .expect("stop session through system cleanup");
        }
        let restarted = super::PtyManager::with_persistence_dir(dir.clone());
        let events = restarted.session_events();
        assert!(events
            .iter()
            .any(|event| event.id == id && event.kind == "spawned"));
        assert!(events.iter().any(|event| {
            event.id == id
                && event.kind == "lifecycle-disposition"
                && event.reason.as_deref() == Some("recoverable")
        }));
        assert!(events
            .iter()
            .any(|event| event.id == id && event.kind == "killed"));
        let matrix = std::fs::read(super::lifecycle_matrix_path(&dir))
            .ok()
            .and_then(|raw| serde_json::from_slice::<Vec<super::TerminalMatrixRecord>>(&raw).ok())
            .expect("read current terminal matrix");
        let record = matrix
            .iter()
            .find(|record| record.id == id)
            .expect("matrix record");
        assert_eq!(record.last_event, "killed");
        assert!(record.event_count >= 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fresh_persistent_terminal_records_recoverable_lifecycle() {
        let dir = std::env::temp_dir().join(format!(
            "tw-fresh-lifecycle-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "fresh-lifecycle-test".to_string();
        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("spawn persistent terminal");
        let lifecycle = super::read_session_disposition(&dir, &id);
        assert_eq!(lifecycle, super::SessionLifecycle::Recoverable);
        manager.kill(&id).expect("close persistent terminal");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unexpected_child_exit_becomes_recoverable_for_cold_restore() {
        let dir = std::env::temp_dir().join(format!(
            "tw-unexpected-exit-lifecycle-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "unexpected-exit-lifecycle-test".to_string();
        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("printf unexpected-exit-marker; exit 0".to_string()),
                    None,
                    None,
                )
                .expect("spawn naturally exiting terminal");
            let snapshot = wait_for_snapshot_containing(&manager, &id, "unexpected-exit-marker");
            assert!(snapshot.contains("unexpected-exit-marker"));
            for _ in 0..50 {
                if manager
                    .list_sessions()
                    .iter()
                    .all(|session| session.id != id)
                {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }

        assert_eq!(
            super::read_session_disposition(&dir, &id),
            super::SessionLifecycle::Recoverable
        );
        let manager = super::PtyManager::with_persistence_dir(dir.clone());
        let (_, reused) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
                None,
                None,
            )
            .expect("cold restore naturally exited terminal");
        assert!(
            !reused,
            "cold recovery creates a replacement PTY, not a live reattach"
        );
        assert!(
            manager
                .snapshot(&id)
                .expect("read cold-restored snapshot")
                .contains("unexpected-exit-marker"),
            "cold recovery must replay the unexpected-death checkpoint"
        );
        manager.kill(&id).expect("clean up restored terminal");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_forces_dirty_persist_flush_before_daemon_death() {
        use std::path::PathBuf;

        let dir: PathBuf = std::env::temp_dir().join(format!(
            "tw-persist-flush-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let id = "persist-flush-test".to_string();

        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            manager
                .ensure_detached(
                    Some(id.clone()),
                    Some("/tmp".to_string()),
                    Some("cat".to_string()),
                    None,
                    None,
                )
                .expect("spawn persistent PTY");
            manager
                .write(&id, "first-line\n")
                .expect("write first line");

            let scrollback = super::scrollback_path(&dir, &id);
            let mut first_persisted = false;
            for _ in 0..40 {
                if let Ok(raw) = std::fs::read(&scrollback) {
                    if raw.len() > 8 && String::from_utf8_lossy(&raw[8..]).contains("first-line") {
                        first_persisted = true;
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            assert!(first_persisted, "first write did not checkpoint to disk");

            // This write lands inside the throttle window. Without a forced flush
            // on snapshot/read, a daemon death here leaves the latest scrollback in
            // RAM only, so cold restore replays a partial command.
            manager
                .write(&id, "second-line-before-death\n")
                .expect("write second line");
            let mut snapshot = String::new();
            for _ in 0..40 {
                snapshot = manager.snapshot(&id).expect("snapshot forces flush");
                if snapshot.contains("second-line-before-death") {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            assert!(
                snapshot.contains("second-line-before-death"),
                "snapshot must include second write, got {snapshot:?}"
            );

            let (_, persisted) = super::load_persisted_scrollback(&dir, &id)
                .expect("scrollback must exist after snapshot");
            assert!(
                persisted.contains("second-line-before-death"),
                "snapshot must force dirty checkpoint before daemon death, got {persisted:?}"
            );
        }

        {
            let manager = super::PtyManager::with_persistence_dir(dir.clone());
            let (_, reused) = manager
                .ensure_detached(Some(id.clone()), None, Some("cat".to_string()), None, None)
                .expect("restore persistent PTY");
            assert!(!reused, "disk restore spawns a fresh PTY");
            let snapshot = manager.snapshot(&id).expect("snapshot restored session");
            assert!(
                snapshot.contains("second-line-before-death"),
                "cold restore must replay latest flushed content, got {snapshot:?}"
            );
            manager.kill(&id).expect("kill restored session");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn full_scrollback_checkpoint_appends_the_new_tail_instead_of_rewriting_everything() {
        let dir = std::env::temp_dir().join(format!(
            "tw-persist-append-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create persistence test dir");
        let id = "persist-append-test";
        let path = super::scrollback_path(&dir, id);
        let line = "123456789\n";
        let initial = line.repeat(super::MAX_SCROLLBACK_BYTES / line.len());

        let mut persist = super::PersistHandle::new(path.clone());
        persist.dirty = true;
        persist.flush_now(0, &initial);

        // Once the in-memory buffer is full, appending one line advances the
        // replay boundary by two lines. Persisting that tiny tail must not
        // replace the entire 4 MB checkpoint on every flush.
        let advanced = (line.len() * 2) as u64;
        let mut current = initial[advanced as usize..].to_string();
        current.push_str("abcdefghi\n");
        persist.dirty = true;
        persist.flush_now(advanced, &current);

        let raw_len = std::fs::metadata(&path).expect("checkpoint metadata").len() as usize;
        assert_eq!(
            raw_len,
            8 + initial.len() + line.len(),
            "a small tail should append to the checkpoint instead of rewriting the 4 MB window"
        );

        let (loaded_base, loaded) = super::load_persisted_scrollback(&dir, id)
            .expect("load incrementally persisted scrollback");
        assert_eq!(loaded_base, advanced);
        assert_eq!(loaded, current);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // Password prompts and SSH password entry rely on the TTY disabling echo:
    // typed bytes must reach the program without being painted back. This
    // characterizes the daemon-owned real PTY behavior without needing an sshd
    // fixture.
    #[test]
    fn password_prompt_does_not_echo_typed_input() {
        let manager = PtyManager::new();
        let id = "no-echo-password-test".to_string();
        manager
            .ensure_detached(
                Some(id.clone()),
                None,
                Some(
                    "stty -echo; printf READY; read secret; stty echo; printf 'GOT[%s]' \"$secret\""
                        .to_string(),
                ),
                None,
                None,
            )
            .expect("spawn no-echo PTY");

        let mut snapshot = String::new();
        for _ in 0..40 {
            snapshot = manager.snapshot(&id).expect("snapshot");
            if snapshot.contains("READY") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(
            snapshot.contains("READY"),
            "program never reached the no-echo read prompt, got {snapshot:?}"
        );

        manager.write(&id, "swordfish42\n").expect("write secret");

        let mut out = String::new();
        for _ in 0..40 {
            out = manager.snapshot(&id).expect("snapshot");
            if out.contains("GOT[swordfish42]") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(
            out.contains("GOT[swordfish42]"),
            "program did not receive the typed secret through the PTY, got {out:?}"
        );
        assert_eq!(
            out.matches("swordfish42").count(),
            1,
            "typed password was echoed to the terminal, got {out:?}"
        );

        manager.kill(&id).expect("kill no-echo session");
    }
}
