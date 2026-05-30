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

use crate::daemon::{daemon_socket_path, DaemonRequest, DaemonResponse};
use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor, Rgb};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

pub const DEFAULT_COLS: usize = 80;
pub const DEFAULT_ROWS: usize = 24;

/// Diff emit cadence: at most ~60Hz (16ms) so a fast PTY dump coalesces into one
/// frame per tick instead of flooding the IPC channel.
const EMIT_INTERVAL: Duration = Duration::from_millis(16);

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
}

impl TermState {
    fn new(cols: usize, rows: usize) -> Self {
        let dims = GridDims { cols, rows };
        let term = Term::new(Config::default(), &dims, VoidListener);
        Self {
            term,
            parser: Processor::new(),
        }
    }

    fn feed(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    fn resize(&mut self, cols: usize, rows: usize) {
        if self.term.columns() == cols && self.term.screen_lines() == rows {
            return;
        }
        self.term.resize(GridDims { cols, rows });
    }

    fn scroll(&mut self, delta: i32) {
        self.term.scroll_display(Scroll::Delta(delta));
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
}

/// Owns one headless grid per terminal session id.
pub struct GridManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

impl GridManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.get(id).cloned()
    }

    /// Idempotently stand up a grid for `id`: start feeding it daemon bytes and
    /// run the 60Hz diff emitter. Returns immediately.
    pub fn attach(&self, id: &str, cols: usize, rows: usize) -> Result<(), String> {
        {
            let mut sessions = self.sessions.lock().map_err(|_| "grid lock poisoned")?;
            if sessions.contains_key(id) {
                return Ok(());
            }
            let session = Arc::new(Session {
                state: Arc::new(RwLock::new(TermState::new(cols, rows))),
                emit: Arc::new(Mutex::new(EmitState::default())),
                stop: Arc::new(AtomicBool::new(false)),
            });
            sessions.insert(id.to_string(), Arc::clone(&session));
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
            WireFrame::capture(&state.term)
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

    /// Detach a session: stop its threads and drop its state.
    pub fn detach(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(id) {
                session.stop.store(true, Ordering::Relaxed);
            }
        }
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
    std::thread::Builder::new()
        .name(format!("vt-grid-{id}"))
        .spawn(move || {
            if let Err(error) = feed_grid_from_daemon(&feed_id, &feed_state) {
                eprintln!("vt-grid reader for {feed_id} stopped: {error}");
            }
        })
        .map_err(|error| error.to_string())?;

    let emit_state = Arc::clone(&session.state);
    let emit = Arc::clone(&session.emit);
    let stop = Arc::clone(&session.stop);
    std::thread::Builder::new()
        .name(format!("vt-emit-{id}"))
        .spawn(move || run_emitter(&emit_state, &emit, &stop))
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// 60Hz loop: capture the grid, diff against the last emitted frame, and push
/// the binary delta to every subscriber. Skips work entirely when nobody is
/// listening.
fn run_emitter(
    state: &Arc<RwLock<TermState>>,
    emit: &Arc<Mutex<EmitState>>,
    stop: &Arc<AtomicBool>,
) {
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(EMIT_INTERVAL);
        {
            let guard = match emit.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if guard.channels.is_empty() {
                continue;
            }
        }

        let frame = match state.read() {
            Ok(state) => WireFrame::capture(&state.term),
            Err(_) => return,
        };

        let mut guard = match emit.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if !frame.differs_from(guard.prev.as_ref()) {
            continue;
        }
        let bytes = encode_frame(&frame, guard.prev.as_ref());
        guard
            .channels
            .retain(|channel| channel.send(InvokeResponseBody::Raw(bytes.clone())).is_ok());
        guard.prev = Some(frame);
    }
}

/// Open a subscriber stream to the daemon for `id` and feed every chunk into the
/// VT state machine. The daemon sends a full scrollback snapshot first (which
/// replays the escape sequences and reconstructs the screen), then live deltas.
fn feed_grid_from_daemon(id: &str, state: &Arc<RwLock<TermState>>) -> Result<(), String> {
    let socket_path = daemon_socket_path();
    let mut stream = UnixStream::connect(&socket_path).map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&DaemonRequest::SubscribeSession {
        id: id.to_string(),
        subscriber_id: format!("vt-grid-{}-{id}", std::process::id()),
    })
    .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown(Shutdown::Write);

    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.is_empty() {
            continue;
        }
        let response = serde_json::from_str::<DaemonResponse>(&line)
            .map_err(|error| format!("daemon stream parse failed: {error}"))?;
        match response {
            DaemonResponse::SnapshotSession { data } | DaemonResponse::SessionData { data } => {
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
            cursor,
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            cursor_visible: mode.contains(TermMode::SHOW_CURSOR),
            cells,
        }
    }
}

fn hex((r, g, b): (u8, u8, u8)) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

const DEFAULT_FG: (u8, u8, u8) = (0xd0, 0xd0, 0xd0);
const DEFAULT_BG: (u8, u8, u8) = (0x00, 0x00, 0x00);

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
// Header (15 bytes):
//   [0]      u8   message type: 0x01 = diff, 0x02 = full sync
//   [1..3]   u16  cols
//   [3..5]   u16  rows (visible screen rows)
//   [5..7]   u16  cursor column
//   [7..9]   u16  cursor line (visible, 0-based)
//   [9..13]  u32  mode flags: bit0 = alt screen, bit1 = cursor visible
//   [13..15] u16  dirty row count
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
pub const HEADER_BYTES: usize = 15;

const MODE_ALT_SCREEN: u32 = 1 << 0;
const MODE_CURSOR_VISIBLE: u32 = 1 << 1;
const MODE_APP_CURSOR: u32 = 1 << 2;
const MODE_APP_KEYPAD: u32 = 1 << 3;
const MODE_BRACKETED_PASTE: u32 = 1 << 4;

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
    cursor_col: u16,
    cursor_line: u16,
    alt_screen: bool,
    cursor_visible: bool,
    app_cursor: bool,
    app_keypad: bool,
    bracketed_paste: bool,
    rows_cells: Vec<Vec<WireCell>>,
}

