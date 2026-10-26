//! Private daemon-to-bundled-Node pipes. This is transport, not owner authority.
//! Only an enrolled exact job and a nonserializable resource owner can enter.
//! The daemon wrapper retains its borrowed native lease through this entire call.
use crate::handoff_native::{self, CommitReceipt, EffectReceipt, HostOwnedLifecycleBridge,
    InputIntent, InputReceipt, Intent, Proposal, Recovery};
use crate::handoff_native_binding::{Activation, Registration};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_PACKET_BYTES: usize = 32 * 1024 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    pub provider: String, pub request_id: String,
    pub source_session: String, pub source_pane: String,
    pub target_session: String, pub target_pane: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Document { pub id: String, pub path: String, pub sha256: String }
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Scope {
    pub operation: String, pub binding: Binding, pub head: String, pub documents: Vec<Document>,
}
// Implementations must own/exclude every enrolled source/control/document writer,
// not merely hash files once. They are Rust capabilities, never packet booleans.
pub(crate) trait HeldResources {
    fn validate(&self, scope: &Scope) -> Result<(), String>;
    fn complete(&mut self) -> Result<(), String>;
    fn uncertain(&mut self, operation_id: Option<&str>) -> Result<(), String>;
}
pub(crate) trait ResourceOwner: Send + Sync {
    fn acquire(&self) -> Result<Box<dyn HeldResources + '_>, String>;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Method { Handoff, Input, Register, Activate, Recover }
impl Method {
    fn name(self) -> &'static str { match self {
        Self::Handoff => "commitHandoff", Self::Input => "submit", Self::Register => "registerProviderBinding",
        Self::Activate => "activateProviderBinding", Self::Recover => "recoverUnsent",
    }}
    fn operation(self) -> &'static str { match self {
        Self::Handoff | Self::Recover => "handoff", Self::Input => "native-input",
        Self::Register => "provider-binding", Self::Activate => "provider-startup",
    }}
    fn effect(self) -> Option<&'static str> { match self { Self::Recover => None, _ => Some(self.operation()) } }
}
pub(crate) struct Job {
    pub id: String,
    pub broker_directory: PathBuf,
    pub method: Method,
    pub args: Vec<Value>,
    pub resources: Arc<dyn ResourceOwner>,
}
struct Entry { job: Arc<Job>, claimed: bool, uncertain: bool }
#[derive(Default)]
pub(crate) struct Catalog { entries: Mutex<HashMap<String, Entry>> }
impl Catalog {
    // This locator is not a journal or authority factory. Enrollment must come
    // from the existing trusted source host with already signed exact arguments.
    // No daemon/Tauri request, env value or file can call this private method.
    pub(crate) fn enroll(&self, method: Method, selector: &[u8], job: Job) -> Result<(), String> {
        if job.method != method || job.id.is_empty() || job.id.contains('\0') ||
            !job.broker_directory.is_absolute() || job.args.len() != if method == Method::Input { 2 } else { 1 } {
            return Err("invalid private resolved job".into());
        }
        let key = Self::key(method, selector);
        let mut entries = self.entries.lock().map_err(|_| "private catalog unavailable")?;
        if entries.contains_key(&key) || entries.values().any(|e| e.job.id == job.id) {
            return Err("private job already enrolled; no implicit replay".into());
        }
        entries.insert(key, Entry { job: Arc::new(job), claimed: false, uncertain: false });
        Ok(())
    }
    fn key(method: Method, selector: &[u8]) -> String {
        format!("{}:{}", method.name(), handoff_native::sha256(selector))
    }
    fn claim(&self, method: Method, selector: &[u8]) -> Result<(String, Arc<Job>), String> {
        let key = Self::key(method, selector);
        let mut entries = self.entries.lock().map_err(|_| "private catalog unavailable")?;
        let entry = entries.get_mut(&key).ok_or("private signed job not enrolled; zero effects")?;
        if entry.claimed { return Err("private job consumed or uncertain; reconcile without retry".into()); }
        entry.claimed = true;
        Ok((key, entry.job.clone()))
    }
    fn uncertain(&self, key: &str) {
        if let Ok(mut entries) = self.entries.lock() { if let Some(e) = entries.get_mut(key) { e.uncertain = true; } }
    }
}
static CATALOG: OnceLock<Arc<Catalog>> = OnceLock::new();
pub(crate) fn catalog() -> &'static Arc<Catalog> { CATALOG.get_or_init(|| Arc::new(Catalog::default())) }

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Packet {
    #[serde(rename = "guard")]
    Guard { version: u8, #[serde(rename = "callId")] call_id: String,
        #[serde(rename = "requestId")] request_id: u64, scope: Scope },
    #[serde(rename = "effect")]
    Effect { version: u8, #[serde(rename = "callId")] call_id: String,
        #[serde(rename = "requestId")] request_id: u64, kind: String, intent: Value, native: Value },
    #[serde(rename = "result")]
    Result { version: u8, #[serde(rename = "callId")] call_id: String, ok: bool,
        result: Option<Value>, broker: Option<Value>, error: Option<String> },
}
fn exact<T: for<'de> Deserialize<'de> + Serialize>(v: Value) -> Result<T, String> {
    let typed: T = serde_json::from_value(v.clone()).map_err(|e| format!("private native codec: {e}"))?;
    if serde_json::to_value(&typed).map_err(|e| e.to_string())? != v {
        return Err("private native tuple fields not exact".into());
    }
    Ok(typed)
}

struct Pipe {
    child: Child,
    write: Option<mpsc::Sender<(Vec<u8>, mpsc::Sender<Result<(), String>>)>>,
    read: mpsc::Receiver<Result<Value, String>>,
    deadline: Instant,
}
impl Pipe {
    fn spawn(script: &PathBuf, timeout: Duration) -> Result<Self, String> {
        let mut child = Command::new("node").arg(script).stdin(Stdio::piped())
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        let stdin = child.stdin.take().ok_or("private child stdin absent")?;
        let stdout = child.stdout.take().ok_or("private child stdout absent")?;
        let (write, requests) = mpsc::channel::<(Vec<u8>, mpsc::Sender<Result<(), String>>) >();
        std::thread::spawn(move || {
            let mut stdin = stdin;
            for (bytes, reply) in requests {
                let result = stdin.write_all(&bytes).and_then(|_| stdin.flush()).map_err(|e| e.to_string());
                let failed = result.is_err(); let _ = reply.send(result); if failed { break; }
            }
        });
        let (send, read) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let result = reader.by_ref().take((MAX_PACKET_BYTES + 2) as u64).read_until(b'\n', &mut bytes)
                    .map_err(|e| e.to_string()).and_then(|_| {
                        if bytes.len() > MAX_PACKET_BYTES + 1 { return Err("private packet oversized".into()); }
                        if bytes.last() != Some(&b'\n') {
                            return Err(if bytes.is_empty() { "private packet EOF" } else { "private packet truncated" }.into());
                        }
                        bytes.pop(); if bytes.is_empty() { return Err("private packet empty".into()); }
                        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
                    });
                let failed = result.is_err(); if send.send(result).is_err() || failed { break; }
            }
        });
        Ok(Self { child, write: Some(write), read, deadline: Instant::now() + timeout })
    }
    fn left(&self) -> Result<Duration, String> {
        self.deadline.checked_duration_since(Instant::now()).ok_or("private child timeout".into())
    }
    fn write(&self, packet: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&packet).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_PACKET_BYTES { return Err("private outgoing packet oversized".into()); }
        bytes.push(b'\n'); let (tx, rx) = mpsc::channel();
        self.write.as_ref().ok_or("private child input closed")?.send((bytes, tx)).map_err(|e| e.to_string())?;
        rx.recv_timeout(self.left()?).map_err(|_| "private child write timeout/EOF")?
    }
    fn value(&self) -> Result<Value, String> {
        self.read.recv_timeout(self.left()?).map_err(|_| "private child read timeout/EOF")?
    }
    fn read(&self) -> Result<Packet, String> {
        serde_json::from_value(self.value()?).map_err(|e| format!("private packet schema: {e}"))
    }
    fn exit(&mut self) -> Result<(), String> {
        self.write.take();
        loop {
            if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? {
                if !status.success() { return Err("private child exit unsuccessful".into()); }
                // Wait for the reader's observed EOF, not a racy try_recv. No
                // packet after the final response may certify a second effect.
                return match self.read.recv_timeout(self.left()?) {
                    Ok(Err(error)) if error == "private packet EOF" => Ok(()),
                    Ok(Ok(_)) => Err("private trailing packet after final".into()),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err("private child final EOF unverified".into()),
                };
            }
            let left = self.left()?;
            std::thread::sleep(left.min(Duration::from_millis(2)));
        }
    }
}
impl Drop for Pipe {
    fn drop(&mut self) {
        self.write.take();
        // Only this exact private helper child, never a provider/daemon/session.
        if self.child.try_wait().ok().flatten().is_none() { let _ = self.child.kill(); }
        let _ = self.child.wait();
    }
}

