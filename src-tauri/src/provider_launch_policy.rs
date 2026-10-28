//! Cooperative launch protection. Arbitrary shell programs and same-user
//! credential access require OS isolation; recognizing argv is not that boundary.
use std::path::Path;
use std::io::Write;

fn is_claude_command(command: &str) -> bool {
    for token in command.split_whitespace() {
        let token = token.trim_matches(|ch| ch == '\'' || ch == '"');
        if matches!(token, "exec" | "env" | "command" | "--") || token.contains('=') {
            continue;
        }
        return Path::new(token).file_name().is_some_and(|name| name == "claude");
    }
    false
}

pub fn check_command(command: Option<&str>, root: &Path) -> Result<(), String> {
    if !command.is_some_and(is_claude_command) { return Ok(()); }
    let audit = || -> std::io::Result<()> {
        use std::os::unix::fs::OpenOptionsExt;
        let dir = root.join("provider-policy");
        std::fs::create_dir_all(&dir)?;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).mode(0o600)
            .open(dir.join("audit.jsonl"))?;
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(std::io::Error::other)?.as_millis();
        let entry = serde_json::json!({"version":1,"at":at as u64,"provider":"claude",
            "outcome":"denied","reason":"owner-approval-required","surface":"daemon-spawn",
            "pid":std::process::id(),"standingRule":"owner-approval-required"});
        file.write_all(format!("{entry}\n").as_bytes())?;
        file.sync_all()?;
        std::fs::File::open(&dir)?.sync_all()?;
        std::fs::File::open(root)?.sync_all()
    };
    let reason = if audit().is_ok() { "owner-approval-required" } else { "audit-unavailable" };
    Err(format!("Claude launch denied: {reason}. Existing sessions are preserved; agent flags are not owner approval."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_claude_launch_and_resume_forms_are_recognized() {
        for command in ["claude", "claude --resume abc", "exec claude --resume abc",
            "/opt/claude --model sonnet", "'/opt/claude' --resume abc", "env X=1 claude"] {
            assert!(is_claude_command(command), "{command}");
        }
        for command in ["codex exec 'use claude'", "bash", "echo claude", "opencode"] {
            assert!(!is_claude_command(command), "{command}");
        }
    }
    #[test]
    fn denial_is_audited_and_non_claude_needs_no_storage() {
        let root = std::env::temp_dir().join(format!("tf-provider-policy-{}", uuid::Uuid::new_v4()));
        check_command(Some("codex"), &root).unwrap();
        assert!(!root.exists());
        assert!(check_command(Some("claude --resume abc"), &root).unwrap_err().contains("Claude launch denied"));
        let audit = std::fs::read_to_string(root.join("provider-policy/audit.jsonl")).unwrap();
        assert!(audit.contains("daemon-spawn"));
        assert!(!audit.contains("abc"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
