//! Native lifecycle collection. A verified daemon-owned provider process is
//! pinned with pidfd + birth identity. Poll readiness is exit evidence; a missing
//! process scan, keypress or transport error is never completion evidence.
#[cfg(target_os = "linux")]
mod linux {
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        io::Write,
        os::fd::{AsRawFd, FromRawFd, OwnedFd},
        path::PathBuf,
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex, OnceLock,
        },
        time::{SystemTime, UNIX_EPOCH},
    };
    use tauri::Manager;
    struct Entry {
        binding: Value,
        active: Arc<AtomicBool>,
        sender: mpsc::Sender<Value>,
    }
    static OBSERVERS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    fn registry() -> &'static Mutex<HashMap<String, Entry>> {
        OBSERVERS.get_or_init(|| Mutex::new(HashMap::new()))
    }
    fn at() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    pub(super) fn birth(stat: &str) -> Option<u64> {
        stat.rsplit_once(") ")?
            .1
            .split_whitespace()
            .nth(19)?
            .parse()
            .ok()
    }
    pub(super) fn capture(pid: u32) -> Result<(OwnedFd, String, u64), String> {
        let read = || {
            std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| birth(&stat))
        };
        let before = read().ok_or("process birth identity unavailable")?;
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as i32;
        if fd < 0 {
            return Err(format!(
                "pidfd unavailable: {}",
                std::io::Error::last_os_error()
            ));
        }
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        if read() != Some(before) {
            return Err("process lifetime changed during capture".into());
        }
        let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|e| e.to_string())?;
        let boot_s = std::fs::read_to_string("/proc/stat")
            .map_err(|e| e.to_string())?
            .lines()
            .find_map(|line| {
                line.strip_prefix("btime ")
                    .and_then(|s| s.parse::<u64>().ok())
            })
            .ok_or("boot time unavailable")?;
        let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        if ticks <= 0 {
            return Err("process clock unavailable".into());
        }
        Ok((
            fd,
            format!("pid-{pid}-{before}-{}", boot.trim()),
            boot_s * 1000 + before * 1000 / ticks as u64,
        ))
    }
    fn script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let resource = app
            .path()
            .resolve(
                "agent-hooks/termfleet-session-observation.mjs",
                tauri::path::BaseDirectory::Resource,
            )
            .ok()
            .filter(|p| p.is_file());
        resource
            .or_else(|| {
                let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../scripts/termfleet-session-observation.mjs");
                p.is_file().then_some(p)
            })
            .ok_or("native event publisher missing".into())
    }
    fn publish(
        script: &PathBuf,
        provider: &str,
        identity: &Value,
        seq: u64,
        token: &str,
        mut event: Value,
    ) -> Result<Value, String> {
        let object = event.as_object_mut().ok_or("invalid event")?;
        object.insert("identity".into(), identity.clone());
        object.insert("observer".into(), json!("linux-pidfd"));
        object.insert("seq".into(), json!(seq));
        object.insert("processToken".into(), json!(token));
        let packet = json!({"provider":provider,"observation":event});
        let mut child = Command::new("node")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or("publisher stdin unavailable")?
            .write_all(packet.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
        let result = child.wait_with_output().map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err("native event was not acknowledged by journal".into());
        }
        serde_json::from_slice(&result.stdout).map_err(|e| e.to_string())
    }
    pub(super) fn bind(
        app: tauri::AppHandle,
        file_name: String,
        pty_id: String,
    ) -> Result<bool, String> {
        if !crate::session_events::valid_head_name(&file_name) {
            return Err("invalid event head name".into());
        }
        let dir = dirs::data_dir()
            .ok_or("data directory unavailable")?
            .join("terminal-workspace/agent-status");
        let head: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join(&file_name)).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let identity = head["identity"].clone();
        if head["version"] != 2
            || identity != head["state"]["identity"]
            || head["state"]["ended"] == true
        {
            return Ok(false);
        }
        let pane = identity["paneId"].as_str().ok_or("pane binding missing")?;
        let hash = pane
            .encode_utf16()
            .fold(2166136261u32, |h, c| (h ^ c as u32).wrapping_mul(16777619));
        if file_name != format!("events-{hash:08x}.json") {
            return Err("event head pane mismatch".into());
        }
        let provider = head["provider"]
            .as_str()
            .ok_or("provider missing")?
            .to_string();
        let session = identity["sessionId"]
            .as_str()
            .ok_or("conversation missing")?;
        let mut entries = registry()
            .lock()
            .map_err(|_| "observer registry unavailable")?;
        if entries
            .get(&pty_id)
            .is_some_and(|entry| entry.binding == identity && entry.active.load(Ordering::Acquire))
        {
            return Ok(true);
        }
        let Some(pid) = crate::commands::session_observer_pid(&pty_id, &provider, session, pane)
        else {
            return Ok(false);
        };
        let (fd, token, born_at) = capture(pid)?;
        if head["state"]["lastEventAt"]
            .as_u64()
            .is_none_or(|reported| reported < born_at)
        {
            return Ok(false);
        }
        let script = script(&app)?;
        let (sender, receiver) = mpsc::channel();
        let active = Arc::new(AtomicBool::new(true));
        if let Some(previous) = entries.insert(
            pty_id.clone(),
            Entry {
                binding: identity.clone(),
                active: active.clone(),
                sender,
            },
        ) {
            previous.active.store(false, Ordering::Release);
        }
        drop(entries);
        let mut seq = head["state"]["observationSeq"]["linux-pidfd"]
            .as_u64()
            .unwrap_or(0);
        let mut rollout = if provider == "codex" {
            crate::agent_lifecycle::bound_rollout(pid, session)
        } else {
            None
        };
        std::thread::spawn(move || {
            let mut identity = identity;
            let mut intent: Option<(String, u64)> = None;
            let mut aborted_at = 0;
            let mut abort_modified = None;
            let send = |event: Value, seq: &mut u64, identity: &mut Value| -> bool {
                *seq += 1;
                match publish(&script, &provider, identity, *seq, &token, event) {
                    Ok(reply) => {
                        *identity = reply["identity"].clone();
                        if let Ok(mut entries) = registry().lock() {
                            if let Some(entry) = entries.get_mut(&pty_id) {
                                if Arc::ptr_eq(&entry.active, &active) {
                                    entry.binding = identity.clone();
                                }
                            }
                        }
                        true
                    }
                    Err(error) => {
                        eprintln!("termfleet native observer: {error}");
                        false
                    }
                }
            };
            if !send(
                json!({"type":"agent.started","at":at()}),
                &mut seq,
                &mut identity,
            ) {
                active.store(false, Ordering::Release);
                return;
            }
            while active.load(Ordering::Acquire) {
                for mut event in receiver.try_iter() {
                    if let Some(captured) = event
                        .as_object_mut()
                        .and_then(|o| o.remove("capturedIdentity"))
                    {
                        if captured != identity {
                            continue;
                        }
                    }
                    if event["type"] == "interruption.intent" {
                        intent = Some((
                            event["intentId"].as_str().unwrap_or_default().to_string(),
                            event["at"].as_u64().unwrap_or(0),
                        ));
                    }
                    if !send(event, &mut seq, &mut identity) {
                        active.store(false, Ordering::Release);
                        break;
                    }
                }
                // SessionStart can precede opening the rollout. Resolve lazily
                // on input, only while the captured process birth still matches.
                if provider == "codex"
                    && rollout.is_none()
                    && intent.is_some()
                    && capture(pid).is_ok_and(|(_, current, _)| current == token)
                {
                    rollout = crate::agent_lifecycle::bound_rollout(
                        pid,
                        identity["sessionId"].as_str().unwrap_or_default(),
                    );
                }
                if let (Some(path), Some((id, since))) = (&rollout, &intent) {
                    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
                    if modified != abort_modified {
                        abort_modified = modified;
                        if let Some(observed) =
                            crate::agent_lifecycle::rollout_abort_after(path, *since)
                        {
                            if observed > aborted_at {
                                aborted_at = observed;
                                let id = id.clone();
                                if !send(
                                    json!({"type":"interruption.observed","intentId":id,"at":at()}),
                                    &mut seq,
                                    &mut identity,
                                ) {
                                    active.store(false, Ordering::Release);
                                    break;
                                }
                                intent = None;
                            }
                        }
                    }
                }
                let mut poll = libc::pollfd {
                    fd: fd.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ready = unsafe { libc::poll(&mut poll, 1, 100) };
                if ready > 0 && poll.revents & libc::POLLIN != 0 {
                    // We are not the provider's parent: pidfd proves exit, not its exit code.
                    send(
                        json!({"type":"agent.exited","exitObserved":true,"at":at()}),
                        &mut seq,
                        &mut identity,
                    );
                    break;
                }
                if ready < 0
                    && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted
                {
                    break;
                }
            }
            active.store(false, Ordering::Release);
        });
        Ok(true)
    }
    pub(super) fn event(pty_id: &str, mut event: Value) -> Result<(), String> {
        let entries = registry()
            .lock()
            .map_err(|_| "observer registry unavailable")?;
        let entry = entries
            .get(pty_id)
            .filter(|entry| entry.active.load(Ordering::Acquire))
            .ok_or("no verified process observer")?;
        if !event
            .as_object()
            .is_some_and(|o| o.contains_key("capturedIdentity"))
        {
            event["capturedIdentity"] = entry.binding.clone();
        }
        entry
            .sender
            .send(event)
            .map_err(|_| "observer ended".into())
    }
    pub(super) fn capture_input(id: &str, bytes: &[u8]) -> Option<Value> {
        let key = match bytes {
            b"\x03" => "Ctrl+C",
            b"\x1b" => "Escape",
            _ => return None,
        };
        let entries = registry().lock().ok()?;
        let entry = entries
            .get(id)
            .filter(|entry| entry.active.load(Ordering::Acquire))?;
        Some(
            json!({"type":"interruption.intent","key":key,"intentId":uuid::Uuid::new_v4().to_string(),"at":at(),"capturedIdentity":entry.binding}),
        )
    }
    pub(super) fn input(id: &str, observation: Value) {
        let _ = event(id, observation);
    }
    pub(super) fn transport(id: &str, kind: &str) -> Result<(), String> {
        if !matches!(kind, "transport.disconnected" | "transport.reconnected") {
            return Err("unsupported runtime event".into());
        }
        event(id, json!({"type":kind,"at":at()}))
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn birth_identity_handles_spaces_and_parentheses_in_process_name() {
            let mut fields = vec!["S".to_string(); 20];
            fields[19] = "901".into();
            assert_eq!(
                birth(&format!("42 (provider (worker)) {}", fields.join(" "))),
                Some(901)
            );
            assert_eq!(birth("malformed"), None);
        }
        #[test]
        fn pidfd_observes_exact_child_exit_without_ending_parent_shell() {
            let mut child = Command::new("sh")
                .args(["-c", "sleep 0.3"])
                .spawn()
                .unwrap();
            let (fd, token, born) = capture(child.id()).unwrap();
            assert!(born <= at());
            assert!(token.starts_with(&format!("pid-{}-", child.id())));
            let mut poll = libc::pollfd {
                fd: fd.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            assert_eq!(unsafe { libc::poll(&mut poll, 1, 0) }, 0);
            child.wait().unwrap();
            assert_eq!(unsafe { libc::poll(&mut poll, 1, 1000) }, 1);
            assert_ne!(poll.revents & libc::POLLIN, 0);
            assert!(std::path::Path::new(&format!("/proc/{}", std::process::id())).exists());
        }
    }
}

