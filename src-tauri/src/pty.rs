use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime};

const MAX_SCROLLBACK_BYTES: usize = 200_000;

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<PtyOutputBuffer>>,
    subscribers: Arc<Mutex<Vec<PtySubscriber>>>,
    initial_cwd: Option<String>,
    command: String,
}

pub struct PtyManager {
    ptys: Mutex<HashMap<String, PtyEntry>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionSummary {
    pub id: String,
    pub pid: Option<u32>,
    pub initial_cwd: Option<String>,
    pub command: String,
    pub scrollback_bytes: usize,
    pub subscriber_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputChunk {
    pub data: String,
    pub base_offset: u64,
    pub next_offset: u64,
}

struct PtySubscriber {
    id: String,
    sender: Sender<String>,
}

#[derive(Debug, Default)]
struct PtyOutputBuffer {
    base_offset: u64,
    data: String,
}

impl PtyOutputBuffer {
    fn append(&mut self, data: &str) {
        self.data.push_str(data);
        if self.data.len() <= MAX_SCROLLBACK_BYTES {
            return;
        }

        let trim_to = self.data.len() - MAX_SCROLLBACK_BYTES;
        let boundary = boundary_at_or_after(&self.data, trim_to);
        self.data.drain(..boundary);
        self.base_offset += boundary as u64;
    }

    fn snapshot(&self) -> String {
        self.data.clone()
    }

    fn read_since(&self, offset: u64) -> PtyOutputChunk {
        let start = offset.max(self.base_offset);
        let relative = (start - self.base_offset) as usize;
        let boundary = boundary_at_or_after(&self.data, relative);
        let data = self.data.get(boundary..).unwrap_or("").to_string();

        PtyOutputChunk {
            data,
            base_offset: self.base_offset,
            next_offset: self.base_offset + self.data.len() as u64,
        }
    }
}

trait PtyEventSink: Send + Sync + 'static {
    fn emit_pty_data(&self, id: &str, data: &str) -> Result<(), String>;
}

#[derive(Clone)]
struct TauriPtyEventSink<R: Runtime> {
    app: AppHandle<R>,
}

struct DetachedPtyEventSink;

impl<R: Runtime> PtyEventSink for TauriPtyEventSink<R> {
    fn emit_pty_data(&self, id: &str, data: &str) -> Result<(), String> {
        self.app
            .emit(&format!("pty-data-{}", id), data)
            .map_err(|error| error.to_string())
    }
}

impl PtyEventSink for DetachedPtyEventSink {
    fn emit_pty_data(&self, _id: &str, _data: &str) -> Result<(), String> {
        Ok(())
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
        }
    }

    pub fn ensure<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<(String, bool), String> {
        self.ensure_with_sink(TauriPtyEventSink { app: app.clone() }, id, cwd, command)
    }

