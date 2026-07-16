//! Find-in-buffer search over terminal grid lines.
//!
//! The pure matching core (`find_in_lines`) is independent of the VT grid so it
//! can be unit-tested in isolation; `vt_grid` supplies the line text drawn from
//! the alacritty history buffer.

/// One match location, in buffer coordinates.
/// `line` is the grid line index (negative = scrollback history); `col` is the
/// starting column; `len` is the match length in columns.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Match {
    pub line: i32,
    pub col: usize,
    pub len: usize,
}

/// Find every non-overlapping occurrence of `query` across the given lines.
/// `lines` pairs a grid line index with that line's text. Case-insensitive
/// unless `case_sensitive`. Empty query yields no matches.
pub fn find_in_lines(lines: &[(i32, String)], query: &str, case_sensitive: bool) -> Vec<Match> {
    if query.is_empty() {
        return Vec::new();
    }
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let needle_cols = query.chars().count();

    let mut matches = Vec::new();
    for (line, text) in lines {
        let haystack = if case_sensitive {
            text.clone()
        } else {
            text.to_lowercase()
        };
        let mut from = 0;
        while let Some(rel) = haystack[from..].find(&needle) {
            let byte = from + rel;
            let col = haystack[..byte].chars().count();
            matches.push(Match {
                line: *line,
                col,
                len: needle_cols,
            });
            // Advance past this match (non-overlapping); guard against a
            // zero-length needle (already excluded) to avoid an infinite loop.
            from = byte + needle.len().max(1);
        }
    }
    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_single_match_with_correct_column() {
        let lines = vec![(0, "hello world".to_string())];
        let hits = find_in_lines(&lines, "world", false);
        assert_eq!(
            hits,
            vec![Match {
                line: 0,
                col: 6,
                len: 5
            }]
        );
    }

    #[test]
    fn is_case_insensitive_by_default() {
        let lines = vec![(0, "Hello World".to_string())];
        let hits = find_in_lines(&lines, "world", false);
        assert_eq!(
            hits,
            vec![Match {
                line: 0,
                col: 6,
                len: 5
            }]
        );
    }

    #[test]
    fn case_sensitive_excludes_mismatched_case() {
        let lines = vec![(0, "Hello World".to_string())];
        assert!(find_in_lines(&lines, "world", true).is_empty());
        assert_eq!(
            find_in_lines(&lines, "World", true),
            vec![Match {
                line: 0,
                col: 6,
                len: 5
            }]
        );
    }

    #[test]
    fn finds_multiple_non_overlapping_matches_in_one_line() {
        let lines = vec![(0, "ababab".to_string())];
        let hits = find_in_lines(&lines, "ab", false);
        assert_eq!(
            hits,
            vec![
                Match {
                    line: 0,
                    col: 0,
                    len: 2
                },
                Match {
                    line: 0,
                    col: 2,
                    len: 2
                },
                Match {
                    line: 0,
                    col: 4,
                    len: 2
                },
            ]
        );
    }

    #[test]
    fn reports_matches_across_lines_with_history_indices() {
        let lines = vec![
            (-2, "error: not found".to_string()),
            (-1, "ok".to_string()),
            (0, "another error here".to_string()),
        ];
        let hits = find_in_lines(&lines, "error", false);
        assert_eq!(
            hits,
            vec![
                Match {
                    line: -2,
                    col: 0,
                    len: 5
                },
                Match {
                    line: 0,
                    col: 8,
                    len: 5
                },
            ]
        );
    }

    #[test]
    fn finds_hebrew_substring_by_column() {
        // Hebrew has no case; column is char index within the (logical) line.
        let lines = vec![(0, "שלום עולם".to_string())];
        let hits = find_in_lines(&lines, "עולם", false);
        assert_eq!(
            hits,
            vec![Match {
                line: 0,
                col: 5,
                len: 4
            }]
        );
    }

    #[test]
    fn empty_query_and_no_match_return_nothing() {
        let lines = vec![(0, "hello".to_string())];
        assert!(find_in_lines(&lines, "", false).is_empty());
        assert!(find_in_lines(&lines, "zzz", false).is_empty());
    }
}