pub(crate) struct Bridge { pub(crate) catalog: Arc<Catalog>, pub(crate) script: Option<PathBuf>, pub(crate) timeout: Duration }
impl Bridge {
    fn run(&self, method: Method, selector: &[u8],
        mut effect: impl FnMut(&str, Value) -> Result<Value, String>) -> Result<Value, String> {
        let (key, job) = self.catalog.claim(method, selector)?;
        let mut held = job.resources.acquire()?;
        let mut operation_id = None;
        let mut known_no_effect = false;
        let result = (|| {
            let script = self.script.as_ref().ok_or("installed private helper closure unavailable; zero effects")?;
            let mut pipe = Pipe::spawn(script, self.timeout)?;
            pipe.write(json!({"version":1,"type":"operation","callId":job.id,
                "job":{"id":job.id,"brokerDirectory":job.broker_directory},"method":method.name(),"args":job.args}))?;
            let mut guard = false;
            let mut validated_scope = None;
            let mut issued = false;
            let mut expected = None;
            loop {
                match pipe.read()? {
                    Packet::Guard { version, call_id, request_id, scope } => {
                        if version != 1 || call_id != job.id || request_id != 1 || guard || scope.operation != method.operation() {
                            return Err("private guard binding/sequence mismatch".into());
                        }
                        let checked = held.validate(&scope);
                        pipe.write(match &checked {
                            Ok(()) => json!({"version":1,"type":"guard-result","callId":job.id,"requestId":request_id,"ok":true}),
                            Err(error) => json!({"version":1,"type":"guard-result","callId":job.id,"requestId":request_id,"ok":false,"error":error}),
                        })?;
                        checked?; guard = true; validated_scope = Some(scope);
                    }
                    Packet::Effect { version, call_id, request_id, kind, intent, native } => {
                        if version != 1 || call_id != job.id || request_id != 2 || !guard || issued || Some(kind.as_str()) != method.effect() {
                            return Err("private effect binding/sequence mismatch; no retry".into());
                        }
                        operation_id = intent.get("id").and_then(Value::as_str).map(str::to_owned);
                        if operation_id.as_ref().is_none_or(|id| id.is_empty()) { return Err("private durable operation ID absent".into()); }
                        let native_id = native.get(if method == Method::Handoff { "operation_id" } else { "id" }).and_then(Value::as_str);
                        if native_id != operation_id.as_deref() { return Err("private durable/native operation ID mismatch".into()); }
                        held.validate(validated_scope.as_ref().ok_or("private held scope missing")?)?;
                        issued = true;
                        let result = effect(&kind, native);
                        pipe.write(match &result {
                            Ok(receipt) => json!({"version":1,"type":"effect-result","callId":job.id,"requestId":request_id,"ok":true,"receipt":receipt}),
                            Err(error) => json!({"version":1,"type":"effect-result","callId":job.id,"requestId":request_id,"ok":false,"error":error}),
                        })?;
                        if let Ok(receipt) = result { expected = Some(receipt); }
                    }
                    Packet::Result { version, call_id, ok, result, broker, error } => {
                        if version != 1 || call_id != job.id { return Err("private final binding mismatch".into()); }
                        if !ok { return Err(error.unwrap_or("private broker denied".into())); }
                        if error.is_some() || !guard || broker.is_none() { return Err("private final outcome incomplete".into()); }
                        let value = result.unwrap_or(Value::Null);
                        if method == Method::Recover {
                            if issued { return Err("unsent recovery attempted native effect".into()); }
                        } else if let Some(receipt) = expected {
                            let wanted = if method == Method::Handoff { json!({"effect":receipt}) } else { receipt };
                            if value != wanted { return Err("private final receipt mismatch".into()); }
                        } else {
                            let status = broker.as_ref().unwrap();
                            if method != Method::Input || issued || !value.is_null() ||
                                !(status["duplicate"] == true || status["status"] == "quarantined") {
                                return Err("private native receipt absent or callback failed".into());
                            }
                            pipe.exit()?;
                            held.complete()?;
                            known_no_effect = true;
                            return Err("already-recorded/quarantined or failed effect; no native replay".into());
                        }
                        pipe.exit()?;
                        held.complete()?;
                        return Ok(value);
                    }
                }
            }
        })();
        if known_no_effect { return result; }
        if result.is_err() {
            self.catalog.uncertain(&key);
            let retained = held.uncertain(operation_id.as_deref());
            return Err(format!("private broker outcome unverified; operation={}; reconcile without retry; {}; resource retention={}",
                operation_id.as_deref().unwrap_or("not-initiated"), result.unwrap_err(), retained.err().unwrap_or("held".into())));
        }
        result
    }
}
impl HostOwnedLifecycleBridge for Bridge {
    fn commit(&self, proposal: &Proposal, native: &mut dyn FnMut(&Intent) -> Result<EffectReceipt, String>) -> Result<CommitReceipt, String> {
        let selector = serde_json::to_vec(proposal).map_err(|e| e.to_string())?;
        exact(self.run(Method::Handoff, &selector, |_, value| {
            let i: Intent = exact(value)?; serde_json::to_value(native(&i)?).map_err(|e| e.to_string())
        })?)
    }
    fn recover_unsent(&self, op: &str, pane: &str, session: &str) -> Result<Recovery, String> {
        let selector = serde_json::to_vec(&json!({"operationId":op,"targetPane":pane,"targetSession":session})).map_err(|e| e.to_string())?;
        let r: Recovery = exact(self.run(Method::Recover, &selector, |_, _| Err("recovery never effects".into()))?)?;
        if r.operation_id != op || r.target_pane != pane || r.target_session != session ||
            r.draft.bytes != r.draft.text.len() || r.draft.sha256 != handoff_native::sha256(r.draft.text.as_bytes()) {
            return Err("private unsent recovery binding mismatch".into());
        }
        Ok(r)
    }
    fn deliver_input(&self, proposal: &str, native: &mut dyn FnMut(&InputIntent) -> Result<InputReceipt, String>) -> Result<InputReceipt, String> {
        exact(self.run(Method::Input, proposal.as_bytes(), |_, value| {
            let i: InputIntent = exact(value)?; serde_json::to_value(native(&i)?).map_err(|e| e.to_string())
        })?)
    }
    fn register_provider(&self, proposal: &str, native: &mut dyn FnMut(&Registration) -> Result<Registration, String>) -> Result<Registration, String> {
        exact(self.run(Method::Register, proposal.as_bytes(), |_, value| {
            let i: Registration = exact(value)?; serde_json::to_value(native(&i)?).map_err(|e| e.to_string())
        })?)
    }
    fn activate_provider(&self, proposal: &str, native: &mut dyn FnMut(&Activation) -> Result<Activation, String>) -> Result<Activation, String> {
        exact(self.run(Method::Activate, proposal.as_bytes(), |_, value| {
            let i: Activation = exact(value)?; serde_json::to_value(native(&i)?).map_err(|e| e.to_string())
        })?)
    }
}

