//! Claim a queued request once across multiple desktop pollers. A claim left by
//! interruption is retained for diagnosis; it is never silently re-executed.
use std::{fs, path::Path};

pub fn take(path: &Path, max_bytes: u64) -> Option<String> {
    let claimed = path.with_extension("claimed");
    // Both windows may list the same path. Only one can create the claim link; an interrupted claim cannot be overwritten.
    fs::hard_link(path, &claimed).ok()?;
    let _ = fs::remove_file(path);
    let small = fs::metadata(&claimed)
        .map(|m| m.len() <= max_bytes)
        .unwrap_or(false);
    let text = if small {
        fs::read_to_string(&claimed).ok()
    } else {
        None
    };
    let _ = fs::remove_file(claimed);
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tf-claim-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("fixture.request.json")
    }
    #[test]
    fn concurrent_windows_take_exactly_once() {
        let path = fixture("concurrent");
        fs::write(&path, "generation A").unwrap();
        let barrier = Arc::new(Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let p = path.clone();
                let b = barrier.clone();
                std::thread::spawn(move || {
                    b.wait();
                    take(&p, 1024)
                })
            })
            .collect();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| r.is_some()).count(), 1);
        assert!(results.iter().flatten().all(|s| s == "generation A"));
        assert_eq!(take(&path, 1024), None);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn interrupted_claim_is_not_replayed() {
        let path = fixture("interrupted");
        fs::write(
            path.with_extension("claimed"),
            "retained interrupted generation",
        )
        .unwrap();
        assert_eq!(take(&path, 1024), None);
        fs::write(&path, "same request id retried").unwrap();
        assert_eq!(take(&path, 1024), None);
        assert_eq!(
            fs::read_to_string(path.with_extension("claimed")).unwrap(),
            "retained interrupted generation"
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn oversized_or_unreadable_requests_do_not_wedge_the_queue() {
        let path = fixture("large");
        fs::write(&path, "oversize").unwrap();
        assert_eq!(take(&path, 1), None);
        assert!(!path.exists());
        fs::write(&path, [255, 254]).unwrap();
        assert_eq!(take(&path, 1024), None);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
