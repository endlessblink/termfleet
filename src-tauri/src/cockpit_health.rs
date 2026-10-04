//! Content-free desktop heartbeat and independent single-flight IO guards.
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct SingleFlight(AtomicBool);
impl SingleFlight {
    pub const fn new() -> Self {
        Self(AtomicBool::new(false))
    }
    pub fn try_acquire(&self) -> Option<Permit<'_>> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Permit(self))
    }
}
pub struct Permit<'a>(&'a SingleFlight);
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0 .0.store(false, Ordering::Release);
    }
}
pub static SNAPSHOT_WRITER: SingleFlight = SingleFlight::new();
pub static HEARTBEAT_WRITER: SingleFlight = SingleFlight::new();

pub fn write_heartbeat(runtime: &Path, pid: u32) -> io::Result<PathBuf> {
    let root = runtime.join("termfleet");
    fs::create_dir_all(&root)?;
    #[cfg(unix)]
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    let path = root.join(format!("cockpit-heartbeat-{pid}"));
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    let result = (|| {
        let mut file = options.open(&temporary)?;
        writeln!(file, "{pid}")?;
        fs::rename(&temporary, &path)?;
        Ok(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_stall_cannot_block_heartbeat_or_spawn_more_snapshot_jobs() {
        let snapshot = SingleFlight::new();
        let heartbeat = SingleFlight::new();
        let stalled_write = snapshot.try_acquire().unwrap();
        for _ in 0..100 {
            assert!(snapshot.try_acquire().is_none());
            assert!(heartbeat.try_acquire().is_some());
        }
        drop(stalled_write);
        assert!(snapshot.try_acquire().is_some());
    }
    #[test]
    fn heartbeat_is_atomic_private_content_free_and_per_desktop() {
        let root = std::env::temp_dir().join(format!(
            "tf-heartbeat-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let a = write_heartbeat(&root, 123).unwrap();
        let b = write_heartbeat(&root, 124).unwrap();
        assert_ne!(a, b);
        assert_eq!(fs::read_to_string(&a).unwrap(), "123\n");
        write_heartbeat(&root, 123).unwrap();
        assert_eq!(fs::read_dir(root.join("termfleet")).unwrap().count(), 2);
        #[cfg(unix)]
        {
            assert_eq!(
                fs::metadata(&a).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(root.join("termfleet"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