pub fn capture_input(id: &str, bytes: &[u8]) -> Option<serde_json::Value> {
    #[cfg(target_os = "linux")]
    {
        linux::capture_input(id, bytes)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (id, bytes);
        None
    }
}
pub fn commit_input(id: &str, observation: Option<serde_json::Value>) {
    #[cfg(target_os = "linux")]
    if let Some(event) = observation {
        linux::input(id, event);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (id, observation);
}
#[tauri::command]
pub async fn agent_status_observe_process(
    app: tauri::AppHandle,
    file_name: String,
    pty_id: String,
) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(move || linux::bind(app, file_name, pty_id))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, file_name, pty_id);
        Ok(false)
    }
}
#[tauri::command]
pub fn agent_status_runtime_event(pty_id: String, kind: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::transport(&pty_id, &kind);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (pty_id, kind);
        Err("native observer requires Linux".into())
    }
}

/// Full captured-source observation for desktop handoff preflight; no effect/authority.
#[tauri::command]
pub async fn agent_status_source_snapshot(pane_id: String, provider: String) -> Result<serde_json::Value,String> {
    tauri::async_runtime::spawn_blocking(move || crate::handoff_native_bridge::snapshot_observed_source(&pane_id,&provider))
        .await.map_err(|e| e.to_string())?
}
