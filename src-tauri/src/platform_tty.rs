use std::process::Command;

pub struct RawModeGuard;

impl RawModeGuard {
    pub fn activate() -> Option<Self> {
        set_raw_no_echo().then_some(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        restore_sane_mode();
    }
}

pub fn terminal_size() -> Option<(u16, u16)> {
    let output = Command::new("stty").arg("size").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_stty_size(&output.stdout)
}

fn set_raw_no_echo() -> bool {
    Command::new("stty")
        .args(["raw", "-echo"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn restore_sane_mode() {
    let _ = Command::new("stty").arg("sane").status();
}

fn parse_stty_size(output: &[u8]) -> Option<(u16, u16)> {
    let text = std::str::from_utf8(output).ok()?;
    let mut parts = text.split_whitespace();
    let rows = parts.next()?.parse::<u16>().ok()?;
    let cols = parts.next()?.parse::<u16>().ok()?;
    Some((cols, rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_stty_size_returns_cols_rows() {
        assert_eq!(parse_stty_size(b"24 80\n"), Some((80, 24)));
        assert_eq!(parse_stty_size(b"48 132"), Some((132, 48)));
    }

    #[test]
    fn parse_stty_size_rejects_invalid_output() {
        assert_eq!(parse_stty_size(b""), None);
        assert_eq!(parse_stty_size(b"80"), None);
        assert_eq!(parse_stty_size(b"rows cols"), None);
    }
}
