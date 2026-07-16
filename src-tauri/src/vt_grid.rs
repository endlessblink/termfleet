//! TC-017a (Stage 1) — headless terminal grid.
//!
//! Owns a headless `alacritty_terminal::Term` per session. The PTY daemon stays
//! the PTY authority; this module is a *read model*: it opens its own subscriber
//! stream to the daemon, feeds the raw PTY bytes into the VT state machine on a
//! dedicated blocking thread (state behind an `RwLock`), and serializes the
//! visible grid (chars + color/style) to JSON on demand.
//!
//! Later stages replace the JSON snapshot with a binary dirty-diff pushed to the
//! canvas renderer; the grid ownership established here is the foundation.

use crate::daemon::{daemon_ensure_running, daemon_socket_path, DaemonRequest, DaemonResponse};
use crate::daemon_ipc;
use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor, Rgb};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::Shutdown;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

pub const DEFAULT_COLS: usize = 80;
pub const DEFAULT_ROWS: usize = 24;

/// Diff emit cadence: at most ~60Hz (16ms) so a fast PTY dump coalesces into one
/// frame per tick instead of flooding the IPC channel.
const EMIT_INTERVAL: Duration = Duration::from_millis(16);
const GRID_FEED_THREAD_STACK_BYTES: usize = 256 * 1024;
// Reconnect tuning for the grid feed. The daemon owns the PTY and survives socket
// drops / its own restarts (build-id replace, crash+respawn), so the grid feed
// retries with exponential backoff instead of dying on the first read error.
const GRID_FEED_RECONNECT_BASE: Duration = Duration::from_millis(150);
const GRID_FEED_RECONNECT_MAX: Duration = Duration::from_millis(2000);
// Stop after this many *consecutive* failed reconnects (a feed that streamed for
// a while resets the counter), so a permanently dead daemon can't spin forever.
const GRID_FEED_MAX_RECONNECTS: u32 = 40;
// A feed that ran at least this long counts as a healthy session and resets the
// consecutive-failure counter on the next loop.
const GRID_FEED_HEALTHY_MIN: Duration = Duration::from_secs(2);
const GRID_FEED_READ_TIMEOUT: Duration = Duration::from_millis(100);

/// Minimal `Dimensions` implementation so we can build/resize the grid without
/// pulling in the crate's test-only `TermSize` helper.
#[derive(Clone, Copy)]
struct GridDims {
    cols: usize,
    rows: usize,
}

impl Dimensions for GridDims {
    fn total_lines(&self) -> usize {
        self.rows
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.cols
    }
}

/// Per-session VT state: the headless terminal plus its ANSI parser.
struct TermState {
    term: Term<VoidListener>,
    parser: Processor,
    alternate_scroll_touched: bool,
    mode_scan_tail: Vec<u8>,
    unsupported_control_tail: Vec<u8>,
    /// Set by any method that can change the visible grid (feed/scroll/resize/
    /// reset); cleared by the emitter after it captures a frame. Lets the 60Hz
    /// emitter skip the O(rows*cols) capture+diff for panes that haven't changed
    /// — the dominant always-on cost when many panes sit idle.
    dirty: bool,
}

impl TermState {
    fn new(cols: usize, rows: usize) -> Self {
        let dims = GridDims { cols, rows };
        let term = Term::new(Config::default(), &dims, VoidListener);
        Self {
            term,
            parser: Processor::new(),
            alternate_scroll_touched: false,
            mode_scan_tail: Vec::new(),
            unsupported_control_tail: Vec::new(),
            dirty: true,
        }
    }

    fn feed(&mut self, bytes: &[u8]) {
        self.scan_mode_sequences(bytes);
        let filtered = self.strip_unsupported_control_sequences(bytes);
        self.parser.advance(&mut self.term, &filtered);
        self.dirty = true;
    }

    fn scan_mode_sequences(&mut self, bytes: &[u8]) {
        let mut scan = self.mode_scan_tail.clone();
        scan.extend_from_slice(bytes);
        if scan
            .windows(b"\x1b[?1007h".len())
            .any(|window| window == b"\x1b[?1007h")
            || scan
                .windows(b"\x1b[?1007l".len())
                .any(|window| window == b"\x1b[?1007l")
        {
            self.alternate_scroll_touched = true;
        }
        let keep = scan.len().min(16);
        self.mode_scan_tail = scan[scan.len() - keep..].to_vec();
    }

    fn strip_unsupported_control_sequences(&mut self, bytes: &[u8]) -> Vec<u8> {
        const SYNC_OUTPUT_ON: &[u8] = b"\x1b[?2026h";
        const SYNC_OUTPUT_OFF: &[u8] = b"\x1b[?2026l";
        const TARGETS: [&[u8]; 2] = [SYNC_OUTPUT_ON, SYNC_OUTPUT_OFF];

        let mut scan = Vec::with_capacity(self.unsupported_control_tail.len() + bytes.len());
        scan.extend_from_slice(&self.unsupported_control_tail);
        scan.extend_from_slice(bytes);
        self.unsupported_control_tail.clear();

        let mut out = Vec::with_capacity(scan.len());
        let mut index = 0;
        while index < scan.len() {
            if scan[index] == 0x1b {
                if let Some(target) = TARGETS
                    .iter()
                    .find(|target| scan[index..].starts_with(target))
                {
                    index += target.len();
                    continue;
                }
                if TARGETS
                    .iter()
                    .any(|target| target.starts_with(&scan[index..]))
                {
                    self.unsupported_control_tail = scan[index..].to_vec();
                    break;
                }
            }

            out.push(scan[index]);
            index += 1;
        }

        out
    }

    fn resize(&mut self, cols: usize, rows: usize) {
        if self.term.columns() == cols && self.term.screen_lines() == rows {
            return;
        }
        self.term.resize(GridDims { cols, rows });
        self.dirty = true;
    }

    /// Drop all grid content and reset the parser, preserving the current
    /// dimensions. Used before applying a fresh daemon snapshot on (re)subscribe:
    /// the daemon replays the full scrollback as escape sequences, so feeding it
    /// into a Term that already holds that content would stack a duplicate.
    fn reset(&mut self) {
        let dims = GridDims {
            cols: self.term.columns(),
            rows: self.term.screen_lines(),
        };
        self.term = Term::new(Config::default(), &dims, VoidListener);
        self.parser = Processor::new();
        self.mode_scan_tail.clear();
        self.unsupported_control_tail.clear();
        self.alternate_scroll_touched = false;
        self.dirty = true;
    }

    fn scroll(&mut self, delta: i32) {
        self.term.scroll_display(Scroll::Delta(delta));
        self.dirty = true;
    }

    fn scroll_to_bottom(&mut self) {
        if self.term.grid().display_offset() == 0 {
            return;
        }
        self.term.scroll_display(Scroll::Bottom);
        self.dirty = true;
    }
}

/// Subscribers and last-emitted frame for a session's binary diff stream.
#[derive(Default)]
struct EmitState {
    prev: Option<WireFrame>,
    channels: Vec<Channel<InvokeResponseBody>>,
}

/// All per-session state: the headless grid, the diff emit state, and a stop
/// flag for the background threads.
struct Session {
    state: Arc<RwLock<TermState>>,
    emit: Arc<Mutex<EmitState>>,
    stop: Arc<AtomicBool>,
    attach_token: Mutex<Option<String>>,
}

/// Owns one headless grid per terminal session id.
pub struct GridManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}

impl GridManager {
    pub fn new() -> Self {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        spawn_shared_emitter(Arc::clone(&sessions));
        Self { sessions }
    }

    fn get(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.get(id).cloned()
    }

