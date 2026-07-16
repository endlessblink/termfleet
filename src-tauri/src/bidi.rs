//! BiDi reordering for terminal rows (TC-018 increment 1).
//!
//! Pure, no-I/O helper: given the primary characters of a terminal row in
//! logical order, compute the visual column order so RTL runs (Hebrew) display
//! right-to-left while LTR runs stay left-to-right. Base direction is LTR
//! (terminal convention: the shell prompt/command stays left-anchored).
//!
//! Combining marks remain attached to their base grid cell during reordering;
//! the wire encoder and browser font shaper preserve and draw the grapheme.

use unicode_bidi::{BidiInfo, Level};

/// Paragraph base direction. Only `Ltr` is used this increment; `Rtl` is
/// reserved for a future RTL-locale mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BaseDir {
    Ltr,
}

/// Visual column ordering for one terminal row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowOrder {
    /// logical column -> visual column
    pub log_to_vis: Vec<usize>,
    /// visual column -> logical column (permutation to apply to cells)
    pub vis_to_log: Vec<usize>,
    /// true when no reordering occurred (identity) — the fast path
    pub identity: bool,
}

impl RowOrder {
    /// Identity ordering for `n` columns (visual == logical).
    fn identity(n: usize) -> Self {
        let seq: Vec<usize> = (0..n).collect();
        RowOrder {
            log_to_vis: seq.clone(),
            vis_to_log: seq,
            identity: true,
        }
    }
}

/// Compute the visual column order for a row.
///
/// `cells_text[i]` is the primary char of logical column `i`; `None` marks a
/// wide-char spacer column that rides immediately after its base. Total: never
/// panics — on any analysis failure it returns identity order.
pub fn order_row(cells_text: &[Option<char>], _base: BaseDir) -> RowOrder {
    let n = cells_text.len();
    if n == 0 {
        return RowOrder::identity(0);
    }

    // Fast path: a line with no strong right-to-left character can never be
    // reordered, so skip BiDi analysis entirely (keeps `cat`/fast-dump cheap).
    if !cells_text.iter().any(|c| c.map_or(false, is_strong_rtl)) {
        return RowOrder::identity(n);
    }

    // Group columns into display units: each `Some` char starts a group; any
    // following `None` (wide-char spacer) columns ride with that base so column
    // alignment survives reordering. A leading `None` with no base becomes its
    // own neutral group.
    struct Group {
        cols: Vec<usize>,
        char_idx: Option<usize>,
    }
    let mut groups: Vec<Group> = Vec::new();
    let mut text = String::new();
    for (col, cell) in cells_text.iter().enumerate() {
        match cell {
            Some(ch) => {
                let char_idx = text.chars().count();
                text.push(*ch);
                groups.push(Group {
                    cols: vec![col],
                    char_idx: Some(char_idx),
                });
            }
            None => match groups.last_mut() {
                Some(g) => g.cols.push(col),
                None => groups.push(Group {
                    cols: vec![col],
                    char_idx: None,
                }),
            },
        }
    }

    if text.is_empty() {
        return RowOrder::identity(n);
    }

    let info = BidiInfo::new(&text, Some(Level::ltr()));
    // Byte offset of each char, so we can place it within a visual run.
    let char_byte: Vec<usize> = text.char_indices().map(|(b, _)| b).collect();
    let nchars = char_byte.len();

    // Walk the paragraph's visual runs (already in left-to-right visual order);
    // reverse char order inside RTL runs. Result: logical char indices in
    // visual order.
    let para = &info.paragraphs[0];
    let (_run_levels, runs) = info.visual_runs(para, para.range.clone());
    let mut vis_char_order: Vec<usize> = Vec::with_capacity(nchars);
    for run in runs {
        let rtl = info.levels[run.start].is_rtl();
        let mut cis: Vec<usize> = (0..nchars)
            .filter(|&ci| char_byte[ci] >= run.start && char_byte[ci] < run.end)
            .collect();
        if rtl {
            cis.reverse();
        }
        vis_char_order.extend(cis);
    }

    // Map char index -> its group, then translate the visual char order into a
    // visual group order. Leading neutral (no-char) groups stay leftmost.
    let mut char_to_group = vec![0usize; nchars];
    for (gi, g) in groups.iter().enumerate() {
        if let Some(ci) = g.char_idx {
            char_to_group[ci] = gi;
        }
    }
    let mut vis_to_log: Vec<usize> = Vec::with_capacity(n);
    for g in &groups {
        if g.char_idx.is_none() {
            vis_to_log.extend_from_slice(&g.cols);
        }
    }
    for &ci in &vis_char_order {
        vis_to_log.extend_from_slice(&groups[char_to_group[ci]].cols);
    }
    let mut log_to_vis = vec![0usize; n];
    for (vis, &log) in vis_to_log.iter().enumerate() {
        log_to_vis[log] = vis;
    }

    let identity = vis_to_log.iter().copied().eq(0..n);
    RowOrder {
        log_to_vis,
        vis_to_log,
        identity,
    }
}