// A fixed complete import closure, resolved alongside the immutable executable
// or by Tauri's existing resource directory. Never a caller/env-selected path.
const HELPER_FILES: &[&str] = &[
    "termfleet-daemon-broker.mjs", "lib/daemon-broker-operation.mjs",
    "lib/daemon-broker-native-codec.mjs", "lib/daemon-broker-stdio.mjs",
    "lib/paid-action-broker.mjs", "lib/native-framed-input-host.mjs",
    "lib/native-input-frame.mjs", "lib/handoff-user-words.mjs",
    "lib/handoff-capsule.mjs", "lib/handoff-records.mjs",
];
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct ResourceReceipt { version: u8, config_sha256: String, files: Vec<ResourceFile> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResourceFile { source: String, target: String, bytes: usize, sha256: String, mode: u32 }
fn configured_resource_map() -> Option<HashMap<String, String>> {
    let config: Value = serde_json::from_slice(include_bytes!("../tauri.conf.json")).ok()?;
    let configured = config.get("bundle")?.get("resources")?.as_object()?;
    if configured.is_empty() { return None; }
    let mut expected = HashMap::new();
    for (source, target) in configured {
        // The configured source is relative to src-tauri; receipt source is
        // normalized relative to the app root, matching the existing installer.
        let mut normalized = PathBuf::from("src-tauri");
        for component in Path::new(source).components() {
            match component {
                std::path::Component::Normal(part) => normalized.push(part),
                std::path::Component::CurDir => {},
                std::path::Component::ParentDir => { if !normalized.pop() { return None; } },
                _ => return None,
            }
        }
        let target = target.as_str()?;
        let p = Path::new(target);
        if p.as_os_str().is_empty() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) ||
            normalized.as_os_str().is_empty() || expected.insert(target.to_owned(), normalized.to_str()?.to_owned()).is_some() { return None; }
    }
    Some(expected)
}
fn raw_release_valid(directory: &Path) -> bool {
    let read = |name: &str| -> Option<Vec<u8>> {
        let p = directory.join(name); let m = std::fs::symlink_metadata(&p).ok()?;
        if !m.is_file() || m.file_type().is_symlink() || m.len() > MAX_PACKET_BYTES as u64 { return None; }
        std::fs::read(p).ok()
    };
    let Some(bytes) = read("resources.json") else { return false; };
    let Some(manifest) = read("manifest.env") else { return false; };
    let Ok(manifest) = std::str::from_utf8(&manifest) else { return false; };
    let hashes: Vec<_> = manifest.lines().filter_map(|line| line.strip_prefix("TERMFLEET_RESOURCES_SHA256=")).collect();
    if hashes != [handoff_native::sha256(&bytes)] { return false; }
    let Ok(receipt) = serde_json::from_slice::<ResourceReceipt>(&bytes) else { return false; };
    if receipt.version != 1 || receipt.config_sha256 != handoff_native::sha256(include_bytes!("../tauri.conf.json")) { return false; }
    let Some(configured) = configured_resource_map() else { return false; };
    if receipt.files.len() != configured.len() { return false; }
    let mut targets = std::collections::HashSet::new();
    for file in &receipt.files {
        if configured.get(&file.target) != Some(&file.source) { return false; }
        let p = Path::new(&file.target);
        if p.is_absolute() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) ||
            !targets.insert(&file.target) || file.source.is_empty() || file.mode & !0o777 != 0 { return false; }
        let path = directory.join(p);
        let Ok(meta) = std::fs::symlink_metadata(&path) else { return false; };
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != file.bytes as u64 ||
            !path.canonicalize().is_ok_and(|real| real.starts_with(directory) && real == path) { return false; }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o777 != file.mode { return false; }
        }
        let Ok(bytes) = std::fs::read(&path) else { return false; };
        if handoff_native::sha256(&bytes) != file.sha256 { return false; }
    }
    HELPER_FILES.iter().all(|file| targets.contains(&format!("agent-hooks/{file}")))
}
pub(crate) fn installed_helper(executable: &Path, resource_directory: Option<&Path>) -> Option<PathBuf> {
    let release = executable.parent()?.canonicalize().ok()?;
    let adjacent = release.join("agent-hooks");
    let raw_layout = release.join("manifest.env").symlink_metadata().is_ok() ||
        release.join("resources.json").symlink_metadata().is_ok() || adjacent.symlink_metadata().is_ok();
    // A malformed raw release cannot evade its receipt via a bundle fallback.
    if raw_layout && !raw_release_valid(&release) { return None; }
    let roots = [if raw_layout {Some(adjacent)} else {None}, resource_directory.map(|p| p.join("agent-hooks"))];
    for root in roots.into_iter().flatten() {
        // The installer verifies/promotes these bytes. This shape check prevents
        // a missing or redirected closure from becoming a source-tree fallback.
        let Ok(meta) = std::fs::symlink_metadata(&root) else { continue; };
        if !meta.is_dir() || meta.file_type().is_symlink() { continue; }
        let Ok(root) = root.canonicalize() else { continue; };
        let valid = HELPER_FILES.iter().all(|name| {
            let p = root.join(name);
            let Ok(m) = std::fs::symlink_metadata(&p) else { return false; };
            m.is_file() && !m.file_type().is_symlink() &&
                p.canonicalize().is_ok_and(|real| real.starts_with(&root) && real == p)
        });
        if valid { return Some(root.join(HELPER_FILES[0])); }
    }
    None
}
#[cfg(not(test))]
fn bundled_helper() -> Option<PathBuf> {
    // Same product/version selection as Tauri generate_context. APPDIR/APPIMAGE
    // cannot change this private bridge's resource path.
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    let info = tauri::PackageInfo {
        name: config.get("productName")?.as_str()?.into(),
        version: config.get("version")?.as_str()?.parse().ok()?,
        authors: env!("CARGO_PKG_AUTHORS"), description: env!("CARGO_PKG_DESCRIPTION"),
        crate_name: env!("CARGO_PKG_NAME"),
    };
    let mut environment = tauri::Env::default();
    #[cfg(target_os="linux")] { environment.appdir = None; environment.appimage = None; }
    let resources = tauri::utils::platform::resource_dir(&info, &environment).ok();
    installed_helper(&std::env::current_exe().ok()?, resources.as_deref())
}
#[cfg(test)] fn bundled_helper() -> Option<PathBuf> { None }