    /// Ensure a grid session exists for `id` at exactly `cols`x`rows`, without
    /// spawning any threads. Returns the session and whether it was freshly
    /// created (`true`) or already existed (`false`).
    ///
    /// A RE-ATTACH to an existing session MUST resize its Term to the caller's
    /// size — it must never keep the old width. Re-attach happens whenever the
    /// frontend effect re-subscribes (map zoom toggling `mapProjection`, a
    /// `cols`/`rows`/`dprTick` change) while a grid session lingers from a prior
    /// mount whose fire-and-forget `grid_detach` hasn't landed yet. If we kept
    /// the stale width here, the grid Term would drift from the PTY winsize
    /// (which `daemon_resize_session` moves to the new size): the agent then
    /// composes lines at the PTY width while the grid parses them at its old
    /// width, so every full line overflows and the surplus character spills onto
    /// the next row (the mid-word wrap-spill regression). Resizing on re-attach
    /// keeps grid width == PTY winsize regardless of detach/attach ordering.
    fn upsert_session(
        &self,
        id: &str,
        cols: usize,
        rows: usize,
        attach_token: Option<String>,
    ) -> Result<(Arc<Session>, bool), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "grid lock poisoned")?;
        if let Some(existing) = sessions.get(id) {
            existing
                .state
                .write()
                .map_err(|_| "grid state poisoned")?
                .resize(cols, rows);
            *existing
                .attach_token
                .lock()
                .map_err(|_| "grid attach token poisoned")? = attach_token;
            return Ok((Arc::clone(existing), false));
        }
        let session = Arc::new(Session {
            state: Arc::new(RwLock::new(TermState::new(cols, rows))),
            emit: Arc::new(Mutex::new(EmitState::default())),
            stop: Arc::new(AtomicBool::new(false)),
            attach_token: Mutex::new(attach_token),
        });
        sessions.insert(id.to_string(), Arc::clone(&session));
        Ok((session, true))
    }

    /// Idempotently stand up a grid for `id`: start feeding it daemon bytes and
    /// run the 60Hz diff emitter. Returns immediately. On a re-attach to an
    /// existing session this resizes the live Term to `cols`x`rows` (see
    /// `upsert_session`) and does not re-spawn its threads.
    pub fn attach(
        &self,
        id: &str,
        cols: usize,
        rows: usize,
        attach_token: Option<String>,
    ) -> Result<(), String> {
        {
            let (session, is_new) = self.upsert_session(id, cols, rows, attach_token)?;
            if !is_new {
                return Ok(());
            }
            spawn_session_threads(id, &session)?;
        }
        Ok(())
    }

    /// Serialize the current visible grid for `id` to JSON.
    pub fn snapshot(&self, id: &str) -> Result<String, String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;
        let state = session.state.read().map_err(|_| "grid state poisoned")?;
        let snapshot = GridSnapshot::capture(&state.term);
        serde_json::to_string(&snapshot).map_err(|error| error.to_string())
    }

    pub fn selection_text(
        &self,
        id: &str,
        start_row: i32,
        start_col: usize,
        end_row: i32,
        end_col: usize,
    ) -> Result<String, String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;
        let state = session.state.read().map_err(|_| "grid state poisoned")?;
        Ok(selection_text(
            &state.term,
            start_row,
            start_col,
            end_row,
            end_col,
        ))
    }

    /// Register a binary-diff subscriber. Sends an immediate full-sync frame so
    /// the new subscriber has a baseline, then the emitter pushes diffs at 60Hz.
    pub fn subscribe_diffs(
        &self,
        id: &str,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<(), String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;

        let frame = {
            let state = session.state.read().map_err(|_| "grid state poisoned")?;
            WireFrame::capture_state(&state)
        };
        // Full sync to the new subscriber. Diffs are idempotent (each row carries
        // absolute cell values), so any overlap with the shared emitter is safe.
        channel
            .send(InvokeResponseBody::Raw(encode_frame(&frame, None)))
            .map_err(|error| error.to_string())?;

        let mut emit = session.emit.lock().map_err(|_| "emit lock poisoned")?;
        emit.channels.push(channel);
        if emit.prev.is_none() {
            emit.prev = Some(frame);
        }
        Ok(())
    }

    /// Resize the headless grid for `id` so it interprets PTY output at the new
    /// dimensions. The PTY itself is resized separately (daemon_resize_session);
    /// keeping both in lock-step avoids reflow corruption. The next emit is a
    /// full sync (dimension change forces one).
    pub fn resize(&self, id: &str, cols: usize, rows: usize) -> Result<(), String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;
        let mut state = session.state.write().map_err(|_| "grid state poisoned")?;
        state.resize(cols, rows);
        Ok(())
    }

    /// Scroll the display by `delta` lines (positive = into history/up). The
    /// next emit reflects the new viewport; the JS side only ever holds the
    /// visible screen, so deep scrollback never grows the frontend heap.
    pub fn scroll(&self, id: &str, delta: i32) -> Result<(), String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;
        let mut state = session.state.write().map_err(|_| "grid state poisoned")?;
        state.scroll(delta);
        Ok(())
    }

    /// Return a scrolled-back viewport to the live bottom. User keyboard input
    /// should do this before writing to the PTY; otherwise the frontend can keep
    /// showing a historical scrollback viewport while the prompt/cursor belongs
    /// to the live screen, which reads as a broken split/blank terminal.
    pub fn scroll_to_bottom(&self, id: &str) -> Result<(), String> {
        let session = self
            .get(id)
            .ok_or_else(|| format!("no grid attached for session {id}"))?;
        let mut state = session.state.write().map_err(|_| "grid state poisoned")?;
        state.scroll_to_bottom();
        Ok(())
    }

    /// Detach a session: stop its threads and drop its state.
    pub fn detach(&self, id: &str, attach_token: Option<&str>) {
        if let Ok(mut sessions) = self.sessions.lock() {
            let should_detach = sessions
                .get(id)
                .and_then(|session| {
                    session.attach_token.lock().ok().map(|token| {
                        match (attach_token, token.as_deref()) {
                            (Some(expected), Some(current)) => expected == current,
                            (Some(_), None) => false,
                            (None, _) => true,
                        }
                    })
                })
                .unwrap_or(false);
            if should_detach {
                if let Some(session) = sessions.remove(id) {
                    session.stop.store(true, Ordering::Relaxed);
                }
            }
        }
    }

    #[cfg(test)]
    fn has_session(&self, id: &str) -> bool {
        self.sessions
            .lock()
            .map(|sessions| sessions.contains_key(id))
            .unwrap_or(false)
    }

    #[cfg(test)]
    fn session_token(&self, id: &str) -> Option<String> {
        self.sessions
            .lock()
            .ok()?
            .get(id)?
            .attach_token
            .lock()
            .ok()?
            .clone()
    }
}

impl Default for GridManager {
    fn default() -> Self {
        Self::new()
    }
}

fn spawn_session_threads(id: &str, session: &Arc<Session>) -> Result<(), String> {
    let feed_id = id.to_string();
    let feed_state = Arc::clone(&session.state);
    let stop = Arc::clone(&session.stop);
    std::thread::Builder::new()
        .name(format!("vt-grid-{id}"))
        .stack_size(GRID_FEED_THREAD_STACK_BYTES)
        .spawn(move || run_feed_with_reconnect(&feed_id, &feed_state, &stop))
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// Exponential backoff for grid-feed reconnects, capped. `failures` is the count
/// of consecutive failed attempts (1 for the first retry). Pure for testability.
fn grid_feed_reconnect_backoff(failures: u32) -> Duration {
    let shift = failures.saturating_sub(1).min(4);
    let millis = GRID_FEED_RECONNECT_BASE
        .as_millis()
        .saturating_mul(1u128 << shift)
        .min(GRID_FEED_RECONNECT_MAX.as_millis()) as u64;
    Duration::from_millis(millis)
}

/// Sleep up to `dur`, waking early (in small slices) if `stop` is set so a detach
/// aborts a backoff promptly. Returns true if it slept the full duration.
fn sleep_unless_stopped(dur: Duration, stop: &AtomicBool) -> bool {
    let slice = Duration::from_millis(50);
    let mut remaining = dur;
    while remaining > Duration::ZERO {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        let step = remaining.min(slice);
        std::thread::sleep(step);
        remaining = remaining.saturating_sub(step);
    }
    true
}

/// Run the daemon grid feed, reconnecting across transient socket drops and daemon
/// restarts. The daemon is the PTY authority and survives these, so a dropped feed
/// is recoverable: each re-subscribe begins with a fresh snapshot (applied via
/// `TermState::reset` + feed) so reconnection neither blanks nor duplicates the grid.
fn run_feed_with_reconnect(id: &str, state: &Arc<RwLock<TermState>>, stop: &AtomicBool) {
    let mut consecutive_failures: u32 = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let started = std::time::Instant::now();
        let result = feed_grid_from_daemon(id, state, stop);
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // A feed that streamed for a meaningful time was a healthy connection;
        // only count rapid back-to-back failures toward the give-up cap.
        let was_healthy = result.is_ok() || started.elapsed() >= GRID_FEED_HEALTHY_MIN;
        if was_healthy {
            consecutive_failures = 0;
        } else {
            consecutive_failures += 1;
        }
        if let Err(error) = &result {
            eprintln!("vt-grid reader for {id} dropped (attempt {consecutive_failures}): {error}");
        }
        if consecutive_failures > GRID_FEED_MAX_RECONNECTS {
            eprintln!(
                "vt-grid reader for {id} giving up after {consecutive_failures} consecutive reconnect failures"
            );
            return;
        }
        let backoff = grid_feed_reconnect_backoff(consecutive_failures.max(1));
        if !sleep_unless_stopped(backoff, stop) {
            return;
        }
    }
}

