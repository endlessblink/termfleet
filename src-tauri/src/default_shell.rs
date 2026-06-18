pub fn shell_command(command: Option<String>) -> String {
    command.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "bash".into()))
}

pub fn login_shell_command() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "sh".into())
}

pub fn is_inline_shell_command(command: &str) -> bool {
    command.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_command_wins() {
        assert_eq!(
            shell_command(Some("zellij attach main".to_string())),
            "zellij attach main"
        );
    }

    #[test]
    fn whitespace_marks_inline_shell_command() {
        assert!(!is_inline_shell_command("bash"));
        assert!(is_inline_shell_command("echo bridge-ready"));
    }
}
