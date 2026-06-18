use std::io;
use std::path::Path;

pub type LocalListener = std::os::unix::net::UnixListener;
pub type LocalStream = std::os::unix::net::UnixStream;

pub fn connect(path: &Path) -> io::Result<LocalStream> {
    LocalStream::connect(path)
}

pub fn bind(path: &Path) -> io::Result<LocalListener> {
    LocalListener::bind(path)
}
