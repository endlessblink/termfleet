use std::path::PathBuf;

const SOCKET_DIR_NAME: &str = "terminal-workspace";
const SOCKET_FILE_NAME: &str = "daemon.sock";

pub fn daemon_socket_path() -> PathBuf {
    runtime_dir().join(SOCKET_DIR_NAME).join(SOCKET_FILE_NAME)
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
}