fn rgba_u32((r, g, b): (u8, u8, u8)) -> u32 {
    (u32::from(r) << 24) | (u32::from(g) << 16) | (u32::from(b) << 8) | 0xFF
}

impl WireFrame {
    fn capture(term: &Term<VoidListener>) -> Self {
        let cols = term.columns();
        let rows = term.screen_lines();
        let mode = *term.mode();
        let cursor = term.renderable_content().cursor.point;
        let grid = term.grid();
        // Visible row `r` maps to buffer line `r - display_offset` so a scrolled
        // viewport reads history (0 when not scrolled).
        let offset = grid.display_offset() as i32;

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
            cursor_col: cursor.column.0 as u16,
            cursor_line: cursor.line.0.max(0) as u16,
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            cursor_visible: mode.contains(TermMode::SHOW_CURSOR),
            app_cursor: mode.contains(TermMode::APP_CURSOR),
            app_keypad: mode.contains(TermMode::APP_KEYPAD),
            bracketed_paste: mode.contains(TermMode::BRACKETED_PASTE),
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

    let mut buffer = Vec::with_capacity(HEADER_BYTES + dirty.len() * (4 + frame.cols as usize * CELL_BYTES));
    buffer.push(if full { MSG_FULL } else { MSG_DIFF });
    push_u16(&mut buffer, frame.cols);
    push_u16(&mut buffer, frame.rows);
    push_u16(&mut buffer, frame.cursor_col);
    push_u16(&mut buffer, frame.cursor_line);
    push_u32(&mut buffer, frame.mode_flags());
    push_u16(&mut buffer, dirty.len() as u16);
    for index in dirty {
        push_row(&mut buffer, index, &frame.rows_cells[index]);
    }
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(bytes: &str) -> GridSnapshot {
        let mut state = TermState::new(DEFAULT_COLS, DEFAULT_ROWS);
        state.feed(bytes.as_bytes());
        GridSnapshot::capture(&state.term)
    }

    fn text_at(snapshot: &GridSnapshot, row: usize) -> String {
        snapshot.cells[row]
            .iter()
            .map(|cell| cell.c.as_str())
            .collect::<String>()
            .trim_end()
            .to_string()
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
        WireFrame::capture(&state.term)
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
        assert_eq!(read_u16(&buffer, 5), 2); // cursor col after "hi"
        assert_eq!(read_u16(&buffer, 7), 0); // cursor line
        // mode: cursor visible by default, no alt screen.
        assert_eq!(read_u32(&buffer, 9) & MODE_CURSOR_VISIBLE, MODE_CURSOR_VISIBLE);
        assert_eq!(read_u32(&buffer, 9) & MODE_ALT_SCREEN, 0);
        // full sync marks every row dirty.
        assert_eq!(read_u16(&buffer, 13), DEFAULT_ROWS as u16);
    }

    #[test]
    fn full_sync_first_row_carries_expected_glyphs() {
        let f = frame("\x1b[31mR\x1b[0m");
        let buffer = encode_frame(&f, None);
        // First dirty row starts right after the 15-byte header.
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
        let dirty = read_u16(&buffer, 13);
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
        assert_eq!(read_u16(&buffer, 5), 2); // cursor moved 3 -> 2
        assert_eq!(read_u16(&buffer, 13), 0); // zero dirty rows
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
    fn dimension_change_forces_full_sync() {
        let small = {
            let mut state = TermState::new(40, 10);
            state.feed(b"x");
            WireFrame::capture(&state.term)
        };
        let big = frame("x");
        let buffer = encode_frame(&big, Some(&small));
        assert_eq!(buffer[0], MSG_FULL);
        assert_eq!(read_u16(&buffer, 13), DEFAULT_ROWS as u16);
    }
}