/// True for characters in the strong RTL Unicode blocks (Hebrew, Arabic and
/// friends, plus their presentation forms). A conservative pre-filter for the
/// fast path; the full BiDi algorithm still does the precise work when any of
/// these appear.
fn is_strong_rtl(c: char) -> bool {
    matches!(c as u32,
        0x0590..=0x05FF   // Hebrew
        | 0x0600..=0x06FF // Arabic
        | 0x0700..=0x074F // Syriac
        | 0x0750..=0x077F // Arabic Supplement
        | 0x0780..=0x07BF // Thaana
        | 0x07C0..=0x07FF // NKo
        | 0x0800..=0x083F // Samaritan
        | 0x08A0..=0x08FF // Arabic Extended-A
        | 0xFB1D..=0xFB4F // Hebrew presentation forms
        | 0xFB50..=0xFDFF // Arabic presentation forms-A
        | 0xFE70..=0xFEFF // Arabic presentation forms-B
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn some(s: &str) -> Vec<Option<char>> {
        s.chars().map(Some).collect()
    }

    #[test]
    fn ascii_line_is_identity_fast_path() {
        let order = order_row(&some("echo hi"), BaseDir::Ltr);
        assert!(order.identity, "an all-LTR line must be identity-ordered");
        assert_eq!(order.vis_to_log, (0..7).collect::<Vec<_>>());
        assert_eq!(order.log_to_vis, (0..7).collect::<Vec<_>>());
    }

    #[test]
    fn empty_and_whitespace_are_identity() {
        assert!(order_row(&[], BaseDir::Ltr).identity);
        let spaces = order_row(&some("   "), BaseDir::Ltr);
        assert!(spaces.identity);
        assert_eq!(spaces.vis_to_log, vec![0, 1, 2]);
    }

    #[test]
    fn mixed_ltr_rtl_keeps_english_and_reverses_hebrew() {
        // "abc שלום def": english segments stay LTR, the Hebrew run reverses,
        // and the neutral spaces resolve to the LTR base (stay in place).
        let order = order_row(&some("abc שלום def"), BaseDir::Ltr);
        assert!(!order.identity);
        assert_eq!(
            order.vis_to_log,
            vec![0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11],
            "abc + space stay; שלום reverses; space + def stay"
        );
    }

    #[test]
    fn cursor_column_maps_logical_to_visual() {
        // Same mixed line; log_to_vis is the inverse permutation.
        let order = order_row(&some("abc שלום def"), BaseDir::Ltr);
        assert_eq!(order.log_to_vis[0], 0, "'a' stays leftmost");
        assert_eq!(
            order.log_to_vis[4], 7,
            "first Hebrew char goes rightmost of its run"
        );
        assert_eq!(order.log_to_vis[9], 9, "'d' after the Hebrew block");
        // log_to_vis and vis_to_log are true inverses.
        for (log, &vis) in order.log_to_vis.iter().enumerate() {
            assert_eq!(order.vis_to_log[vis], log);
        }
    }

    #[test]
    fn wide_char_spacer_rides_with_its_base_across_rtl() {
        // '世' is a wide LTR char (cols 0-1: base + spacer), then Hebrew "של".
        let cells = vec![Some('世'), None, Some('ש'), Some('ל')];
        let order = order_row(&cells, BaseDir::Ltr);
        assert!(!order.identity);
        assert_eq!(
            order.vis_to_log,
            vec![0, 1, 3, 2],
            "wide base+spacer stay paired and leftmost; Hebrew run reverses"
        );
    }

    #[test]
    fn pure_hebrew_reverses_under_ltr_base() {
        // Logical "שלום": ש=0, ל=1, ו=2, ם=3.
        // Visually (RTL run) ש must be rightmost (col 3), ם leftmost (col 0).
        let order = order_row(&some("שלום"), BaseDir::Ltr);
        assert!(!order.identity, "an RTL run must not be identity-ordered");
        assert_eq!(
            order.vis_to_log,
            vec![3, 2, 1, 0],
            "visual columns should read the Hebrew run right-to-left"
        );
        assert_eq!(order.log_to_vis, vec![3, 2, 1, 0]);
    }
}
