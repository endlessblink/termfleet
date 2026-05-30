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
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor, Rgb};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex, RwLock};

pub const DEFAULT_COLS: usize = 80;
pub const DEFAULT_ROWS: usize = 24;

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

    // Used by TC-017e (resize/reflow); wired now so the grid owns sizing.
    #[allow(dead_code)]
    fn resize(&mut self, cols: usize, rows: usize) {
        if self.term.columns() == cols && self.term.screen_lines() == rows {
            return;
        }
        self.term.resize(GridDims { cols, rows });
    }
}

/// Owns one headless grid per terminal session id.
pub struct GridManager {
    grids: Mutex<HashMap<String, Arc<RwLock<TermState>>>>,
}

impl GridManager {
    pub fn new() -> Self {
        Self {
            grids: Mutex::new(HashMap::new()),
        }
    }

    /// Idempotently stand up a grid for `id` and start feeding it daemon bytes.
    /// Returns immediately; the background reader thread keeps the grid current.
    pub fn attach(&self, id: &str, cols: usize, rows: usize) -> Result<(), String> {
        {
            let grids = self.grids.lock().map_err(|_| "grid lock poisoned")?;
            if grids.contains_key(id) {
                return Ok(());
            }
        }

        let state = Arc::new(RwLock::new(TermState::new(cols, rows)));
        {
            let mut grids = self.grids.lock().map_err(|_| "grid lock poisoned")?;
            // Re-check under the lock to avoid racing two attaches.
            if grids.contains_key(id) {
                return Ok(());
            }
            grids.insert(id.to_string(), Arc::clone(&state));
        }

        let id_owned = id.to_string();
        std::thread::Builder::new()
            .name(format!("vt-grid-{id}"))
            .spawn(move || {
                if let Err(error) = feed_grid_from_daemon(&id_owned, &state) {
                    eprintln!("vt-grid reader for {id_owned} stopped: {error}");
                }
            })
            .map_err(|error| error.to_string())?;

        Ok(())
    }

    /// Serialize the current visible grid for `id` to JSON.
    pub fn snapshot(&self, id: &str) -> Result<String, String> {
        let state = {
            let grids = self.grids.lock().map_err(|_| "grid lock poisoned")?;
            grids
                .get(id)
                .cloned()
                .ok_or_else(|| format!("no grid attached for session {id}"))?
        };
        let state = state.read().map_err(|_| "grid state poisoned")?;
        let snapshot = GridSnapshot::capture(&state.term);
        serde_json::to_string(&snapshot).map_err(|error| error.to_string())
    }

    /// Detach a session's grid (stops serving snapshots; the reader thread exits
    /// when the daemon stream closes).
    pub fn detach(&self, id: &str) {
        if let Ok(mut grids) = self.grids.lock() {
            grids.remove(id);
        }
    }
}

impl Default for GridManager {
    fn default() -> Self {
        Self::new()
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
        let mut cells = Vec::with_capacity(rows);
        for row in 0..rows {
            let line = &grid[Line(row as i32)];
            let mut row_cells = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &line[Column(col)];
                let flags = cell.flags;
                if flags.contains(Flags::WIDE_CHAR_SPACER) {
                    // The spacer trails a wide char; skip so columns stay aligned
                    // with the canvas advance (char_width * 2).
                    continue;
                }
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
}