// Actual daemon registration, default empty. Capture/protected-source enrollment
// must supply already verified roles/arguments; transport cannot create them.
pub(crate) fn register_daemon_bridge() -> Result<(), String> {
    handoff_native::register_host_owned_bridge(Arc::new(Bridge {
        catalog: catalog().clone(), script: bundled_helper(), timeout: CALL_TIMEOUT,
    }))
}

// Existing fixed bundled observation helper; no signer or effect authority.
pub(crate) fn source_recovery_helper() -> Option<PathBuf> {
    let broker = bundled_helper()?;
    let p = broker.parent()?.join("termfleet-session-observation.mjs");
    let meta = std::fs::symlink_metadata(&p).ok()?;
    (meta.is_file() && !meta.file_type().is_symlink() && p.canonicalize().ok()? == p).then_some(p)
}
pub(crate) fn recover_observed_source(script: &PathBuf, directory: &Path, pane: &str, provider: &str) -> Result<Value, String> {
    // Only exact privately enrolled paths reach here. The result is OBSERVED
    // admission, never owner approval, delivery, startup or broker reconciliation.
    let mut pipe = Pipe::spawn(script, Duration::from_secs(3))?;
    pipe.write(json!({"operation":"recover-session-source-pending","dir":directory,"paneId":pane,"provider":provider}))?;
    pipe.write.take(); // Existing helper reads a complete request through EOF.
    let value = pipe.value()?;
    if value["version"] != 1 || value["kind"] != "observed-source-recovery" || value["paneId"] != pane || value["provider"] != provider ||
        value["result"]["ok"] != true || value["result"]["trust"] != "observed" || value["result"]["acknowledged"] != false ||
        value["result"]["forwarded"] != false || value["result"]["status"] != "admitted" || value["result"]["receipts"].as_array().is_none() ||
        value["result"]["pending"]["ok"] != true || value["result"]["pending"]["complete"] != true {
        return Err("observed source recovery unverified; retained originals are not acknowledged".into());
    }
    pipe.exit()?;
    Ok(value["result"].clone())
}

// Read-only observed snapshot using the same installed immutable helper closure.
// Neither pane identity nor this packet confers human/approval authority.
pub(crate) fn snapshot_observed_source(pane: &str, provider: &str) -> Result<Value, String> {
    if pane.is_empty() || pane.contains('\0') || !matches!(provider,"claude"|"codex") {
        return Err("invalid observed source scope".into());
    }
    let script=source_recovery_helper().ok_or("installed observed snapshot helper unavailable")?;
    let mut pipe=Pipe::spawn(&script,Duration::from_secs(3))?;
    pipe.write(json!({"operation":"snapshot-session-source-journals","paneId":pane,"provider":provider}))?;
    pipe.write.take();
    let value=pipe.value()?;
    if value["version"]!=1 || value["trust"]!="observed" || (value["ok"]==true && (value["paneId"]!=pane || value["provider"]!=provider)) {
        return Err("observed snapshot reply unverified".into());
    }
    pipe.exit()?;
    Ok(value)
}
