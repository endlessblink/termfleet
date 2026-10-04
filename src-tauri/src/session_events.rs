//! Event-driven journal-head notifications. The watcher owns no PTY and never
//! restarts or inspects an agent. Consumers validate the complete snapshot binding.
use std::sync::OnceLock;
use tauri::Emitter;

pub fn valid_head_name(name: &str) -> bool {
    name.strip_prefix("events-")
        .and_then(|value| value.strip_suffix(".json"))
        .is_some_and(|hash| hash.len() == 8 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[tauri::command]
pub fn agent_status_events_watch(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        static STARTED: OnceLock<()> = OnceLock::new();
        if STARTED.get().is_some() { return Ok(()); }
        let dir = dirs::data_dir().ok_or("user data directory unavailable")?
            .join("terminal-workspace").join("agent-status");
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let path = std::ffi::CString::new(dir.as_os_str().as_encoded_bytes())
            .map_err(|error| error.to_string())?;
        let fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) };
        if fd < 0 { return Err(std::io::Error::last_os_error().to_string()); }
        let watch = unsafe { libc::inotify_add_watch(fd, path.as_ptr(), libc::IN_MOVED_TO | libc::IN_CLOSE_WRITE) };
        if watch < 0 {
            unsafe { libc::close(fd); }
            return Err(std::io::Error::last_os_error().to_string());
        }
        // Concurrent callers can create only one long-lived watcher.
        if STARTED.set(()).is_err() { unsafe { libc::close(fd); } return Ok(()); }
        std::thread::spawn(move || {
            let mut bytes = [0_u8; 16 * 1024];
            loop {
                let mut poll = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
                let ready = unsafe { libc::poll(&mut poll, 1, 1000) };
                if ready < 0 {
                    if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted { continue; }
                    break;
                }
                if ready == 0 { continue; }
                let count = unsafe { libc::read(fd, bytes.as_mut_ptr().cast(), bytes.len()) };
                if count <= 0 { continue; }
                let mut offset = 0;
                while offset + std::mem::size_of::<libc::inotify_event>() <= count as usize {
                    let event = unsafe { std::ptr::read_unaligned(bytes.as_ptr().add(offset).cast::<libc::inotify_event>()) };
                    let start = offset + std::mem::size_of::<libc::inotify_event>();
                    let end = start + event.len as usize;
                    if end > count as usize { break; }
                    let name = bytes[start..end].split(|byte| *byte == 0).next().unwrap_or_default();
                    if event.mask & libc::IN_Q_OVERFLOW != 0 {
                        let _ = app.emit("termfleet:session-event-head", "rescan");
                    } else if let Ok(name) = std::str::from_utf8(name) {
                        if valid_head_name(name) { let _ = app.emit("termfleet:session-event-head", name); }
                    }
                    offset = end;
                }
            }
            unsafe { libc::close(fd); }
        });
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = app; Err("event journal watcher requires Linux".into()) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn head_names_exclude_paths_journals_and_temporary_files() {
        assert!(super::valid_head_name("events-a0f312be.json"));
        for name in ["../events-a0f312be.json", "events-aa.json", "events-a0f312be.json.tmp", "events-a0f312be-run.jsonl", "pane-a0f312be.json"] {
            assert!(!super::valid_head_name(name));
        }
    }
}
