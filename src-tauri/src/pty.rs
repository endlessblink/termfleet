use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime};

const MAX_SCROLLBACK_BYTES: usize = 200_000;

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


struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
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
}

impl PtyEntry {
    /// Stop the reader thread and reap the child. Idempotent.
    fn shutdown(&mut self) {
        self.reader_stop.store(true, Ordering::Relaxed);
        let _ = self.child.kill();
        // Dropping all writers/clones of the master closes the PTY master fd, so
        // the reader's blocking read() returns EOF and the loop exits.
        if let Some(handle) = self.reader.take() {
            let _ = handle.join();
        }
    }
}

pub struct PtyManager {
    ptys: Mutex<HashMap<String, PtyEntry>>,
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
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputChunk {
    pub data: String,
    pub base_offset: u64,
    pub next_offset: u64,
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
}

impl PersistHandle {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_flush: None,
            dirty: false,
        }
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
        let mut bytes = Vec::with_capacity(8 + data.len());
        bytes.extend_from_slice(&base_offset.to_le_bytes());
        bytes.extend_from_slice(data.as_bytes());
        if atomic_write(&self.path, &bytes).is_ok() {
            self.last_flush = Some(Instant::now());
            self.dirty = false;
        }
    }

    fn flush_now(&mut self, base_offset: u64, data: &str) {
        if !self.dirty {
            return;
        }
        let mut bytes = Vec::with_capacity(8 + data.len());
        bytes.extend_from_slice(&base_offset.to_le_bytes());
        bytes.extend_from_slice(data.as_bytes());
        if atomic_write(&self.path, &bytes).is_ok() {
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
            let boundary = boundary_at_or_after(&self.data, trim_to);
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
            persist_dir: None,
        }
    }

    /// A manager that checkpoints sessions to the default per-user data dir so
    /// they survive a daemon restart. Used by the daemon (the persistent PTY
    /// owner). Falls back to no persistence if the data dir can't be created.
    pub fn persistent() -> Self {
        let persist_dir = default_persist_dir().and_then(|dir| {
            fs::create_dir_all(&dir).ok().map(|_| dir)
        });
        Self {
            ptys: Mutex::new(HashMap::new()),
            persist_dir,
        }
    }

    #[cfg(test)]
    fn with_persistence_dir(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        Self {
            ptys: Mutex::new(HashMap::new()),
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
        self.ensure_with_sink(TauriPtyEventSink { app: app.clone() }, id, cwd, command, None, None)
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
        if self.ptys.lock().unwrap().contains_key(&id) {
            return Ok((id, true));
        }

        // A persisted checkpoint for this id means the original shell died with a
        // previous daemon (dev relaunch, OOM) or the machine rebooted. Restore the
        // session so it comes back *fully*: the saved scrollback is replayed into
        // the grid (see the buffer build below) and the fresh shell reopens at the
        // saved working directory. The replay is made safe for dead full-screen
        // apps by appending RESTORE_NORMALIZE_SEQUENCE.
        let persisted = self
            .persist_dir
            .as_ref()
            .and_then(|dir| load_persisted(dir, &id));
        let cwd = cwd.or_else(|| persisted.as_ref().and_then(|entry| entry.cwd.clone()));

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
        let open_rows = rows.filter(|value| *value > 0).unwrap_or(24);
        let open_cols = cols.filter(|value| *value > 0).unwrap_or(80);
        let pair = pty_system
            .openpty(PtySize {
                rows: open_rows,
                cols: open_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let initial_cwd = cwd.clone();
        let shell =
            command.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "bash".into()));
        let command_label = shell.clone();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "C.UTF-8".into()),
        );
        cmd.env(
            "LC_CTYPE",
            std::env::var("LC_CTYPE").unwrap_or_else(|_| "C.UTF-8".into()),
        );

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
        // Drop the slave - the child process has it now
        drop(pair.slave);

        // Get reader and writer from master
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

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
                if let Some((base_offset, mut data)) = load_persisted_scrollback(dir, &id) {
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
            write_session_meta(dir, &id, cwd.as_deref(), &command_label);
        }
        let output = Arc::new(Mutex::new(initial_buffer));
        let output_reader = output.clone();
        let subscribers: Arc<Mutex<Vec<PtySubscriber>>> = Arc::new(Mutex::new(Vec::new()));
        let subscribers_reader = subscribers.clone();
        let reader_stop = Arc::new(AtomicBool::new(false));
        let reader_stop_thread = reader_stop.clone();

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if reader_stop_thread.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        // A stop requested mid-read: discard the bytes and exit so a
                        // killed/duplicate shell can never broadcast after shutdown.
                        if reader_stop_thread.load(Ordering::Relaxed) {
                            break;
                        }
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        append_pty_output(&output_reader, &data);
                        broadcast_pty_output(&subscribers_reader, &data);
                        if event_sink.emit_pty_data(&event_id, &data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

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
            };
            loser.shutdown();
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
        let mut ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get_mut(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        entry.writer.flush().map_err(|e| e.to_string())?;
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
        let mut entry = {
            let mut ptys = self.ptys.lock().unwrap();
            ptys.remove(id)
                .ok_or_else(|| format!("PTY {} not found", id))?
        };
        // Stop + join the reader thread (and kill the child) outside the manager
        // lock, so a reader blocked in read() can't deadlock other PTY operations
        // while we wait for it to drain to EOF.
        entry.shutdown();
        // An explicit close destroys the session, so drop its disk checkpoint —
        // otherwise a killed terminal would resurrect on the next daemon start.
        if let Some(dir) = &self.persist_dir {
            remove_persisted(dir, id);
        }
        Ok(())
    }

    pub fn get_cwd(&self, id: &str) -> Result<String, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let pid = entry
            .child
            .process_id()
            .ok_or_else(|| "Cannot get process ID".to_string())?;
        let link = format!("/proc/{}/cwd", pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    }

    pub fn snapshot(&self, id: &str) -> Result<String, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let mut output = entry.output.lock().unwrap();
        let snapshot = output.snapshot();
        Ok(snapshot)
    }

    pub fn read_since(&self, id: &str, offset: u64) -> Result<PtyOutputChunk, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let mut output = entry.output.lock().unwrap();
        let chunk = output.read_since(offset);
        Ok(chunk)
    }

    pub fn subscribe(&self, id: &str, subscriber_id: String) -> Result<Receiver<String>, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let (sender, receiver) = mpsc::channel();
        let mut subscribers = entry.subscribers.lock().unwrap();
        subscribers.retain(|subscriber| subscriber.id != subscriber_id);
        subscribers.push(PtySubscriber {
            id: subscriber_id,
            sender,
        });
        Ok(receiver)
    }

    pub fn unsubscribe(&self, id: &str, subscriber_id: &str) -> Result<(), String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .subscribers
            .lock()
            .unwrap()
            .retain(|subscriber| subscriber.id != subscriber_id);
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<PtySessionSummary> {
        let ptys = self.ptys.lock().unwrap();
        ptys.iter()
            .map(|(id, entry)| PtySessionSummary {
                id: id.clone(),
                pid: entry.child.process_id(),
                initial_cwd: entry.initial_cwd.clone(),
                command: entry.command.clone(),
                scrollback_bytes: entry.output.lock().unwrap().data.len(),
                subscriber_count: entry.subscribers.lock().unwrap().len(),
            })
            .collect()
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
    let trace_path = std::env::var_os("TERMINAL_WORKSPACE_TRACE_PTY_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/terminal-workspace-pty-trace.log"));
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(trace_path)
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
struct PersistedSession {
    cwd: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    command: Option<String>,
}