    fn ensure_with_sink<S: PtyEventSink>(
        &self,
        event_sink: S,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<(String, bool), String> {
        let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if self.ptys.lock().unwrap().contains_key(&id) {
            return Ok((id, true));
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let initial_cwd = cwd.clone();
        let shell =
            command.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "bash".into()));
        let command_label = shell.clone();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "C.UTF-8".into()),
        );
        cmd.env(
            "LC_CTYPE",
            std::env::var("LC_CTYPE").unwrap_or_else(|_| "C.UTF-8".into()),
        );

        // Set working directory
        if let Some(dir) = &cwd {
            cmd.cwd(dir);
        } else {
            // Default to home directory
            if let Some(home) = dirs::home_dir() {
                cmd.cwd(home);
            }
        }

        // Spawn the child process on the slave side
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // Drop the slave - the child process has it now
        drop(pair.slave);

        // Get reader and writer from master
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Spawn reader thread that emits events to frontend
        let event_id = id.clone();
        let event_sink = Arc::new(event_sink);
        let output = Arc::new(Mutex::new(PtyOutputBuffer::default()));
        let output_reader = output.clone();
        let subscribers: Arc<Mutex<Vec<PtySubscriber>>> = Arc::new(Mutex::new(Vec::new()));
        let subscribers_reader = subscribers.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        append_pty_output(&output_reader, &data);
                        broadcast_pty_output(&subscribers_reader, &data);
                        if event_sink.emit_pty_data(&event_id, &data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Store the PTY entry. A concurrent renderer may have created the same
        // stable session while this shell was launching; keep the first owner.
        let mut ptys = self.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            let _ = child.kill();
            return Ok((id, true));
        }
        ptys.insert(
            id.clone(),
            PtyEntry {
                master: pair.master,
                writer,
                child,
                output,
                subscribers,
                initial_cwd,
                command: command_label,
            },
        );

        Ok((id, false))
    }

    pub fn spawn<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<String, String> {
        let (id, _) = self.ensure(app, id, cwd, command)?;
        Ok(id)
    }

    pub fn ensure_detached(
        &self,
        id: Option<String>,
        cwd: Option<String>,
        command: Option<String>,
    ) -> Result<(String, bool), String> {
        self.ensure_with_sink(DetachedPtyEventSink, id, cwd, command)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.ptys.lock().unwrap().len()
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        trace_pty(
            "pty.write.start",
            format!("id={id} bytes={} data={data:?}", data.len()),
        );
        let mut ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get_mut(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        entry.writer.flush().map_err(|e| e.to_string())?;
        trace_pty("pty.write.end", format!("id={id} bytes={}", data.len()));
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut ptys = self.ptys.lock().unwrap();
        let mut entry = ptys
            .remove(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry.child.kill().map_err(|e| e.to_string())
    }

    pub fn get_cwd(&self, id: &str) -> Result<String, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let pid = entry
            .child
            .process_id()
            .ok_or_else(|| "Cannot get process ID".to_string())?;
        let link = format!("/proc/{}/cwd", pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    }

    pub fn snapshot(&self, id: &str) -> Result<String, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let snapshot = entry.output.lock().unwrap().snapshot();
        Ok(snapshot)
    }

    pub fn read_since(&self, id: &str, offset: u64) -> Result<PtyOutputChunk, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let chunk = entry.output.lock().unwrap().read_since(offset);
        Ok(chunk)
    }

    pub fn subscribe(&self, id: &str, subscriber_id: String) -> Result<Receiver<String>, String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        let (sender, receiver) = mpsc::channel();
        let mut subscribers = entry.subscribers.lock().unwrap();
        subscribers.retain(|subscriber| subscriber.id != subscriber_id);
        subscribers.push(PtySubscriber {
            id: subscriber_id,
            sender,
        });
        Ok(receiver)
    }

    pub fn unsubscribe(&self, id: &str, subscriber_id: &str) -> Result<(), String> {
        let ptys = self.ptys.lock().unwrap();
        let entry = ptys
            .get(id)
            .ok_or_else(|| format!("PTY {} not found", id))?;
        entry
            .subscribers
            .lock()
            .unwrap()
            .retain(|subscriber| subscriber.id != subscriber_id);
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<PtySessionSummary> {
        let ptys = self.ptys.lock().unwrap();
        ptys.iter()
            .map(|(id, entry)| PtySessionSummary {
                id: id.clone(),
                pid: entry.child.process_id(),
                initial_cwd: entry.initial_cwd.clone(),
                command: entry.command.clone(),
                scrollback_bytes: entry.output.lock().unwrap().data.len(),
                subscriber_count: entry.subscribers.lock().unwrap().len(),
            })
            .collect()
    }
}

fn append_pty_output(output: &Arc<Mutex<PtyOutputBuffer>>, data: &str) {
    trace_pty(
        "pty.output.read",
        format!("bytes={} data={data:?}", data.len()),
    );
    output.lock().unwrap().append(data);
}

fn broadcast_pty_output(subscribers: &Arc<Mutex<Vec<PtySubscriber>>>, data: &str) {
    let mut subscribers = subscribers.lock().unwrap();
    subscribers.retain(|subscriber| subscriber.sender.send(data.to_string()).is_ok());
}

fn trace_pty(label: &str, details: impl AsRef<str>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_some() {
        let line = serde_json::json!({
            "label": label,
            "rustEpochMs": now,
            "details": truncate_trace_detail(details.as_ref()),
        });
        let thread_id = format!("{:?}", std::thread::current().id())
            .chars()
            .filter(|char| char.is_ascii_alphanumeric())
            .collect::<String>();
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!(
                "/tmp/terminal-workspace-latency-trace-{}-{thread_id}.jsonl",
                std::process::id(),
            ))
            .and_then(|mut file| writeln!(file, "{line}"));
    }
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_PTY").is_none() {
        return;
    }
    let line = format!("[TW-PTY] {now} {label} {}\n", details.as_ref());
    eprint!("{line}");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/terminal-workspace-pty-trace.log")
        .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()));
}