fn spawn_shared_emitter(sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>) {
    std::thread::Builder::new()
        .name("vt-grid-emitter".to_string())
        .stack_size(GRID_FEED_THREAD_STACK_BYTES)
        .spawn(move || run_shared_emitter(&sessions))
        .expect("spawn vt grid shared emitter");
}

/// 60Hz loop: capture the grid, diff against the last emitted frame, and push
/// the binary delta to every subscriber. Skips work entirely when nobody is
/// listening.
fn run_shared_emitter(sessions: &Arc<Mutex<HashMap<String, Arc<Session>>>>) {
    loop {
        std::thread::sleep(EMIT_INTERVAL);
        let sessions = match sessions.lock() {
            Ok(sessions) => sessions.values().cloned().collect::<Vec<_>>(),
            Err(_) => return,
        };
        for session in sessions {
            emit_session_diff(&session);
        }
    }
}

fn emit_session_diff(session: &Arc<Session>) {
    if session.stop.load(Ordering::Relaxed) {
        return;
    }
    {
        let guard = match session.emit.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard.channels.is_empty() {
            return;
        }
    }

    // Skip the full-grid capture entirely for panes that haven't mutated since
    // the last emit. Capturing every session at 60Hz even while idle was the
    // dominant always-on CPU cost with many panes open (O(rows*cols) per pane
    // per frame).
    //
    // Idle panes (the common case) check `dirty` under a cheap SHARED read lock
    // and bail — they never take the write lock. Taking the write lock here every
    // tick would serialize against the feed thread that applies keystroke echo,
    // adding input latency that scales with pane count. Only a dirtied pane
    // escalates to the write lock to capture + clear the flag. The emitter is the
    // sole clearer of `dirty` and the feed thread only ever sets it, so the value
    // can't be lost between the read check and the write.
    {
        let state = match session.state.read() {
            Ok(state) => state,
            Err(_) => return,
        };
        if !state.dirty {
            return;
        }
    }
    let frame = {
        let mut state = match session.state.write() {
            Ok(state) => state,
            Err(_) => return,
        };
        if !state.dirty {
            return;
        }
        state.dirty = false;
        WireFrame::capture_state(&state)
    };

    let mut guard = match session.emit.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if !frame.differs_from(guard.prev.as_ref()) {
        return;
    }
    let bytes = encode_frame(&frame, guard.prev.as_ref());
    guard
        .channels
        .retain(|channel| channel.send(InvokeResponseBody::Raw(bytes.clone())).is_ok());
    guard.prev = Some(frame);
}

