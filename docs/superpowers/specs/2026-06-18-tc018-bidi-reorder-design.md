# TC-018 Increment 1 — BiDi Reorder (RTL display) — Design

**Date:** 2026-06-18
**Task:** TC-018 (MASTER_PLAN.md:1797), first increment only.
**Branch / worktree:** `tc-018-bidi-rtl` at `devops/termfleet-wt-tc018` (off `origin/main`).

## Context / why

The headless-VT + Canvas2D renderer (TC-017, shipped default) draws strictly
left-to-right, one cell per column, from the alacritty *logical* grid. Hebrew
therefore renders **reversed** and mixed Hebrew/English lines are garbled. This
is the disqualifying blocker for a Hebrew-working daily driver.

This design originally scoped **BiDi reordering only** (TC-018 Stages 1–2). After it,
Hebrew runs read right-to-left, mixed lines order correctly, and the cursor
lands on the right visual column. **Out of scope this increment:** `rustybuzz`
shaping and nikud/combining-mark stacking (TC-018 Stages 3–5) — those are the
fast-follow. The cell model, binary IPC payload, and canvas renderer are
**unchanged**; React keeps receiving a plain visual-coordinate grid. The
2026-07-17 consolidation completed the fast-follow as described below.

## Architecture

One new pure, isolated Rust module + a shared row-ordering helper so the two
existing capture paths stay consistent.

### New module: `src-tauri/src/bidi.rs` (pure, no I/O, no alacritty types)

```
/// Visual column order for one terminal row.
/// `cells_text[i]` is the primary char of logical column `i`
/// (wide-char spacer columns carry None and ride with their base).
pub struct RowOrder {
    /// logical column -> visual column
    pub log_to_vis: Vec<usize>,
    /// visual column -> logical column (the permutation to apply to cells)
    pub vis_to_log: Vec<usize>,
    /// true when no reordering happened (identity) — fast path
    pub identity: bool,
}

pub enum BaseDir { Ltr }   // terminal convention; Rtl reserved for later

/// Total function: never panics. On any analysis failure returns identity.
pub fn order_row(cells_text: &[Option<char>], base: BaseDir) -> RowOrder;
```

- **Fast path:** if no char has a strong-RTL bidi class, return identity
  (`vis_to_log = 0..n`, `identity = true`) without invoking `unicode-bidi`.
  Protects `cat`/fast-dump performance (MASTER_PLAN risk #1).
- **Reorder:** build the line string from `Some(char)` columns (skip wide
  spacers), run `unicode_bidi::BidiInfo::new(&s, Some(LTR base level))`, take the
  paragraph's `visual_runs`/reordered indices, and translate char positions back
  to **columns** (wide spacers travel immediately after their base in visual
  order so column alignment holds).
- Base direction is **LTR** (explicit base level, not auto-detect): the shell
  prompt/command stays left-anchored; RTL runs reverse within. `BaseDir::Rtl`
  is defined but unused this increment.

### Shared helper in `vt_grid.rs`

Both `GridSnapshot::capture` (vt_grid.rs:396) and `WireFrame::capture`
(vt_grid.rs:633) currently iterate `grid[Line(row - offset)]` columns
independently. Extract:

```
fn ordered_row_indices(line: &Row<Cell>, cols: usize) -> bidi::RowOrder
```

which collects the per-column primary chars and calls `bidi::order_row`. Each
capture path then emits cells in `vis_to_log` order instead of `0..cols`. The
cursor — on the cursor's line only — is remapped via `log_to_vis[cursor.col]`
(clamped). Non-cursor lines need only the permutation. Per-row results may be
cached on `TermState` keyed by line content + offset to avoid recomputing
unchanged lines (optimization, can land after correctness).

### Data flow

`PTY → alacritty logical grid → ordered_row_indices (bidi::order_row) → visual
cell order in BOTH capture paths → existing JSON/binary IPC → canvas (unchanged)`.

## Dependencies

Add to `src-tauri/Cargo.toml`: `unicode-bidi = "0.3"`. No frontend deps.

## Error handling

`order_row` is total: any internal failure (e.g. unexpected run structure)
returns identity order, degrading to today's LTR behavior — never a panic, never
a crash in the render thread.

## Testing (TDD — unit tests first, all pure Rust)

`bidi.rs` `#[cfg(test)]`:
1. ASCII / no-RTL line → `identity == true`, `vis_to_log == 0..n` (fast path).
2. Pure Hebrew `שלום` → first logical char ends rightmost (highest visual col),
   last ends leftmost.
3. Mixed `abc שלום def` → `abc` and `def` keep LTR order; Hebrew run reversed;
   run boundaries correct.
4. Cursor remap: `log_to_vis` maps a mid-line logical column to the expected
   visual column for a mixed line.
5. Wide-char column adjacent to an RTL run keeps its spacer aligned.
6. Empty line / all-spaces → identity.

`vt_grid.rs` integration test (extends existing live-grid tests):
7. Real PTY `printf 'שלום'`; assert the captured snapshot row is visually
   ordered (ש at the higher column), ASCII line unaffected in the same session.

A passing run requires `cargo test` green and existing vt_grid tests unbroken.

## Acceptance

- `echo "שלום"` shows `ש` rightmost, `ם` leftmost (Stage 2 verify).
- Mixed Hebrew/English command lines read correctly; cursor visually correct.
- ASCII output byte-identical to pre-change (regression-safe).
- No measurable perf regression on non-RTL lines (fast path / identity).
- Both JSON snapshot and binary diff paths produce the same visual order.

## 2026-07-17 implementation addendum

The completed implementation uses alacritty's existing zero-width mark storage
and Canvas2D's native font shaping instead of adding `rustybuzz` and a second
glyph atlas. Each 34-byte wire cell carries one base codepoint and up to four
combining codepoints, followed by its colors and style. The frontend reconstructs
one grapheme string per terminal cell, so Hebrew nikud stays attached without
consuming columns. The decoder accepts legacy 14-byte frames during rolling
restarts. Rust and Chromium regressions cover visual ordering, cursor mapping,
wire decoding, and `שָׁלוֹם` occupying exactly four cells.