fn truncate_trace_detail(details: &str) -> String {
    const MAX_TRACE_DETAIL: usize = 160;
    if details.len() <= MAX_TRACE_DETAIL {
        return details.to_string();
    }
    let boundary = details
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= MAX_TRACE_DETAIL)
        .last()
        .unwrap_or(0);
    format!("{}...", &details[..boundary])
}

fn boundary_at_or_after(data: &str, index: usize) -> usize {
    if index >= data.len() {
        return data.len();
    }

    data.char_indices()
        .find_map(|(boundary, _)| (boundary >= index).then_some(boundary))
        .unwrap_or(data.len())
}

#[cfg(test)]
mod tests {
    use super::PtyManager;

    #[test]
    fn kill_removes_pty_from_manager() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "kill-removes-pty-test".to_string();

        let spawned = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn test PTY");

        assert_eq!(spawned, id);
        manager
            .write(&id, "before kill\n")
            .expect("write before kill");
        manager.kill(&id).expect("kill test PTY");

        let write_after_kill = manager.write(&id, "after kill\n");
        assert!(
            matches!(write_after_kill, Err(ref error) if error.contains("not found")),
            "expected killed PTY to be removed, got {write_after_kill:?}"
        );
    }

    #[test]
    fn spawn_reuses_existing_stable_id() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-reuse-test".to_string();

        let first = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn first stable PTY");
        let second = manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("reuse stable PTY");

        assert_eq!(first, id);
        assert_eq!(second, id);
        assert_eq!(manager.active_count(), 1);

        manager.kill(&id).expect("kill stable PTY");
    }

    #[test]
    fn snapshot_replays_backend_scrollback() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-snapshot-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn snapshot PTY");
        manager
            .write(&id, "snapshot replay\n")
            .expect("write snapshot line");

        let mut snapshot = String::new();
        for _ in 0..20 {
            snapshot = manager.snapshot(&id).expect("read snapshot");
            if snapshot.contains("snapshot replay") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        assert!(
            snapshot.contains("snapshot replay"),
            "expected backend scrollback to include PTY output, got {snapshot:?}"
        );

        manager.kill(&id).expect("kill snapshot PTY");
    }

    #[test]
    fn read_since_returns_incremental_output_cursor() {
        let app = tauri::test::mock_app();
        let manager = PtyManager::new();
        let id = "stable-session-read-since-test".to_string();

        manager
            .spawn(
                app.handle(),
                Some(id.clone()),
                None,
                Some("cat".to_string()),
            )
            .expect("spawn read cursor PTY");
        manager
            .write(&id, "cursor one\n")
            .expect("write first line");

        let mut first = manager.read_since(&id, 0).expect("read first chunk");
        for _ in 0..20 {
            if first.data.contains("cursor one") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
            first = manager.read_since(&id, 0).expect("read first chunk");
        }

        assert!(
            first.data.contains("cursor one"),
            "expected first output chunk, got {first:?}"
        );

        let empty = manager
            .read_since(&id, first.next_offset)
            .expect("read at current cursor");
        assert_eq!(empty.data, "");
        assert_eq!(empty.next_offset, first.next_offset);

        manager
            .write(&id, "cursor two\n")
            .expect("write second line");
        let mut second = manager
            .read_since(&id, first.next_offset)
            .expect("read second chunk");
        for _ in 0..20 {
            if second.data.contains("cursor two") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
            second = manager
                .read_since(&id, first.next_offset)
                .expect("read second chunk");
        }

        assert!(
            second.data.contains("cursor two"),
            "expected incremental output chunk, got {second:?}"
        );

        manager.kill(&id).expect("kill read cursor PTY");
    }

    #[test]
    fn detached_sessions_are_owned_and_listed_without_tauri() {
        let manager = PtyManager::new();
        let id = "detached-session-test".to_string();

        let (first, reused_first) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
            )
            .expect("spawn detached PTY");
        let (second, reused_second) = manager
            .ensure_detached(
                Some(id.clone()),
                Some("/tmp".to_string()),
                Some("cat".to_string()),
            )
            .expect("reuse detached PTY");
        let sessions = manager.list_sessions();

        assert_eq!(first, id);
        assert_eq!(second, id);
        assert!(!reused_first);
        assert!(reused_second);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, id);
        assert_eq!(sessions[0].initial_cwd.as_deref(), Some("/tmp"));

        manager.kill(&id).expect("kill detached PTY");
    }
}