/// Open a subscriber stream to the daemon for `id` and feed every chunk into the
/// VT state machine. The daemon sends a full scrollback snapshot first (which
/// replays the escape sequences and reconstructs the screen), then live deltas.
fn feed_grid_from_daemon(
    id: &str,
    state: &Arc<RwLock<TermState>>,
    stop: &AtomicBool,
) -> Result<(), String> {
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
                    "terminal daemon became reachable but grid stream connect still failed: {retry_error} (initial: {initial_error})"
                )
            })?
        }
    };
    let request = serde_json::to_vec(&DaemonRequest::SubscribeSession {
        id: id.to_string(),
        subscriber_id: format!("vt-grid-{}-{id}", std::process::id()),
    })
    .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown(Shutdown::Write);
    stream
        .set_read_timeout(Some(GRID_FEED_READ_TIMEOUT))
        .map_err(|error| error.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                continue;
            }
            Err(error) => return Err(error.to_string()),
        }
        if line.is_empty() {
            continue;
        }
        let response = serde_json::from_str::<DaemonResponse>(line.trim_end())
            .map_err(|error| format!("daemon stream parse failed: {error}"))?;
        match response {
            DaemonResponse::SnapshotSession { data } => {
                // A snapshot is a complete screen+scrollback reconstruction. Reset
                // first so a reconnect's fresh snapshot replaces the (now stale)
                // grid atomically instead of stacking a duplicate scrollback.
                let mut state = state.write().map_err(|_| "grid state poisoned")?;
                state.reset();
                state.feed(data.as_bytes());
            }
            DaemonResponse::SessionData { data } => {
                let mut state = state.write().map_err(|_| "grid state poisoned")?;
                state.feed(data.as_bytes());
            }
            DaemonResponse::Error { message } => return Err(message),
            _ => {}
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GridSnapshot {
    cols: usize,
    rows: usize,
    display_offset: usize,
    cursor: CursorSnapshot,
    alt_screen: bool,
    cursor_visible: bool,
    /// Row-major grid of cells: `cells[row][col]`.
    cells: Vec<Vec<CellSnapshot>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorSnapshot {
    col: usize,
    line: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CellSnapshot {
    c: String,
    /// Resolved foreground as "#rrggbb".
    fg: String,
    /// Resolved background as "#rrggbb".
    bg: String,
    #[serde(skip_serializing_if = "is_false")]
    bold: bool,
    #[serde(skip_serializing_if = "is_false")]
    italic: bool,
    #[serde(skip_serializing_if = "is_false")]
    underline: bool,
    #[serde(skip_serializing_if = "is_false")]
    inverse: bool,
    #[serde(skip_serializing_if = "is_false")]
    wide: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl GridSnapshot {
    fn capture(term: &Term<VoidListener>) -> Self {
        let cols = term.columns();
        let rows = term.screen_lines();
        let mode = *term.mode();
        let content = term.renderable_content();
        let cursor = CursorSnapshot {
            col: content.cursor.point.column.0,
            line: content.cursor.point.line.0,
        };

        let grid = term.grid();
        // Honor the scroll position: visible row `r` maps to buffer line
        // `r - display_offset` (0 when not scrolled), so scrollback shows history.
        let offset = grid.display_offset() as i32;
        let mut cells = Vec::with_capacity(rows);
        for row in 0..rows {
            let line = &grid[Line(row as i32 - offset)];
            let mut row_cells = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &line[Column(col)];
                let flags = cell.flags;
                // Emit every column (including wide-char spacers) so the
                // serialized row index maps 1:1 to the grid column; the renderer
                // relies on `cells[row][col]` positional alignment. A spacer
                // trails a wide char and renders as blank (the wide glyph itself
                // carries the `wide` flag on its base cell).
                row_cells.push(CellSnapshot {
                    c: cell.c.to_string(),
                    fg: hex(resolve_color(cell.fg, true)),
                    bg: hex(resolve_color(cell.bg, false)),
                    bold: flags.intersects(Flags::BOLD | Flags::DIM_BOLD),
                    italic: flags.contains(Flags::ITALIC),
                    underline: flags.contains(Flags::UNDERLINE),
                    inverse: flags.contains(Flags::INVERSE),
                    wide: flags.contains(Flags::WIDE_CHAR),
                });
            }
            cells.push(row_cells);
        }

        Self {
            cols,
            rows,
            display_offset: grid.display_offset(),
            cursor,
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            cursor_visible: offset == 0 && mode.contains(TermMode::SHOW_CURSOR),
            cells,
        }
    }
}

fn hex((r, g, b): (u8, u8, u8)) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

const DEFAULT_FG: (u8, u8, u8) = (0xd0, 0xd0, 0xd0);
// Neutral cockpit gray (#1d2022) instead of pure black, matched to --terminal-bg
// so default cells blend with the surface fill and the buffer reads as gray.
const DEFAULT_BG: (u8, u8, u8) = (0x1d, 0x20, 0x22);

/// Resolve an `alacritty_terminal` color into concrete RGB using a standard
/// xterm palette. Stage 1 ignores live OSC palette overrides (the terminal's
/// `colors` table) in favor of a deterministic, theme-independent mapping;
/// truecolor (`Spec`) is always exact.
fn resolve_color(color: Color, is_fg: bool) -> (u8, u8, u8) {
    match color {
        Color::Spec(Rgb { r, g, b }) => (r, g, b),
        Color::Indexed(index) => indexed_rgb(index),
        Color::Named(named) => named_rgb(named, is_fg),
    }
}

fn named_rgb(named: NamedColor, is_fg: bool) -> (u8, u8, u8) {
    match named {
        NamedColor::Black => (0x00, 0x00, 0x00),
        NamedColor::Red => (0xcd, 0x00, 0x00),
        NamedColor::Green => (0x00, 0xcd, 0x00),
        NamedColor::Yellow => (0xcd, 0xcd, 0x00),
        NamedColor::Blue => (0x00, 0x00, 0xee),
        NamedColor::Magenta => (0xcd, 0x00, 0xcd),
        NamedColor::Cyan => (0x00, 0xcd, 0xcd),
        NamedColor::White => (0xe5, 0xe5, 0xe5),
        NamedColor::BrightBlack => (0x7f, 0x7f, 0x7f),
        NamedColor::BrightRed => (0xff, 0x00, 0x00),
        NamedColor::BrightGreen => (0x00, 0xff, 0x00),
        NamedColor::BrightYellow => (0xff, 0xff, 0x00),
        NamedColor::BrightBlue => (0x5c, 0x5c, 0xff),
        NamedColor::BrightMagenta => (0xff, 0x00, 0xff),
        NamedColor::BrightCyan => (0x00, 0xff, 0xff),
        NamedColor::BrightWhite => (0xff, 0xff, 0xff),
        NamedColor::Foreground | NamedColor::BrightForeground => DEFAULT_FG,
        NamedColor::Background => DEFAULT_BG,
        NamedColor::Cursor => DEFAULT_FG,
        NamedColor::DimBlack => (0x00, 0x00, 0x00),
        NamedColor::DimRed => (0x66, 0x00, 0x00),
        NamedColor::DimGreen => (0x00, 0x66, 0x00),
        NamedColor::DimYellow => (0x66, 0x66, 0x00),
        NamedColor::DimBlue => (0x00, 0x00, 0x77),
        NamedColor::DimMagenta => (0x66, 0x00, 0x66),
        NamedColor::DimCyan => (0x00, 0x66, 0x66),
        NamedColor::DimWhite => (0x72, 0x72, 0x72),
        NamedColor::DimForeground => {
            if is_fg {
                (0x80, 0x80, 0x80)
            } else {
                DEFAULT_BG
            }
        }
    }
}

/// Standard xterm 256-color palette.
fn indexed_rgb(index: u8) -> (u8, u8, u8) {
    match index {
        0 => named_rgb(NamedColor::Black, false),
        1 => named_rgb(NamedColor::Red, false),
        2 => named_rgb(NamedColor::Green, false),
        3 => named_rgb(NamedColor::Yellow, false),
        4 => named_rgb(NamedColor::Blue, false),
        5 => named_rgb(NamedColor::Magenta, false),
        6 => named_rgb(NamedColor::Cyan, false),
        7 => named_rgb(NamedColor::White, false),
        8 => named_rgb(NamedColor::BrightBlack, false),
        9 => named_rgb(NamedColor::BrightRed, false),
        10 => named_rgb(NamedColor::BrightGreen, false),
        11 => named_rgb(NamedColor::BrightYellow, false),
        12 => named_rgb(NamedColor::BrightBlue, false),
        13 => named_rgb(NamedColor::BrightMagenta, false),
        14 => named_rgb(NamedColor::BrightCyan, false),
        15 => named_rgb(NamedColor::BrightWhite, false),
        16..=231 => {
            let i = index - 16;
            let r = i / 36;
            let g = (i % 36) / 6;
            let b = i % 6;
            (cube_step(r), cube_step(g), cube_step(b))
        }
        232..=255 => {
            let level = 8 + (index - 232) * 10;
            (level, level, level)
        }
    }
}

fn cube_step(value: u8) -> u8 {
    if value == 0 {
        0
    } else {
        55 + value * 40
    }
}

// ---------------------------------------------------------------------------
// Binary dirty-diff wire format (TC-017c)
// ---------------------------------------------------------------------------
//
// All integers little-endian. The frontend reads it as an ArrayBuffer.
//
// Header (17 bytes):
//   [0]      u8   message type: 0x01 = diff, 0x02 = full sync
//   [1..3]   u16  cols
//   [3..5]   u16  rows (visible screen rows)
//   [5..7]   u16  display offset (scrollback lines above the live bottom)
//   [7..9]   u16  cursor column
//   [9..11]  u16  cursor line (visible, 0-based)
//   [11..15] u32  mode flags: bit0 = alt screen, bit1 = cursor visible
//   [15..17] u16  dirty row count
// Then, per dirty row:
//   u16 row index, u16 cell count (== cols), then `cell count` cells.
// Cell (14 bytes):
//   [0..4]   u32  character (UTF-32 code point; 0 = blank)
//   [4..8]   u32  foreground 0xRRGGBBAA
//   [8..12]  u32  background 0xRRGGBBAA
//   [12..14] u16  style flags: bit0 bold, bit1 italic, bit2 underline,
//                 bit3 inverse, bit4 wide
//
// A full sync marks every row dirty; a diff carries only changed rows (but the
// header always carries the current cursor + mode, so cursor-only moves emit a
// diff with zero dirty rows).

pub const MSG_DIFF: u8 = 0x01;
pub const MSG_FULL: u8 = 0x02;
pub const CELL_BYTES: usize = 14;
pub const HEADER_BYTES: usize = 17;

const MODE_ALT_SCREEN: u32 = 1 << 0;
const MODE_CURSOR_VISIBLE: u32 = 1 << 1;
const MODE_APP_CURSOR: u32 = 1 << 2;
const MODE_APP_KEYPAD: u32 = 1 << 3;
const MODE_BRACKETED_PASTE: u32 = 1 << 4;
// Mouse reporting is on (any of click/drag/motion). When set, the frontend must
// forward wheel notches as mouse wheel reports so apps that own the mouse
// (zellij, vim, htop, less, tmux) scroll — sending arrow keys instead makes the
// focused TUI move the cursor/selection and warn "use PgUp/PgDn".
const MODE_MOUSE_REPORT: u32 = 1 << 5;
// Alternate-scroll (DECSET 1007): translate wheel to arrow keys on the alt
// screen. Only honored when mouse reporting is OFF.
const MODE_ALTERNATE_SCROLL: u32 = 1 << 6;
// SGR extended mouse encoding (DECSET 1006) is active. Picks the wheel report
// wire format: SGR `ESC[<b;x;yM` when set, legacy X10 `ESC[M` bytes otherwise.
const MODE_SGR_MOUSE: u32 = 1 << 7;
// The app explicitly sent DECSET/DECRST 1007 at least once. Without this, a
// false alternate-scroll bit means "unset", not "explicitly disabled".
const MODE_ALTERNATE_SCROLL_SET: u32 = 1 << 8;

const STYLE_BOLD: u16 = 1 << 0;
const STYLE_ITALIC: u16 = 1 << 1;
const STYLE_UNDERLINE: u16 = 1 << 2;
const STYLE_INVERSE: u16 = 1 << 3;
const STYLE_WIDE: u16 = 1 << 4;

#[derive(Clone, Copy, PartialEq, Eq)]
struct WireCell {
    ch: u32,
    fg: u32,
    bg: u32,
    style: u16,
}

/// A captured frame in the compact form used for diffing + encoding.
struct WireFrame {
    cols: u16,
    rows: u16,
    display_offset: u16,
    cursor_col: u16,
    cursor_line: u16,
    alt_screen: bool,
    cursor_visible: bool,
    app_cursor: bool,
    app_keypad: bool,
    bracketed_paste: bool,
    mouse_report: bool,
    alternate_scroll: bool,
    alternate_scroll_set: bool,
    sgr_mouse: bool,
    rows_cells: Vec<Vec<WireCell>>,
}

fn rgba_u32((r, g, b): (u8, u8, u8)) -> u32 {
    (u32::from(r) << 24) | (u32::from(g) << 16) | (u32::from(b) << 8) | 0xFF
}

impl WireFrame {
    fn capture_state(state: &TermState) -> Self {
        let mut frame = Self::capture(&state.term);
        frame.alternate_scroll_set = state.alternate_scroll_touched;
        frame
    }

    fn capture(term: &Term<VoidListener>) -> Self {
        let cols = term.columns();
        let rows = term.screen_lines();
        let mode = *term.mode();
        let grid = term.grid();
        // Visible row `r` maps to buffer line `r - display_offset` so a scrolled
        // viewport reads history (0 when not scrolled).
        let offset = grid.display_offset() as i32;
        let cursor = term.renderable_content().cursor.point;

        let mut rows_cells = Vec::with_capacity(rows);
        for row in 0..rows {
            let line = &grid[Line(row as i32 - offset)];
            let mut cells = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &line[Column(col)];
                let flags = cell.flags;
                let mut style = 0u16;
                if flags.intersects(Flags::BOLD | Flags::DIM_BOLD) {
                    style |= STYLE_BOLD;
                }
                if flags.contains(Flags::ITALIC) {
                    style |= STYLE_ITALIC;
                }
                if flags.contains(Flags::UNDERLINE) {
                    style |= STYLE_UNDERLINE;
                }
                if flags.contains(Flags::INVERSE) {
                    style |= STYLE_INVERSE;
                }
                if flags.contains(Flags::WIDE_CHAR) {
                    style |= STYLE_WIDE;
                }
                let ch = if cell.c == ' ' || cell.c == '\0' {
                    0
                } else {
                    cell.c as u32
                };
                cells.push(WireCell {
                    ch,
                    fg: rgba_u32(resolve_color(cell.fg, true)),
                    bg: rgba_u32(resolve_color(cell.bg, false)),
                    style,
                });
            }
            rows_cells.push(cells);
        }

        Self {
            cols: cols as u16,
            rows: rows as u16,
            display_offset: grid.display_offset().min(u16::MAX as usize) as u16,
            cursor_col: cursor.column.0 as u16,
            cursor_line: cursor.line.0.max(0) as u16,
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            cursor_visible: offset == 0 && mode.contains(TermMode::SHOW_CURSOR),
            app_cursor: mode.contains(TermMode::APP_CURSOR),
            app_keypad: mode.contains(TermMode::APP_KEYPAD),
            bracketed_paste: mode.contains(TermMode::BRACKETED_PASTE),
            // Any mouse-reporting variant means an app wants wheel-as-mouse.
            mouse_report: mode.intersects(
                TermMode::MOUSE_REPORT_CLICK | TermMode::MOUSE_DRAG | TermMode::MOUSE_MOTION,
            ),
            alternate_scroll: mode.contains(TermMode::ALTERNATE_SCROLL),
            alternate_scroll_set: false,
            sgr_mouse: mode.contains(TermMode::SGR_MOUSE),
            rows_cells,
        }
    }

    fn mode_flags(&self) -> u32 {
        let mut flags = 0;
        if self.alt_screen {
            flags |= MODE_ALT_SCREEN;
        }
        if self.cursor_visible {
            flags |= MODE_CURSOR_VISIBLE;
        }
        if self.app_cursor {
            flags |= MODE_APP_CURSOR;
        }
        if self.app_keypad {
            flags |= MODE_APP_KEYPAD;
        }
        if self.bracketed_paste {
            flags |= MODE_BRACKETED_PASTE;
        }
        if self.mouse_report {
            flags |= MODE_MOUSE_REPORT;
        }
        if self.alternate_scroll {
            flags |= MODE_ALTERNATE_SCROLL;
        }
        if self.sgr_mouse {
            flags |= MODE_SGR_MOUSE;
        }
        if self.alternate_scroll_set {
            flags |= MODE_ALTERNATE_SCROLL_SET;
        }
        flags
    }

    /// True if anything visible changed relative to `prev` (cells, cursor, mode,
    /// or dimensions).
    fn differs_from(&self, prev: Option<&WireFrame>) -> bool {
        let Some(prev) = prev else {
            return true;
        };
        if prev.cols != self.cols
            || prev.rows != self.rows
            || prev.display_offset != self.display_offset
            || prev.cursor_col != self.cursor_col
            || prev.cursor_line != self.cursor_line
            || prev.mode_flags() != self.mode_flags()
        {
            return true;
        }
        self.rows_cells != prev.rows_cells
    }
}

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_row(buffer: &mut Vec<u8>, index: usize, cells: &[WireCell]) {
    push_u16(buffer, index as u16);
    push_u16(buffer, cells.len() as u16);
    for cell in cells {
        push_u32(buffer, cell.ch);
        push_u32(buffer, cell.fg);
        push_u32(buffer, cell.bg);
        push_u16(buffer, cell.style);
    }
}

/// Encode `frame` against `prev`. A full sync (all rows) when `prev` is `None`
/// or the dimensions changed; otherwise a diff carrying only changed rows.
fn encode_frame(frame: &WireFrame, prev: Option<&WireFrame>) -> Vec<u8> {
    let full = match prev {
        None => true,
        Some(prev) => prev.cols != frame.cols || prev.rows != frame.rows,
    };

    let dirty: Vec<usize> = if full {
        (0..frame.rows_cells.len()).collect()
    } else {
        let prev = prev.expect("prev present when not full");
        (0..frame.rows_cells.len())
            .filter(|&i| frame.rows_cells[i] != prev.rows_cells[i])
            .collect()
    };

    let mut buffer =
        Vec::with_capacity(HEADER_BYTES + dirty.len() * (4 + frame.cols as usize * CELL_BYTES));
    buffer.push(if full { MSG_FULL } else { MSG_DIFF });
    push_u16(&mut buffer, frame.cols);
    push_u16(&mut buffer, frame.rows);
    push_u16(&mut buffer, frame.display_offset);
    push_u16(&mut buffer, frame.cursor_col);
    push_u16(&mut buffer, frame.cursor_line);
    push_u32(&mut buffer, frame.mode_flags());
    push_u16(&mut buffer, dirty.len() as u16);
    for index in dirty {
        push_row(&mut buffer, index, &frame.rows_cells[index]);
    }
    buffer
}

fn ordered_selection(
    start_row: i32,
    start_col: usize,
    end_row: i32,
    end_col: usize,
) -> ((i32, usize), (i32, usize)) {
    if start_row < end_row || (start_row == end_row && start_col <= end_col) {
        ((start_row, start_col), (end_row, end_col))
    } else {
        ((end_row, end_col), (start_row, start_col))
    }
}

fn selection_text(
    term: &Term<VoidListener>,
    start_row: i32,
    start_col: usize,
    end_row: i32,
    end_col: usize,
) -> String {
    let cols = term.columns();
    if cols == 0 {
        return String::new();
    }
    let ((start_row, start_col), (end_row, end_col)) =
        ordered_selection(start_row, start_col, end_row, end_col);
    let grid = term.grid();
    let mut lines = Vec::new();
    for row in start_row..=end_row {
        let from = if row == start_row { start_col } else { 0 }.min(cols - 1);
        let to = if row == end_row { end_col } else { cols - 1 }.min(cols - 1);
        let mut text = String::new();
        let line = &grid[Line(row)];
        for col in from..=to {
            let ch = line[Column(col)].c;
            text.push(if ch == '\0' { ' ' } else { ch });
        }
        lines.push(text.trim_end().to_string());
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(bytes: &str) -> GridSnapshot {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(bytes.as_bytes());
        GridSnapshot::capture(&state.term)
    }

    // Regression: re-attaching to a lingering grid session MUST resize its Term
    // to the caller's size, never silently keep the old width. A stale width
    // drifts the grid from the PTY winsize, so the agent composes lines at the
    // PTY width while the grid parses them at its old width and every full line
    // spills one character onto the next row (the mid-word wrap-spill bug).
    // `upsert_session` is the thread-free core of `GridManager::attach`; before
    // the fix `attach` returned early on an existing session and dropped the new
    // size, which this asserts against.
    #[test]
    fn reattach_resizes_existing_grid_to_new_size() {
        let manager = GridManager::new();
        let (_first, first_is_new) = manager
            .upsert_session("regression-session", 80, 24, Some("first".to_string()))
            .expect("first attach");
        assert!(first_is_new, "first upsert creates the session");

        // Put content in so the Term isn't empty, mirroring a live re-attach.
        manager
            .get("regression-session")
            .expect("session present")
            .state
            .write()
            .expect("state lock")
            .feed(b"agent output before re-attach\r\n");

        // Re-attach (e.g. a map zoom toggled `mapProjection`) at a wider size.
        let (session, second_is_new) = manager
            .upsert_session("regression-session", 100, 30, Some("second".to_string()))
            .expect("re-attach");
        assert!(!second_is_new, "re-attach reuses the existing session");

        let state = session.state.read().expect("state lock");
        assert_eq!(
            state.term.columns(),
            100,
            "re-attach must resize the grid Term width to match the new PTY winsize"
        );
        assert_eq!(
            state.term.screen_lines(),
            30,
            "re-attach must resize the grid Term height too"
        );
        drop(state);

        manager.detach("regression-session", Some("second"));
    }

    #[test]
    fn stale_detach_token_does_not_remove_new_grid_session() {
        let manager = GridManager::new();
        manager
            .upsert_session("map-session", 80, 24, Some("old-mount".to_string()))
            .expect("initial map grid should attach");
        manager
            .upsert_session("map-session", 100, 30, Some("new-mount".to_string()))
            .expect("new map grid should reattach");

        manager.detach("map-session", Some("old-mount"));

        assert!(
            manager.has_session("map-session"),
            "a stale map-node cleanup must not detach the current grid session"
        );
        assert_eq!(
            manager.session_token("map-session").as_deref(),
            Some("new-mount")
        );

        manager.detach("map-session", Some("new-mount"));
        assert!(
            !manager.has_session("map-session"),
            "the current map-node cleanup should detach its own grid session"
        );
    }

    #[test]
    fn term_state_dirty_flag_tracks_visible_mutations() {
        let mut state = TermState::new(80, 24);
        assert!(state.dirty, "new sessions must emit an initial full frame");

        state.dirty = false;
        state.feed(b"visible output");
        assert!(state.dirty, "feed must mark the grid dirty");

        state.dirty = false;
        state.resize(100, 30);
        assert!(state.dirty, "dimension changes must mark the grid dirty");

        state.dirty = false;
        state.resize(100, 30);
        assert!(
            !state.dirty,
            "same-size resize should not wake the emitter when nothing changed"
        );

        state.scroll(-1);
        assert!(state.dirty, "scroll changes the visible grid");

        state.dirty = false;
        state.scroll_to_bottom();
        assert!(
            !state.dirty,
            "scroll-to-bottom at the live bottom should not wake the emitter"
        );

        for i in 0..100 {
            state.feed(format!("line{i}\r\n").as_bytes());
        }
        state.dirty = false;
        state.scroll(100);
        assert!(state.dirty, "scroll into history changes the visible grid");
        state.dirty = false;
        state.scroll_to_bottom();
        assert!(
            state.dirty,
            "scroll-to-bottom from history changes the visible grid"
        );

        state.dirty = false;
        state.reset();
        assert!(state.dirty, "reset must force a fresh frame");
    }

    // Regression: the 60Hz emitter skips the O(rows*cols) grid capture for panes
    // that haven't changed (the dirty flag). This guards the invariant the skip
    // relies on — every method that can change the visible grid must mark dirty,
    // and a no-op must NOT — so the optimization can never drop a real frame nor
    // needlessly re-emit an idle one. If a new mutation method is added without
    // setting `dirty`, this fails.
    #[test]
    fn term_state_dirty_tracks_grid_mutations() {
        let mut s = TermState::new(80, 24);
        assert!(s.dirty, "a new grid starts dirty so its first frame emits");

        s.dirty = false;
        s.feed(b"hello world");
        assert!(s.dirty, "feed marks the grid dirty");

        s.dirty = false;
        s.scroll(1);
        assert!(s.dirty, "scroll marks the grid dirty");

        s.dirty = false;
        s.scroll_to_bottom();
        assert!(
            !s.dirty,
            "scroll_to_bottom at the live bottom must not mark dirty"
        );

        for i in 0..100 {
            s.feed(format!("line{i}\r\n").as_bytes());
        }
        s.dirty = false;
        s.scroll(100);
        assert!(s.dirty, "scroll into history marks dirty");
        s.dirty = false;
        s.scroll_to_bottom();
        assert!(s.dirty, "scroll_to_bottom from history marks dirty");

        s.dirty = false;
        s.resize(100, 30);
        assert!(s.dirty, "a real resize marks the grid dirty");

        s.dirty = false;
        s.resize(100, 30);
        assert!(
            !s.dirty,
            "a no-op resize must NOT mark dirty (no needless capture/emit)"
        );

        s.reset();
        assert!(s.dirty, "reset marks the grid dirty");
    }

    #[test]
    fn reconnect_backoff_is_monotonic_and_capped() {
        let b1 = grid_feed_reconnect_backoff(1);
        let b2 = grid_feed_reconnect_backoff(2);
        let b3 = grid_feed_reconnect_backoff(3);
        assert_eq!(
            b1, GRID_FEED_RECONNECT_BASE,
            "first retry uses the base delay"
        );
        assert!(
            b2 > b1 && b3 > b2,
            "backoff grows with consecutive failures"
        );
        // Far-out attempts saturate at the cap, never exceeding it.
        for failures in 5..50 {
            assert!(
                grid_feed_reconnect_backoff(failures) <= GRID_FEED_RECONNECT_MAX,
                "backoff must stay capped"
            );
        }
        assert_eq!(grid_feed_reconnect_backoff(40), GRID_FEED_RECONNECT_MAX);
    }

    #[test]
    fn reset_clears_grid_content_but_keeps_dimensions() {
        let mut state = TermState::new(100, 30);
        state.feed(b"hello reconnect world\r\n");
        let before = GridSnapshot::capture(&state.term);
        assert!(text_at(&before, 0).contains("hello reconnect world"));

        state.reset();
        let after = GridSnapshot::capture(&state.term);
        assert_eq!(after.cols, 100, "reset preserves columns");
        assert_eq!(after.rows, 30, "reset preserves rows");
        assert!(
            !text_at(&after, 0).contains("hello"),
            "reset must clear prior grid content so a fresh snapshot can't duplicate it"
        );
    }

    #[test]
    fn reset_then_feed_does_not_duplicate_snapshot_content() {
        // Simulates a reconnect: the same snapshot bytes are applied twice. With
        // reset-before-feed the grid must hold the content once, not stacked.
        let snapshot = "line-A\r\nline-B\r\nline-C\r\n";
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.reset();
        state.feed(snapshot.as_bytes());
        state.reset();
        state.feed(snapshot.as_bytes());
        let grid = GridSnapshot::capture(&state.term);
        let occurrences = (0..grid.rows)
            .filter(|&row| text_at(&grid, row).contains("line-B"))
            .count();
        assert_eq!(occurrences, 1, "reconnect snapshot must not duplicate rows");
    }

    fn text_at(snapshot: &GridSnapshot, row: usize) -> String {
        snapshot.cells[row]
            .iter()
            .map(|cell| cell.c.as_str())
            .collect::<String>()
            .trim_end()
            .to_string()
    }

    fn wire_text_at(frame: &WireFrame, row: usize) -> String {
        frame.rows_cells[row]
            .iter()
            .filter_map(|cell| char::from_u32(cell.ch))
            .filter(|ch| *ch != '\0')
            .collect::<String>()
            .trim_end()
            .to_string()
    }

    fn frame_text(frame: &WireFrame) -> String {
        (0..usize::from(frame.rows))
            .map(|row| wire_text_at(frame, row))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn plain_text_lands_on_the_first_row() {
        let snapshot = feed("hello world");
        assert_eq!(snapshot.cols, DEFAULT_COLS);
        assert_eq!(snapshot.rows, DEFAULT_ROWS);
        assert_eq!(text_at(&snapshot, 0), "hello world");
        // Cursor advances to just past the text on the same line.
        assert_eq!(snapshot.cursor.line, 0);
        assert_eq!(snapshot.cursor.col, 11);
    }

    #[test]
    fn crlf_moves_to_the_next_row() {
        let snapshot = feed("line one\r\nline two");
        assert_eq!(text_at(&snapshot, 0), "line one");
        assert_eq!(text_at(&snapshot, 1), "line two");
        assert_eq!(snapshot.cursor.line, 1);
    }

    #[test]
    fn sgr_red_foreground_is_resolved() {
        // ESC[31m -> red fg; ESC[0m resets.
        let snapshot = feed("\x1b[31mRED\x1b[0mok");
        assert_eq!(snapshot.cells[0][0].c, "R");
        assert_eq!(snapshot.cells[0][0].fg, "#cd0000");
        // After reset, default fg.
        assert_eq!(snapshot.cells[0][3].c, "o");
        assert_eq!(snapshot.cells[0][3].fg, "#d0d0d0");
    }

    #[test]
    fn truecolor_is_exact() {
        // ESC[38;2;10;20;30m -> rgb(10,20,30).
        let snapshot = feed("\x1b[38;2;10;20;30mX");
        assert_eq!(snapshot.cells[0][0].fg, "#0a141e");
    }

    #[test]
    fn bold_flag_is_reported() {
        let snapshot = feed("\x1b[1mB");
        assert!(snapshot.cells[0][0].bold);
    }

    #[test]
    fn alt_screen_mode_is_detected() {
        // ESC[?1049h enters the alternate screen.
        let snapshot = feed("\x1b[?1049h");
        assert!(snapshot.alt_screen);
    }

    // --- binary wire codec (TC-017c) ---

    fn frame(bytes: &str) -> WireFrame {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(bytes.as_bytes());
        WireFrame::capture_state(&state)
    }

    fn read_u16(buffer: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([buffer[offset], buffer[offset + 1]])
    }

    fn read_u32(buffer: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes([
            buffer[offset],
            buffer[offset + 1],
            buffer[offset + 2],
            buffer[offset + 3],
        ])
    }

    #[test]
    fn full_sync_header_and_dimensions() {
        let f = frame("hi");
        let buffer = encode_frame(&f, None);
        assert_eq!(buffer[0], MSG_FULL);
        assert_eq!(read_u16(&buffer, 1), DEFAULT_COLS as u16);
        assert_eq!(read_u16(&buffer, 3), DEFAULT_ROWS as u16);
        assert_eq!(read_u16(&buffer, 5), 0); // display offset
        assert_eq!(read_u16(&buffer, 7), 2); // cursor col after "hi"
        assert_eq!(read_u16(&buffer, 9), 0); // cursor line
                                             // mode: cursor visible by default, no alt screen.
        assert_eq!(
            read_u32(&buffer, 11) & MODE_CURSOR_VISIBLE,
            MODE_CURSOR_VISIBLE
        );
        assert_eq!(read_u32(&buffer, 11) & MODE_ALT_SCREEN, 0);
        // full sync marks every row dirty.
        assert_eq!(read_u16(&buffer, 15), DEFAULT_ROWS as u16);
    }

    #[test]
    fn alternate_scroll_touched_is_reported_even_when_disabled() {
        let disabled = frame("\x1b[?1007l");
        assert!(!disabled.alternate_scroll);
        assert!(disabled.alternate_scroll_set);

        let enabled = frame("\x1b[?1007h");
        assert!(enabled.alternate_scroll);
        assert!(enabled.alternate_scroll_set);
    }

    #[test]
    fn full_sync_first_row_carries_expected_glyphs() {
        let f = frame("\x1b[31mR\x1b[0m");
        let buffer = encode_frame(&f, None);
        // First dirty row starts right after the header.
        let row_index = read_u16(&buffer, HEADER_BYTES);
        let cell_count = read_u16(&buffer, HEADER_BYTES + 2);
        assert_eq!(row_index, 0);
        assert_eq!(cell_count, DEFAULT_COLS as u16);
        // First cell of row 0: char 'R', red fg.
        let cell0 = HEADER_BYTES + 4;
        assert_eq!(read_u32(&buffer, cell0), 'R' as u32);
        assert_eq!(read_u32(&buffer, cell0 + 4), rgba_u32((0xcd, 0x00, 0x00)));
    }

    #[test]
    fn diff_emits_only_changed_rows() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(b"line0\r\nline1");
        let first = WireFrame::capture(&state.term);
        // Type into a fresh row; only that row (and prior cursor row) changes.
        state.feed(b"\r\nrow2text");
        let second = WireFrame::capture(&state.term);

        let buffer = encode_frame(&second, Some(&first));
        assert_eq!(buffer[0], MSG_DIFF);
        let dirty = read_u16(&buffer, 15);
        // Only the newly written row changed (1), not all 24.
        assert_eq!(dirty, 1);
        assert_eq!(read_u16(&buffer, HEADER_BYTES), 2); // row index 2
    }

    #[test]
    fn identical_frames_do_not_differ() {
        let a = frame("same");
        let b = frame("same");
        assert!(!b.differs_from(Some(&a)));
    }

    #[test]
    fn cursor_move_marks_a_difference_with_zero_dirty_rows() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(b"abc");
        let first = WireFrame::capture(&state.term);
        // Move cursor left without changing cell contents (CUB).
        state.feed(b"\x1b[D");
        let second = WireFrame::capture(&state.term);
        assert!(second.differs_from(Some(&first)));
        let buffer = encode_frame(&second, Some(&first));
        assert_eq!(buffer[0], MSG_DIFF);
        assert_eq!(read_u16(&buffer, 7), 2); // cursor moved 3 -> 2
        assert_eq!(read_u16(&buffer, 15), 0); // zero dirty rows
    }

    #[test]
    fn resize_changes_grid_dimensions_and_preserves_content() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(b"hello");
        state.resize(100, 30);
        let f = WireFrame::capture(&state.term);
        assert_eq!(f.cols, 100);
        assert_eq!(f.rows, 30);
        // Content survives the reflow on the first row.
        let text: String = f.rows_cells[0]
            .iter()
            .filter_map(|cell| char::from_u32(cell.ch))
            .filter(|c| *c != '\0')
            .collect();
        assert!(text.starts_with("hello"), "got: {text:?}");
    }

    fn last_nonblank_row(frame: &WireFrame) -> Option<usize> {
        (0..frame.rows as usize)
            .rev()
            .find(|&r| !wire_text_at(frame, r).is_empty())
    }

    // Root-cause regression for the "grow toward the bottom leaves black space"
    // report: on a row GROW the grid pins live content to the TOP and leaves the
    // unfilled rows blank at the BOTTOM (alacritty pulls only as much scrollback
    // down as history holds; an inline app that parked its cursor mid-screen
    // fills nothing beneath it). This is exactly why TerminalCanvas must
    // bottom-anchor the rendered canvas (applyLiveBottomAnchor) — the grid itself
    // cannot avoid the trailing dead strip. If a future alacritty bump changes
    // this to keep the cursor at the floor, this test flips and the frontend
    // anchor can be revisited.
    #[test]
    fn grow_leaves_blank_rows_below_live_content() {
        // Scenario A: a shell with limited history. 30 printed lines into a 24-row
        // grid -> only ~7 lines of history exist to pull down on a 24->40 grow.
        let mut shell = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        for n in 0..30 {
            shell.feed(format!("line-{n:02}\r\n").as_bytes());
        }
        shell.resize(DEFAULT_COLS, 40);
        let after = WireFrame::capture(&shell.term);
        let last_a = last_nonblank_row(&after).expect("shell has content");
        assert!(
            (after.rows as usize) - 1 - last_a > 0,
            "grow left no blank strip below a short-history shell — alacritty grow \
             behavior changed; revisit applyLiveBottomAnchor (last_nonblank={last_a}, rows={})",
            after.rows,
        );

        // Scenario B: an inline TUI draws a block then parks the cursor mid-screen
        // (CUP) without filling the rows beneath it. The grow can only add blanks.
        let mut app = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        for n in 0..10 {
            app.feed(format!("menu-{n:02}\r\n").as_bytes());
        }
        app.feed(b"\x1b[12;1Hfooter");
        app.resize(DEFAULT_COLS, 40);
        let a2 = WireFrame::capture(&app.term);
        let last_b = last_nonblank_row(&a2).expect("app has content");
        assert!(
            (a2.rows as usize) - 1 - last_b >= 24,
            "inline-app grow should leave a large blank strip below the parked \
             content (last_nonblank={last_b}, rows={})",
            a2.rows,
        );
    }

    // The user's repro: there IS ample scrollback (it scrolls into view), yet a
    // grow leaves black at the bottom. This pins down whether the GRID fills from
    // history on grow when plenty exists, or leaves a blank tail regardless.
    #[test]
    fn grow_with_ample_history_fills_from_scrollback() {
        let mut shell = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        // 100 lines into a 24-row grid -> ~76 lines of scrollback history.
        for n in 0..100 {
            shell.feed(format!("line-{n:03}\r\n").as_bytes());
        }
        let before = WireFrame::capture(&shell.term);
        shell.resize(DEFAULT_COLS, 40);
        let after = WireFrame::capture(&shell.term);
        let last = last_nonblank_row(&after).expect("content present");
        let blank_below = (after.rows as usize) - 1 - last;
        eprintln!(
            "ample-history grow: before cursor_line={} -> after cursor_line={} last_nonblank={} blank_below={}",
            before.cursor_line, after.cursor_line, last, blank_below,
        );
        // With 76 history lines available to fill 16 new rows, the grow pulls
        // history down to the floor; the only "blank" tail is the single live
        // prompt line where the cursor rests. So the GRID fills correctly on grow
        // — the live black-tail must come from elsewhere (the app's SIGWINCH
        // reprint drawing a short frame, or the frontend not resizing the grid),
        // NOT the grid resize itself.
        assert!(
            blank_below <= 1,
            "grow with ample history left {blank_below} blank rows at the bottom; \
             the grid should fill from scrollback down to the live prompt line",
        );
    }

    // End-to-end backend replay of the user's exact live sequence: run a command
    // that builds scrollback, GROW the grid (what grid_resize does), then feed the
    // real bytes bash emits on the grow SIGWINCH (captured from a live PTY:
    // "\r\x1b[K\rPROMPT$ " — clear-line + prompt reprint, NO clear-screen). If the
    // resulting frame is filled to the floor, the BACKEND is correct and any live
    // black-tail is lost in the FRONTEND render/resize wiring, not here.
    #[test]
    fn live_sequence_grow_then_bash_reprint_stays_filled() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        for n in 1..=100 {
            state.feed(format!("{n}\r\n").as_bytes());
        }
        state.feed(b"PROMPT$ ");
        // Grow 24 -> 40, exactly like grid_resize.
        state.resize(DEFAULT_COLS, 40);
        // The real bash grow-SIGWINCH reprint, captured from a live PTY.
        state.feed(b"\r\x1b[K\rPROMPT$ ");
        let frame = WireFrame::capture(&state.term);
        let last = last_nonblank_row(&frame).expect("content present");
        let blank_below = (frame.rows as usize) - 1 - last;
        eprintln!(
            "live replay: rows={} cursor_line={} last_nonblank={} blank_below={}",
            frame.rows, frame.cursor_line, last, blank_below,
        );
        assert!(
            blank_below <= 1,
            "backend live-replay left {blank_below} blank rows after grow+reprint; \
             the backend itself is dropping the fill",
        );
    }

    #[test]
    fn resize_storm_keeps_wire_frame_rectangular_and_modes() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(b"\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1006h");
        state.feed(b"\x1b[Hhtop-ish frame\r\nrunning after resize storms");

        let sizes = [
            (132, 42),
            (82, 22),
            (118, 34),
            (64, 18),
            (150, 45),
            (96, 28),
        ];
        let mut previous = WireFrame::capture(&state.term);
        for (cols, rows) in sizes {
            state.resize(cols, rows);
            // Simulate a foreground TUI repainting after SIGWINCH.
            state.feed(format!("\x1b[Hresize {cols}x{rows}\x1b[K").as_bytes());
            let frame = WireFrame::capture(&state.term);

            assert_eq!(frame.cols, cols as u16);
            assert_eq!(frame.rows, rows as u16);
            assert_eq!(frame.rows_cells.len(), rows);
            assert!(
                frame.rows_cells.iter().all(|row| row.len() == cols),
                "resize {cols}x{rows} produced a non-rectangular frame"
            );
            assert!(frame.alt_screen, "alt-screen mode leaked during resize");
            assert!(
                frame.bracketed_paste,
                "bracketed paste mode leaked during resize"
            );
            assert!(frame.mouse_report, "mouse-report mode leaked during resize");
            assert!(frame.sgr_mouse, "SGR mouse mode leaked during resize");
            assert_eq!(
                encode_frame(&frame, Some(&previous))[0],
                MSG_FULL,
                "dimension changes must force a full sync"
            );
            previous = frame;
        }

        let final_frame = WireFrame::capture(&state.term);
        assert!(
            final_frame
                .rows_cells
                .iter()
                .flatten()
                .any(|cell| cell.ch != 0),
            "resize storm produced a blank live frame"
        );
    }

    #[test]
    fn synchronized_output_markers_never_render_as_text() {
        let mut state = TermState::new(40, 8);
        state.feed(b"\x1b[?2026hWorking 57\x1b[?2026l");
        let frame = WireFrame::capture(&state.term);
        let text = frame_text(&frame);

        assert!(
            text.contains("Working") && text.contains("57"),
            "payload should still render, got: {text:?}"
        );
        assert!(
            !text.contains("?2026") && !text.contains("[?2026"),
            "synchronized-output marker leaked into the grid: {text:?}"
        );
    }

    #[test]
    fn split_synchronized_output_markers_never_render_as_text() {
        let mut state = TermState::new(40, 8);
        state.feed(b"\x1b[?");
        state.feed(b"2026hWorking");
        state.feed(b" 57\x1b[?20");
        state.feed(b"26l");
        let frame = WireFrame::capture(&state.term);
        let text = frame_text(&frame);

        assert!(
            text.contains("Working") && text.contains("57"),
            "payload should still render, got: {text:?}"
        );
        assert!(
            !text.contains("?2026") && !text.contains("[?2026"),
            "split synchronized-output marker leaked into the grid: {text:?}"
        );
    }

    #[test]
    fn alternate_screen_roundtrip_preserves_main_scrollback() {
        let mut state = TermState::new(40, 8);
        for i in 0..20 {
            state.feed(format!("main-{i}\r\n").as_bytes());
        }
        let main_before_alt = WireFrame::capture(&state.term);
        assert!(!main_before_alt.alt_screen);

        state.feed(b"\x1b[?1049h\x1b[Halt-screen-only");
        let alt = WireFrame::capture(&state.term);
        assert!(alt.alt_screen);
        assert_eq!(wire_text_at(&alt, 0), "alt-screen-only");

        state.feed(b"\x1b[?1049l");
        let restored = WireFrame::capture(&state.term);
        assert!(!restored.alt_screen);
        assert!(
            restored
                .rows_cells
                .iter()
                .enumerate()
                .any(|(row, _)| wire_text_at(&restored, row).starts_with("main-")),
            "main screen content was not restored after leaving alt-screen"
        );
        assert!(
            !restored
                .rows_cells
                .iter()
                .enumerate()
                .any(|(row, _)| wire_text_at(&restored, row).contains("alt-screen-only")),
            "alt-screen content leaked into the restored main screen"
        );
    }

    #[test]
    fn scrolling_into_history_reveals_older_lines() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        // Print 100 numbered lines; only the last 24 are on screen.
        for i in 0..100 {
            state.feed(format!("line{i}\r\n").as_bytes());
        }
        let bottom = WireFrame::capture(&state.term);
        let bottom_row0: String = bottom.rows_cells[0]
            .iter()
            .filter_map(|c| char::from_u32(c.ch))
            .filter(|c| *c != '\0')
            .collect();
        // Without scrolling, row 0 shows a recent line, not line0.
        assert_ne!(bottom_row0, "line0");

        // Scroll up far enough to bring the very first lines into view.
        state.scroll(100);
        let scrolled = WireFrame::capture(&state.term);
        assert!(
            scrolled.display_offset > 0,
            "scrolled history must expose a non-zero display offset"
        );
        let any_early = scrolled.rows_cells.iter().any(|row| {
            let text: String = row
                .iter()
                .filter_map(|c| char::from_u32(c.ch))
                .filter(|c| *c != '\0')
                .collect();
            text == "line0" || text == "line1"
        });
        assert!(any_early, "scrollback did not reveal the earliest lines");
    }

    #[test]
    fn scrolled_history_hides_cursor_until_bottom_reset() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        for i in 0..100 {
            state.feed(format!("line{i}\r\n").as_bytes());
        }

        let bottom = WireFrame::capture(&state.term);
        assert!(bottom.cursor_visible, "cursor should show at live bottom");

        state.scroll(100);
        let scrolled = WireFrame::capture(&state.term);
        assert!(
            GridSnapshot::capture(&state.term).display_offset > 0,
            "JSON snapshots must expose the scrolled viewport offset"
        );
        assert!(
            !scrolled.cursor_visible,
            "scrolled-back history must not render the live cursor in a historical viewport"
        );

        state.scroll_to_bottom();
        let restored = WireFrame::capture(&state.term);
        assert_eq!(restored.display_offset, 0);
        assert!(
            restored.cursor_visible,
            "bottom reset should restore the live cursor"
        );
        let restored_row0: String = restored.rows_cells[0]
            .iter()
            .filter_map(|c| char::from_u32(c.ch))
            .filter(|c| *c != '\0')
            .collect();
        assert_ne!(
            restored_row0, "line0",
            "bottom reset should leave history and return to the live screen"
        );
    }

    #[test]
    fn selection_text_extracts_across_scrolled_history_lines() {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        for i in 0..100 {
            state.feed(format!("line{i:02}\r\n").as_bytes());
        }
        state.scroll(100);
        let snapshot = GridSnapshot::capture(&state.term);
        let frame = WireFrame::capture(&state.term);
        let visible_row = frame
            .rows_cells
            .iter()
            .enumerate()
            .find_map(|(row, _)| {
                if wire_text_at(&frame, row).starts_with("line00") {
                    Some(row as i32)
                } else {
                    None
                }
            })
            .expect("line00 should be visible after scrolling to history");
        let top_row = visible_row - snapshot.display_offset as i32;
        let text = selection_text(&state.term, top_row, 0, top_row + 2, 5);
        assert_eq!(text, "line00\nline01\nline02");
    }

    #[test]
    fn dimension_change_forces_full_sync() {
        let small = {
            let mut state = TermState::new(40, 10);
            state.feed(b"x");
            WireFrame::capture(&state.term)
        };
        let big = frame("x");
        let buffer = encode_frame(&big, Some(&small));
        assert_eq!(buffer[0], MSG_FULL);
        assert_eq!(read_u16(&buffer, 15), DEFAULT_ROWS as u16);
    }
}
