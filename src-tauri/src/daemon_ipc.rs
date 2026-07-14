use std::io;
use std::path::Path;

pub type LocalListener = std::os::unix::net::UnixListener;
pub type LocalStream = std::os::unix::net::UnixStream;

pub fn connect(path: &Path) -> io::Result<LocalStream> {
    LocalStream::connect(path)
}

pub fn bind(path: &Path) -> io::Result<LocalListener> {
    let listener = LocalListener::bind(path)?;
    // Restrict the socket inode itself to the owner. The 0700 parent dir is the
    // primary access guard (see daemon::prepare_socket_dir), but tightening the
    // socket file too removes the reliance on any single layer.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Reject a client connection whose peer uid differs from the daemon's own uid.
///
/// The socket lives in a 0700 user-owned directory, so cross-user access is
/// already blocked on a normal system; this is defense-in-depth so that a single
/// permission slip (or an unexpected socket location) can't hand another local
/// user control of the PTYs. Fails closed on any error.
///
/// Linux uses `SO_PEERCRED`; the macOS port (TC-023) will use `getpeereid` here
/// behind the same seam. Non-Linux builds currently allow (same-user assumption)
/// until that port lands.
#[cfg(target_os = "linux")]
pub fn peer_is_authorized(stream: &LocalStream) -> bool {
    use std::os::unix::io::AsRawFd;

    let fd = stream.as_raw_fd();
    let mut cred = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: getsockopt writes at most `len` bytes into `cred`, which is sized
    // exactly to `libc::ucred`; `len` is updated in place.
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut libc::ucred as *mut libc::c_void,
            &mut len,
        )
    };
    if rc != 0 || len as usize != std::mem::size_of::<libc::ucred>() {
        return false;
    }
    // SAFETY: geteuid is always successful and takes no arguments.
    let self_uid = unsafe { libc::geteuid() };
    cred.uid == self_uid
}

#[cfg(not(target_os = "linux"))]
pub fn peer_is_authorized(_stream: &LocalStream) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn bind_restricts_socket_inode_to_owner() {
        let dir = std::env::temp_dir().join(format!("tf-ipc-bind-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("daemon.sock");
        let _listener = bind(&sock).unwrap();

        let mode = std::fs::metadata(&sock).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "socket inode must be owner-only");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn peer_from_same_process_is_authorized() {
        let dir = std::env::temp_dir().join(format!("tf-ipc-peer-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("daemon.sock");
        let listener = bind(&sock).unwrap();
        let _client = connect(&sock).unwrap();
        let (server_side, _addr) = listener.accept().unwrap();

        assert!(
            peer_is_authorized(&server_side),
            "a connection from our own uid must be authorized"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
