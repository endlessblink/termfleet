use std::path::PathBuf;

const SOCKET_DIR_NAME: &str = "terminal-workspace";
const SOCKET_FILE_NAME: &str = "daemon.sock";

pub fn daemon_socket_path() -> PathBuf {
    runtime_dir().join(SOCKET_DIR_NAME).join(SOCKET_FILE_NAME)
}

pub fn latency_trace_path(pid: u32, thread_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "terminal-workspace-latency-trace-{pid}-{thread_id}.jsonl"
    ))
}

pub fn pty_trace_path() -> PathBuf {
    std::env::var_os("TERMINAL_WORKSPACE_TRACE_PTY_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("terminal-workspace-pty-trace.log"))
}

pub fn runtime_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::runtime_dir())
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_socket_path_uses_terminal_workspace_dir() {
        let socket_path = daemon_socket_path();
        assert_eq!(
            socket_path.file_name().and_then(|name| name.to_str()),
            Some("daemon.sock")
        );
        assert_eq!(
            socket_path
                .parent()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str()),
            Some("terminal-workspace")
        );
    }

    #[test]
    fn latency_trace_path_keeps_linux_temp_file_shape() {
        let path = latency_trace_path(1234, "ThreadId7");
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("terminal-workspace-latency-trace-1234-ThreadId7.jsonl")
        );
        assert_eq!(path.parent(), Some(std::env::temp_dir().as_path()));
    }

    #[test]
    fn pty_trace_path_uses_env_override_or_temp_default() {
        std::env::remove_var("TERMINAL_WORKSPACE_TRACE_PTY_FILE");
        let default_path = pty_trace_path();
        assert_eq!(
            default_path.file_name().and_then(|name| name.to_str()),
            Some("terminal-workspace-pty-trace.log")
        );
        assert_eq!(default_path.parent(), Some(std::env::temp_dir().as_path()));

        let override_path = std::env::temp_dir().join("termfleet-custom-pty-trace.log");
        std::env::set_var("TERMINAL_WORKSPACE_TRACE_PTY_FILE", &override_path);
        assert_eq!(pty_trace_path(), override_path);
        std::env::remove_var("TERMINAL_WORKSPACE_TRACE_PTY_FILE");
    }
}