/// Root of termfleet's per-user durable state (`~/.local/share/terminal-workspace`).
/// Holds the per-session scrollback (`sessions/`) and the workspace layout
/// (`workspace.json`) so the tab→session mapping survives a localStorage wipe.
pub fn data_root_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("terminal-workspace"))
}

fn default_persist_dir() -> Option<PathBuf> {
    data_root_dir().map(|dir| dir.join("sessions"))
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
        let cwd = fs::read(meta_path(&dir, &id))
            .ok()
            .and_then(|raw| serde_json::from_slice::<SessionMeta>(&raw).ok())
            .and_then(|meta| meta.cwd);
        sessions.push(PersistedSessionSummary {
            id,
            cwd,
            scrollback_bytes: bytes,
        });
    }
    sessions
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

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        let _ = file.sync_all();
    }
    fs::rename(&tmp, path)
}

fn write_session_meta(dir: &Path, id: &str, cwd: Option<&str>, command: &str) {
    let meta = SessionMeta {
        cwd: cwd.map(|value| value.to_string()),
        command: Some(command.to_string()),
    };
    if let Ok(json) = serde_json::to_vec(&meta) {
        let _ = atomic_write(&meta_path(dir, id), &json);
    }
}

/// Detect a session checkpoint for this id. Returns `None` for a fresh session
/// (no saved scrollback). Reads the cwd metadata used to reopen the shell; the
/// scrollback *content* is loaded separately by `load_persisted_scrollback`.
fn load_persisted(dir: &Path, id: &str) -> Option<PersistedSession> {
    if !scrollback_path(dir, id).exists() {
        return None;
    }
    let cwd = fs::read(meta_path(dir, id))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).ok())
        .and_then(|meta| meta.cwd);
    Some(PersistedSession { cwd })
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
    let base_offset = u64::from_le_bytes(header);
    let data = String::from_utf8_lossy(&raw[8..]).into_owned();
    Some((base_offset, data))
}

fn remove_persisted(dir: &Path, id: &str) {
    let _ = fs::remove_file(scrollback_path(dir, id));
    let _ = fs::remove_file(meta_path(dir, id));
    let _ = fs::remove_file(history_path(dir, id));
}

fn boundary_at_or_after(data: &str, index: usize) -> usize {
    if index >= data.len() {
        return data.len();
    }

    data.char_indices()
        .find_map(|(boundary, _)| (boundary >= index).then_some(boundary))
        .unwrap_or(data.len())
}

#[cfg(test)]
mod tests {
    use super::PtyManager;

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

    #[test]
    fn duplicate_spawn_shuts_down_the_loser_reader() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "dup-stable-test".to_string();

        let (first, reused_first) = manager
            .ensure(app.handle(), Some(id.clone()), None, Some("cat".to_string()))
            .expect("first ensure");
        assert!(!reused_first);

        // Second ensure for the same id spawns a shell, loses the insert race, and
        // must fully shut down its loser reader (not leak it). Manager keeps one.
        let (second, reused_second) = manager
            .ensure(app.handle(), Some(id.clone()), None, Some("cat".to_string()))
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
            assert!(ok, "scrollback was not checkpointed to disk at {scrollback:?}");
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
            manager.write(&id, "first-line\n").expect("write first line");

            let scrollback = super::scrollback_path(&dir, &id);
            let mut first_persisted = false;
            for _ in 0..40 {
                if let Ok(raw) = std::fs::read(&scrollback) {
                    if raw.len() > 8 && String::from_utf8_lossy(&raw[8..]).contains("first-line")
                    {
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
}
